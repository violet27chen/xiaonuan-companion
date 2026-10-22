import { useEffect, useState } from "react";
import { Mic, Stethoscope, Headphones, Brain, X, Pill, Copy, Check, Share2, Sparkles } from "lucide-react";
import Companion from "./Companion.jsx";
import MemoryPanel, { CardView } from "./MemoryPanel.jsx";
import { PHASE_TEXT, useConversation } from "../hooks/useConversation.js";
import { fetchMemory } from "../lib/auth.js";
import { setAudioMuted } from "../lib/ai.js";
import { syncMedicationReminders, normalizeReminderTimes, remindersEnabled } from "../lib/reminders.js";

export default function CallScreen() {
  const { phase, micOn, level, subtitle, cards, dismissCard, demoMode, micError, toggleMic, activateMic, mode, detectedMode, setMode } = useConversation();
  const [speakerOn, setSpeakerOn] = useState(true);
  const [activationOpen, setActivationOpen] = useState(true);
  const [memOpen, setMemOpen] = useState(false);
  const [nextDose, setNextDose] = useState(null);
  const [copyDone, setCopyDone] = useState(false);
  const [shareStatus, setShareStatus] = useState("");
  const phaseText = PHASE_TEXT[phase] || "";

  useEffect(() => setAudioMuted(!speakerOn), [speakerOn]);

  async function copyVisitSummary(card) {
    const s = card?.visit_summary || {};
    const labels = { symptoms: "主要不适", duration: "持续时间", history: "既往情况", current_meds: "当前用药", questions: "想问医生", missing: "就诊时可补充" };
    const lines = Object.entries(labels).flatMap(([key, label]) => {
      const value = Array.isArray(s[key]) ? s[key].filter(Boolean).join("；") : String(s[key] || "");
      return value ? [`${label}：${value}`] : [];
    });
    try {
      await navigator.clipboard.writeText(["就诊前信息整理（请核对）", ...lines, "仅整理对话信息，不是诊断结论。"].join("\n"));
      setCopyDone(true);
      setTimeout(() => setCopyDone(false), 1800);
    } catch {
      setCopyDone(false);
    }
  }

  async function shareCard(card) {
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

  const busy = phase === "think" || phase === "speak";
  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-[#f2f7f6] text-[#19383f]">
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
        <button type="button" onClick={() => setMemOpen(true)}
          className="flex h-11 items-center gap-2 rounded-2xl border border-white/90 bg-white/80 px-3.5 text-[13px] font-medium text-[#547477] shadow-sm transition hover:bg-white active:scale-[.98]">
          <Brain size={17} className="text-[#318a89]" /> 我的记录
        </button>
      </header>

      <div className="relative z-10 mx-auto mt-4 flex w-[calc(100%-40px)] max-w-[420px] items-center rounded-2xl border border-white/90 bg-white/75 p-1 shadow-[0_6px_24px_rgba(42,87,87,.06)]">
        {[["auto", "自动识别"], ["pre", "就诊前"], ["post", "就诊后"]].map(([value, label]) => (
          <button key={value} type="button" disabled={busy} onClick={() => setMode(value)} aria-pressed={mode === value}
            className={`flex-1 rounded-xl px-2 py-2.5 text-[12px] font-medium transition ${mode === value ? "bg-[#287f80] text-white shadow-[0_4px_12px_rgba(40,127,128,.2)]" : "text-[#789092] hover:text-[#315b60]"} disabled:opacity-60`}>
            {label}
          </button>
        ))}
      </div>
      <p className="relative z-10 mt-1 text-center text-[11px] text-[#89a0a0]">
        {mode === "auto" ? `自动识别：${{ pre: "就诊前准备", post: "就诊后整理", chat: "日常聊天" }[detectedMode] || "等待识别"}` : "手动选择模式"}
      </p>

      {nextDose && (
        <button type="button" onClick={() => setMemOpen(true)} className="relative z-10 mx-auto mt-3 flex items-center gap-2 rounded-full border border-[#f4dfc8] bg-[#fff8ef]/90 px-4 py-2 text-[12px] text-[#956543]">
          <Pill size={14} />
          {nextDose.times.length ? <>{nextDose.reminderEnabled ? "提醒已开启" : "已设置时间，点此开启提醒"}：<b className="font-semibold text-[#85552f]">{nextDose.times.join("、")}</b></> : nextDose.time ? <>医生提到的服药时间：<b className="font-semibold text-[#85552f]">{nextDose.time}</b></> : <>已保存 {nextDose.meds.length} 条用药记录 · 设置提醒</>}
        </button>
      )}

      <main className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-5 pb-4 pt-1">
        <div className="relative flex w-full max-w-[420px] flex-col items-center">
          <div className="relative flex h-[min(42vh,330px)] w-full items-center justify-center">
            <Companion audioLevel={level} talking={phase === "speak"} thinking={phase === "think"} listening={phase === "listen"} style={{ width: "min(75vw, 310px)" }} />
            <div className="absolute right-[12%] top-[14%] flex h-9 w-9 items-center justify-center rounded-2xl border border-white bg-white/90 text-[#e6a66c] shadow-sm">
              <Sparkles size={17} />
            </div>
          </div>

          <div className="mt-[-2px] min-h-[74px] w-full text-center">
            <p className={`text-[14px] font-medium text-[#709092]${phase === "think" ? " think-float" : ""}`}>
              {phaseText || (micOn ? "您可以接着说，我在听" : "准备好了，点话筒开始")}
            </p>
            {subtitle && (
              <div className="mx-auto mt-2 max-w-[370px] rounded-2xl border border-white/90 bg-white/85 px-4 py-2.5 text-[15px] leading-6 text-[#31565b] shadow-[0_8px_24px_rgba(48,89,88,.07)]">
                <span className="mr-2 text-[11px] font-semibold uppercase tracking-wide text-[#4b9692]">{subtitle.who}</span>
                {subtitle.text}
              </div>
            )}
            {micError && <p className="mt-2 text-[13px] text-[#bd6854]">{micError}</p>}
            {demoMode && <span className="mt-2 inline-flex rounded-full bg-[#fff2df] px-3 py-1 text-[11px] font-medium text-[#a07142]">演示模式</span>}
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
            <button type="button" onClick={toggleMic} aria-label={micOn ? "停止聆听" : "开始说话"} aria-pressed={micOn}
              className={`flex h-16 w-16 items-center justify-center rounded-[22px] border transition active:scale-95 ${micOn ? "border-[#287f80] bg-[#287f80] text-white shadow-[0_8px_20px_rgba(40,127,128,.2)] hover:bg-[#216f72]" : "border-[#dce8e7] bg-white/80 text-[#91a4a5] hover:bg-white"}`}>
              <Mic size={24} strokeWidth={1.9} />
            </button>
            <span className={`text-[11px] font-medium ${micOn ? "text-[#287f80]" : "text-[#93a7a8]"}`}>{micOn ? "正在聆听" : "麦克风已关闭"}</span>
          </div>
          <div className="flex flex-col items-center gap-1.5">
            <button type="button" onClick={() => setSpeakerOn((v) => !v)} aria-label={speakerOn ? "关闭听筒声音" : "开启听筒声音"} aria-pressed={speakerOn}
              className={`flex h-16 w-16 items-center justify-center rounded-[22px] border transition active:scale-95 ${speakerOn ? "border-[#b7dcda] bg-[#e5f3f1] text-[#287f80] shadow-[0_6px_16px_rgba(40,127,128,.1)]" : "border-[#dce8e7] bg-white/80 text-[#91a4a5] hover:bg-white"}`}>
              <Headphones size={24} strokeWidth={1.9} />
            </button>
            <span className={`text-[11px] font-medium ${speakerOn ? "text-[#287f80]" : "text-[#93a7a8]"}`}>{speakerOn ? "听筒声音已开启" : "听筒已静音"}</span>
          </div>
        </div>
        <p className="mt-2 text-center text-[11px] text-[#93a7a8]">{micOn ? "正在聆听 · 再点一下可结束" : "点击话筒开始语音对话"}</p>
      </footer>

      {memOpen && <MemoryPanel onClose={() => setMemOpen(false)} />}

      {activationOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#19383f]/35 px-6 backdrop-blur-[5px]"
          role="dialog" aria-modal="true" aria-labelledby="activation-title">
          <div className="w-full max-w-[340px] rounded-[28px] border border-white/80 bg-[#fffdfa] px-6 pb-6 pt-7 text-center shadow-[0_24px_80px_rgba(23,62,66,.24)]">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[20px] bg-[#e7f3ef] text-[#287f80]">
              <Mic size={25} strokeWidth={1.8} />
            </div>
            <h2 id="activation-title" className="mt-4 text-[20px] font-semibold tracking-tight text-[#19383f]">点击屏幕，激活小暖</h2>
            <p className="mt-2 text-[13px] leading-6 text-[#789092]">开启麦克风后就能直接说话，小暖会认真听你讲。</p>
            <button type="button" onClick={() => { setActivationOpen(false); activateMic(); }}
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
