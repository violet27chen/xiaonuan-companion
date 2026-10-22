/**
 * /companion API 层（EdgeOne Makers LangGraph agent，SSE 流式协议）
 * - probeCaps        能力探测 {asr, tts}
 * - askLive          发 wav(base64) → 解析 asr/ai_response 事件 → 回复文本
 * - ttsWav           文本 → base64 wav（带记忆化，供逐句预取）
 * - playWav/stopWav  base64 wav 播放（可中途打断）
 * - speakWithVoice   speechSynthesis 兜底播报
 * - demoReply        演示模式预置回复（服务不可达时保证回路可演示）
 */

import { getToken, getCid, notifyAuthLost } from "./auth.js";

const API = "/companion";

function post(body, signal) {
  const token = getToken();
  if (token) body.token = token;
  return fetch(API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // 会话线：登录后是按用户分配的 id（后端返回），未登录为浏览器临时值；
      // 平台要求 6-36 位 [0-9a-zA-Z-_.]，每次请求都必须带
      "makers-conversation-id": getCid(),
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
export async function probeCaps(timeoutMs = 12000) {
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

/** 发送一段语音，流式收取回复；onAsr 回调语音识别文本，onText 增量回调回复片段，onCard 回调结构化卡片 */
export async function askLive(b64, { onAsr, onText, onCard, onMode, signal, mode = "auto" } = {}) {
  const resp = await post({ audio: b64, mime: "audio/wav", mode }, signal);
  if (!resp.ok) {
    if (checkAuth(resp)) throw new Error("登录过期了，请重新登录");
    const errorBody = await resp.json().catch(() => ({}));
    throw new Error(errorBody.error || "http " + resp.status);
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
      else if (ev.type === "mode") onMode && onMode(ev.mode);
      else if (ev.type === "ai_response") {
        text += ev.content;
        onText && onText(ev.content); // 边收边断句播报，降低首句等待
      }
      else if (ev.type === "card") onCard && onCard(ev.data);
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

/* ---------- TTS 预取与播放 ---------- */
/** 预取完整音频；MiMo 流式片段在真机上存在不稳定表现，先使用已验证可回听的完整 MP3。 */
export function ttsStreamStart(text) {
  if (text) ttsWav(text).catch(() => {});
}

/* ---------- wav 播放（可打断） ---------- */
let curAudio = null;
let curResolve = null;
let audioMuted = false;

export function setAudioMuted(muted) {
  audioMuted = !!muted;
  if (curAudio) curAudio.muted = audioMuted;
  if (audioMuted) stopVoice();
}

/** 只停当前播放（不取消预取流）：playStream 开头用来打断上一句 */
function stopCurrent() {
  if (curAudio) {
    try {
      curAudio.pause();
    } catch {}
  }
  if (curResolve) curResolve("stopped");
}

/** 播放已预取的完整句子，等音频实际开始时再显示字幕。 */
export function playStream(text, { onStart } = {}) {
  stopCurrent();
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
    ttsWav(text).then((b64) => {
      if (settled) return;
      const audio = new Audio("data:audio/mpeg;base64," + b64);
      audio.muted = audioMuted;
      curAudio = audio;
      audio.onended = () => finish("ended");
      audio.onerror = () => finish("error");
      audio.play().then(() => onStart && onStart()).catch(() => finish("blocked"));
    }).catch(() => finish("error"));
  });
}

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
    const a = new Audio("data:audio/mpeg;base64," + b64); // 后端已改返回 mp3
    a.muted = audioMuted;
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
export function speakWithVoice(text, { onStart } = {}) {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    if (audioMuted) {
      resolve("muted");
      return;
    }
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
      u.onstart = () => onStart && onStart();
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
  "我在听呢，您慢慢说，想从哪儿聊起都可以。",
  "嗯，我听明白了。我先按您刚才说的记下来。",
  "好，我陪您把这件事一项一项理清楚。",
  "您慢慢说，不着急，我会认真听着。",
  "我记下来了，您接着说。",
];
let demoIdx = 0;

export function demoReply() {
  const t = DEMO_LINES[demoIdx % DEMO_LINES.length];
  demoIdx = (demoIdx + 1) % DEMO_LINES.length;
  return t;
}
