import { useCallback, useEffect, useRef, useState } from "react";
import { getToken, notifyAuthLost } from "../lib/auth.js";
import { getSpeechSpeed, isAudioMuted } from "../lib/ai.js";

export const PHASE_TEXT = {
  boot: "小暖马上就来",
  listen: "我在听，您说",
  recognize: "正在听清您刚才的话…",
  think: "小暖思考中…",
  speak: "",
  idle: "点一下话筒，跟我说话",
};

function voiceCommandFor(text) {
  const t = String(text || "").replace(/[，。！？、,.!?\s]/g, "");
  if (/智能冲药机|自动冲药|冲药机方案|冲药设备|设备准备清单|智能泡药|自动泡药|泡药机|泡茶设备|健康茶设备/.test(t)) return "dispenser";
  if (!/(不想|不需要|不要|别|不用|先不).{0,6}(拍照|拍一张|药盒|药瓶|处方|医嘱|照片)/.test(t)
      && /拍照|拍一张|拍给小暖|药盒|药瓶|处方|医嘱|药品说明书|药怎么吃|怎么服用|如何服用|药名|认药|用法用量|看.{0,6}药|这是什么药/.test(t)) return "photo";
  if (/看完医生|刚看完医生|已经看完|看完了/.test(t)) return "visit_post";
  if (/看诊前|看医生前|准备看医生|准备就诊|整理就诊问题/.test(t)) return "visit_pre";
  if (/自动识别|自动模式/.test(t)) return "mode_auto";
  if (/看诊后|就诊后|整理医嘱|医生交代|复诊安排/.test(t)) return "mode_post";
  if (/就诊前|看医生前|准备就诊/.test(t)) return "mode_pre";
  if (/日常聊天|随便聊聊/.test(t)) return "mode_chat";
  if (/我的记录|打开记录|查看记录|看看记忆|打开记忆|用药记录|提醒我|吃药提醒|服药提醒|设置.*提醒|设.*提醒|清空记忆|删除记忆|修改档案/.test(t)) return "memory";
  if (/(关闭|关掉|取消|恢复|不要|不用).{0,5}(字幕放大|大字幕|放大字幕)/.test(t) || /字幕小一点|缩小字幕|字体小一点|恢复普通字幕/.test(t)) return "captions_small";
  if (/字幕.*(大|小)|放大字幕|字幕太小|字大一点|字体大|看不清字|开启大字幕|打开大字幕/.test(t)) return /字幕.*(小|太小)|缩小字幕|字体小/.test(t) ? "captions_small" : "captions_large";
  if (/(关闭|关掉|取消|恢复|不要|不用).{0,5}(慢速|慢一点|慢点说|慢速朗读)/.test(t) || /自然语速|正常语速|说快点|语速快|恢复正常朗读/.test(t)) return "speech_normal";
  if (/慢点说|说慢点|语速慢|听慢一点|慢速朗读|把语速调慢|说慢一点/.test(t)) return "speech_slow";
  if (/再说一遍|再说一次|重复刚才|再听一次|没听清|重播刚才|再读一遍/.test(t)) return "repeat";
  if (/分享给家人|分享给医生|分享摘要|把摘要分享|发给家人|发给医生/.test(t)) return "share";
  if (/复制摘要|复制就诊信息|复制就诊摘要/.test(t)) return "copy_summary";
  if (/关闭听筒|关掉声音|静音/.test(t)) return "speaker_off";
  if (/打开听筒|打开声音|开启声音/.test(t)) return "speaker_on";
  if (/关闭麦克风|关掉麦克风|先别听|暂停聆听/.test(t)) return "mic_off";
  return "";
}

function eventId() {
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildInstructions(speed = getSpeechSpeed(), selectedMode = "auto") {
  return [
    "你是老人身边的语音陪伴员小暖，像亲切的孙女自然交流。一般用一两句简短口语回答，不要机械客套，不主动把闲聊引向疾病。",
    "你能直接处理普通聊天。用户明确说出自己的长期健康档案、过敏情况、在用药物或医生医嘱时，应调用 xiaonuan_companion 自动整理记录；用户要求整理就诊信息、复诊安排或生成就诊卡片时也调用。把用户原话传入 message，不要猜测缺失信息，也不要记录提问、假设或第三方信息。",
    "不得诊断、开药、改变医生医嘱。胸痛、呼吸困难、意识不清、大出血等紧急情况，立即建议拨打120或去急诊。没有明确请求不要调用工具。",
    speed === "slow" ? "请用稍慢、清楚的语速说话。" : "请用自然语速说话。",
    `当前对话模式：${selectedMode}。`,
  ].join("\n");
}

function floatToPcmBase64(input, inputRate, targetRate = 16000) {
  const outputLength = Math.max(1, Math.floor(input.length * targetRate / inputRate));
  const bytes = new Uint8Array(outputLength * 2);
  const view = new DataView(bytes.buffer);
  const ratio = inputRate / targetRate;
  for (let i = 0; i < outputLength; i++) {
    const position = i * ratio;
    const left = Math.floor(position);
    const fraction = position - left;
    const a = input[Math.min(left, input.length - 1)] || 0;
    const b = input[Math.min(left + 1, input.length - 1)] || a;
    const sample = Math.max(-1, Math.min(1, a + (b - a) * fraction));
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  let binary = "";
  const stride = 0x8000;
  for (let i = 0; i < bytes.length; i += stride) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + stride, bytes.length)));
  }
  return btoa(binary);
}

function pcmBase64ToFloat(base64) {
  const binary = atob(base64);
  const count = Math.floor(binary.length / 2);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let value = binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8);
    if (value >= 0x8000) value -= 0x10000;
    out[i] = value / (value < 0 ? 0x8000 : 0x7fff);
  }
  return out;
}

export function useConversation() {
  const [phase, setPhase] = useState("boot");
  const [micOn, setMicOn] = useState(false);
  const [micConnecting, setMicConnecting] = useState(false);
  const [level, setLevel] = useState(0);
  const [subtitle, setSubtitle] = useState(null);
  const [voiceCommand, setVoiceCommand] = useState(null);
  const [cards, setCards] = useState([]);
  const [demoMode, setDemoMode] = useState(false);
  const [micError, setMicError] = useState("");
  const [mode, setSelectedMode] = useState("auto");
  const [detectedMode, setDetectedMode] = useState("chat");
  const ctxRef = useRef(null);
  const streamRef = useRef(null);
  const sourceRef = useRef(null);
  const processorRef = useRef(null);
  const socketRef = useRef(null);
  const socketReadyRef = useRef(false);
  const micOnRef = useRef(false);
  const startingRef = useRef(false);
  const phaseRef = useRef(phase);
  const modeRef = useRef(mode);
  const transcriptRef = useRef("");
  const outputTextRef = useRef("");
  const lastReplyRef = useRef("");
  const playAtRef = useRef(0);
  const activeSourcesRef = useRef(new Set());
  const finishTimerRef = useRef(0);
  const speechIdRef = useRef(0);

  phaseRef.current = phase;
  modeRef.current = mode;

  const setMode = useCallback((next) => {
    setSelectedMode(next);
    setDetectedMode(next === "auto" ? "chat" : next);
    if (socketReadyRef.current) sendEvent({ type: "session.update", event_id: eventId(), session: { instructions: buildInstructions(getSpeechSpeed(), next) } });
  }, []);

  function sendEvent(event) {
    const ws = socketRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
  }

  function stopPlayback() {
    for (const source of activeSourcesRef.current) {
      try { source.stop(); } catch {}
    }
    activeSourcesRef.current.clear();
    playAtRef.current = ctxRef.current?.currentTime || 0;
    clearTimeout(finishTimerRef.current);
  }

  function endResponseWhenAudioDrains() {
    const ctx = ctxRef.current;
    const waitMs = Math.max(0, (playAtRef.current - (ctx?.currentTime || 0)) * 1000) + 80;
    clearTimeout(finishTimerRef.current);
    finishTimerRef.current = setTimeout(() => {
      if (phaseRef.current === "speak" || phaseRef.current === "think") {
        setPhase(micOnRef.current ? "listen" : "idle");
        setSubtitle(null);
        setLevel(0);
      }
    }, waitMs);
  }

  function playPcmChunk(base64) {
    const ctx = ctxRef.current;
    if (!ctx || isAudioMuted()) return;
    let samples;
    try { samples = pcmBase64ToFloat(base64); } catch { return; }
    if (!samples.length) return;
    const buffer = ctx.createBuffer(1, samples.length, 24000);
    buffer.copyToChannel(samples, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => activeSourcesRef.current.delete(source);
    const startAt = Math.max(ctx.currentTime + 0.025, playAtRef.current);
    playAtRef.current = startAt + buffer.duration;
    activeSourcesRef.current.add(source);
    source.start(startAt);
    if (phaseRef.current !== "speak") {
      setPhase("speak");
      setLevel(0.38);
      setSubtitle({ who: "小暖", text: outputTextRef.current || "小暖正在回答…" });
    }
  }

  function openSocket() {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${proto}//${location.host}/api/realtime`);
      socketRef.current = ws;
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("语音服务连接超时"));
        ws.close();
      }, 16000);

      ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token: getToken() }));
      ws.onmessage = (message) => {
        if (typeof message.data !== "string") return;
        let event;
        try { event = JSON.parse(message.data); } catch { return; }
        if (event.type === "auth_ok" && !settled) {
          settled = true;
          clearTimeout(timeout);
          socketReadyRef.current = true;
          const instructions = buildInstructions(getSpeechSpeed(), modeRef.current);
          ws.send(JSON.stringify({
            type: "session.create",
            event_id: eventId(),
            session: {
              id: crypto.randomUUID(),
              model: "1.2.6.1",
              instructions,
              audio: {
                input: { format: { type: "pcm", rate: 16000 } },
                output: { format: { type: "pcm_s16le", rate: 24000 }, voice: "zh_female_xiaohe_jupiter_bigtts" },
              },
              tools: [{
                type: "function",
                name: "xiaonuan_companion",
                description: "当用户明确要求整理就诊信息、管理档案或用药记录时调用。原样传递用户刚说的话，由陪诊小暖的业务模型负责安全整理和保存。普通闲聊不要调用。",
                parameters: {
                  type: "object",
                  properties: {
                    message: { type: "string", description: "用户的原话" },
                    mode: { type: "string", enum: ["auto", "pre", "post", "chat"] },
                  },
                  required: ["message", "mode"],
                },
              }],
            },
            extension: { asr: { extra: {} }, tts: { extra: {} }, dialog: { extra: { enable_loudness_norm: true, enable_music: false } } },
          }));
          return;
        }
        if (event.type === "auth_error") {
          if (!settled) { settled = true; clearTimeout(timeout); reject(new Error(event.message || "登录已过期")); }
          if (/登录|过期/.test(event.message || "")) notifyAuthLost();
          setMicError(event.message || "登录已过期，请重新登录");
          return;
        }
        if (event.type === "session.created" || event.type === "session.updated") {
          setPhase("listen");
          return;
        }
        if (event.type === "response.created") {
          outputTextRef.current = "";
          return;
        }
        if (event.type === "conversation.item.input_audio_transcription.started") {
          transcriptRef.current = "";
          return;
        }
        if (event.type === "conversation.item.input_audio_transcription.delta") {
          transcriptRef.current += event.delta || "";
          setPhase("recognize");
          setSubtitle({ who: "您", text: transcriptRef.current });
          return;
        }
        if (event.type === "conversation.item.input_audio_transcription.completed") {
          const text = String(event.transcript || event.text || transcriptRef.current).trim();
          transcriptRef.current = text;
          if (text) {
            setSubtitle({ who: "您", text });
            const command = voiceCommandFor(text);
            if (command) {
              setVoiceCommand({ id: `${Date.now()}-${Math.random()}`, command, repeatText: lastReplyRef.current });
              sendEvent({ type: "response.cancel", event_id: eventId() });
            }
          }
          setPhase("think");
          return;
        }
        if (event.type === "response.output_text.delta") {
          outputTextRef.current += event.delta || "";
          if (phaseRef.current === "speak") setSubtitle({ who: "小暖", text: outputTextRef.current });
          return;
        }
        if (event.type === "response.output_text.done") {
          const text = String(event.text || outputTextRef.current).trim();
          if (text) { outputTextRef.current = text; lastReplyRef.current = text; }
          if (phaseRef.current === "speak" && text) setSubtitle({ who: "小暖", text });
          return;
        }
        if (event.type === "response.output_audio.started") {
          playAtRef.current = Math.max(playAtRef.current, ctxRef.current?.currentTime || 0);
          return;
        }
        if (event.type === "response.output_audio.delta") {
          if (event.delta) playPcmChunk(event.delta);
          return;
        }
        if (event.type === "response.output_audio.done" || event.type === "response.done" || event.type === "response.canceled") {
          if (outputTextRef.current.trim()) lastReplyRef.current = outputTextRef.current.trim();
          endResponseWhenAudioDrains();
          return;
        }
        if (event.type === "xiaonuan.card" && event.data) setCards((prev) => [...prev.slice(-4), event.data]);
        else if (event.type === "xiaonuan.mode" && event.mode) setDetectedMode(event.mode);
        else if (event.type === "xiaonuan.error") setMicError(event.message || "小暖刚才没能整理好，请再说一次。");
        else if (event.type === "error") setMicError("语音服务出错，请稍后再试。");
      };
      ws.onerror = () => {
        if (!settled) { settled = true; clearTimeout(timeout); reject(new Error("实时语音连接失败")); }
        setMicError("语音服务连接失败，请检查网络后重试。");
      };
      ws.onclose = (event) => {
        socketReadyRef.current = false;
        if (!settled && event.code !== 1000) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error("语音服务连接中断"));
        }
        if (socketRef.current === ws) socketRef.current = null;
        if (micOnRef.current && !startingRef.current) {
          micOnRef.current = false;
          setMicOn(false);
          setPhase("idle");
        }
      };
    });
  }

  function onFrames(event) {
    const output = event.outputBuffer?.getChannelData(0);
    if (output) output.fill(0);
    if (!micOnRef.current || !socketReadyRef.current) return;
    const input = event.inputBuffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    const rms = Math.sqrt(sum / input.length);
    if (phaseRef.current === "listen" || phaseRef.current === "recognize") setLevel(Math.min(1, rms * 7));
    try {
      const audio = floatToPcmBase64(input, ctxRef.current.sampleRate);
      sendEvent({ type: "input_audio_buffer.append", audio });
    } catch {
      setMicError("麦克风音频处理失败，请重新开启麦克风。");
    }
  }

  async function ensureGraph() {
    if (ctxRef.current && streamRef.current) {
      if (ctxRef.current.state === "suspended") await ctxRef.current.resume();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("当前浏览器不支持麦克风");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    streamRef.current = stream;
    stream.getTracks().forEach((track) => { track.enabled = false; });
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    ctxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(2048, 1, 1);
    processor.onaudioprocess = onFrames;
    source.connect(processor);
    processor.connect(ctx.destination);
    sourceRef.current = source;
    processorRef.current = processor;
    if (ctx.state === "suspended") await ctx.resume();
  }

  async function startMic() {
    if (startingRef.current) return;
    startingRef.current = true;
    setMicConnecting(true);
    setMicError("");
    try {
      if (screen.orientation?.lock) screen.orientation.lock("portrait").catch(() => {});
      await ensureGraph();
      if (socketRef.current?.readyState === WebSocket.OPEN && socketReadyRef.current) {
        micOnRef.current = true;
        streamRef.current?.getTracks().forEach((track) => { track.enabled = true; });
        setMicOn(true);
        setPhase("listen");
        return;
      }
      if (socketRef.current && socketRef.current.readyState < WebSocket.CLOSING) socketRef.current.close();
      await openSocket();
      if (socketRef.current?.readyState !== WebSocket.OPEN) throw new Error("连接中断");
      // 等服务端确认 session.created 后再打开音频，避免首帧丢失。
      await new Promise((resolve, reject) => {
        const deadline = Date.now() + 10000;
        const poll = () => {
          if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return reject(new Error("连接中断"));
          if (phaseRef.current === "listen" && socketReadyRef.current) return resolve();
          if (Date.now() > deadline) return reject(new Error("语音会话启动超时"));
          setTimeout(poll, 40);
        };
        poll();
      });
      micOnRef.current = true;
      streamRef.current?.getTracks().forEach((track) => { track.enabled = true; });
      setMicOn(true);
      setPhase("listen");
    } catch (error) {
      micOnRef.current = false;
      streamRef.current?.getTracks().forEach((track) => { track.enabled = false; });
      setMicOn(false);
      setPhase("idle");
      setMicError(error?.message || "麦克风没打开，请检查权限后再试");
      try { socketRef.current?.close(); } catch {}
    } finally {
      startingRef.current = false;
      setMicConnecting(false);
    }
  }

  function muteMic() {
    micOnRef.current = false;
    setMicOn(false);
    streamRef.current?.getTracks().forEach((track) => { track.enabled = false; });
    stopPlayback();
    setLevel(0);
    setSubtitle(null);
    const ws = socketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      sendEvent({ type: "session.close", event_id: eventId() });
      ws.close(1000, "user paused");
    }
    socketReadyRef.current = false;
    setPhase("idle");
  }

  function toggleMic() {
    if (micOnRef.current) muteMic();
    else startMic();
  }

  function requestSpeechText(text, resumeListening = false) {
    if (!text || !socketReadyRef.current) return;
    const speechId = `spoken_${++speechIdRef.current}`;
    outputTextRef.current = String(text).trim();
    lastReplyRef.current = outputTextRef.current;
    sendEvent({ type: "speech_text_buffer.append", event_id: eventId(), speech_id: speechId, text: outputTextRef.current });
    sendEvent({ type: "speech_text_buffer.commit", event_id: eventId(), speech_id: speechId, text: outputTextRef.current });
    setPhase("think");
  }

  function interruptTurn() {
    stopPlayback();
    sendEvent({ type: "response.cancel", event_id: eventId() });
    outputTextRef.current = "";
    if (micOnRef.current) setPhase("listen");
  }

  function repeatLastReply(textOverride) {
    const text = typeof textOverride === "string" && textOverride.trim() ? textOverride : lastReplyRef.current;
    if (!text) return;
    if (!socketReadyRef.current) { setMicError("请先开启麦克风，再让小暖重复刚才的话。"); return; }
    interruptTurn();
    requestSpeechText(text, true);
  }

  function speakWelcome(text) {
    if (!text) return;
    startMic().then(() => requestSpeechText(text, true));
  }

  function pauseMic() {
    muteMic();
  }

  function activateMic() {
    if (!micOnRef.current) startMic();
  }

  function resumeListening() {
    if (micOnRef.current && socketReadyRef.current) {
      streamRef.current?.getTracks().forEach((track) => { track.enabled = true; });
      setPhase("listen");
    }
  }

  useEffect(() => {
    setDemoMode(false);
    setPhase("idle");
    return () => {
      micOnRef.current = false;
      socketReadyRef.current = false;
      clearTimeout(finishTimerRef.current);
      stopPlayback();
      try { socketRef.current?.close(1000, "page closed"); } catch {}
      try { processorRef.current?.disconnect(); } catch {}
      try { sourceRef.current?.disconnect(); } catch {}
      try { streamRef.current?.getTracks().forEach((track) => track.stop()); } catch {}
      try { ctxRef.current?.close(); } catch {}
    };
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && ctxRef.current?.state === "suspended") ctxRef.current.resume().catch(() => {});
    };
    const onSpeedChange = () => {
      if (socketReadyRef.current) sendEvent({ type: "session.update", event_id: eventId(), session: { instructions: buildInstructions(getSpeechSpeed(), modeRef.current) } });
    };
    const onMuteChange = () => { if (isAudioMuted()) stopPlayback(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("xn-speech-speed", onSpeedChange);
    window.addEventListener("xn-audio-muted", onMuteChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("xn-speech-speed", onSpeedChange);
      window.removeEventListener("xn-audio-muted", onMuteChange);
    };
  }, []);

  function dismissCard(index) {
    setCards((previous) => previous.filter((_, i) => i !== index));
  }

  return {
    phase, micOn, micConnecting, level, subtitle, cards, dismissCard, demoMode, micError,
    toggleMic, activateMic, pauseMic, resumeListening, repeatLastReply,
    speakWelcome, hasLastReply: !!lastReplyRef.current, mode, detectedMode,
    setMode, voiceCommand,
  };
}
