import { useEffect, useRef, useState } from "react";
import { Mic, Stethoscope, Headphones, Brain, X, Pill, Copy, Check, Share2, Sparkles, CaseSensitive, Gauge, RotateCcw, LoaderCircle, Camera } from "lucide-react";
import Companion from "./Companion.jsx";
import BrandMark from "./BrandMark.jsx";
import MemoryPanel, { CardView } from "./MemoryPanel.jsx";
import PrescriptionPhotoPanel from "./PrescriptionPhotoPanel.jsx";
import { PHASE_TEXT, useConversation } from "../hooks/useRealtimeConversation.js";
import { fetchMemory } from "../lib/auth.js";
import { getSpeechSpeed, isCaptionsEnabled, setAudioMuted, setCaptionsEnabled, setSpeechSpeed } from "../lib/ai.js";
import { syncMedicationReminders, normalizeReminderTimes, remindersEnabled } from "../lib/reminders.js";

export default function CallScreen() {
  const { phase, micOn, micConnecting, level, subtitle, cards, dismissCard, demoMode, micError, toggleMic, activateMic, pauseMic, resumeListening, repeatLastReply, speakWelcome, hasLastReply, voiceCommand, speak, markPhotoConfirmAwaiting, reminderPrompt, speakReminder } = useConversation();
  const [speakerOn, setSpeakerOn] = useState(() => {
    try { return localStorage.getItem("xn_speaker_on") !== "0"; } catch { return true; }
  });
  const [activationOpen, setActivationOpen] = useState(true);
  const [memOpen, setMemOpen] = useState(false);
  const [focusDispenser, setFocusDispenser] = useState(false);
  const [nextDose, setNextDose] = useState(null);
  const [copyDone, setCopyDone] = useState(false);
  const [shareStatus, setShareStatus] = useState("");
  const [photoOpen, setPhotoOpen] = useState(false);
  const [photoAutoOpened, setPhotoAutoOpened] = useState(false);
  const [photoDoneSignal, setPhotoDoneSignal] = useState(0); // 语音"我拍好了"计数
  const [photoConfirmAwaiting, setPhotoConfirmAwaiting] = useState(false); // 小暖复述完时间、等用户说对不对
  const [voiceNotice, setVoiceNotice] = useState("");
  const handledVoiceCommandRef = useRef(null);
  const [speechSpeed, setSpeedState] = useState(getSpeechSpeed);
  // 字幕默认关闭（和豆包一样），开了才显示 AI 说的话；开关状态持久化
  const [captionsOn, setCaptionsOn] = useState(isCaptionsEnabled);
  const [largeCaptions, setLargeCaptions] = useState(() => {
    try { return localStorage.getItem("xn_large_captions") === "1"; } catch { return false; }
  });
  const phaseText = PHASE_TEXT[phase] || "";

  useEffect(() => setAudioMuted(!speakerOn), [speakerOn]);
  useEffect(() => {
    try { localStorage.setItem("xn_speaker_on", speakerOn ? "1" : "0"); } catch {}
  }, [speakerOn]);
  useEffect(() => setSpeechSpeed(speechSpeed), [speechSpeed]);

  // 等确认时用户说起了别的（没说对/不对）：收起拍照面板，回到正常对话
  useEffect(() => {
    const onCancel = () => {
      setPhotoOpen(false);
      setPhotoAutoOpened(false);
      setPhotoConfirmAwaiting(false);
      markPhotoConfirmAwaiting(false);
    };
    window.addEventListener("xn-photo-confirm-cancel", onCancel);
    return () => window.removeEventListener("xn-photo-confirm-cancel", onCancel);
  }, []);

  function toggleCaptions() {
    const next = !captionsOn;
    setCaptionsOn(next);
    setCaptionsEnabled(next);
  }

  function toggleLargeCaptions() {
    setLargeCaptions((value) => {
      const next = !value;
      try { localStorage.setItem("xn_large_captions", next ? "1" : "0"); } catch {}
      return next;
    });
  }

  function openPhotoPanel(autoOpened = false) {
    // 麦克风保持开启：用户要对着小暖说"我拍好了"、确认时间对不对
    setPhotoAutoOpened(autoOpened);
    setPhotoOpen(true);
    activateMic();
  }

  function closePhotoPanel() {
    setPhotoOpen(false);
    setPhotoAutoOpened(false);
    setPhotoConfirmAwaiting(false);
    markPhotoConfirmAwaiting(false);
    activateMic();
  }

  function handlePhotoReadBack(text) {
    setPhotoConfirmAwaiting(true);
    markPhotoConfirmAwaiting(true);
    speak(text); // 小暖念一遍记录的时间，然后问对不对
  }

  function handlePhotoRetake() {
    setPhotoConfirmAwaiting(false);
    markPhotoConfirmAwaiting(false);
  }

  function openMemoryPanel() {
    pauseMic();
    setMemOpen(true);
  }

  function closeMemoryPanel() {
    setMemOpen(false);
    setFocusDispenser(false);
    activateMic();
  }

  function activateWithWelcome() {
    // 开场白按进入次数缩短：第一次约十个字，之后几个字，避免每次都要听一长串
    let visits = 0;
    try { visits = Number(localStorage.getItem("xn_visit_count") || "0"); } catch {}
    try { localStorage.setItem("xn_visit_count", String(visits + 1)); } catch {}
    const greeting = visits === 0 ? "您好，我是小暖。" : "来啦，请说。";
    setActivationOpen(false);
    speakWelcome(greeting);
  }

  useEffect(() => {
    if (!voiceCommand || voiceCommand.id === handledVoiceCommandRef.current) return;
    handledVoiceCommandRef.current = voiceCommand.id;
    // 拍照面板开着时只放行拍照流程的指令（说"我拍好了/对/不对"用），其他面板不开
    const photoFlow = new Set(["photo_done", "confirm_yes", "confirm_no"]);
    if (memOpen) return;
    if (photoOpen && !photoFlow.has(voiceCommand.command)) return;
    const messages = {
      photo: "我帮您打开拍照入口了。对准药盒或医嘱拍一张，拍好了跟我说一声。",
      photo_done: "好的，我来看这张照片。",
      confirm_yes: "好的，已经记好了。",
      confirm_no: "好的，您说怎么改，我来改。",
      memory: "我帮您打开记录了。可以说要查看、修改或删除哪一项；删除前需要您确认。",
      dispenser: "我打开了泡药和健康茶设备方案，可以查看准备情况。现在还没有接入实体设备。",
      captions_on: "字幕已打开，我说的话会显示在屏幕上。",
      captions_off: "字幕已关闭。",
      captions_large: "字幕已放大。",
      captions_small: "字幕已恢复普通大小。",
      speech_slow: "我会说慢一点。",
      speech_normal: "我会用自然语速说话。",
      repeat: "我再把刚才的话说一遍。",
      share: cards.length ? "我帮您准备分享就诊信息。" : "还没有可分享的就诊摘要；可以先告诉我看诊情况。",
      copy_summary: cards.at(-1)?.type === "pre" ? "我帮您复制就诊摘要。" : "还没有可复制的就诊前摘要；可以先告诉我看诊情况。",
      speaker_off: "好的，我先关闭语音。",
      speaker_on: "好的，我会用语音回答。",
      mic_off: "好的，我先暂停聆听。要继续时请重新开启麦克风。",
    };
    setVoiceNotice(messages[voiceCommand.command] || "好的，我帮您切换好了。");
    switch (voiceCommand.command) {
      case "photo": openPhotoPanel(true); break;
      case "photo_done":
        if (photoOpen) {
          setPhotoDoneSignal((n) => n + 1);
          speak("好的，我来看这张照片。");
        } else {
          openPhotoPanel(true);
          speak("先拍一张药盒或医嘱的照片，拍好了跟我说一声。");
        }
        break;
      case "confirm_yes":
        if (photoConfirmAwaiting) {
          closePhotoPanel();
          speak("好的，已经记好了，到点我会提醒您。");
        }
        break;
      case "confirm_no":
        // 只说"不对"时不替用户改：关上面板，让豆包模型听着用户的原话改正并更新记录
        if (photoConfirmAwaiting) closePhotoPanel();
        break;
      case "memory": openMemoryPanel(); break;
      case "dispenser": setFocusDispenser(true); openMemoryPanel(); break;
      case "captions_on": setCaptionsOn(true); setCaptionsEnabled(true); break;
      case "captions_off": setCaptionsOn(false); setCaptionsEnabled(false); break;
      case "captions_large": setLargeCaptions(true); break;
      case "captions_small": setLargeCaptions(false); break;
      case "speech_slow": setSpeedState("slow"); break;
      case "speech_normal": setSpeedState("normal"); break;
      case "repeat": repeatLastReply(voiceCommand.repeatText, true); break;
      case "share": if (cards.length) shareCard(cards[cards.length - 1], true); break;
      case "copy_summary": if (cards.at(-1)?.type === "pre") copyVisitSummary(cards[cards.length - 1], true); break;
      case "speaker_off": setSpeakerOn(false); break;
      case "speaker_on": setSpeakerOn(true); break;
      case "mic_off": pauseMic(); break;
      default: break;
    }
    // confirm_no 要把用户的改正原话留给模型回复，不能打断
    if (voiceCommand.command !== "confirm_no") resumeListening();
  }, [voiceCommand, phase, photoOpen, memOpen, photoConfirmAwaiting]);

  async function copyVisitSummary(card, voiceTriggered = false) {
    const s = card?.visit_summary || {};
    const labels = { symptoms: "主要不适", duration: "持续时间", history: "既往情况", current_meds: "当前用药", questions: "想问医生", missing: "就诊时可补充" };
    const lines = Object.entries(labels).flatMap(([key, label]) => {
      const value = Array.isArray(s[key]) ? s[key].filter(Boolean).join("；") : String(s[key] || "");
      return value ? [`${label}：${value}`] : [];
    });
    const text = ["就诊前信息整理（请核对）", ...lines, "仅整理对话信息，不是诊断结论。"].join("\n");
    if (voiceTriggered && window.XiaonuanNative?.copyText) {
      try {
        window.XiaonuanNative.copyText(text);
        setCopyDone(true);
        setTimeout(() => setCopyDone(false), 1800);
      } catch { setVoiceNotice("复制失败，请点就诊卡片上的“复制摘要”按钮。"); }
      return;
    }
    if (voiceTriggered) {
      setVoiceNotice("浏览器需要一次点击才能复制，请点就诊卡片上的“复制”按钮。");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopyDone(true);
      setTimeout(() => setCopyDone(false), 1800);
    } catch {
      setCopyDone(false);
    }
  }

  async function shareCard(card, voiceTriggered = false) {
    const summary = card?.visit_summary || {};
    const labels = { symptoms: "主要不适", duration: "持续时间", history: "既往情况", current_meds: "当前用药", questions: "想问医生", missing: "就诊时可补充" };
    const lines = [];
    if (card?.type === "pre") {
      for (const [key, label] of Object.entries(labels)) {
        const value = Array.isArray(summary[key]) ? summary[key].filter(Boolean).join("；") : String(summary[key] || "");
        if (value) lines.push(`${label}：${value}`);
      }
      lines.unshift("就诊前信息整理（请核对）");
      lines.push("仅整理对话中提到的信息，不是诊断结论。");
    } else {
      lines.push("小暖整理的就诊后安排（请核对医生原始医嘱）");
      for (const med of card?.medications || []) {
        const details = [med.dosage, med.frequency, med.timing].filter(Boolean).join("，");
        lines.push(`用药：${med.name || ""}${details ? `，${details}` : ""}`);
      }
      for (const warning of card?.warnings || []) lines.push(`注意：${warning}`);
      const follow = card?.follow_up || {};
      const bring = Array.isArray(follow.bring) ? follow.bring : [];
      if (follow.department || follow.time_hint || bring.length) lines.push(`复诊：${[follow.department, follow.time_hint, bring.length ? `带上${bring.join("、")}` : ""].filter(Boolean).join("，")}`);
      if (card?.next_dose_time) lines.push(`下次服药：${card.next_dose_time}`);
      lines.push("请以医生实际交代为准。");
    }
    const text = lines.join("\n");
    if (voiceTriggered) {
      const nativeShare = window.XiaonuanNative?.shareText;
      if (nativeShare) {
        try {
          nativeShare("小暖整理的就医信息", text);
          setShareStatus("已打开系统分享");
          setTimeout(() => setShareStatus(""), 2200);
        } catch {
          setVoiceNotice("分享没有打开，请点就诊卡片上的“分享”按钮。 ");
        }
      } else {
        setVoiceNotice("浏览器需要一次点击才能分享，请点就诊卡片上的“分享”按钮。 ");
      }
      return;
    }
    try {
      if (navigator.share) {
        await navigator.share({ title: "小暖整理的就医信息", text });
        setShareStatus("已打开分享");
      } else {
        await navigator.clipboard.writeText(text);
        setShareStatus("已复制，可粘贴给家人或医生");
      }
      setTimeout(() => setShareStatus(""), 2200);
    } catch (error) {
      if (error?.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(text);
        setShareStatus("已复制，可粘贴给家人或医生");
        setTimeout(() => setShareStatus(""), 2200);
      } catch {
        setShareStatus("分享失败，请重试");
        setTimeout(() => setShareStatus(""), 2200);
      }
    }
  }

  useEffect(() => {
    let alive = true;
    async function refresh() {
      try {
        const m = await fetchMemory();
        if (!alive) return;
        const meds = m.medications || [];
        const latestCard = (m.cards || []).slice().reverse().find((c) => c.card && c.card.next_dose_time);
        const time = latestCard?.card?.next_dose_time || "";
        const times = [...new Set(meds.flatMap((med) => normalizeReminderTimes(med.reminder_times)))].sort();
        setNextDose(meds.length ? { time, meds, times, reminderEnabled: remindersEnabled() } : null);
        syncMedicationReminders(meds);
      } catch {}
    }
    refresh();
    const timer = setInterval(refresh, 20000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  return (
    <div className={`relative flex h-screen flex-col overflow-hidden bg-[#f2f7f6] text-[#19383f]${largeCaptions ? " large-captions" : ""}`}>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-28 top-16 h-72 w-72 rounded-full bg-[#dff0ec] blur-3xl" />
        <div className="absolute -right-32 top-1/3 h-80 w-80 rounded-full bg-[#fbe9dc] blur-3xl" />
      </div>

      <header className="relative z-10 flex items-center justify-between px-5 pt-[max(16px,env(safe-area-inset-top))] md:px-8">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#e3f1ee] text-[#287f80] shadow-sm">
            <Stethoscope size={21} strokeWidth={1.8} />
          </div>
          <div>
            <h1 className="text-[17px] font-semibold tracking-tight">小暖 <span className="font-normal text-[#8da1a2]">· 就医助手</span></h1>
            <p className="mt-0.5 text-[11px] tracking-wide text-[#89a0a0]">把就医信息说清楚、记明白</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => openPhotoPanel(false)} aria-label="拍照识药" title="拍照识药"
            className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/90 bg-white/80 text-[#318a89] shadow-sm transition hover:bg-white active:scale-[.98]">
            <Camera size={19} strokeWidth={1.8} />
          </button>
          <button type="button" onClick={openMemoryPanel}
            className="flex h-11 items-center gap-2 rounded-2xl border border-white/90 bg-white/80 px-3.5 text-[13px] font-medium text-[#547477] shadow-sm transition hover:bg-white active:scale-[.98]">
            <Brain size={17} className="text-[#318a89]" /> 我的记录
          </button>
        </div>
      </header>

      {nextDose && (
        <button type="button" onClick={openMemoryPanel} className="relative z-10 mx-auto mt-3 flex items-center gap-2 rounded-full border border-[#f4dfc8] bg-[#fff8ef]/90 px-4 py-2 text-[12px] text-[#956543]">
          <Pill size={14} />
          {nextDose.times.length ? <>{nextDose.reminderEnabled ? "提醒已开启" : "已设置时间，点此开启提醒"}：<b className="font-semibold text-[#85552f]">{nextDose.times.join("、")}</b></> : nextDose.time ? <>医生提到的服药时间：<b className="font-semibold text-[#85552f]">{nextDose.time}</b></> : <>已保存 {nextDose.meds.length} 条用药记录 · 设置提醒</>}
        </button>
      )}

      {reminderPrompt && (
        <button type="button" onClick={speakReminder}
          className="relative z-10 mx-auto mt-3 flex animate-pulse items-center gap-2 rounded-full border border-[#f4dfc8] bg-[#fff8ef] px-4 py-2 text-[12px] text-[#956543] shadow-[0_8px_24px_rgba(150,90,40,.12)]">
          <Pill size={14} />
          到吃药时间了：{reminderPrompt.name}{reminderPrompt.dosage ? `，${reminderPrompt.dosage}` : ""}{reminderPrompt.time ? `（${reminderPrompt.time}）` : ""} · <b className="font-semibold text-[#85552f]">让小暖说</b>
        </button>
      )}

      <main className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-5 pb-4 pt-1">
        <div className="relative flex w-full max-w-[420px] flex-col items-center">
          <div className="relative flex h-[min(30vh,232px)] w-full items-center justify-center">
            <Companion audioLevel={level} talking={phase === "speak"} thinking={phase === "think"} listening={phase === "listen"} style={{ width: "min(52vw, 200px)" }} />
            <div className="absolute right-[16%] top-[12%] flex h-8 w-8 items-center justify-center rounded-2xl border border-white bg-white/90 text-[#e6a66c] shadow-sm">
              <Sparkles size={15} />
            </div>
          </div>

          <div className="mt-[-2px] min-h-[74px] w-full text-center">
            <p className={`text-[14px] font-medium text-[#709092]${phase === "think" ? " think-float" : ""}`}>
              {phaseText || (micOn ? "您可以接着说，我在听" : "准备好了，点话筒开始")}
            </p>
            {subtitle && (
              <div className="subtitle-panel mx-auto mt-2 max-w-[370px] rounded-2xl border border-white/90 bg-white/85 px-4 py-2.5 text-[15px] leading-6 text-[#31565b] shadow-[0_8px_24px_rgba(48,89,88,.07)]">
                <span className="mr-2 text-[11px] font-semibold uppercase tracking-wide text-[#4b9692]">{subtitle.who}</span>
                {subtitle.text}
              </div>
            )}
            {micError && <p className="mt-2 text-[13px] text-[#bd6854]">{micError}</p>}
            {voiceNotice && <p role="status" className="mt-2 text-[13px] text-[#287f80]">{voiceNotice}</p>}
            {demoMode && <span className="mt-2 inline-flex rounded-full bg-[#fff2df] px-3 py-1 text-[11px] font-medium text-[#a07142]">演示模式</span>}
          </div>

          {/* 设置工具栏：放在人物下方，和顶部导航栏彻底分开；按钮紧凑 + 可换行，窄屏也不重叠 */}
          <div data-testid="settings-toolbar" className="mt-1 flex w-full flex-wrap items-center justify-center gap-1.5">
            <button type="button" onClick={toggleCaptions} aria-pressed={captionsOn} className={`flex h-8 items-center gap-1 rounded-lg px-2 text-[11px] font-medium transition active:scale-[.97] ${captionsOn ? "bg-[#287f80] text-white shadow-[0_4px_12px_rgba(40,127,128,.18)]" : "border border-white/90 bg-white/80 text-[#547477]"}`}>
              <CaseSensitive size={13} />{captionsOn ? "字幕已开" : "字幕"}
            </button>
            {captionsOn && (
              <button type="button" onClick={toggleLargeCaptions} aria-pressed={largeCaptions} className={`flex h-8 items-center gap-1 rounded-lg px-2 text-[11px] font-medium transition active:scale-[.97] ${largeCaptions ? "bg-[#287f80] text-white" : "border border-white/90 bg-white/80 text-[#547477]"}`}>
                <CaseSensitive size={13} />{largeCaptions ? "已放大" : "放大"}
              </button>
            )}
            <button type="button" onClick={() => setSpeedState((speed) => speed === "slow" ? "normal" : "slow")} aria-pressed={speechSpeed === "slow"} className={`flex h-8 items-center gap-1 rounded-lg px-2 text-[11px] font-medium transition active:scale-[.97] ${speechSpeed === "slow" ? "bg-[#287f80] text-white shadow-[0_4px_12px_rgba(40,127,128,.18)]" : "border border-white/90 bg-white/80 text-[#547477]"}`}>
              <Gauge size={13} />{speechSpeed === "slow" ? "慢速" : "正常"}
            </button>
            {hasLastReply && <button type="button" onClick={repeatLastReply} className="flex h-8 items-center gap-1 rounded-lg border border-white/90 bg-white/80 px-2 text-[11px] font-medium text-[#547477] transition active:scale-[.97]">
              <RotateCcw size={12} />再听
            </button>}
          </div>

          {cards.length > 0 && (
            <div className="relative mt-3 w-full max-w-[390px] rounded-[22px] border border-white bg-white/95 p-4 pr-28 text-[13px] leading-relaxed text-[#37555a] shadow-[0_14px_40px_rgba(44,84,85,.12)]">
              <div className="absolute right-9 top-2 flex items-center gap-0.5">
                <button type="button" onClick={() => shareCard(cards[cards.length - 1])}
                  className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium text-[#287f80]" aria-label="分享给家人或医生" title="分享给家人或医生">
                  <Share2 size={13} />分享
                </button>
                {cards[cards.length - 1]?.type === "pre" && (
                  <button type="button" onClick={() => copyVisitSummary(cards[cards.length - 1])}
                    className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium text-[#287f80]" aria-label="复制就诊摘要">
                    {copyDone ? <Check size={13} /> : <Copy size={13} />}{copyDone ? "已复制" : "复制"}
                  </button>
                )}
              </div>
              <button type="button" aria-label="收起卡片" onClick={() => dismissCard(cards.length - 1)}
                className="absolute right-2 top-2 rounded-full p-1 text-[#93a7a8] hover:bg-[#eef5f4]">
                <X size={14} />
              </button>
              {shareStatus && <p className="mb-2 text-[11px] text-[#287f80]">{shareStatus}</p>}
              <CardView card={cards[cards.length - 1]} />
            </div>
          )}
        </div>
      </main>

      <footer className="relative z-10 border-t border-white/70 bg-white/55 px-6 pb-[max(20px,env(safe-area-inset-bottom))] pt-4 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[420px] items-center justify-center gap-7">
          <div className="flex flex-col items-center gap-1.5">
            <button type="button" onClick={toggleMic} aria-label={micConnecting ? "正在连接语音服务" : micOn ? "停止聆听" : "开始说话"} aria-pressed={micOn} aria-busy={micConnecting} disabled={micConnecting}
              className={`flex h-16 w-16 items-center justify-center rounded-[22px] border transition active:scale-95 disabled:cursor-wait ${micOn ? "border-[#287f80] bg-[#287f80] text-white shadow-[0_8px_20px_rgba(40,127,128,.2)] hover:bg-[#216f72]" : micConnecting ? "border-[#b7dcda] bg-[#e5f3f1] text-[#287f80]" : "border-[#dce8e7] bg-white/80 text-[#91a4a5] hover:bg-white"}`}>
              {micConnecting ? <LoaderCircle size={24} strokeWidth={1.9} className="animate-spin" /> : <Mic size={24} strokeWidth={1.9} />}
            </button>
            <span role="status" className={`text-[11px] font-medium ${micOn || micConnecting ? "text-[#287f80]" : "text-[#93a7a8]"}`}>{micConnecting ? "正在连接…" : micOn ? "正在聆听" : "麦克风已关闭"}</span>
          </div>
          <div className="flex flex-col items-center gap-1.5">
            <button type="button" onClick={() => setSpeakerOn((v) => !v)} aria-label={speakerOn ? "关闭听筒声音" : "开启听筒声音"} aria-pressed={speakerOn}
              className={`flex h-16 w-16 items-center justify-center rounded-[22px] border transition active:scale-95 ${speakerOn ? "border-[#b7dcda] bg-[#e5f3f1] text-[#287f80] shadow-[0_6px_16px_rgba(40,127,128,.1)]" : "border-[#dce8e7] bg-white/80 text-[#91a4a5] hover:bg-white"}`}>
              <Headphones size={24} strokeWidth={1.9} />
            </button>
            <span className={`text-[11px] font-medium ${speakerOn ? "text-[#287f80]" : "text-[#93a7a8]"}`}>{speakerOn ? "听筒声音已开启" : "听筒已静音"}</span>
          </div>
        </div>
        <p className="mt-2 text-center text-[11px] text-[#93a7a8]">{micConnecting ? "正在连接小暖的语音服务…" : micOn ? "正在聆听 · 再点一下可结束" : micError ? "连接没有成功，请稍后重试" : "点击话筒开始语音对话"}</p>
      </footer>

      {memOpen && <MemoryPanel onClose={closeMemoryPanel} focusDispenser={focusDispenser} />}
      {photoOpen && (
        <PrescriptionPhotoPanel
          autoOpened={photoAutoOpened}
          onClose={closePhotoPanel}
          onSpeak={speak}
          onReadBack={handlePhotoReadBack}
          onRetake={handlePhotoRetake}
          doneSignal={photoDoneSignal}
        />
      )}

      {activationOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#19383f]/35 px-6 backdrop-blur-[5px]"
          role="dialog" aria-modal="true" aria-labelledby="activation-title">
          <div className="w-full max-w-[340px] rounded-[28px] border border-white/80 bg-[#fffdfa] px-6 pb-6 pt-7 text-center shadow-[0_24px_80px_rgba(23,62,66,.24)]">
            <div className="mx-auto flex h-14 w-14 items-center justify-center overflow-hidden rounded-[20px] bg-[#e7f3ef]">
              <BrandMark className="h-12 w-12" />
            </div>
            <h2 id="activation-title" className="mt-4 text-[20px] font-semibold tracking-tight text-[#19383f]">点击屏幕，激活小暖</h2>
            <p className="mt-2 text-[13px] leading-6 text-[#789092]">开启麦克风后直接说就行，例如“帮我看药盒”，拍好了说“我拍好了”；也可以说“打开字幕”“说慢一点”或“打开我的记录”，小暖会帮您打开相应功能。</p>
            <button type="button" onClick={activateWithWelcome}
              className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#287f80] text-[14px] font-semibold text-white shadow-[0_8px_20px_rgba(40,127,128,.2)] transition hover:bg-[#216f72] active:scale-[.98]">
              <Mic size={17} />点击激活并开启麦克风
            </button>
            <p className="mt-3 text-[11px] text-[#9aabab]">如果系统询问权限，请选择允许</p>
          </div>
        </div>
      )}
    </div>
  );
}
