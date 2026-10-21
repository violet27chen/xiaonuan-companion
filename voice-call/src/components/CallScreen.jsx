import { useState } from "react";
import { Mic, Stethoscope, Volume2, Brain } from "lucide-react";
import Companion from "./Companion.jsx";
import MemoryPanel from "./MemoryPanel.jsx";
import { PHASE_TEXT, useConversation } from "../hooks/useConversation.js";

/* 情景固定为陪诊；底部只保留 麦克风 / 免提 两个功能按钮 */
const CONTROLS = [
  { id: "mic", label: "麦克风", icon: Mic },
  { id: "speaker", label: "免提", icon: Volume2 },
];

function ControlButton({ item, isOn, onToggle }) {
  const { icon: Icon, label } = item;
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={isOn}
      onClick={() => onToggle(item.id)}
      className={[
        "flex h-16 w-16 items-center justify-center rounded-full transition-transform duration-100 active:scale-95",
        isOn
          ? "bg-white text-[#4a4038] shadow-[0_8px_24px_rgba(120,100,70,0.16)]"
          : "bg-[#e9e2d4] text-[#a79d8c]",
      ].join(" ")}
    >
      <span className="relative flex items-center justify-center">
        <Icon size={26} strokeWidth={1.8} />
        {!isOn && <span className="absolute h-[2px] w-9 rotate-45 rounded-full bg-[#b7ac9a]" />}
      </span>
    </button>
  );
}

export default function CallScreen() {
  const { phase, micOn, level, subtitle, demoMode, micError, toggleMic } = useConversation();
  const [speakerOn, setSpeakerOn] = useState(true);
  const [memOpen, setMemOpen] = useState(false);
  const phaseText = PHASE_TEXT[phase] || "";

  return (
    <div className="relative h-dvh w-full touch-none overflow-hidden bg-[#f6f1e7] text-[#4a4038] select-none">
      {/* 暖阳纸感背景：顶部自然暖光，不用紫色渐变 */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 75% 55% at 50% 26%, #fffdf6 0%, #f6f1e7 58%, #efe7d8 100%)",
        }}
      />

      {/* 顶部：情景固定为「陪诊」；服务不可用时显示演示模式 */}
      <div
        className="absolute inset-x-0 top-0 z-10 flex flex-col items-center"
        style={{ paddingTop: "max(20px, env(safe-area-inset-top))" }}
      >
        <div className="flex items-center gap-2 rounded-full border border-[#e6ddc9] bg-white/85 px-5 py-2.5 shadow-[0_6px_20px_rgba(120,100,70,0.10)]">
          <Stethoscope size={17} strokeWidth={1.8} className="text-[#1b6c80]" />
          <span className="text-[15px] font-medium text-[#4a4038]">陪诊情景</span>
        </div>
        {demoMode && (
          <span className="mt-2 rounded-full bg-[#fdf6e7] px-3 py-1 text-[12px] font-medium text-[#92400e]">
            演示模式
          </span>
        )}
      </div>

      {/* 右上角：记忆入口 */}
      <button
        type="button"
        onClick={() => setMemOpen(true)}
        className="absolute right-4 z-20 flex items-center gap-1.5 rounded-full border border-[#e6ddc9] bg-white/85 px-4 py-2.5 text-[14px] font-medium text-[#4a4038] shadow-[0_6px_20px_rgba(120,100,70,0.10)] transition-transform duration-100 active:scale-95"
        style={{ top: "max(20px, env(safe-area-inset-top))" }}
      >
        <Brain size={16} strokeWidth={1.8} className="text-[#1b6c80]" />
        记忆
      </button>

      {/* 中间：小暖人物形象 */}
      <div className="absolute inset-0 flex items-center justify-center">
        {/* 地面软阴影：让人物像坐在自然光里 */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-[7vmin] w-[44vmin] -translate-x-1/2 translate-y-[24vmin] rounded-[50%] bg-[#d8ccb6] blur-2xl opacity-70" />
        <Companion
          audioLevel={level}
          talking={phase === "speak"}
          listening={phase === "listen"}
        />
      </div>

      {/* 状态区：人物正下方，状态标签 + 语音字幕 */}
      <div className="absolute inset-x-0 z-10 px-10" style={{ top: "calc(50% + 27vmin + 14px)" }}>
        {phaseText && (
          <p
            className={`text-center text-[15px] text-[#8a7f72]${
              phase === "think" ? " think-float" : ""
            }`}
          >
            {phaseText}
          </p>
        )}
        {subtitle && (
          <p className="mt-2 text-center text-[19px] font-medium leading-relaxed text-[#4a4038]">
            <span className="mr-2 text-[14px] font-normal text-[#a79d8c]">{subtitle.who}</span>
            {subtitle.text}
          </p>
        )}
        {micError && <p className="mt-2 text-center text-[14px] text-[#c0392b]">{micError}</p>}
      </div>

      {/* 底部控制面板：只保留 麦克风 / 免提 */}
      <div
        className="absolute inset-x-0 bottom-0 z-10 px-6 pt-10"
        style={{ paddingBottom: "max(28px, env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto flex items-center justify-center gap-10">
          {CONTROLS.map((item) => (
            <ControlButton
              key={item.id}
              item={item}
              isOn={item.id === "mic" ? micOn : speakerOn}
              onToggle={(id) => (id === "mic" ? toggleMic() : setSpeakerOn((v) => !v))}
            />
          ))}
        </div>
      </div>

      {/* 记忆面板 */}
      {memOpen && <MemoryPanel onClose={() => setMemOpen(false)} />}
    </div>
  );
}
