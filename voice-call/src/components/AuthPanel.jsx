import { useState } from "react";
import { Stethoscope } from "lucide-react";
import Companion from "./Companion.jsx";
import { login, register, setAuth } from "../lib/auth.js";

/* 登录 / 注册门禁：各自账号登录，小暖的记忆和聊天互不串 */
export default function AuthPanel({ onAuth }) {
  const [mode, setMode] = useState("login"); // login | register
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr("");
    const u = username.trim();
    if (!u || !password) {
      setErr("用户名和密码都要填");
      return;
    }
    if (mode === "register" && password !== password2) {
      setErr("两次密码不一样，再核对一下");
      return;
    }
    setBusy(true);
    try {
      const j = mode === "register" ? await register(u, password) : await login(u, password);
      setAuth(j.token, j.username);
      onAuth();
    } catch (e2) {
      setErr(e2.message || "出了点问题，再试一次");
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "w-full rounded-2xl border border-[#e6ddc9] bg-white px-5 py-4 text-[17px] text-[#4a4038] placeholder-[#b7ac9a] outline-none focus:border-[#1b6c80]";

  return (
    <div className="relative h-dvh w-full touch-none overflow-hidden bg-[#f6f1e7] text-[#4a4038] select-none">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 75% 55% at 50% 26%, #fffdf6 0%, #f6f1e7 58%, #efe7d8 100%)",
        }}
      />
      <div className="relative flex h-full flex-col items-center justify-center overflow-y-auto px-8 py-10">
        {/* 小暖形象 + 标题 */}
        <div className="w-[38vmin] max-w-[220px] shrink-0">
          <Companion audioLevel={0} talking={false} listening={false} />
        </div>
        <h1 className="mt-2 text-[26px] font-medium text-[#4a4038]">陪诊小暖</h1>
        <p className="mt-1 mb-6 text-[14px] text-[#8a7f72]">
          登录后小暖就认得您，记忆不串门
        </p>

        <form onSubmit={submit} className="w-full max-w-[360px] space-y-3.5">
          <div className="flex items-center gap-2 rounded-full border border-[#e6ddc9] bg-white/85 px-4 py-2 text-[13px] text-[#8a7f72]">
            <Stethoscope size={15} strokeWidth={1.8} className="text-[#1b6c80]" />
            {mode === "login" ? "欢迎回来" : "第一次来，先注册"}
          </div>
          <input
            className={inputCls}
            placeholder="用户名（字母、数字或汉字）"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            maxLength={20}
          />
          <input
            className={inputCls}
            type="password"
            placeholder="密码（至少4位）"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            maxLength={64}
          />
          {mode === "register" && (
            <input
              className={inputCls}
              type="password"
              placeholder="再输一次密码"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              autoComplete="new-password"
              maxLength={64}
            />
          )}
          {err && <p className="text-center text-[14px] text-[#c0392b]">{err}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-2xl bg-[#1b6c80] py-4 text-[17px] font-medium text-white transition-transform duration-100 active:scale-[0.98] disabled:opacity-60"
          >
            {busy ? "请稍候…" : mode === "login" ? "登录" : "注册并开始"}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setErr("");
              setPassword2("");
            }}
            className="w-full py-2 text-center text-[15px] text-[#1b6c80]"
          >
            {mode === "login" ? "还没有账号？点这里注册" : "已经有账号了？点这里登录"}
          </button>
        </form>
      </div>
    </div>
  );
}
