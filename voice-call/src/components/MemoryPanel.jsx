import { useEffect, useState } from "react";
import { X, LogOut } from "lucide-react";
import { fetchMemory, logout, getUser } from "../lib/auth.js";

/* 小暖保存的记忆：档案 / 问诊收集 / 生成的卡片 / 最近的对话 */
function CardView({ card }) {
  if (!card || typeof card !== "object") return null;
  if (card.type === "summary") {
    return (
      <div className="space-y-1">
        <p className="font-medium text-[#1b6c80]">病史摘要卡</p>
        {card.chief_complaint && <p>主诉：{card.chief_complaint}</p>}
        {Array.isArray(card.timeline) && card.timeline.length > 0 && (
          <p>时间线：{card.timeline.join("；")}</p>
        )}
        {Array.isArray(card.history) && card.history.length > 0 && (
          <p>既往病史：{card.history.join("；")}</p>
        )}
        {Array.isArray(card.medications) && card.medications.length > 0 && (
          <p>在服药物：{card.medications.join("；")}</p>
        )}
        {Array.isArray(card.allergies) && card.allergies.length > 0 && (
          <p>药物过敏：{card.allergies.join("；")}</p>
        )}
        {card.last_exam && <p>近期检查：{card.last_exam}</p>}
      </div>
    );
  }
  if (card.type === "post") {
    return (
      <div className="space-y-1">
        <p className="font-medium text-[#1b6c80]">诊后安排</p>
        {Array.isArray(card.medications) &&
          card.medications.map((m, i) => (
            <p key={i}>
              · {m.name}：{m.dosage}，{m.frequency}，{m.timing}
              {m.notes ? `（${m.notes}）` : ""}
            </p>
          ))}
        {Array.isArray(card.warnings) &&
          card.warnings.map((w, i) => <p key={"w" + i}>· 注意：{w}</p>)}
        {card.follow_up && card.follow_up.department && (
          <p>
            · 复诊：{card.follow_up.department}
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
    <pre className="whitespace-pre-wrap break-all text-[13px] text-[#8a7f72]">
      {JSON.stringify(card, null, 2)}
    </pre>
  );
}

function Section({ title, empty, children }) {
  const isEmpty = !children || (Array.isArray(children) && children.length === 0);
  return (
    <section className="rounded-2xl border border-[#e6ddc9] bg-white/80 p-4">
      <h3 className="mb-2 text-[14px] font-medium text-[#a79d8c]">{title}</h3>
      {isEmpty ? (
        <p className="text-[14px] text-[#b7ac9a]">{empty}</p>
      ) : (
        <div className="space-y-1.5 text-[15px] leading-relaxed text-[#4a4038]">{children}</div>
      )}
    </section>
  );
}

function KV({ k, v }) {
  const text = Array.isArray(v) ? v.join("；") : String(v);
  if (!text.trim()) return null;
  return (
    <p>
      <span className="text-[#a79d8c]">{k}：</span>
      {text}
    </p>
  );
}

export default function MemoryPanel({ onClose }) {
  const [mem, setMem] = useState(null);
  const [err, setErr] = useState("");
  const username = getUser();

  useEffect(() => {
    let alive = true;
    fetchMemory()
      .then((m) => alive && setMem(m))
      .catch((e) => alive && setErr(e.message || "读取失败"));
    return () => {
      alive = false;
    };
  }, []);

  async function doLogout() {
    await logout();
    onClose();
  }

  return (
    <div className="absolute inset-0 z-30 flex justify-end bg-[#4a4038]/25" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-[400px] flex-col bg-[#fdf9ef] shadow-[-8px_0_32px_rgba(74,64,56,0.18)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div
          className="flex items-center justify-between border-b border-[#e6ddc9] px-5"
          style={{ paddingTop: "max(16px, env(safe-area-inset-top))", paddingBottom: 16 }}
        >
          <div>
            <h2 className="text-[18px] font-medium text-[#4a4038]">小暖的记忆</h2>
            {username && <p className="text-[13px] text-[#a79d8c]">{username} 的记忆文件</p>}
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#8a7f72] shadow-[0_4px_14px_rgba(120,100,70,0.12)]"
          >
            <X size={20} strokeWidth={1.8} />
          </button>
        </div>

        {/* 内容 */}
        <div className="flex-1 space-y-3.5 overflow-y-auto px-5 py-4">
          {err && <p className="text-center text-[14px] text-[#c0392b]">{err}</p>}
          {!mem && !err && <p className="text-center text-[14px] text-[#a79d8c]">正在翻记忆…</p>}
          {mem && (
            <>
              <Section title="小暖记得的你（健康档案）" empty="还没有档案，聊天时会自动记录">
                {Object.entries(mem.profile || {}).map(([k, v]) => (
                  <KV key={k} k={k} v={v} />
                ))}
              </Section>
              <Section title="问诊收集" empty="还没有问诊记录">
                {Object.entries(mem.interview || {}).map(([k, v]) => (
                  <KV key={k} k={k} v={v} />
                ))}
              </Section>
              <Section title="保存的卡片" empty="还没有生成过卡片">
                {(mem.cards || [])
                  .slice()
                  .reverse()
                  .map((item, i) => (
                    <div key={i} className="rounded-xl bg-[#f6f1e7] p-3 text-[14px]">
                      <CardView card={item.card} />
                    </div>
                  ))}
              </Section>
              <Section title="最近的对话" empty="还没有聊过天">
                {(mem.recent || []).map((m, i) => (
                  <p key={i}>
                    <span className="mr-1.5 text-[13px] text-[#a79d8c]">{m.who}</span>
                    {m.text}
                  </p>
                ))}
              </Section>
            </>
          )}
        </div>

        {/* 底部：退出登录 */}
        <div
          className="border-t border-[#e6ddc9] px-5"
          style={{ paddingTop: 12, paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}
        >
          <button
            type="button"
            onClick={doLogout}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-[#e6ddc9] bg-white py-3.5 text-[15px] text-[#8a7f72]"
          >
            <LogOut size={17} strokeWidth={1.8} />
            退出登录（换一个人用）
          </button>
        </div>
      </div>
    </div>
  );
}
