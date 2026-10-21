/**
 * /companion API 层（EdgeOne Makers LangGraph agent，SSE 流式协议）
 * - probeCaps        能力探测 {asr, tts}
 * - askLive          发 wav(base64) → 解析 asr/ai_response 事件 → 回复文本
 * - ttsWav           文本 → base64 wav（带记忆化，供逐句预取）
 * - playWav/stopWav  base64 wav 播放（可中途打断）
 * - speakWithVoice   speechSynthesis 兜底播报
 * - demoReply        演示模式预置回复（服务不可达时保证回路可演示）
 */

import { getToken, getUser, notifyAuthLost } from "./auth.js";

const API = "/companion";

let cid =
  localStorage.getItem("vc_cid") ||
  (() => {
    const v = "c-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("vc_cid", v);
    return v;
  })();

function post(body, signal) {
  const user = getUser();
  const token = getToken();
  if (token) body.token = token;
  return fetch(API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // 登录后按用户隔离会话线：多人共用一台设备，记忆和对话也不串
      "makers-conversation-id": user ? "u-" + user : cid,
    },
    body: JSON.stringify(body),
    signal,
  });
}

/** 令牌失效（过期/被顶掉）：清登录态，界面自动退回登录页 */
function checkAuth(resp) {
  if (resp.status === 401) {
    notifyAuthLost();
    return true;
  }
  return false;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 能力探测：超时/失败返回 null（调用方据此降级演示模式） */
export async function probeCaps(timeoutMs = 5000) {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await post({ action: "caps" }, ctl.signal);
      if (!r.ok) return null;
      const j = await r.json();
      return { asr: !!j.asr, tts: !!j.tts };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/** 健康档案：沿用旧前端的 localStorage 键，老用户的档案继续生效（无编辑 UI，仅随请求上传） */
function profileFromStorage() {
  try {
    const p = JSON.parse(localStorage.getItem("xn_profile") || "{}");
    return p && typeof p === "object" ? p : {};
  } catch {
    return {};
  }
}

/** 发送一段语音，流式收取回复；onAsr 回调语音识别文本，onText 增量回调回复片段 */
export async function askLive(b64, { onAsr, onText, signal } = {}) {
  const resp = await post({ audio: b64, mime: "audio/wav", profile: profileFromStorage() }, signal);
  if (!resp.ok) {
    if (checkAuth(resp)) throw new Error("登录过期了，请重新登录");
    throw new Error("http " + resp.status);
  }
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop();
    for (const p of parts) {
      const line = p.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const s = line.slice(5).trim();
      if (s === "[DONE]") continue;
      let ev;
      try {
        ev = JSON.parse(s);
      } catch {
        continue;
      }
      if (ev.type === "asr") onAsr && onAsr(ev.content);
      else if (ev.type === "ai_response") {
        text += ev.content;
        onText && onText(ev.content); // 边收边断句播报，降低首句等待
      }
      else if (ev.type === "error_message") throw new Error(ev.content || "服务出错");
    }
  }
  return text.trim();
}

const ttsMemo = {};

/** 文本 → base64 wav（记忆化：预取和正式播报不重复请求；失败的条目不驻留，允许重试） */
export function ttsWav(text, signal) {
  if (!text) return Promise.reject(new Error("empty"));
  const hit = ttsMemo[text];
  if (hit) return hit;
  const p = (async () => {
    const r = await post({ action: "tts", text }, signal);
    if (!r.ok) {
      checkAuth(r);
      throw new Error("tts " + r.status);
    }
    const j = await r.json();
    if (!j.audio) throw new Error("no audio");
    return j.audio;
  })();
  p.catch(() => {
    if (ttsMemo[text] === p) delete ttsMemo[text];
  });
  ttsMemo[text] = p;
  return p;
}

/* ---------- wav 播放（可打断） ---------- */
let curAudio = null;
let curResolve = null;

export function playWav(b64) {
  stopWav();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      curAudio = null;
      curResolve = null;
      resolve(v);
    };
    curResolve = finish;
    const a = new Audio("data:audio/wav;base64," + b64);
    curAudio = a;
    a.onended = () => finish("ended");
    a.onerror = () => finish("error");
    a.play().catch(() => finish("blocked"));
  });
}

export function stopWav() {
  if (curAudio) {
    try {
      curAudio.pause();
    } catch {}
  }
  if (curResolve) curResolve("stopped");
}

/* ---------- speechSynthesis 兜底播报 ---------- */
export function speakWithVoice(text) {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    if (!synth || !text) {
      setTimeout(resolve, Math.min(500 + text.length * 150, 2500));
      return;
    }
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => finish("timeout"), 15000);
    try {
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "zh-CN";
      u.rate = 0.95;
      const zh = synth.getVoices().find((v) => /zh|cmn|Chinese/i.test(v.lang + " " + v.name));
      if (zh) u.voice = zh;
      u.onend = () => finish("ended");
      u.onerror = () => finish("error");
      synth.speak(u);
    } catch {
      finish("error");
    }
  });
}

export function stopVoice() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
}

/* ---------- 演示模式预置回复（陪诊情景，轮换） ---------- */
const DEMO_LINES = [
  "您说，我听着呢。今天哪里不舒服？咱们不着急，慢慢说。",
  "嗯，我知道了。我给您记下来，复查的事咱们提前一天提醒您。",
  "好的，我明白了。就诊那天您带上医保卡和以前的检查单，我陪您去。",
  "您慢慢说，不着急，我一直在这儿。要多注意休息，按时吃饭。",
  "好的。这个药一天三次，饭后吃。可别忘了，我会提醒您的。",
];
let demoIdx = 0;

export function demoReply() {
  const t = DEMO_LINES[demoIdx % DEMO_LINES.length];
  demoIdx = (demoIdx + 1) % DEMO_LINES.length;
  return t;
}
