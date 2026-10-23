import { useEffect, useRef, useState } from "react";
import { getToken, notifyAuthLost } from "../lib/auth.js";
import { getSpeechSpeed, isAudioMuted, isCaptionsEnabled } from "../lib/ai.js";

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
  if (/看完医生|刚看完医生|已经看完|看完了/.test(t)) return "";
  if (/看诊前|看医生前|准备看医生|准备就诊|整理就诊问题/.test(t)) return "";
  if (/自动识别|自动模式/.test(t)) return "";
  if (/看诊后|就诊后|整理医嘱|医生交代|复诊安排/.test(t)) return "";
  if (/就诊前|看医生前|准备就诊/.test(t)) return "";
  if (/日常聊天|随便聊聊/.test(t)) return "";
  if (/我的记录|打开记录|查看记录|看看记忆|打开记忆|用药记录|提醒我|吃药提醒|服药提醒|设置.*提醒|设.*提醒|清空记忆|删除记忆|修改档案/.test(t)) return "memory";
  if (/(关闭|关掉|取消|恢复|不要|不用).{0,5}(字幕放大|大字幕|放大字幕)/.test(t) || /字幕小一点|缩小字幕|字体小一点|恢复普通字幕/.test(t)) return "captions_small";
  if (/字幕.*(大|小)|放大字幕|字幕太小|字大一点|字体大|看不清字|开启大字幕|打开大字幕/.test(t)) return /字幕.*(小|太小)|缩小字幕|字体小/.test(t) ? "captions_small" : "captions_large";
  if (/(关闭|关掉|取消|不要|不用).{0,2}字幕/.test(t)) return "captions_off";
  if (/(打开|开启|显示|看看).{0,2}字幕/.test(t)) return "captions_on";
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

function buildInstructions() {
  return [
    "你是老人身边的语音陪伴员小暖，像亲切的孙女自然交流。一般用一两句简短口语回答，不要机械客套，不主动把闲聊引向疾病。",
    "你能直接处理普通聊天。用户明确说出自己的长期健康档案、过敏情况、在用药物或医生医嘱时，应调用 xiaonuan_companion 自动整理记录；用户要求整理就诊信息、复诊安排或生成就诊卡片时也调用。把用户原话传入 message，不要猜测缺失信息，也不要记录提问、假设或第三方信息。",
    "不得诊断、开药、改变医生医嘱。胸痛、呼吸困难、意识不清、大出血等紧急情况，立即建议拨打120或去急诊。没有明确请求不要调用工具。",
    "说话清楚、语句简短，重要的话稍微放慢一点，方便老人听清。",
  ].join("\n");
}

// 语速走豆包 TTS 的 audio.output.speed（-50=0.5x, 0=原速, 100=2x），比提示词可靠。
function speechSpeedValue() {
  return getSpeechSpeed() === "slow" ? -25 : 0;
}

function outputAudioConfig() {
  return { format: { type: "pcm_s16le", rate: 24000 }, voice: "zh_female_xiaohe_jupiter_bigtts", speed: speechSpeedValue() };
}

const PCM_CHUNK = 320; // 20ms @16k 单声道，豆包建议的分片单位（640 字节）

// 麦克风 Float32 -> 16k Int16（线性插值重采样）
function floatToPcm16(input, inputRate, targetRate = 16000) {
  const outputLength = Math.max(1, Math.floor(input.length * targetRate / inputRate));
  const out = new Int16Array(outputLength);
  const ratio = inputRate / targetRate;
  for (let i = 0; i < outputLength; i++) {
    const position = i * ratio;
    const left = Math.floor(position);
    const fraction = position - left;
    const a = input[Math.min(left, input.length - 1)] || 0;
    const b = input[Math.min(left + 1, input.length - 1)] || a;
    const sample = Math.max(-1, Math.min(1, a + (b - a) * fraction));
    out[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return out;
}

function int16ToBase64(view) {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  let binary = "";
  const stride = 0x8000;
  for (let i = 0; i < bytes.length; i += stride) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + stride, bytes.length)));
  }
  return btoa(binary);
}

function pcmBase64ToFloat(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const count = bytes.length >> 1;
  const out = new Float32Array(count);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < count; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

function mergeFloatParts(parts, total) {
  const out = new Float32Array(total);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

// 豆包下行是 24kHz PCM。播放侧加抖动缓冲：首包等 150ms 预缓冲再开播，
// 每块最多合并 240ms 播出，积压超过 1.2s 丢弃最老数据。
const PLAY_LEAD_SAMPLES = 3600;        // 150ms @24k
const PLAY_BLOCK_SAMPLES = 5760;       // 240ms @24k
const PLAY_MAX_BUFFER_SAMPLES = 28800; // 1.2s @24k

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
  const ctxRef = useRef(null);
  const streamRef = useRef(null);
  const sourceRef = useRef(null);
  const processorRef = useRef(null);
  const socketRef = useRef(null);
  const socketReadyRef = useRef(false);
  const micOnRef = useRef(false);
  const startingRef = useRef(false);
  const phaseRef = useRef(phase);
  const transcriptRef = useRef("");
  const outputTextRef = useRef("");
  const lastReplyRef = useRef("");
  const playAtRef = useRef(0);
  const activeSourcesRef = useRef(new Set());
  const playQueueRef = useRef([]);
  const playQueueLenRef = useRef(0);
  const playStartedRef = useRef(false);
  const playFlushRef = useRef(false);
  const finishTimerRef = useRef(0);
  const speechIdRef = useRef(0);
  const lastAudioSentRef = useRef(0);
  const upstreamMutedRef = useRef(false);
  const pcmQueueRef = useRef([]);
  const pcmQueueLenRef = useRef(0);
  const sentFramesRef = useRef(0);
  const audioWarnRef = useRef(false);
  const micStartAtRef = useRef(0);
  // 字幕文本归属：文本按「响应轮次」归属，textGenRef 记录当前 outputTextRef
  // 属于哪一轮（= responseGenRef 的值）。豆包的「打招呼」类响应（chat_tts_text）
  // 不会下发 response.created，若不清归属，上一轮的文本会残留并与新一轮 delta
  // 拼接，字幕就和说的话对不上（错位）。任何新文本到达时若轮次不符，先清空再累计。
  const textGenRef = useRef(-1);          // outputTextRef 属于哪一轮响应
  const captionsOnRef = useRef(isCaptionsEnabled()); // 字幕开关（默认关，像豆包一样）
  const dropLateAudioRef = useRef(false); // response.cancel 后迟到的音频包直接丢弃，避免旧音频复播
  const responseGenRef = useRef(0);       // 每开始一个响应 +1，用于让上一轮的收尾定时器失效
  const audioStartedGenRef = useRef(-1);  // 记录哪个响应已经开始出音频

  phaseRef.current = phase;

  function sendEvent(event) {
    const ws = socketRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
  }

  function stopPlayback() {
    for (const source of activeSourcesRef.current) {
      try { source.stop(); } catch {}
    }
    activeSourcesRef.current.clear();
    playQueueRef.current = [];
    playQueueLenRef.current = 0;
    playStartedRef.current = false;
    playFlushRef.current = false;
    playAtRef.current = ctxRef.current?.currentTime || 0;
    clearTimeout(finishTimerRef.current);
  }

  function endResponseWhenAudioDrains() {
    const ctx = ctxRef.current;
    const gen = responseGenRef.current; // 捕获时的轮次：期间若开了新一轮，定时器直接作废
    const waitMs = Math.max(0, (playAtRef.current - (ctx?.currentTime || 0)) * 1000) + 80;
    clearTimeout(finishTimerRef.current);
    finishTimerRef.current = setTimeout(() => {
      if (gen !== responseGenRef.current) return;
      if (phaseRef.current === "speak" || phaseRef.current === "think") {
        setPhase(micOnRef.current ? "listen" : "idle");
        setSubtitle(null);
        setLevel(0);
      }
    }, waitMs);
  }

  // 字幕只显示「当前这一轮」AI 正在说的文本；开关关闭或文本不属于当前轮次一律不显示。
  // 字幕消失由音频排空定时器负责（按语速决定长短），不随文本 done 提前消失。
  function syncSubtitle() {
    if (!captionsOnRef.current) { setSubtitle(null); return; }
    if (textGenRef.current !== responseGenRef.current) { setSubtitle(null); return; }
    const text = outputTextRef.current.trim();
    if (!text) { setSubtitle(null); return; }
    setSubtitle({ who: "小暖", text });
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
      syncSubtitle(); // 只有字幕开关打开、且文本属于当前轮次时才显示
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

      ws.onopen = () => {
        upstreamMutedRef.current = false;
        lastAudioSentRef.current = Date.now();
        ws.send(JSON.stringify({ type: "auth", token: getToken() }));
      };
      ws.onmessage = (message) => {
        if (typeof message.data !== "string") return;
        let event;
        try { event = JSON.parse(message.data); } catch { return; }
        if (event.type === "auth_ok" && !settled) {
          settled = true;
          clearTimeout(timeout);
          socketReadyRef.current = true;
          resolve(); // 必须 resolve，否则 startMic 会一直卡在「正在连接」
          const instructions = buildInstructions();
          ws.send(JSON.stringify({
            type: "session.create",
            event_id: eventId(),
            session: {
              id: crypto.randomUUID(),
              model: "1.2.6.1",
              instructions,
              audio: {
                input: { format: { type: "pcm", rate: 16000 } },
                output: outputAudioConfig(),
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
          // 新一轮响应开始：文本重新累计，旧字幕归属作废
          responseGenRef.current += 1;
          audioStartedGenRef.current = -1;
          outputTextRef.current = "";
          textGenRef.current = responseGenRef.current;
          dropLateAudioRef.current = false;
          return;
        }
        if (event.type === "conversation.item.input_audio_transcription.started") {
          transcriptRef.current = "";
          return;
        }
        if (event.type === "conversation.item.input_audio_transcription.delta") {
          // 用户自己说话时不上字幕：用户知道自己说了什么，字幕只在小暖
          // 说话时出现，方便没听清时看一眼。识别文本仍内部累积，供语音指令判断。
          transcriptRef.current += event.delta || "";
          setPhase("recognize");
          return;
        }
        if (event.type === "conversation.item.input_audio_transcription.completed") {
          const text = String(event.transcript || event.text || transcriptRef.current).trim();
          transcriptRef.current = text;
          if (text) {
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
          // 兜底：如果没收到 response.created（豆包的打招呼类响应就是这样），
          // 且文本属于上一轮，先把残留清掉再累计，否则字幕会是「旧文本+新文本」。
          if (textGenRef.current !== responseGenRef.current) {
            outputTextRef.current = "";
            textGenRef.current = responseGenRef.current;
          }
          outputTextRef.current += event.delta || "";
          if (phaseRef.current === "speak") syncSubtitle();
          return;
        }
        if (event.type === "response.output_text.done") {
          const text = String(event.text || outputTextRef.current).trim();
          if (text) { outputTextRef.current = text; lastReplyRef.current = text; }
          if (phaseRef.current === "speak") syncSubtitle();
          return;
        }
        if (event.type === "response.output_audio.started") {
          dropLateAudioRef.current = false; // 新响应开始出音频，恢复接收
          if (audioStartedGenRef.current !== responseGenRef.current) {
            audioStartedGenRef.current = responseGenRef.current;
            // 音频开始了但文本还没到（或属于上一轮残留）：清空等新文本，避免字幕错位
            if (textGenRef.current !== responseGenRef.current) {
              outputTextRef.current = "";
              textGenRef.current = responseGenRef.current;
            }
          }
          playAtRef.current = Math.max(playAtRef.current, ctxRef.current?.currentTime || 0);
          return;
        }
        if (event.type === "response.output_audio.delta") {
          if (dropLateAudioRef.current) return; // 取消后迟到的包，丢弃
          if (event.delta) playPcmChunk(event.delta);
          return;
        }
        if (event.type === "response.output_audio.done" || event.type === "response.done" || event.type === "response.canceled") {
          // 本轮结束：复位文本归属，下一轮（可能没有 response.created）重新累计，
          // 否则字幕会把两轮回复拼在一起（错位）。
          if (audioStartedGenRef.current === responseGenRef.current) {
            textGenRef.current = -1;
          }
          if (event.type === "response.canceled") {
            dropLateAudioRef.current = true;
            setSubtitle(null);
          }
          if (outputTextRef.current.trim()) lastReplyRef.current = outputTextRef.current.trim();
          endResponseWhenAudioDrains();
          return;
        }
        if (event.type === "xiaonuan.card" && event.data) setCards((prev) => [...prev.slice(-4), event.data]);
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
      const pcm = floatToPcm16(input, ctxRef.current?.sampleRate || 16000);
      pcmQueueRef.current.push(pcm);
      pcmQueueLenRef.current += pcm.length;
      // 下游没在发（连接中断 / 页面卡顿）时丢弃积压，避免音频越拖越久
      while (pcmQueueLenRef.current > PCM_CHUNK * 40 && pcmQueueRef.current.length > 1) {
        pcmQueueLenRef.current -= pcmQueueRef.current.shift().length;
      }
    } catch {
      setMicError("麦克风音频处理失败，请重新开启麦克风。");
    }
  }

  // 严格按 20ms 的实时节奏向豆包投递音频分片（过快或过慢都会触发服务端错误）
  function pumpAudio() {
    if (!micOnRef.current || !socketReadyRef.current) return;
    const ws = socketRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (pcmQueueLenRef.current < PCM_CHUNK) return;
    const out = new Int16Array(PCM_CHUNK);
    let filled = 0;
    while (filled < PCM_CHUNK && pcmQueueRef.current.length) {
      const head = pcmQueueRef.current[0];
      const take = Math.min(head.length, PCM_CHUNK - filled);
      out.set(head.subarray(0, take), filled);
      filled += take;
      if (take === head.length) pcmQueueRef.current.shift();
      else pcmQueueRef.current[0] = head.subarray(take);
    }
    pcmQueueLenRef.current -= filled;
    if (filled < PCM_CHUNK) return;
    if (upstreamMutedRef.current) {
      sendEvent({ type: "input_audio_unmute.commit", event_id: eventId() });
      upstreamMutedRef.current = false;
    }
    sendEvent({ type: "input_audio_buffer.append", audio: int16ToBase64(out) });
    lastAudioSentRef.current = Date.now();
    sentFramesRef.current += 1;
    if (sentFramesRef.current === 1 || sentFramesRef.current % 200 === 0) {
      console.info(`[xn audio] 已发送音频分片 ${sentFramesRef.current} 个`);
    }
  }

  // AudioContext 必须在用户手势里同步创建并 resume，否则 iOS/部分安卓 WebView
  // 会一直保持 suspended，onaudioprocess 不触发 -> 服务端收不到音频 -> 超时断线。
  function primeAudioContext() {
    try {
      if (!ctxRef.current) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        ctxRef.current = new Ctx({ latencyHint: "interactive" });
        ctxRef.current.onstatechange = () => {
          const ctx = ctxRef.current;
          if (ctx && ctx.state !== "running" && micOnRef.current) ctx.resume().catch(() => {});
        };
      }
      if (ctxRef.current.state !== "running") ctxRef.current.resume().catch(() => {});
      return ctxRef.current;
    } catch {
      return null;
    }
  }

  async function ensureGraph() {
    const ctx = primeAudioContext();
    if (!ctx) throw new Error("当前浏览器不支持音频采集");
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("当前浏览器不支持麦克风");
    if (streamRef.current) {
      if (ctx.state === "suspended") await ctx.resume();
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    streamRef.current = stream;
    stream.getTracks().forEach((track) => { track.enabled = false; });
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(2048, 1, 1);
    processor.onaudioprocess = onFrames;
    source.connect(processor);
    processor.connect(ctx.destination);
    sourceRef.current = source;
    processorRef.current = processor;
    if (ctx.state !== "running") await ctx.resume();
  }

  async function startMic() {
    if (startingRef.current) return;
    startingRef.current = true;
    setMicConnecting(true);
    setMicError("");
    audioWarnRef.current = false;
    sentFramesRef.current = 0;
    pcmQueueRef.current = [];
    pcmQueueLenRef.current = 0;
    try {
      primeAudioContext(); // 同步在用户手势内启动 AudioContext
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
      micStartAtRef.current = Date.now();
      streamRef.current?.getTracks().forEach((track) => { track.enabled = true; });
      setMicOn(true);
      // 小暖正在自我介绍/说话时不要把它打回「聆听」，否则字幕和状态会闪。
      setPhase((prev) => (prev === "think" || prev === "speak" ? prev : "listen"));
    } catch (error) {
      micOnRef.current = false;
      streamRef.current?.getTracks().forEach((track) => { track.enabled = false; });
      setMicOn(false);
      setPhase("idle");
      const errorName = error?.name || "";
      const errorMessage = error?.message || "";
      if (["NotAllowedError", "PermissionDeniedError", "SecurityError"].includes(errorName)
          || /permission denied|denied permission/i.test(errorMessage)) {
        setMicError("麦克风权限被拒绝。请在浏览器地址栏旁的网站设置中允许麦克风，再点话筒重试；安卓 App 请到系统设置中允许小暖使用麦克风。");
      } else if (errorName === "NotFoundError" || errorName === "DevicesNotFoundError") {
        setMicError("没有找到可用的麦克风，请检查设备后重试。");
      } else if (errorName === "NotReadableError" || errorName === "TrackStartError") {
        setMicError("麦克风正被其他应用占用，请关闭占用麦克风的应用后重试。");
      } else {
        setMicError(errorMessage || "麦克风没打开，请检查权限后再试");
      }
      try { socketRef.current?.close(); } catch {}
    } finally {
      startingRef.current = false;
      setMicConnecting(false);
    }
  }

  function muteMic() {
    micOnRef.current = false;
    upstreamMutedRef.current = false;
    dropLateAudioRef.current = true;
    textGenRef.current = -1;
    responseGenRef.current += 1;
    pcmQueueRef.current = [];
    pcmQueueLenRef.current = 0;
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
    responseGenRef.current += 1;          // 新一轮：让上一轮的收尾定时器作废
    audioStartedGenRef.current = -1;
    outputTextRef.current = String(text).trim();
    textGenRef.current = responseGenRef.current; // 这段文本属于新一轮，音频开始时直接用作字幕
    lastReplyRef.current = outputTextRef.current;
    dropLateAudioRef.current = false;
    // 注意：只发 commit（带 text）。如果再发一次 append(text)，豆包会把两处
    // 文本都合成语音，导致同一句话播两遍。
    sendEvent({ type: "speech_text_buffer.commit", event_id: eventId(), speech_id: speechId, text: outputTextRef.current });
    setPhase("think");
    syncSubtitle();
  }

  function interruptTurn() {
    responseGenRef.current += 1;       // 让上一轮的收尾定时器失效
    dropLateAudioRef.current = true;   // 丢弃取消后迟到的音频包
    stopPlayback();
    sendEvent({ type: "response.cancel", event_id: eventId() });
    outputTextRef.current = "";
    textGenRef.current = -1;
    setSubtitle(null);
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

  // 豆包要求上行音频流保活：长时间没有音频帧会触发
  // AudioServerNoAudioInputTooLongError（收不到音频输入超时）并关闭会话。
  // 这里一旦检测到超过 4s 没发出音频帧（例如 AudioContext 被浏览器挂起、
  // 切后台、设备切换），就主动发静音事件，恢复时再取消静音。
  useEffect(() => {
    const pump = setInterval(pumpAudio, 20);
    const timer = setInterval(() => {
      if (!socketReadyRef.current) return;
      const ctx = ctxRef.current;
      if (micOnRef.current && ctx?.state === "suspended") ctx.resume().catch(() => {});
      if (micOnRef.current && sentFramesRef.current === 0 && micStartAtRef.current
          && Date.now() - micStartAtRef.current > 6000 && !audioWarnRef.current) {
        audioWarnRef.current = true;
        console.warn(
          "[xn audio] 开麦 6 秒仍未采集到音频帧 ctx=",
          ctx?.state,
          "tracks=",
          streamRef.current?.getTracks().map((t) => `${t.kind}:enabled=${t.enabled}:${t.readyState}`).join(","),
        );
        setMicError("没有听到麦克风的声音，请确认浏览器已允许使用麦克风，并检查系统输入设备。");
      }
      if (Date.now() - lastAudioSentRef.current < 4000) return;
      if (upstreamMutedRef.current) return;
      sendEvent({ type: "input_audio_mute.commit", event_id: eventId() });
      upstreamMutedRef.current = true;
    }, 2000);
    return () => {
      clearInterval(pump);
      clearInterval(timer);
    };
  }, []);

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
      if (socketReadyRef.current) sendEvent({ type: "session.update", event_id: eventId(), session: { instructions: buildInstructions(), audio: { output: outputAudioConfig() } } });
    };
    const onCaptionsChange = () => {
      // 字幕开关切换：关→立即隐藏；开→若 AI 正在说话，马上把当前这轮的字幕显示出来
      captionsOnRef.current = isCaptionsEnabled();
      syncSubtitle();
    };
    const onMuteChange = () => { if (isAudioMuted()) stopPlayback(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("xn-speech-speed", onSpeedChange);
    window.addEventListener("xn-captions", onCaptionsChange);
    window.addEventListener("xn-audio-muted", onMuteChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("xn-speech-speed", onSpeedChange);
      window.removeEventListener("xn-captions", onCaptionsChange);
      window.removeEventListener("xn-audio-muted", onMuteChange);
    };
  }, []);

  function dismissCard(index) {
    setCards((previous) => previous.filter((_, i) => i !== index));
  }

  return {
    phase, micOn, micConnecting, level, subtitle, cards, dismissCard, demoMode, micError,
    toggleMic, activateMic, pauseMic, resumeListening, repeatLastReply,
    speakWelcome, hasLastReply: !!lastReplyRef.current, voiceCommand,
  };
}
