import { useEffect, useState } from "react";
import { X, LogOut, Pencil, Check, Plus, Trash2, AlertTriangle, LoaderCircle, Bell, BellOff } from "lucide-react";
import { fetchMemory, saveMemory, clearMemory, deleteMemoryItem, logout, getUser } from "../lib/auth.js";
import { enableMedicationReminders, disableMedicationReminders, remindersEnabled, normalizeReminderTimes, syncMedicationReminders } from "../lib/reminders.js";
import SmartDispenserPanel from "./SmartDispenserPanel.jsx";

/* 小暖保存的记忆：档案 / 用药记录 / 生成的卡片（只存 AI 整理的结构化信息，不存对话原文） */
export function CardView({ card }) {
  if (!card || typeof card !== "object") return null;
  if (card.type === "pre") {
    const summary = card.visit_summary || {};
    const rows = [
      ["主要不适", summary.symptoms], ["持续时间", summary.duration],
      ["既往情况", summary.history], ["当前用药", summary.current_meds],
      ["想问医生", summary.questions], ["就诊时可补充", summary.missing],
    ];
    return (
      <div className="space-y-1">
        <p className="font-medium text-[#287f80]">就诊前信息整理（请核对后再使用）</p>
        {rows.map(([label, value]) => {
          const text = Array.isArray(value) ? value.filter(Boolean).join("；") : String(value || "");
          return text ? <p key={label}><span className="text-[#769092]">{label}：</span>{text}</p> : null;
        })}
        <p className="pt-1 text-[12px] text-[#769092]">仅整理对话中提到的信息，不是诊断结论。</p>
      </div>
    );
  }
  if (card.type === "post") {
    return (
      <div className="space-y-1">
        {card.source === "photo" && <p className="font-medium text-[#287f80]">{card.document_type || "医嘱"}照片整理（已由您核对）</p>}
        {Array.isArray(card.new_items) && card.new_items.length > 0 && (
          <p className="font-medium text-[#287f80]">刚记下的用药提醒</p>
        )}
        {Array.isArray(card.new_items) &&
          card.new_items.map((m, i) => <MedRow key={"n" + i} m={m} />)}
        {(Array.isArray(card.new_items) ? card.new_items.length : 0) > 0 && (
          <div className="mt-2 border-t border-dashed border-[#dce8e7] pt-2">
            <p className="font-medium text-[#769092] text-[13px]">全部用药</p>
          </div>
        )}
        {Array.isArray(card.medications) && card.medications.map((m, i) => <MedRow key={"a" + i} m={m} />)}
        {Array.isArray(card.warnings) && card.warnings.length > 0 && (
          <>
            <p className="mt-2 font-medium text-[#287f80]">注意事项</p>
            {card.warnings.map((w, i) => <p key={"w" + i}>· {w}</p>)}
          </>
        )}
        {Array.isArray(card.unreadable) && card.unreadable.length > 0 && (
          <p className="mt-2 text-[#ae684c]">原件待确认：{card.unreadable.join("、")}</p>
        )}
        {card.follow_up && card.follow_up.department && (
          <p className="mt-2">
            复诊：{card.follow_up.department}
            {card.follow_up.time_hint ? `，${card.follow_up.time_hint}` : ""}
            {card.follow_up.bring && card.follow_up.bring.length > 0
              ? `，带上${card.follow_up.bring.join("、")}`
              : ""}
          </p>
        )}
      </div>
    );
  }
  return (
    <pre className="whitespace-pre-wrap break-all text-[13px] text-[#688184]">
      {JSON.stringify(card, null, 2)}
    </pre>
  );
}

function MedRow({ m }) {
  if (!m || !m.name) return null;
  const parts = [m.name, m.dosage, m.frequency];
  return (
    <p>
      · <b className="text-[#19383f]">{m.name}</b>
      {m.dosage && ` ${m.dosage}`}
      {m.frequency && ` · ${m.frequency}`}
      {m.timing && <span className="text-[#769092]">（{m.timing}）</span>}
      {m.notes && <span className="text-[#769092]"> {m.notes}</span>}
      {Array.isArray(m.reminder_times) && m.reminder_times.length > 0 && (
        <span className="ml-1 text-[13px] text-[#287f80]">每天 {m.reminder_times.join("、")} 提醒</span>
      )}
    </p>
  );
}

function Section({ title, empty, children }) {
  const isEmpty = !children || (Array.isArray(children) && children.length === 0);
  return (
    <section className="rounded-2xl border border-[#dce8e7] bg-white/80 p-4">
      <h3 className="mb-2 text-[14px] font-medium text-[#769092]">{title}</h3>
      {isEmpty ? (
        <p className="text-[14px] text-[#94a9aa]">{empty}</p>
      ) : (
        <div className="space-y-1.5 text-[15px] leading-relaxed text-[#19383f]">{children}</div>
      )}
    </section>
  );
}

function KV({ k, v }) {
  const text = Array.isArray(v) ? v.join("；") : String(v);
  if (!text.trim()) return null;
  return (
    <p>
      <span className="text-[#769092]">{k}：</span>
      {text}
    </p>
  );
}

function reminderTimesFromInput(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(/[，,、\s]+/).filter(Boolean);
  if (values.some((time) => !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(time).trim()))) {
    throw new Error("提醒时间请按24小时制填写，例如 08:00、20:00。");
  }
  return normalizeReminderTimes(values);
}

function DeletableRow({ children, label, busy, onDelete, className = "" }) {
  return (
    <div className={`group flex items-start gap-2 ${className}`}>
      <div className="min-w-0 flex-1">{children}</div>
      <button
        type="button"
        aria-label={busy ? `正在清除${label}` : `清除${label}`}
        title={busy ? "删除中…" : `清除${label}`}
        disabled={busy}
        onClick={onDelete}
        className="mt-0.5 flex min-h-7 min-w-7 shrink-0 items-center justify-center gap-1 rounded-full text-[#94a9aa] transition hover:bg-[#fff0eb] hover:text-[#ae5d48] disabled:cursor-wait disabled:bg-[#fff0eb] disabled:px-2 disabled:text-[#ae5d48]"
      >
        {busy ? <><LoaderCircle size={15} className="animate-spin" /><span className="text-[12px]">删除中…</span></> : <Trash2 size={15} strokeWidth={1.8} />}
      </button>
    </div>
  );
}

function KVEditor({ data, onChange }) {
  const entries = Object.entries(data || {});
  const setRow = (i, patch) => {
    const next = entries.map(([k, v], idx) => (idx === i ? [patch.k ?? k, patch.v ?? v] : [k, v]));
    onChange(Object.fromEntries(next.filter(([k]) => k.trim())));
  };
  return (
    <div className="space-y-2">
      {entries.map(([k, v], i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={k}
            onChange={(e) => setRow(i, { k: e.target.value })}
            placeholder="项目"
            className="w-24 shrink-0 rounded-lg border border-[#dce8e7] bg-white px-2 py-1.5 text-[14px]"
          />
          <input
            value={Array.isArray(v) ? v.join("；") : String(v)}
            onChange={(e) => setRow(i, { v: e.target.value })}
            placeholder="内容"
            className="flex-1 rounded-lg border border-[#dce8e7] bg-white px-2 py-1.5 text-[14px]"
          />
          <button
            type="button"
            aria-label="删除"
            onClick={() => {
              const next = entries.filter((_, idx) => idx !== i);
              onChange(Object.fromEntries(next));
            }}
            className="shrink-0 rounded-lg p-1.5 text-[#94a9aa]"
          >
            <Trash2 size={16} strokeWidth={1.8} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange({ ...(data || {}), "": "" })}
        className="flex items-center gap-1 rounded-lg px-2 py-1 text-[14px] text-[#287f80]"
      >
        <Plus size={15} strokeWidth={1.8} />
        添加一项
      </button>
    </div>
  );
}

/* 用药提醒编辑器：每行药名/剂量/频次/时机；面板窄时横向滚动兜底 */
function MedsEditor({ list, onChange }) {
  const meds = Array.isArray(list) ? [...list] : [];
  function setMed(i, patch) {
    const next = meds.map((m, idx) => (idx === i ? { ...(m || {}), ...patch } : m));
    onChange(next);
  }
  function remove(i) {
    onChange(meds.filter((_, idx) => idx !== i));
  }
  function add() {
    onChange([...meds, { name: "", dosage: "", frequency: "", timing: "", notes: "", reminder_times: [] }]);
  }
  const fieldCls = "rounded-md border border-[#dce8e7] bg-white px-2 py-1.5 text-[13px] min-w-0 w-full";
  const rowCls = "flex gap-1.5 items-center min-w-[600px]";
  const headerCls = "flex gap-1.5 text-[12px] text-[#769092] min-w-[600px]";
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto -mx-1 px-1 pb-1">
        <div className="space-y-2">
          {/* 表头 */}
          <div className={headerCls}>
            <div className="flex-[2] min-w-0">药名</div>
            <div className="w-14 shrink-0">剂量</div>
            <div className="w-16 shrink-0">频次</div>
            <div className="w-14 shrink-0">时机</div>
            <div className="flex-[1.2] min-w-0">备注</div>
            <div className="w-32 shrink-0">提醒钟点</div>
            <div className="w-7 shrink-0"></div>
          </div>
          {meds.map((m, i) => (
            <div key={i} className={rowCls}>
              <input value={m.name || ""} onChange={(e) => setMed(i, { name: e.target.value })} placeholder="如 二甲双胍" className={`${fieldCls} flex-[2]`} />
              <input value={m.dosage || ""} onChange={(e) => setMed(i, { dosage: e.target.value })} placeholder="1片" className={`${fieldCls} w-14 shrink-0`} />
              <input value={m.frequency || ""} onChange={(e) => setMed(i, { frequency: e.target.value })} placeholder="每天2次" className={`${fieldCls} w-16 shrink-0`} />
              <input value={m.timing || ""} onChange={(e) => setMed(i, { timing: e.target.value })} placeholder="饭后" className={`${fieldCls} w-14 shrink-0`} />
              <input value={m.notes || ""} onChange={(e) => setMed(i, { notes: e.target.value })} placeholder="" className={`${fieldCls} flex-[1.2]`} />
              <input value={m.reminderTimesText ?? normalizeReminderTimes(m.reminder_times).join(", ")} onChange={(e) => setMed(i, { reminderTimesText: e.target.value })} placeholder="08:00, 20:00" aria-label={`${m.name || "药品"}的提醒钟点`} className={`${fieldCls} w-32 shrink-0`} />
              <button type="button" onClick={() => remove(i)} aria-label="删除" className="w-7 shrink-0 rounded-md p-1 text-[#94a9aa] hover:text-[#d37b62]">
                <Trash2 size={15} strokeWidth={1.8} />
              </button>
            </div>
          ))}
        </div>
      </div>
      <p className="text-[12px] leading-relaxed text-[#769092]">按医生交代填写具体钟点（24小时制），多个时间用逗号分开；“早上”“饭后”不会自动猜时间。</p>
      <button type="button" onClick={add} className="flex items-center gap-1 rounded-lg px-2 py-1 text-[14px] text-[#287f80]">
        <Plus size={15} strokeWidth={1.8} />
        添加一条用药提醒
      </button>
    </div>
  );
}

export default function MemoryPanel({ onClose, focusDispenser = false }) {
  const [mem, setMem] = useState(null);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [deletingItems, setDeletingItems] = useState(() => new Set());
  const [reminderEnabled, setReminderEnabled] = useState(() => remindersEnabled());
  const [reminderStatus, setReminderStatus] = useState("");
  const [draftProfile, setDraftProfile] = useState({});
  const [draftMeds, setDraftMeds] = useState([]);
  const username = getUser();

  useEffect(() => {
    let alive = true;
    fetchMemory()
      .then((m) => alive && setMem(m))
      .catch((e) => alive && setErr(e.message || "读取失败"));
    return () => { alive = false; };
  }, []);

  function startEdit() {
    setDraftProfile({ ...(mem?.profile || {}) });
    setDraftMeds([...(mem?.medications || [])]);
    setEditing(true);
  }

  async function doSave() {
    setSaving(true);
    setErr("");
    try {
      const medications = draftMeds.map(({ reminderTimesText, ...med }) => ({
        ...med,
        reminder_times: reminderTimesFromInput(reminderTimesText ?? med.reminder_times),
      }));
      await saveMemory({ profile: draftProfile, medications });
      const m = await fetchMemory();
      setMem(m);
      syncMedicationReminders(m.medications);
      setEditing(false);
    } catch (e) {
      setErr(e.message || "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function doLogout() {
    disableMedicationReminders();
    setReminderEnabled(false);
    await logout();
    onClose();
  }

  async function doClear() {
    setConfirmClear(false);
    setClearing(true);
    setErr("");
    try {
      await clearMemory();
      disableMedicationReminders();
      setReminderEnabled(false);
      setReminderStatus("");
      const m = await fetchMemory();
      setMem(m);
      setDraftProfile({});
      setDraftMeds([]);
      setEditing(false);
    } catch (e) {
      setErr(e.message || "清空失败");
    } finally {
      setClearing(false);
    }
  }

  async function removeItem(id, payload) {
    if (deletingItems.has(id)) return;
    setDeletingItems((items) => new Set(items).add(id));
    setErr("");
    try {
      await deleteMemoryItem(payload);
      const fresh = await fetchMemory();
      setMem(fresh);
      if (payload.category === "medications") syncMedicationReminders(fresh.medications);
    } catch (e) {
      setErr(e.message || "删除失败，请重试");
    } finally {
      setDeletingItems((items) => {
        const next = new Set(items);
        next.delete(id);
        return next;
      });
    }
  }

  async function toggleMedicationReminders() {
    if (reminderEnabled) {
      setReminderStatus(disableMedicationReminders());
      setReminderEnabled(false);
      return;
    }
    try {
      const status = await enableMedicationReminders(mem?.medications || []);
      setReminderStatus(status);
      setReminderEnabled(true);
    } catch (e) {
      setReminderStatus(e.message || "开启提醒失败");
    }
  }

  return (
    <div className="absolute inset-0 z-30 flex justify-end bg-[#19383f]/25" onClick={onClose}>
      <div className="flex h-full w-full max-w-[420px] flex-col bg-[#f9fbfb] shadow-[-8px_0_32px_rgba(74,64,56,0.18)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#dce8e7] px-5" style={{ paddingTop: "max(16px, env(safe-area-inset-top))", paddingBottom: 16 }}>
          <div>
            <h2 className="text-[18px] font-medium text-[#19383f]">小暖的记忆</h2>
            {username && <p className="text-[13px] text-[#769092]">{username} 的记忆文件</p>}
          </div>
          <div className="flex items-center gap-2">
            {mem && !editing && (
              <button type="button" onClick={startEdit} className="flex items-center gap-1 rounded-full bg-white px-3.5 py-2 text-[14px] text-[#287f80] shadow-[0_4px_14px_rgba(120,100,70,0.12)]">
                <Pencil size={15} strokeWidth={1.8} /> 编辑
              </button>
            )}
            {editing && (
              <button type="button" onClick={doSave} disabled={saving} className="flex items-center gap-1 rounded-full bg-[#287f80] px-3.5 py-2 text-[14px] text-white disabled:opacity-50">
                <Check size={15} strokeWidth={1.8} /> {saving ? "保存中…" : "保存"}
              </button>
            )}
            <button type="button" aria-label="关闭" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#688184] shadow-[0_4px_14px_rgba(120,100,70,0.12)]">
              <X size={20} strokeWidth={1.8} />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-3.5 overflow-y-auto px-5 py-4">
          {err && <p className="text-center text-[14px] text-[#bd6854]">{err}</p>}
          {!mem && !err && <p className="text-center text-[14px] text-[#769092]">正在翻记忆…</p>}

          {mem && !editing && (
            <>
              <p className="rounded-xl bg-[#edf6f4] px-3.5 py-3 text-[13px] leading-relaxed text-[#557176]">
                小暖会从聊天中自动记下您明确提到的个人情况和用药。您可以随时编辑或删除。
              </p>
              <section className="rounded-2xl border border-[#dce8e7] bg-white/80 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-[14px] font-medium text-[#19383f]">按时用药提醒</h3>
                    <p className="mt-1 text-[12px] leading-relaxed text-[#769092]">
                      {window.XiaonuanNative ? "Android App 可在锁屏后提醒；请允许通知和闹钟权限。" : "网页需保持打开；锁屏提醒请使用 Android App。"}
                    </p>
                  </div>
                  <button type="button" onClick={toggleMedicationReminders}
                    className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-[13px] font-medium ${reminderEnabled ? "bg-[#fff0eb] text-[#ae5d48]" : "bg-[#287f80] text-white"}`}>
                    {reminderEnabled ? <BellOff size={15} /> : <Bell size={15} />}
                    {reminderEnabled ? "关闭提醒" : "开启提醒"}
                  </button>
                </div>
                {reminderStatus && <p className="mt-2 text-[12px] text-[#287f80]">{reminderStatus}</p>}
                {!(mem.medications || []).some((m) => normalizeReminderTimes(m.reminder_times).length) && (
                  <p className="mt-2 text-[12px] text-[#a07142]">先点“编辑”，为用药记录填写准确钟点，例如 08:00、20:00。</p>
                )}
              </section>
              <SmartDispenserPanel medications={mem.medications || []} autoExpand={focusDispenser} />
              <Section title="用药记录" empty="还没保存过用药记录，告诉小暖就能记下来">
                {(mem.medications || []).map((m, i) => (
                  <DeletableRow key={i} label={`用药记录：${m.name || "未命名"}`} busy={deletingItems.has(`medications-${i}`)} onDelete={() => removeItem(`medications-${i}`, { category: "medications", index: i, expected: m })}>
                    <MedRow m={m} />
                  </DeletableRow>
                ))}
              </Section>
              <Section title="小暖记得的你（健康档案）" empty="还没有档案">
                {Object.entries(mem.profile || {}).map(([k, v]) => (
                  <DeletableRow key={k} label={`档案：${k}`} busy={deletingItems.has(`profile-${k}`)} onDelete={() => removeItem(`profile-${k}`, { category: "profile", key: k })}>
                    <KV k={k} v={v} />
                  </DeletableRow>
                ))}
              </Section>
              <Section title="保存的卡片" empty="还没有生成过卡片">
                {(mem.cards || []).slice().reverse().map((item, i) => (
                  <DeletableRow key={item.ts || i} className="rounded-xl bg-[#f2f7f6] p-3 text-[14px]" label="保存的卡片" busy={deletingItems.has(`cards-${i}`)} onDelete={() => removeItem(`cards-${i}`, { category: "cards", index: (mem.cards || []).length - 1 - i, expected: item })}>
                    <CardView card={item.card} />
                  </DeletableRow>
                ))}
              </Section>
            </>
          )}

          {mem && editing && (
            <>
              <section className="rounded-2xl border border-[#dce8e7] bg-white/80 p-4">
                <h3 className="mb-2 text-[14px] font-medium text-[#769092]">用药记录（编辑）</h3>
                <MedsEditor list={draftMeds} onChange={setDraftMeds} />
              </section>
              <section className="rounded-2xl border border-[#dce8e7] bg-white/80 p-4">
                <h3 className="mb-2 text-[14px] font-medium text-[#769092]">健康档案（编辑）</h3>
                <KVEditor data={draftProfile} onChange={setDraftProfile} />
              </section>
              <p className="text-[13px] leading-relaxed text-[#769092]">保存后小暖会在后续对话中参考这些记录。填写准确钟点后，可在记忆页开启提醒。</p>
            </>
          )}
        </div>

        <div className="border-t border-[#dce8e7] px-5 py-3">
          <button
            type="button"
            disabled={clearing}
            onClick={() => setConfirmClear(true)}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-[#e8a48d] bg-[#fff0eb] py-3 text-[14px] text-[#ae5d48] disabled:opacity-60"
          >
            <AlertTriangle size={16} strokeWidth={1.8} />
            {clearing ? "清空中…" : "一键清空所有记忆"}
          </button>
        </div>
        <div className="border-t border-[#dce8e7] px-5" style={{ paddingTop: 12, paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>
          <button type="button" onClick={doLogout} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-[#dce8e7] bg-white py-3.5 text-[15px] text-[#688184]">
            <LogOut size={17} strokeWidth={1.8} /> 退出登录（换一个人用）
          </button>
        </div>
      </div>
      {/* 清空确认弹窗：叠加在面板上方 */}
      {confirmClear && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#19383f]/50" onClick={() => setConfirmClear(false)}>
          <div className="mx-6 w-full max-w-[340px] rounded-2xl bg-[#f9fbfb] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center gap-2 text-[#ae5d48]">
              <AlertTriangle size={20} strokeWidth={1.8} />
              <span className="text-[16px] font-medium">确认清空所有记忆？</span>
            </div>
            <p className="mb-5 text-[14px] leading-relaxed text-[#557176]">
              会把你的档案、用药记录和保存的卡片全部删除。登录账号本身保留，可以重新开始记录。
            </p>
            <div className="flex gap-3">
              <button type="button" onClick={() => setConfirmClear(false)} className="flex-1 rounded-xl border border-[#dce8e7] py-2.5 text-[14px] text-[#557176]">
                取消
              </button>
              <button type="button" onClick={doClear} disabled={clearing} className="flex-1 rounded-xl bg-[#ae5d48] py-2.5 text-[14px] text-white disabled:opacity-60">
                {clearing ? "清空中…" : "确认清空"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
