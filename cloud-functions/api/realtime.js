import { randomUUID } from "node:crypto";
import WebSocket from "ws";

const UPSTREAM_URL = "wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue";
const MAX_TOOL_TEXT = 6000;

// EdgeOne Makers Cloud Functions 的 WebSocket 必须用「返回 { websocket: handler }」的形式。
// 之前用的 new WebSocketPair() + return response 是 Cloudflare/边缘运行时写法，在 Makers 下
// 握手会被边缘层拦截成 502（eo-pages-inner-status-intercept: true），浏览器 WS 永远建不起来，
// 前端就显示「实时语音连接失败」。改成下面的对象返回形式即可。
export async function onRequest(context) {
  if (context.request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("请使用 WebSocket 连接", { status: 426, headers: { Upgrade: "websocket" } });
  }
  if (!context.env?.DOUBAO_REALTIME_API_KEY) {
    return new Response("实时语音服务未配置", { status: 503 });
  }
  return { websocket: createSession(context) };
}

function createSession(context) {
  let upstream = null;
  let authenticated = false;
  let upstreamConnected = false;
  let closed = false;
  let eventSeq = 0;
  let authTimer = null;

  const isOpen = (ws) => ws == null || ws.readyState == null || ws.readyState === 1;
  const sendClient = (ws, payload) => {
    try { ws.send(JSON.stringify(payload)); } catch {}
  };
  const sendUpstream = (payload) => {
    if (upstream?.readyState === WebSocket.OPEN) upstream.send(JSON.stringify(payload));
  };
  const closeClientAfterFlush = (client, code, reason) => {
    setTimeout(() => {
      try { client.close?.(code, reason); } catch {}
    }, 120);
  };
  const shutdown = () => {
    closed = true;
    if (upstream && upstream.readyState < WebSocket.CLOSING) {
      try { upstream.close(); } catch {}
    }
    upstream = null;
  };

  async function authenticateAndConnect(client, payload) {
    const token = typeof payload.token === "string" ? payload.token : "";
    if (!token || token.length > 512) {
      sendClient(client, { type: "auth_error", message: "请先登录后再使用语音" });
      closeClientAfterFlush(client, 1008, "authentication required");
      return;
    }
    const verifyUrl = companionUrl(context.request.url, context.env);
    const verify = await fetch(verifyUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "makers-conversation-id": randomUUID(),
      },
      body: JSON.stringify({ action: "auth_check", token }),
    });
    const verifyBody = await verify.json().catch(() => null);
    const verifyError = verifyBody?.error || (Array.isArray(verifyBody) && verifyBody[0]?.error);
    if (!verify.ok || verifyError || verifyBody?.ok === false) {
      sendClient(client, { type: "auth_error", message: "登录已过期，请重新登录" });
      closeClientAfterFlush(client, 1008, "authentication failed");
      return;
    }
    authenticated = true;
    upstream = new WebSocket(UPSTREAM_URL, {
      headers: {
        "X-Api-Key": context.env.DOUBAO_REALTIME_API_KEY,
        "X-Api-Connect-Id": randomUUID(),
      },
      handshakeTimeout: 12000,
      perMessageDeflate: false,
    });
    upstream.on("open", () => {
      upstreamConnected = true;
      sendClient(client, { type: "auth_ok" });
    });
    upstream.on("message", (data, isBinary) => {
      if (closed) return;
      if (isBinary) {
        try { client.send(data); } catch {}
        return;
      }
      const raw = data.toString();
      let event;
      try { event = JSON.parse(raw); } catch { try { client.send(raw); } catch {} return; }
      if (event.type === "response.function_call_arguments.done") {
        handleFunctionCalls(client, event, token).catch((error) => {
          console.error("[realtime tool] failed:", error?.message || error);
          sendClient(client, { type: "xiaonuan.error", message: "刚才没能保存这条信息，请再说一次。" });
        });
      }
      try { client.send(raw); } catch {}
    });
    upstream.on("error", (error) => {
      // 把豆包上游的真实错误码透传出来，便于区分「出网/DNS 问题」还是「密钥问题」。
      const reason = error?.code || error?.message || "unknown";
      console.error("[realtime upstream] connection error:", error?.message || error, "code=", error?.code);
      sendClient(client, upstreamConnected
        ? { type: "xiaonuan.error", message: `语音服务暂时连接不上（${reason}），请稍后再试。` }
        : { type: "auth_error", message: `豆包语音连接失败（${reason}），请检查实时语音服务配置或稍后重试。` });
      closeClientAfterFlush(client, 1011, "upstream connection failed");
    });
    upstream.on("close", (code, reason) => {
      console.error("[realtime upstream] closed code=", code, "reason=", reason?.toString?.() || reason);
      if (!closed) {
        sendClient(client, upstreamConnected
          ? { type: "upstream_closed" }
          : { type: "auth_error", message: "豆包语音未能建立连接，请稍后重试。" });
        closeClientAfterFlush(client, 1011, "voice provider disconnected");
      }
    });
  }

  async function handleFunctionCalls(client, event, token) {
    if (!authenticated || !Array.isArray(event.items)) return;
    const results = [];
    for (const item of event.items) {
      if (item?.name !== "xiaonuan_companion" || !item.call_id) continue;
      let args = {};
      try { args = JSON.parse(item.arguments || "{}"); } catch {}
      const message = typeof args.message === "string" ? args.message.trim().slice(0, 1000) : "";
      const mode = ["auto", "pre", "post", "chat"].includes(args.mode) ? args.mode : "auto";
      if (!message) {
        results.push({ type: "message", role: "tool", call_id: item.call_id, content: [{ type: "input_text", text: "没有识别到需要整理的内容。" }] });
        continue;
      }
      const response = await fetch(companionUrl(context.request.url, context.env), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "makers-conversation-id": randomUUID(),
        },
        body: JSON.stringify({ action: "", message, mode, token }),
      });
      if (response.status === 401) {
        sendClient(client, { type: "auth_error", message: "登录已过期，请重新登录" });
        try { client.close?.(1008, "authentication failed"); } catch {}
        return;
      }
      if (!response.ok || !response.body) throw new Error(`companion request ${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answer = "";
      while (!closed) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() || "";
        for (const block of blocks) {
          const line = block.split("\n").find((row) => row.startsWith("data:"));
          if (!line) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          let itemEvent;
          try { itemEvent = JSON.parse(data); } catch { continue; }
          if (itemEvent.type === "ai_response") answer += itemEvent.content || "";
          else if (itemEvent.type === "card") sendClient(client, { type: "xiaonuan.card", data: itemEvent.data });
          else if (itemEvent.type === "mode") sendClient(client, { type: "xiaonuan.mode", mode: itemEvent.mode });
          else if (itemEvent.type === "error_message") answer = itemEvent.content || "这次没整理成功，请再说一次。";
        }
      }
      const safeAnswer = answer.trim().slice(0, MAX_TOOL_TEXT) || "我已经听到，正在帮您整理。";
      results.push({
        type: "message",
        role: "tool",
        call_id: item.call_id,
        content: [{ type: "input_text", text: safeAnswer }],
      });
    }
    if (results.length && !closed) {
      sendUpstream({ type: "conversation.item.create", event_id: `tool_${++eventSeq}`, items: results });
    }
  }

  return {
    onopen(client) {
      sendClient(client, { type: "server_ready" });
      authTimer = setTimeout(() => {
        if (!authenticated && isOpen(client)) {
          sendClient(client, { type: "auth_error", message: "连接超时，请重试" });
          try { client.close?.(1008, "authentication timeout"); } catch {}
        }
      }, 10000);
    },
    async onmessage(client, data, isBinary) {
      if (closed || isBinary) return;
      let payload;
      try { payload = JSON.parse(typeof data === "string" ? data : data.toString()); }
      catch { sendClient(client, { type: "xiaonuan.error", message: "语音数据格式不正确" }); return; }
      if (!authenticated) {
        if (payload.type !== "auth") return;
        clearTimeout(authTimer);
        try { await authenticateAndConnect(client, payload); }
        catch (error) {
          console.error("[realtime auth] failed:", error?.message || error);
          sendClient(client, { type: "auth_error", message: "语音服务暂时不可用，请稍后再试。" });
          try { client.close?.(1011, "authentication service unavailable"); } catch {}
        }
        return;
      }
      if (!upstream || upstream.readyState !== WebSocket.OPEN) {
        sendClient(client, { type: "xiaonuan.error", message: "语音服务正在连接，请稍候" });
        return;
      }
      sendUpstream(payload);
    },
    onclose(client) {
      clearTimeout(authTimer);
      shutdown();
    },
    onerror(client, error) {
      console.error("[realtime client] socket error:", error?.message || error);
      shutdown();
    },
  };
}

function companionUrl(requestUrl, env) {
  // 1) 显式覆盖优先（可在 .env / 函数环境变量里设 COMPANION_URL，例如本地指向真实后端）。
  const override = env?.COMPANION_URL || process.env.COMPANION_URL;
  if (override) {
    try {
      const u = new URL(override);
      u.pathname = "/companion";
      u.search = "";
      return u.toString();
    } catch {}
  }
  let url;
  try { url = new URL(requestUrl); } catch { return "/companion"; }
  // 2) 本地开发：函数运行时的 request.url 是 Makers 内部端口（如 9001），
  //    同域推导会被 dev server 代理到错误端口而 ECONNREFUSED（并曾导致 CLI 崩溃）。
  //    Python 后端(agent-python) 实际在 127.0.0.1:9100，本地直接打它即可绕过坏代理。
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (isLocal) {
    return "http://127.0.0.1:9100/companion";
  }
  // 3) 生产：/companion 与 /api/realtime 同域名，同域推导即可。
  url.protocol = url.protocol === "http:" || url.protocol === "ws:" ? "http:" : "https:";
  url.pathname = "/companion";
  url.search = "";
  return url;
}
