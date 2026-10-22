import { useState } from "react";
import { Camera, Check, ChevronRight, ClipboardList, RotateCcw, Stethoscope } from "lucide-react";

const steps = [
  { title: "看医生前", icon: ClipboardList },
  { title: "看诊时", icon: Stethoscope },
  { title: "看完之后", icon: Camera },
];

export default function VisitJourney({ step, onPrepare, onDoctorDone, onPhoto, onReset }) {
  const [expanded, setExpanded] = useState(true);
  const current = Math.max(0, Math.min(3, step));
  return (
    <section className="relative z-10 mx-auto mt-3 w-[calc(100%-40px)] max-w-[420px] rounded-2xl border border-white/90 bg-white/85 p-3 shadow-[0_6px_24px_rgba(42,87,87,.06)]">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} className="flex min-h-10 min-w-0 flex-1 items-center justify-between gap-2 text-left">
          <span className="text-[14px] font-semibold text-[#315b60]">就医三步</span>
          <span className="truncate text-[12px] text-[#789092]">{steps[current].title}</span>
        </button>
        <button type="button" onClick={onPhoto} className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-[#edf6f4] px-3 text-[13px] font-medium text-[#287f80]" aria-label="拍照整理医嘱">
          <Camera size={16} />拍医嘱
        </button>
      </div>
      {expanded && (
        <>
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            {steps.map(({ title, icon: Icon }, index) => (
              <div key={title} className={`flex items-center gap-1.5 rounded-xl px-2 py-2 ${index < current ? "bg-[#e8f4ef] text-[#287f80]" : index === current ? "bg-[#287f80] text-white" : "bg-[#f1f5f4] text-[#879d9e]"}`}>
                {index < current ? <Check size={15} /> : <Icon size={15} />}
                <span className="truncate text-[11px] font-medium">{title}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[13px] leading-5 text-[#688184]">
            {current === 0 ? "先说说哪里不舒服，小暖会整理成一张可给医生看的摘要。" : current === 1 ? "把摘要给医生看；看完后告诉小暖，再整理医嘱和复诊安排。" : current === 2 ? "拍下处方或医嘱，逐项核对后再保存或设置提醒。" : "已保存您核对过的医嘱；有其他药品或复诊单，也可以继续拍照整理。"}
          </p>
          <div className="mt-2 flex items-center gap-2">
            {current === 0 ? (
              <button type="button" onClick={onPrepare} className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#287f80] px-3 text-[13px] font-medium text-white">
                整理就诊问题<ChevronRight size={16} />
              </button>
            ) : current === 1 ? (
              <button type="button" onClick={onDoctorDone} className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#287f80] px-3 text-[13px] font-medium text-white">
                看完医生了<ChevronRight size={16} />
              </button>
            ) : (
              <button type="button" onClick={onPhoto} className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#287f80] px-3 text-[13px] font-medium text-white">
                {current === 3 ? "再拍一张医嘱" : "拍照整理医嘱"}<ChevronRight size={16} />
              </button>
            )}
            {current > 0 && <button type="button" onClick={onReset} className="flex h-10 shrink-0 items-center gap-1 rounded-xl px-2 text-[12px] text-[#789092]" title="重新开始一趟就医流程">
              <RotateCcw size={14} />重来
            </button>}
          </div>
        </>
      )}
    </section>
  );
}
