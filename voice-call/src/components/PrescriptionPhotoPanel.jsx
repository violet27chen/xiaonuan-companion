import { useEffect, useState } from "react";
import { Camera, Check, LoaderCircle, RotateCcw, Upload, X } from "lucide-react";
import { fetchMemory, saveMemory } from "../lib/auth.js";
import { compressPrescriptionPhoto, recognizePrescription } from "../lib/medicationPhoto.js";

function timeText(value) {
  return Array.isArray(value) ? value.join(", ") : String(value || "");
}

function timesFromText(value) {
  return [...new Set(String(value || "").split(/[，,、\s]+/).map((v) => v.trim()).filter((v) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v)))].slice(0, 4);
}

export default function PrescriptionPhotoPanel({ onClose, onSaved, autoOpened = false }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [allowSend, setAllowSend] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [items, setItems] = useState([]);
  const [confirmOther, setConfirmOther] = useState(false);

  useEffect(() => {
    if (!file) { setPreview(""); return undefined; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function chooseFile(next) {
    setError("");
    setResult(null);
    setItems([]);
    setConfirmOther(false);
    setAllowSend(false);
    setFile(next || null);
  }

  async function recognize() {
    if (!file || !allowSend || busy) return;
    setBusy(true);
    setError("");
    try {
      const image = await compressPrescriptionPhoto(file);
      const parsed = await recognizePrescription(image);
      setResult(parsed);
      setConfirmOther(false);
      setItems((parsed.medications || []).map((med) => ({
        ...med,
        reminderText: timeText(med.reminder_times),
        confirmed: false,
      })));
      if (!(parsed.medications || []).length) setError("没有读出药品项目；可以换一张更清楚的照片再试");
    } catch (e) {
      setError(e.message || "识别失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  function updateItem(index, patch) {
    setItems((current) => current.map((item, i) => i === index ? { ...item, ...patch } : item));
  }

  async function saveConfirmed() {
    const confirmed = items.filter((item) => item.confirmed && item.name.trim());
    const hasOther = (result?.warnings?.length || 0) > 0
      || !!result?.follow_up?.department || !!result?.follow_up?.time_hint
      || (result?.follow_up?.bring?.length || 0) > 0;
    if ((!confirmed.length && !(confirmOther && hasOther)) || busy) return;
    setBusy(true);
    setError("");
    try {
      const current = await fetchMemory();
      const merged = new Map((current.medications || []).filter((med) => med?.name?.trim()).map((med) => [med.name.trim(), med]));
      const medications = confirmed.map(({ reminderText, confirmed: _confirmed, uncertain_fields, evidence, ...med }) => ({
        ...(merged.get(med.name.trim()) || {}),
        ...med,
        name: med.name.trim(),
        reminder_times: timesFromText(reminderText),
      }));
      for (const med of medications) merged.set(med.name, med);
      const includeOther = confirmOther;
      const photoCard = {
        type: "post",
        source: "photo",
        document_type: result.document_type,
        medications,
        warnings: includeOther ? (result.warnings || []) : [],
        follow_up: includeOther ? (result.follow_up || {}) : {},
        unreadable: includeOther ? (result.unreadable || []) : [],
      };
      await saveMemory({ medications: [...merged.values()], cards: [photoCard] });
      onSaved?.(photoCard);
    } catch (e) {
      setError(e.message || "保存失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  const confirmedCount = items.filter((item) => item.confirmed && item.name.trim()).length;
  const hasOther = !!result && ((result.warnings?.length || 0) > 0
    || !!result.follow_up?.department || !!result.follow_up?.time_hint
    || (result.follow_up?.bring?.length || 0) > 0);
  const canSave = confirmedCount > 0 || (confirmOther && hasOther);

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
          {!result && (
            <>
              <p className="rounded-2xl border border-[#f1dfc8] bg-[#fff8ef] p-3.5 text-[14px] leading-6 text-[#805f43]">
                拍清楚药盒、处方或医嘱上的文字，小暖会帮您整理看得清的信息。照片会发送给 MiMo 图片识别服务；建议先遮住姓名、身份证号、就诊卡号等个人信息，识别后请对照原件核对。药盒上的规格不代表每次服用剂量，小暖不会据此判断怎么吃药，也不会保存原照片。
              </p>
              {autoOpened && <p className="rounded-xl bg-[#edf6f4] px-3.5 py-3 text-[14px] leading-5 text-[#287f80]">您刚才提到了药品，我已经帮您打开拍照入口。点下面的按钮，对准药盒或医嘱拍一张；也可以从相册选照片。</p>}
              {preview ? (
                <div className="relative overflow-hidden rounded-2xl border border-[#dce8e7] bg-white">
                  <img src={preview} alt="待识别的医嘱照片" className="max-h-[34vh] w-full object-contain" />
                  <button type="button" onClick={() => chooseFile(null)} className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-white/95 px-3 py-2 text-[13px] text-[#547477] shadow" aria-label="重新选择照片">
                    <RotateCcw size={15} />重选
                  </button>
                </div>
              ) : (
                <label className="flex min-h-44 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-[#b9d8d3] bg-white text-center text-[#287f80]">
                  <Camera size={32} strokeWidth={1.7} />
                  <span className="text-[16px] font-medium">{autoOpened ? "点这里打开相机或相册" : "拍照或从相册选择"}</span>
                  <span className="text-[13px] text-[#769092]">支持 JPG、PNG、WebP</span>
                  <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" onChange={(event) => chooseFile(event.target.files?.[0])} />
                </label>
              )}
              {file && (
                <label className="flex items-start gap-3 rounded-xl bg-white px-3.5 py-3 text-[14px] leading-5 text-[#547477]">
                  <input type="checkbox" checked={allowSend} onChange={(event) => setAllowSend(event.target.checked)} className="mt-0.5 h-5 w-5 accent-[#287f80]" />
                  <span>我知道这张照片会发送给 MiMo 识别；识别结果要与原医嘱核对后才保存。</span>
                </label>
              )}
              {file && (
                <button type="button" onClick={recognize} disabled={!allowSend || busy} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#287f80] text-[15px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">
                  {busy ? <><LoaderCircle size={18} className="animate-spin" />正在识别…</> : <><Upload size={18} />开始识别</>}
                </button>
              )}
            </>
          )}

          {result && (
            <>
              <p className="rounded-xl bg-[#edf6f4] px-3.5 py-3 text-[14px] leading-5 text-[#557176]">
                识别到 {result.document_type || "医嘱"}。剂量和频次都需要对照原件核实；模糊内容请手动修正，不确定就不要保存。
              </p>
              {items.map((item, index) => (
                <article key={`${item.name}-${index}`} className="space-y-3 rounded-2xl border border-[#dce8e7] bg-white p-4">
                  <div className="flex items-start gap-3">
                    <input type="checkbox" checked={item.confirmed} onChange={(event) => updateItem(index, { confirmed: event.target.checked })} className="mt-1 h-5 w-5 accent-[#287f80]" aria-label={`确认核对${item.name || "药品"}`} />
                    <label className="min-w-0 flex-1 text-[14px] font-medium text-[#287f80]">我已对照原件核对这项</label>
                  </div>
                  {item.uncertain_fields?.length > 0 && <p className="ml-8 text-[13px] text-[#ae684c]">图片不清楚：{item.uncertain_fields.join("、")}。请看原件修改。</p>}
                  {item.evidence && <p className="ml-8 rounded-lg bg-[#f4f7f6] px-3 py-2 text-[13px] leading-5 text-[#769092]">图片原文：{item.evidence}</p>}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {[["name", "药品名称"], ["dosage", "每次剂量"], ["frequency", "服用频次"], ["timing", "服用时机"]].map(([key, label]) => (
                      <label key={key} className="text-[13px] text-[#769092]">
                        {label}
                        <input value={item[key] || ""} onChange={(event) => updateItem(index, { [key]: event.target.value })} placeholder="请核对，未写明可留空" className="mt-1 h-11 w-full rounded-xl border border-[#dce8e7] bg-[#fbfdfd] px-3 text-[15px] text-[#19383f] outline-none focus:border-[#78b6ae]" />
                      </label>
                    ))}
                    <label className="text-[13px] text-[#769092] sm:col-span-2">
                      每日提醒钟点（可选）
                      <input value={item.reminderText} onChange={(event) => updateItem(index, { reminderText: event.target.value })} placeholder="仅填写医嘱明确写出的时刻，如 08:00" className="mt-1 h-11 w-full rounded-xl border border-[#dce8e7] bg-[#fbfdfd] px-3 text-[15px] text-[#19383f] outline-none focus:border-[#78b6ae]" />
                    </label>
                  </div>
                </article>
              ))}
              {(result.warnings?.length > 0 || result.follow_up?.department || result.follow_up?.time_hint || result.unreadable?.length > 0) && (
                <div className="space-y-2 rounded-2xl border border-[#dce8e7] bg-white p-4 text-[14px] leading-5 text-[#547477]">
                  {result.warnings?.map((warning, i) => <p key={`w${i}`}>注意事项：{warning}</p>)}
                  {(result.follow_up?.department || result.follow_up?.time_hint) && <p>复诊：{[result.follow_up.department, result.follow_up.time_hint].filter(Boolean).join("，")}</p>}
                  {result.follow_up?.bring?.length > 0 && <p>复诊带上：{result.follow_up.bring.join("、")}</p>}
                  {result.unreadable?.length > 0 && <p className="text-[#ae684c]">未读清楚：{result.unreadable.join("、")}</p>}
                  <p className="border-t border-dashed border-[#dce8e7] pt-2 text-[12px] text-[#8a9ea0]">以上文字仅作识别参考，复诊和注意事项请对照原件。</p>
                  <label className="flex items-start gap-2 border-t border-dashed border-[#dce8e7] pt-3 text-[13px] leading-5 text-[#547477]">
                    <input type="checkbox" checked={confirmOther} onChange={(event) => setConfirmOther(event.target.checked)} className="mt-0.5 h-5 w-5 accent-[#287f80]" />
                    我已核对以上注意事项和复诊信息，可以一并保存
                  </label>
                </div>
              )}
              <button type="button" onClick={() => { setResult(null); setItems([]); setAllowSend(false); setConfirmOther(false); }} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-[#dce8e7] bg-white text-[14px] text-[#547477]">
                <RotateCcw size={16} />换一张照片
              </button>
            </>
          )}
          {error && <p role="alert" className="rounded-xl bg-[#fff0eb] px-3.5 py-3 text-[14px] leading-5 text-[#ae5d48]">{error}</p>}
        </div>

        {result && (
          <footer className="border-t border-[#dce8e7] bg-white/80 px-5 py-3" style={{ paddingBottom: "max(14px, env(safe-area-inset-bottom))" }}>
            <button type="button" onClick={saveConfirmed} disabled={!canSave || busy} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#287f80] text-[15px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">
              {busy ? <><LoaderCircle size={18} className="animate-spin" />保存中…</> : <><Check size={18} />{confirmedCount > 0 ? `保存已核对的 ${confirmedCount} 项` : "保存已核对的医嘱信息"}</>}
            </button>
            <p className="mt-2 text-center text-[12px] leading-5 text-[#8a9ea0]">未勾选的药品不会保存，也不会设置提醒</p>
          </footer>
        )}
      </section>
    </div>
  );
}
