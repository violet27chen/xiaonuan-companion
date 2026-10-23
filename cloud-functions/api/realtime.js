import { randomUUID } from "node:crypto";
import WebSocket from "ws";

const UPSTREAM_URL = "wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue";
const MAX_TOOL_TEXT = 6000;

export async function onRequest(context) {
  if (context.request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("请使用 WebSocket 连接", { status: 426, headers: { Upgrade: "websocket" } });
  }
  if (!context.env?.DOUBAO_REALTIME_API_KEY) {
    return new Response("实时语音服务未配置", { status: 503 });
  }
  // EdgeOne Node Functions upgrades must return the Response from WebSocketPair.
  // Returning a `{ websocket: handler }` object completes the HTTP handshake but
  // does not keep the Node function's WebSocket event loop attached.
  const { socket, response } = new WebSocketPair();
  const session = createSession(context);
  socket.addEventListener("message", (event) => {
    const data = event.data;
    const isBinary = typeof data !== "string"
      && (data instanceof ArrayBuffer || ArrayBuffer.isView(data));
    session.onmessage(socket, data, isBinary);
  });
  socket.addEventListener("close", () => session.onclose(socket));
  socket.addEventListener("error", (event) => session.onerror(socket, event.error || event));
  session.onopen(socket);
  return response;
}

function createSession(context) {
  let upstream = null;
  let authenticated = false;
  let upstreamConnected = false;
  let closed = false;
  let eventSeq = 0;
  let authTimer = null;

  const sendClient = (ws, payload) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(payload));
  };
  const sendUpstream = (payload) => {
    if (upstream?.readyState === WebSocket.OPEN) upstream.send(JSON.stringify(payload));
  };
  const closeClientAfterFlush = (client, code, reason) => {
    setTimeout(() => {
      if (client.readyState === 1) client.close(code, reason);
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
    const verifyUrl = companionUrl(context.request.url);
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
      if (closed || client.readyState !== 1) return;
      if (isBinary) {
        client.send(data);
        return;
      }
      const raw = data.toString();
      let event;
      try { event = JSON.parse(raw); } catch { client.send(raw); return; }
      if (event.type === "response.function_call_arguments.done") {
        handleFunctionCalls(client, event, token).catch((error) => {
          console.error("[realtime tool] failed:", error?.message || error);
          sendClient(client, { type: "xiaonuan.error", message: "刚才没能保存这条信息，请再说一次。" });
        });
      }
      // Forward transcript/text/audio events unchanged; API credentials stay on this server.
      client.send(raw);
    });
    upstream.on("error", (error) => {
      console.error("[realtime upstream] connection error:", error?.message || error);
      sendClient(client, upstreamConnected
        ? { type: "xiaonuan.error", message: "语音服务暂时连接不上，请稍后再试。" }
        : { type: "auth_error", message: "豆包语音连接失败，请检查实时语音服务配置或稍后重试。" });
      closeClientAfterFlush(client, 1011, "upstream connection failed");
    });
    upstream.on("close", () => {
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
      const response = await fetch(companionUrl(context.request.url), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "makers-conversation-id": randomUUID(),
        },
        body: JSON.stringify({ action: "", message, mode, token }),
      });
      if (response.status === 401) {
        sendClient(client, { type: "auth_error", message: "登录已过期，请重新登录" });
        client.close(1008, "authentication failed");
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
      // Send an initial frame immediately so the EdgeOne WebSocket adapter
      // keeps the upgraded connection active while auth/provider setup runs.
      sendClient(client, { type: "server_ready" });
      authTimer = setTimeout(() => {
        if (!authenticated && client.readyState === 1) {
          sendClient(client, { type: "auth_error", message: "连接超时，请重试" });
          client.close(1008, "authentication timeout");
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
          client.close(1011, "authentication service unavailable");
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

function companionUrl(requestUrl) {
  const url = new URL(requestUrl);
  url.protocol = url.protocol === "http:" || url.protocol === "ws:" ? "http:" : "https:";
  url.pathname = "/companion";
  url.search = "";
  return url;
}
