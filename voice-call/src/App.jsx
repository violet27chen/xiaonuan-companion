import { useEffect, useState } from "react";
import AuthPanel from "./components/AuthPanel.jsx";
import CallScreen from "./components/CallScreen.jsx";
import { getToken } from "./lib/auth.js";

/* 门禁：未登录（或令牌失效）时先登录，登录后才进入通话界面 */
export default function App() {
  const [authed, setAuthed] = useState(() => !!getToken());

  useEffect(() => {
    // 令牌过期/被顶掉/主动退出登录 → 回登录页
    const onAuthLost = () => setAuthed(false);
    window.addEventListener("xn-auth-lost", onAuthLost);
    return () => window.removeEventListener("xn-auth-lost", onAuthLost);
  }, []);

  if (!authed) return <AuthPanel onAuth={() => setAuthed(true)} />;
  return <CallScreen />;
}
