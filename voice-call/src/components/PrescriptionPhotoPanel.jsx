import { useEffect, useRef, useState } from "react";
import { Camera, Check, LoaderCircle, RotateCcw, X } from "lucide-react";
import { fetchMemory, saveMemory } from "../lib/auth.js";
import { compressPrescriptionPhoto, recognizePrescription } from "../lib/medicationPhoto.js";
import { defaultReminderTimes, normalizeTimes, timesToSpeech } from "../lib/medicationSchedule.js";

function timesFromText(value) {
  return normalizeTimes(String(value || "").split(/[，,、\s]+/).map((v) => v.trim()));
}

/** 小暖复述记录的文本：药名+剂量+频次+时间，然后问对不对 */
function readBackText(items) {
  const valid = items.filter((item) => item.name?.trim());
  if (!valid.length) return "";
  const parts = valid.map((item) => {
    const dose = item.dosage?.trim();
    // 识别结果有时已带"每次"（如"每次1片"），别再重复加
    const doseText = dose && !/每次|每一|每回/.test(dose) ? `每次${dose}` : dose || "";
    const freq = item.frequency?.trim();
    const times = timesToSpeech(timesFromText(item.reminderText));
    return [item.name.trim(), doseText, freq, times].filter(Boolean).join("，");
  });
  const list = parts.join("；");
  return valid.length === 1
    ? `我记下了：${list}。这个时间对吗？不对的话直接告诉我怎么改。`
    : `我记下了：${list}。这些时间对吗？不对的话直接告诉我怎么改。`;
}

export default function PrescriptionPhotoPanel({ onClose, onSpeak, onReadBack, onRetake, doneSignal = 0, autoOpened = false }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [items, setItems] = useState([]);
  const [saved, setSaved] = useState(false);
  const [readBack, setReadBack] = useState("");
  const autoRecognizeRef = useRef(false);
  const itemsSnapshotRef = useRef("");

  useEffect(() => {
    if (!file) { setPreview(""); return undefined; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function resetAll() {
    setFile(null);
    setResult(null);
    setItems([]);
    setSaved(false);
    setReadBack("");
    setError("");
    autoRecognizeRef.current = false;
    itemsSnapshotRef.current = "";
  }

  function chooseFile(next) {
    setError("");
    setResult(null);
    setItems([]);
    setSaved(false);
    setReadBack("");
    itemsSnapshotRef.current = "";
    setFile(next || null);
    if (next) autoRecognizeRef.current = true; // 拍完/选完自动识别，不用点发送
    onRetake?.();
  }

  async function recognize(fileArg) {
    const target = fileArg || file;
    if (!target || busy) return;
    setBusy(true);
    setError("");
    try {
      const image = await compressPrescriptionPhoto(target);
      const parsed = await recognizePrescription(image);
      setResult(parsed);
      const recognized = (parsed.medications || [])
        .filter((med) => med?.name?.trim())
        .map((med) => {
          // 医嘱没写钟点时，按频次自动排默认时间（非睡眠时段）
          const schedule = defaultReminderTimes(med.frequency, med.reminder_times);
          return {
            ...med,
            name: med.name.trim(),
            reminderText: schedule.times.join(", "),
            reminderSource: schedule.source,
          };
        });
      setItems(recognized);
      if (!recognized.length) {
        setError("没有读出药品项目；可以换一张更清楚的照片再试");
        onSpeak?.("这张照片我没看清药品信息，换一张更清楚的再拍一次吧。");
        return;
      }
      await persist(recognized);
    } catch (e) {
      setError(e.message || "识别失败，请重试");
      onSpeak?.("这张照片我没识别成功，换一张更清楚的再试一次吧。");
    } finally {
      setBusy(false);
    }
  }

  /** 保存识别结果（合并同名用药），保存后让小暖复述时间并问对不对 */
  async function persist(list) {
    if (!list.length || busy) return;
    setBusy(true);
    setError("");
    try {
      const current = await fetchMemory();
      const merged = new Map((current.medications || []).filter((med) => med?.name?.trim()).map((med) => [med.name.trim(), med]));
      const medications = list.map(({ reminderText, reminderSource, ...med }) => ({
        ...(merged.get(med.name.trim()) || {}),
        ...med,
        name: med.name.trim(),
        reminder_times: timesFromText(reminderText),
      }));
      for (const med of medications) merged.set(med.name, med);
      const photoCard = {
        type: "post",
        source: "photo",
        document_type: result?.document_type,
        medications,
        warnings: result?.warnings || [],
        follow_up: result?.follow_up || {},
        unreadable: result?.unreadable || [],
      };
      await saveMemory({ medications: [...merged.values()], cards: [photoCard] });
      setSaved(true);
      itemsSnapshotRef.current = JSON.stringify(list);
      const text = readBackText(list);
      setReadBack(text);
      onReadBack?.(text); // 小暖念出来 + 进入"等确认"状态
    } catch (e) {
      setError(e.message || "保存失败，请重试");
      onSpeak?.("这次没保存成功，请稍后再试一次。");
    } finally {
      setBusy(false);
    }
  }

  // 拍完/选完照片：自动开始识别，不用点任何按钮
  useEffect(() => {
    if (file && autoRecognizeRef.current) {
      autoRecognizeRef.current = false;
      recognize(file);
    }
  }, [file]);

  // 手动改了什么：停顿一下自动重存（老人不点保存也能改对）
  useEffect(() => {
    if (!saved || !items.length) return undefined;
    const snapshot = JSON.stringify(items);
    if (snapshot === itemsSnapshotRef.current) return undefined;
    const timer = setTimeout(() => {
      itemsSnapshotRef.current = snapshot;
      persist(items);
    }, 900);
    return () => clearTimeout(timer);
  }, [items, saved]);

  // 语音"我拍好了"：有照片就开始识别；已存好的就再念一遍时间
  useEffect(() => {
    if (!doneSignal) return undefined;
    if (busy) return undefined;
    if (file && !result) { recognize(file); return undefined; }
    if (saved && readBack) onSpeak?.(readBack);
    if (!file) setError("先拍一张药盒或医嘱的照片，拍好了再跟我说“我拍好了”。");
    return undefined;
  }, [doneSignal]);

  function updateItem(index, patch) {
    setItems((current) => current.map((item, i) => i === index ? { ...item, ...patch } : item));
  }

  const savedCount = items.filter((item) => item.name?.trim()).length;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-[#19383f]/45 p-0 backdrop-blur-sm sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-labelledby="photo-title">
      <section className="flex max-h-[94dvh] w-full max-w-[560px] flex-col overflow-hidden rounded-t-[28px] bg-[#f9fbfb] shadow-2xl sm:rounded-[28px]">
        <header className="flex items-center justify-between border-b border-[#dce8e7] px-5 py-4" style={{ paddingTop: "max(16px, env(safe-area-inset-top))" }}>
          <div>
            <h2 id="photo-title" className="text-[18px] font-semibold text-[#19383f]">拍张照片给小暖看</h2>
            <p className="mt-1 text-[13px] text-[#769092]">药盒、处方或医嘱都可以拍</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#688184]" aria-label="关闭">
            <X size={20} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <p className="rounded-2xl border border-[#f1dfc8] bg-[#fff8ef] p-3.5 text-[14px] leading-6 text-[#805f43]">
            拍清楚药盒、处方或医嘱上的文字，小暖会自动识别并整理，不用点发送。建议先遮住姓名、身份证号、就诊卡号等个人信息；识别结果请对照原件核对，药盒上的规格不代表每次服用剂量，小暖不会据此判断怎么吃药，也不会保存原照片。
          </p>
          {autoOpened && !saved && <p className="rounded-xl bg-[#edf6f4] px-3.5 py-3 text-[14px] leading-5 text-[#287f80]">您刚才提到了药品，我已经帮您打开拍照入口。对准药盒或医嘱拍一张，拍好了跟我说一声“我拍好了”就行。</p>}

          {preview ? (
            <div className="relative overflow-hidden rounded-2xl border border-[#dce8e7] bg-white">
              <img src={preview} alt="待识别的医嘱照片" className="max-h-[30vh] w-full object-contain" />
              {!saved && (
                <button type="button" onClick={() => chooseFile(null)} className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-white/95 px-3 py-2 text-[13px] text-[#547477] shadow" aria-label="重新选择照片">
                  <RotateCcw size={15} />重选
                </button>
              )}
            </div>
          ) : (
            <label className="flex min-h-40 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-[#b9d8d3] bg-white text-center text-[#287f80]">
              <Camera size={32} strokeWidth={1.7} />
              <span className="text-[16px] font-medium">拍照或从相册选择</span>
              <span className="text-[13px] text-[#769092]">拍好了跟我说“我拍好了”，小暖自动识别</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" onChange={(event) => chooseFile(event.target.files?.[0])} />
            </label>
          )}

          {busy && !saved && (
            <p className="flex items-center gap-2 rounded-xl bg-[#edf6f4] px-3.5 py-3 text-[14px] text-[#287f80]">
              <LoaderCircle size={17} className="animate-spin" />小暖正在看这张照片…
            </p>
          )}

          {saved && (
            <>
              <p className="rounded-xl bg-[#edf6f4] px-3.5 py-3 text-[14px] leading-5 text-[#557176]">
                <Check size={15} className="mr-1 inline align-text-top" />已自动记下 {savedCount} 项。小暖会念一遍记录的时间，问您对不对；不对就直接说，比如“阿司匹林改成一天两次”。也可以直接改下面的内容，改完会自动保存。
              </p>
              {readBack && <p className="rounded-xl bg-white px-3.5 py-3 text-[14px] leading-6 text-[#287f80]">小暖：{readBack}</p>}
            </>
          )}

          {items.map((item, index) => (
            <article key={`${item.name}-${index}`} className="space-y-3 rounded-2xl border border-[#dce8e7] bg-white p-4">
              {item.uncertain_fields?.length > 0 && <p className="text-[13px] text-[#ae684c]">图片不清楚：{item.uncertain_fields.join("、")}。请看原件修改。</p>}
              {item.evidence && <p className="rounded-lg bg-[#f4f7f6] px-3 py-2 text-[13px] leading-5 text-[#769092]">图片原文：{item.evidence}</p>}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {[["name", "药品名称"], ["dosage", "每次剂量"], ["frequency", "服用频次"], ["timing", "服用时机"]].map(([key, label]) => (
                  <label key={key} className="text-[13px] text-[#769092]">
                    {label}
                    <input value={item[key] || ""} onChange={(event) => updateItem(index, { [key]: event.target.value })} placeholder="未写明可留空" className="mt-1 h-11 w-full rounded-xl border border-[#dce8e7] bg-[#fbfdfd] px-3 text-[15px] text-[#19383f] outline-none focus:border-[#78b6ae]" />
                  </label>
                ))}
                <label className="text-[13px] text-[#769092] sm:col-span-2">
                  每日提醒钟点
                  <input value={item.reminderText || ""} onChange={(event) => updateItem(index, { reminderText: event.target.value })} placeholder="如 08:00, 18:00" className="mt-1 h-11 w-full rounded-xl border border-[#dce8e7] bg-[#fbfdfd] px-3 text-[15px] text-[#19383f] outline-none focus:border-[#78b6ae]" />
                  {item.reminderSource === "default" && <span className="mt-1 block text-[12px] text-[#8a9ea0]">医嘱没写时间，小暖按一天3次排在非睡眠时段，可以改。</span>}
                </label>
              </div>
            </article>
          ))}

          {result && !saved && (result.warnings?.length > 0 || result.follow_up?.department || result.follow_up?.time_hint || result.unreadable?.length > 0) && (
            <div className="space-y-2 rounded-2xl border border-[#dce8e7] bg-white p-4 text-[14px] leading-5 text-[#547477]">
              {result.warnings?.map((warning, i) => <p key={`w${i}`}>注意事项：{warning}</p>)}
              {(result.follow_up?.department || result.follow_up?.time_hint) && <p>复诊：{[result.follow_up.department, result.follow_up.time_hint].filter(Boolean).join("，")}</p>}
              {result.follow_up?.bring?.length > 0 && <p>复诊带上：{result.follow_up.bring.join("、")}</p>}
              {result.unreadable?.length > 0 && <p className="text-[#ae684c]">未读清楚：{result.unreadable.join("、")}</p>}
            </div>
          )}

          {error && <p role="alert" className="rounded-xl bg-[#fff0eb] px-3.5 py-3 text-[14px] leading-5 text-[#ae5d48]">{error}</p>}
        </div>

        {(file || saved) && (
          <footer className="border-t border-[#dce8e7] bg-white/80 px-5 py-3" style={{ paddingBottom: "max(14px, env(safe-area-inset-bottom))" }}>
            <button type="button" onClick={() => { resetAll(); onRetake?.(); }} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-[#dce8e7] bg-white text-[14px] text-[#547477]">
              <RotateCcw size={16} />换一张照片
            </button>
          </footer>
        )}
      </section>
    </div>
  );
}
