import { useEffect, useRef, useState } from "react";
import { encodeWav, blobToBase64, splitSent } from "../lib/wav.js";
import {
  probeCaps,
  askLive,
  ttsWav,
  playWav,
  stopWav,
  speakWithVoice,
  stopVoice,
  demoReply,
  sleep,
} from "../lib/ai.js";

/* VAD：说话阈值 / 静音自动断句 / 最短 / 最长 */
const SPEECH_RMS = 0.02;
const SILENCE_MS = 1200;
const MIN_MS = 500;
const MAX_MS = 20000;
const FRAME = 4096;

export const PHASE_TEXT = {
  boot: "小暖马上就来",
  listen: "我在听，您说",
  think: "小暖思考中…",
  speak: "",
  idle: "点一下话筒，跟我说话",
};

/**
 * 免手接续语音对话回路：
 *   listen（VAD 静音自动断句）→ think（ASR+回复）→ speak（逐句播报）→ listen …
 * 回复边收边播：凑满一句就立刻合成语音开播，不用等整段回复，首句等待大幅缩短。
 * 全程不用点麦克风。话筒按钮语义：
 *   聆听中点按 = 立即发送已录内容（没说话则只是静音）；小暖说话/思考中点按 = 打断并继续听；空闲点按 = 开麦。
 */
export function useConversation() {
  const [phase, setPhase] = useState("boot"); // boot|idle|listen|think|speak
  const [micOn, setMicOn] = useState(false);
  const [level, setLevel] = useState(0); // 0~1，驱动人物呼吸/嘴型
  const [subtitle, setSubtitle] = useState(null); // {who:"您"|"小暖", text}
  const [demoMode, setDemoMode] = useState(false);
  const [micError, setMicError] = useState("");

  const ctxRef = useRef(null);
  const streamRef = useRef(null);
  const srcRef = useRef(null);
  const procRef = useRef(null);
  const recBufRef = useRef([]);
  const vadRef = useRef({ speechSeen: false, silenceMs: 0 });
  const recordingRef = useRef(false);
  const busyRef = useRef(false); // 一小轮对话（请求+播报）进行中
  const turnRef = useRef(0); // 回合令牌：打断/新一轮自增，旧循环据此退出
  const abortRef = useRef(null);
  const maxTimerRef = useRef(0);
  const lastAmpRef = useRef(0);
  const micOnRef = useRef(false);
  const demoRef = useRef(false);
  const graphReadyRef = useRef(false);
  const startingRef = useRef(false);
  const startedRef = useRef(false);

  /* ================= 启动：能力探测，决定 live / demo ================= */
  useEffect(() => {
    let alive = true;
    (async () => {
      const q = new URLSearchParams(location.search).get("mode");
      if (q === "demo" || q === "live") {
        demoRef.current = q === "demo";
      } else {
        const caps = await probeCaps();
        demoRef.current = !(caps && caps.asr);
      }
      if (!alive) return;
      setDemoMode(demoRef.current);
      setPhase("idle");
    })();
    return () => {
      alive = false;
    };
  }, []);

  /* ================= 音频图：首次手势时创建，之后复用 ================= */
  async function ensureGraph() {
    if (graphReadyRef.current && ctxRef.current) {
      if (ctxRef.current.state === "suspended") {
        try {
          await ctxRef.current.resume();
        } catch {}
      }
      return;
    }
    // getUserMedia 软约束 + 重试 + 单次超时（权限弹窗不响应时 promise 会永久挂起）
    let stream = null;
    let lastErr = null;
    for (let i = 0; i < 3 && !stream; i++) {
      try {
        stream = await Promise.race([
          navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: { ideal: true },
              noiseSuppression: { ideal: true },
              autoGainControl: { ideal: true },
            },
          }),
          sleep(6000).then(() => {
            throw new Error("mic-timeout");
          }),
        ]);
      } catch (e) {
        lastErr = e;
        await sleep(400);
      }
    }
    if (!stream) throw lastErr || new Error("mic");
    streamRef.current = stream;
    stream.getTracks().forEach((t) => (t.enabled = false)); // 默认静音，开聊再打开
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    ctxRef.current = ctx;
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(FRAME, 1, 1);
    proc.onaudioprocess = onFrames;
    src.connect(proc);
    proc.connect(ctx.destination);
    srcRef.current = src;
    procRef.current = proc;
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {}
    }
    graphReadyRef.current = true;
  }

  /* ================= VAD 收音 ================= */
  function onFrames(e) {
    if (!recordingRef.current) return;
    const d = e.inputBuffer.getChannelData(0);
    recBufRef.current.push(new Float32Array(d));
    let sum = 0;
    for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
    const rms = Math.sqrt(sum / d.length);
    const now = performance.now();
    if (now - lastAmpRef.current > 90) {
      lastAmpRef.current = now;
      setLevel(Math.min(1, rms * 7));
    }
    const vad = vadRef.current;
    if (rms > SPEECH_RMS) {
      vad.speechSeen = true;
      vad.silenceMs = 0;
    } else if (vad.speechSeen) {
      const rate = (ctxRef.current && ctxRef.current.sampleRate) || 48000;
      vad.silenceMs += (d.length / rate) * 1000;
      if (vad.silenceMs >= SILENCE_MS) finishTurn();
    }
  }

  function beginListen() {
    if (busyRef.current) return; // 小暖在说/在想，不抢麦
    if (!graphReadyRef.current) {
      startMic();
      return;
    }
    clearTimeout(maxTimerRef.current);
    recBufRef.current = [];
    vadRef.current = { speechSeen: false, silenceMs: 0 };
    recordingRef.current = true;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => (t.enabled = true));
    }
    setSubtitle(null);
    setLevel(0.06);
    setPhase("listen");
    maxTimerRef.current = setTimeout(finishTurn, MAX_MS); // 最长 20s 自动断
  }

  function finishTurn() {
    clearTimeout(maxTimerRef.current);
    recordingRef.current = false;
    const chunks = recBufRef.current;
    recBufRef.current = [];
    const sawSpeech = vadRef.current.speechSeen;
    const rate = (ctxRef.current && ctxRef.current.sampleRate) || 48000;
    const total = chunks.reduce((n, c) => n + c.length, 0);
    if (!chunks.length || !sawSpeech || total < rate * (MIN_MS / 1000)) {
      setLevel(0);
      setSubtitle(null);
      beginListen(); // 太短/没声：继续听，不发送
      return;
    }
    const pcm = new Float32Array(total);
    let off = 0;
    chunks.forEach((c) => {
      pcm.set(c, off);
      off += c.length;
    });
    blobToBase64(encodeWav(pcm, rate))
      .then((b64) => sendTurn(b64))
      .catch(() => beginListen());
  }

  /* ================= 发送 → 回复 → 流式逐句播报 ================= */
  async function sendTurn(b64) {
    const token = ++turnRef.current;
    busyRef.current = true;
    setPhase("think");
    setSubtitle(null);
    const sents = []; // 句子队列：随到随播
    let streamDone = false;
    let tail = "";

    /** 收到一段回复文本就断句：凑满一句立刻合成语音，不用等整段回复 */
    const onText = (t) => {
      if (token !== turnRef.current) return;
      tail += t;
      for (;;) {
        const m = tail.match(/^[\s\S]*?[。！？!?；;]/);
        if (!m) break;
        const s = m[0].trim();
        tail = tail.slice(m[0].length);
        if (!s) continue;
        sents.push(s);
        if (!demoRef.current) ttsWav(s).catch(() => {}); // 边收边合成
      }
    };

    // 播报器与请求并发跑：第一句合成好就开播，不等整段回复
    const player = speakStream(sents, token, () => streamDone);

    let text = "";
    try {
      if (demoRef.current) {
        await sleep(600);
        text = demoReply();
        splitSent(text).forEach((s) => sents.push(s));
      } else {
        abortRef.current = new AbortController();
        text = await askLive(b64, {
          signal: abortRef.current.signal,
          onAsr: (t) => {
            if (token === turnRef.current) {
              setSubtitle({ who: "您", text: t });
            }
          },
          onText,
        });
      }
    } catch (e) {
      if (token !== turnRef.current) return; // 已被打断/新一轮取代（播报器自行退出）
      // 服务不可用：自动降级演示模式，保证对话回路不断
      demoRef.current = true;
      setDemoMode(true);
      await sleep(300);
      text = demoReply();
      splitSent(text).forEach((s) => sents.push(s));
    }
    if (token !== turnRef.current) return;
    streamDone = true;
    const rest = tail.trim();
    if (rest) sents.push(rest);
    await player;
  }

  /** 流式播报：句子随到随播；要说话了字幕才出现（与语音同步），首句开播才从"思考中"切到播报态 */
  async function speakStream(sents, token, isDone) {
    let i = 0;
    let started = false;
    while (token === turnRef.current) {
      if (i >= sents.length) {
        if (isDone()) break; // 流结束（含无回复）
        await sleep(50);
        continue;
      }
      const sent = sents[i++];
      if (demoRef.current) {
        if (!started) {
          started = true;
          setPhase("speak");
        }
        setSubtitle({ who: "小暖", text: sent });
        await speakWithVoice(sent);
      } else {
        // 先合成音频：合成好、即将发声的那一刻才上字幕，杜绝"文字先站一会儿才开口"
        let b64 = null;
        try {
          b64 = await ttsWav(sent);
        } catch {}
        if (token !== turnRef.current) return;
        if (i < sents.length) ttsWav(sents[i]).catch(() => {}); // 预取下一句
        if (!started) {
          started = true;
          setPhase("speak");
        }
        setSubtitle({ who: "小暖", text: sent });
        let played = false;
        if (b64) {
          try {
            played = (await playWav(b64)) === "ended";
          } catch {}
        }
        if (token !== turnRef.current) return;
        if (!played) await speakWithVoice(sent); // 自动播放被拦/TTS 失败 → 语音合成兜底
      }
    }
    if (token !== turnRef.current) return;
    busyRef.current = false;
    setLevel(0);
    afterTurn();
  }

  function afterTurn() {
    if (micOnRef.current) beginListen(); // 听完自动继续听，不用点麦克风
    else setPhase("idle");
  }

  /* ================= 打断 / 麦克风开关 ================= */
  function interruptTurn() {
    turnRef.current += 1; // 旧回合全部作废
    busyRef.current = false;
    if (abortRef.current) {
      try {
        abortRef.current.abort();
      } catch {}
      abortRef.current = null;
    }
    stopWav();
    stopVoice();
  }

  async function startMic() {
    if (startingRef.current) return;
    startingRef.current = true;
    try {
      await ensureGraph();
      micOnRef.current = true;
      setMicOn(true);
      setMicError("");
      startedRef.current = true;
      if (busyRef.current) interruptTurn(); // 小暖正在说：打断，听您说
      beginListen();
    } catch (e) {
      setMicError("麦克风没打开，再点一下试试");
    } finally {
      startingRef.current = false;
    }
  }

  function muteMic() {
    micOnRef.current = false;
    setMicOn(false);
    recordingRef.current = false;
    clearTimeout(maxTimerRef.current);
    recBufRef.current = [];
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => (t.enabled = false));
    }
    setLevel(0);
    setSubtitle(null);
    if (!busyRef.current) setPhase("idle"); // 小暖还在说就让它说完
  }

  /** 聆听中点话筒（关麦）：有说到话就立刻发送，没听到就只是静音 */
  function stopAndSend() {
    clearTimeout(maxTimerRef.current);
    recordingRef.current = false;
    const chunks = recBufRef.current;
    recBufRef.current = [];
    const sawSpeech = vadRef.current.speechSeen;
    const rate = (ctxRef.current && ctxRef.current.sampleRate) || 48000;
    const total = chunks.reduce((n, c) => n + c.length, 0);
    micOnRef.current = false;
    setMicOn(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => (t.enabled = false));
    }
    setLevel(0);
    if (!chunks.length || !sawSpeech || total < rate * (MIN_MS / 1000)) {
      setSubtitle(null);
      setPhase("idle"); // 没听到说话：只是关了麦克风
      return;
    }
    const pcm = new Float32Array(total);
    let off = 0;
    chunks.forEach((c) => {
      pcm.set(c, off);
      off += c.length;
    });
    setPhase("think"); // 立刻进入思考，不用等静音断句
    blobToBase64(encodeWav(pcm, rate))
      .then((b64) => sendTurn(b64))
      .catch(() => setPhase("idle"));
  }

  function toggleMic() {
    if (phase === "boot") return;
    if (micOnRef.current) {
      if (busyRef.current) {
        interruptTurn(); // 小暖说话/思考中：打断并继续听
        beginListen();
      } else {
        stopAndSend(); // 聆听中点一下：立刻发送已录内容
      }
    } else {
      startMic(); // 空闲：开麦
    }
  }

  /* ================= 音量：播报时模拟律动 ================= */
  useEffect(() => {
    if (phase !== "speak") return;
    let v = 0.45;
    const id = setInterval(() => {
      v = v + (0.55 - v) * 0.25 + (Math.random() - 0.5) * 0.5;
      setLevel(Math.min(0.95, Math.max(0.15, v)));
    }, 150);
    return () => clearInterval(id);
  }, [phase]);

  /* ================= 首次手势即开聊（点屏幕任意处） ================= */
  useEffect(() => {
    const kick = (e) => {
      // 点到功能按钮上时不抢跑：交给按钮自己的开关逻辑，避免开麦/关麦相互抵消
      if (e.target && e.target.closest && e.target.closest("button")) return;
      if (phase === "idle" && !micOnRef.current && !startedRef.current) startMic();
    };
    window.addEventListener("pointerdown", kick, { capture: true });
    return () => window.removeEventListener("pointerdown", kick, { capture: true });
  }, [phase]);

  /* ================= 前后台切换：恢复被浏览器挂起的音频上下文 =================
     页面切后台时 Chrome 会挂起 AudioContext（onaudioprocess 停火，VAD 静默死亡），
     回到前台后 resume；麦克风开着却没在收音时重新开始听。 */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const ctx = ctxRef.current;
      if (ctx && ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }
      if (micOnRef.current && !busyRef.current && graphReadyRef.current && !recordingRef.current) {
        beginListen();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  /* ================= 排障钩子 ================= */
  useEffect(() => {
    window.__vc = {
      state: () => ({ phase, micOn, demo: demoRef.current, busy: busyRef.current }),
      demo: (v) => {
        demoRef.current = !!v;
        setDemoMode(!!v);
      },
      speak: (t) => {
        const token = ++turnRef.current;
        busyRef.current = true;
        speakStream(splitSent(t), token, () => true);
      },
      listen: () => beginListen(),
      mute: () => muteMic(),
    };
    return () => {
      delete window.__vc;
    };
  });

  /* ================= 卸载清理 ================= */
  useEffect(
    () => () => {
      recordingRef.current = false;
      clearTimeout(maxTimerRef.current);
      stopWav();
      stopVoice();
      try {
        procRef.current && procRef.current.disconnect();
      } catch {}
      try {
        srcRef.current && srcRef.current.disconnect();
      } catch {}
      try {
        streamRef.current && streamRef.current.getTracks().forEach((t) => t.stop());
      } catch {}
      try {
        ctxRef.current && ctxRef.current.close();
      } catch {}
    },
    []
  );

  return { phase, micOn, level, subtitle, demoMode, micError, toggleMic };
}
