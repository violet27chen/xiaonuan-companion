import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import WebSocket from "ws";
import { randomUUID } from "node:crypto";

// 豆包实时全双工语音上游地址
const UPSTREAM_URL = "wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue";
const MAX_TOOL_TEXT = 6000;

/**
 * 创建一个实时语音会话：浏览器 <-> 本中继 <-> 豆包。
 * context 结构（兼容独立运行与边缘函数两种调用方式）：
 *   { request: { url, headers? }, env: Record<string,string|undefined> }
 */
function createSession(context) {
  let upstream = null;
  let authenticated = false;
  let upstreamConnected = false;
  let closed = false;
  let eventSeq = 0;
  let audioFrameCount = 0;
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

    async function handleMarkTaken(item) {
      let args = {};
      try { args = JSON.parse(item.arguments || "{}"); } catch {}
      const med_name = String(args.med_name || "").slice(0, 80).trim();
      const dose_time = String(args.dose_time || "").trim();
      const status = args.status === "skipped" ? "skipped" : "taken";
      if (!med_name || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(dose_time)) {
        results.push({ type: "message", role: "tool", call_id: item.call_id, content: [{ type: "input_text", text: "我没听清是哪一顿药，能再说一下药名和钟点吗？" }] });
        return;
      }
      try {
        const response = await fetch(companionUrl(context.request.url, context.env), {
          method: "POST",
          headers: { "content-type": "application/json", "makers-conversation-id": randomUUID() },
          body: JSON.stringify({ action: "medication_taken", med_name, dose_time, status, token }),
        });
        const j = await response.json().catch(() => ({}));
        const text = response.ok && j?.message
          ? String(j.message).slice(0, 200)
          : (j?.error ? `记的时候出了点问题：${String(j.error).slice(0, 120)}` : "好的，我帮您记下了。");
        results.push({ type: "message", role: "tool", call_id: item.call_id, content: [{ type: "input_text", text }] });
      } catch {
        results.push({ type: "message", role: "tool", call_id: item.call_id, content: [{ type: "input_text", text: "网络有点问题，没记上，请再说一次。" }] });
      }
    }

    for (const item of event.items) {
      if (!item?.call_id) continue;
      if (item.name === "xiaonuan_mark_taken") {
        await handleMarkTaken(item);
        continue;
      }
      if (item.name !== "xiaonuan_companion") continue;
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
      if (payload.type === "input_audio_buffer.append") {
        audioFrameCount += 1;
        if (audioFrameCount === 1 || audioFrameCount % 50 === 0) {
          console.log(`[realtime audio] frames=${audioFrameCount} base64_len=${String(payload.audio || "").length}`);
        }
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

// 解析 companion 后端地址：
// 1) 显式 COMPANION_URL（容器内指向 http://api:8000/companion）；2) 本地开发回 127.0.0.1；3) 生产同域推导。
function companionUrl(requestUrl, env) {
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
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (isLocal) {
    return "http://127.0.0.1:8000/companion";
  }
  url.protocol = url.protocol === "http:" || url.protocol === "ws:" ? "http:" : "https:";
  url.pathname = "/companion";
  url.search = "";
  return url.toString();
}

const port = Number(process.env.REALTIME_PORT || 8081);

const TTS_URL = "https://openspeech.bytedance.com/api/v3/tts/unidirectional";
const TTS_RESOURCE_ID = "seed-tts-2.0";
// 默认音色：zh_female_vv_uranus_bigtts（seed-tts-2.0 下本账号可用）。
// 注意：实时对话用的 zh_female_xiaohe_jupiter_bigtts 属于另一套未开通的资源，
// 无法通过「音频生成 HTTP」调用，故这里用可工作的音色，并允许 DOUBAO_TTS_SPEAKER 覆盖。
const TTS_DEFAULT_SPEAKER = process.env.DOUBAO_TTS_SPEAKER || "zh_female_vv_uranus_bigtts";

function readJsonBody(req, limit = 1 << 16) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) { req.destroy(); reject(new Error("body too large")); return; }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try { resolve(Buffer.concat(chunks).toString("utf8")); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

/**
 * 豆包语音「音频生成 HTTP」代理：固定文本的系统播报（欢迎语/用药提醒/拍照复述等）
 * 走这里合成，不再占用实时全双工会话。响应为 NDJSON 流，每行 {"code":0,"data":"<base64>"}，
 * 结束行 {"code":20000000,"data":null}；此处把音频片段拼成完整 mp3 返回。
 */
async function handleTts(req, res) {
  let payload;
  try { payload = JSON.parse(await readJsonBody(req)); }
  catch { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "invalid json" })); return; }
  const text = String(payload?.text || "").trim();
  if (!text) { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "empty text" })); return; }
  if (text.length > 1024) { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "text too long" })); return; }
  const speaker = String(payload?.voice || TTS_DEFAULT_SPEAKER);
  const apiKey = process.env.DOUBAO_TTS_API_KEY || process.env.DOUBAO_REALTIME_API_KEY;
  if (!apiKey) { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "tts not configured" })); return; }
  try {
    const upstream = await fetch(TTS_URL, {
      method: "POST",
      headers: {
        "X-Api-Key": apiKey,
        "X-Api-Resource-Id": TTS_RESOURCE_ID,
        "X-Api-Request-Id": randomUUID(),
        "Content-Type": "application/json",
        "Connection": "keep-alive",
      },
      body: JSON.stringify({
        req_params: {
          text,
          speaker,
          audio_params: { format: "mp3", sample_rate: 24000 },
        },
      }),
    });
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "tts upstream error", status: upstream.status, detail: detail.slice(0, 500) }));
      return;
    }
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const parts = [];
    let upstreamError = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const obj = JSON.parse(line);
          const code = obj?.code ?? obj?.header?.code;
          const msg = obj?.message ?? obj?.header?.message;
          if (code === 0 && obj.data) parts.push(obj.data);
          else if (code && code !== 0 && code !== 20000000) upstreamError = msg ? `${code}: ${msg}` : `${code}`;
        } catch {}
      }
    }
    const tail = buffer.trim();
    if (tail) { try { const obj = JSON.parse(tail); const code = obj?.code ?? obj?.header?.code; const msg = obj?.message ?? obj?.header?.message; if (code === 0 && obj.data) parts.push(obj.data); else if (code && code !== 0 && code !== 20000000) upstreamError = msg ? `${code}: ${msg}` : `${code}`; } catch {} }
    const audio = Buffer.from(parts.join(""), "base64");
    if (!audio.length) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: upstreamError ? `tts upstream: ${upstreamError}` : "tts returned empty audio" }));
      return;
    }
    res.writeHead(200, { "content-type": "audio/mpeg", "content-length": audio.length });
    res.end(audio);
  } catch (e) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "tts failed", detail: String(e?.message || e).slice(0, 500) }));
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  if (req.method === "POST" && url.pathname === "/tts") { handleTts(req, res); return; }
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not found");
});
const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  if (url.pathname !== "/api/realtime") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (client) => {
    const request = {
      url: `http://${req.headers.host || "127.0.0.1"}${url.pathname}${url.search}`,
      headers: { get: (name) => req.headers[name.toLowerCase()] || null },
    };
    const session = createSession({ request, env: process.env });
    client.on("message", (data, isBinary) => session.onmessage(client, data, isBinary));
    client.on("close", () => session.onclose(client));
    client.on("error", (error) => session.onerror(client, error));
    session.onopen(client, req);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Xiaonuan realtime listening on 127.0.0.1:${port}`);
});
