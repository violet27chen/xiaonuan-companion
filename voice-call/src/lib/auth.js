/* 用户系统：注册 / 登录 / 令牌 / 记忆数据（后端 /companion，action 路由） */
const API = "/companion";
const TOKEN_KEY = "xn_token";
const USER_KEY = "xn_user";
const AUTH_LOST_EVENT = "xn-auth-lost";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function getUser() {
  return localStorage.getItem(USER_KEY) || "";
}

export function setAuth(token, username) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, username);
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

/** 令牌失效（过期/被顶掉）：清本地登录态并通知界面回到登录页 */
export function notifyAuthLost() {
  clearAuth();
  window.dispatchEvent(new Event(AUTH_LOST_EVENT));
}

async function call(action, payload = {}) {
  let r;
  try {
    r = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...payload }),
    });
  } catch {
    throw new Error("网络不稳定，再试一次");
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `服务开小差了(${r.status})`);
  return j;
}

export function login(username, password) {
  return call("login", { username, password });
}

export function register(username, password) {
  return call("register", { username, password });
}

export async function logout() {
  const token = getToken();
  clearAuth();
  try {
    await call("logout", { token });
  } catch {}
  window.dispatchEvent(new Event(AUTH_LOST_EVENT));
}

export function fetchMemory() {
  return call("memory", { token: getToken() });
}
