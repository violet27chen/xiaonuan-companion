import { useState } from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import Companion from "./Companion.jsx";
import BrandMark from "./BrandMark.jsx";
import { login, register, setAuth } from "../lib/auth.js";

/* Login gate for the private health notes and voice companion. */
export default function AuthPanel({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr("");
    const u = username.trim();
    if (!u || !password) return setErr("用户名和密码都要填");
    if (mode === "register" && password.length < 8) return setErr("密码至少需要8位");
    if (mode === "register" && password !== password2) return setErr("两次密码不一样，再核对一下");
    setBusy(true);
    try {
      const j = mode === "register" ? await register(u, password) : await login(u, password);
      setAuth(j.token, j.username, j.cid);
      onAuth();
    } catch (e2) {
      setErr(e2.message || "出了点问题，再试一次");
    } finally {
      setBusy(false);
    }
  }

  const inputClass = "w-full rounded-2xl border border-[#dce8e7] bg-[#f9fbfb] px-4 py-3.5 text-[16px] text-[#19383f] placeholder-[#94a9aa] outline-none transition focus:border-[#318a89] focus:bg-white focus:ring-4 focus:ring-[#318a89]/10";

  return (
    <main className="relative min-h-dvh overflow-x-hidden overflow-y-auto bg-[#f2f7f6] text-[#19383f]">
      <div className="pointer-events-none absolute -left-28 -top-32 h-80 w-80 rounded-full bg-[#d9eeea] blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-24 h-96 w-96 rounded-full bg-[#fae8da] blur-3xl" />
      <div className="relative mx-auto grid min-h-dvh max-w-6xl items-center gap-6 px-5 py-8 md:grid-cols-[1.1fr_.9fr] md:gap-12 md:px-10">
        <section className="hidden flex-col items-center text-center md:flex">
          <div className="mb-2 rounded-full border border-white/80 bg-white/70 px-4 py-2 text-[13px] font-medium tracking-wide text-[#548080] shadow-sm">
            VOICE FIRST · CARE WITH WARMTH
          </div>
          <Companion audioLevel={0} talking={false} listening={false} style={{ width: "min(34vw, 360px)" }} />
          <h1 className="mt-1 text-[34px] font-semibold tracking-tight">就医这件事，慢慢说</h1>
          <p className="mt-3 max-w-sm text-[16px] leading-7 text-[#688184]">
            小暖帮您整理就诊前的信息，也把看诊后的安排记清楚。
          </p>
          <div className="mt-8 flex items-center gap-2 rounded-2xl border border-white/80 bg-white/65 px-4 py-3 text-[13px] text-[#72898a]">
            <ShieldCheck size={16} className="text-[#318a89]" /> 个人记录按账号保存，您可以随时编辑或清空
          </div>
        </section>

        <section className="mx-auto w-full max-w-[440px] rounded-[30px] border border-white/80 bg-white/90 p-6 shadow-[0_24px_80px_rgba(39,83,84,0.12)] backdrop-blur md:p-9">
          <div className="mb-7 flex items-center gap-3">
            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-[#edf6f4]">
              <BrandMark className="h-12 w-12" />
            </div>
            <div>
              <div className="text-[20px] font-semibold tracking-tight">小暖</div>
              <div className="mt-0.5 text-[13px] text-[#72898a]">语音就医信息助手</div>
            </div>
          </div>
          <div className="mb-6">
            <p className="text-[13px] font-medium text-[#769092]">欢迎使用小暖</p>
            <h2 className="mt-1 text-[27px] font-semibold tracking-tight">{mode === "login" ? "欢迎回来" : "创建一个账号"}</h2>
          </div>
          <div className="mb-5 flex rounded-2xl bg-[#f0f5f4] p-1">
            {[ ["login", "登录"], ["register", "注册"] ].map(([value, label]) => (
              <button key={value} type="button" onClick={() => { setMode(value); setErr(""); }}
                className={`flex-1 rounded-xl py-2.5 text-[14px] font-medium transition ${mode === value ? "bg-white text-[#236f72] shadow-sm" : "text-[#789092]"}`}>
                {label}
              </button>
            ))}
          </div>
          <form onSubmit={submit} className="space-y-3.5">
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-[#577477]">用户名</span>
              <input className={inputClass} placeholder="字母、数字或汉字" value={username}
                onChange={(e) => setUsername(e.target.value)} autoComplete="username" maxLength={20} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-[#577477]">密码</span>
              <input className={inputClass} type="password" placeholder={mode === "register" ? "至少8位" : "请输入密码"}
                value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "login" ? "current-password" : "new-password"} maxLength={64}
                minLength={mode === "register" ? 8 : undefined} />
            </label>
            {mode === "register" && (
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium text-[#577477]">确认密码</span>
                <input className={inputClass} type="password" placeholder="再输入一次密码" value={password2}
                  onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" maxLength={64} />
              </label>
            )}
            {err && <p role="alert" className="rounded-xl bg-[#fff0eb] px-3.5 py-2.5 text-[13px] text-[#ae5d48]">{err}</p>}
            <button type="submit" disabled={busy}
              className="group flex w-full items-center justify-center gap-2 rounded-2xl bg-[#267f80] py-3.5 text-[15px] font-semibold text-white shadow-[0_8px_20px_rgba(38,127,128,.22)] transition hover:bg-[#216f72] active:scale-[.99] disabled:opacity-60">
              {busy ? "请稍候…" : mode === "login" ? "登录并继续" : "创建账号"}
              {!busy && <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" />}
            </button>
          </form>
          <p className="mt-5 text-center text-[12px] leading-5 text-[#8aa0a0]">
            健康记录仅供您整理和核对，不替代医生意见。
          </p>
        </section>
      </div>
    </main>
  );
}
