/* 用户系统：注册 / 登录 / 令牌 / 会话线 / 记忆数据（后端 /companion，action 路由） */
const API = "/companion";
const TOKEN_KEY = "xn_token";
const USER_KEY = "xn_user";
const CID_KEY = "xn_cid"; // 会话线：登录后为按用户分配的值，未登录为浏览器临时值
const AUTH_LOST_EVENT = "xn-auth-lost";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function getUser() {
  return localStorage.getItem(USER_KEY) || "";
}

export function setAuth(token, username, cid) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, username);
  if (cid) localStorage.setItem(CID_KEY, cid);
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(CID_KEY);
  localStorage.removeItem("xn_profile");
}

/** 会话线 id：平台要求 6-36 位 [0-9a-zA-Z-_.]；必须每次请求都带 */
export function getCid() {
  let c = localStorage.getItem(CID_KEY);
  if (!c) {
    c = "c-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(CID_KEY, c);
  }
  return c;
}

/** 令牌失效（过期/被顶掉）：清本地登录态并通知界面回到登录页 */
export function notifyAuthLost() {
  clearAuth();
  window.dispatchEvent(new Event(AUTH_LOST_EVENT));
}

/** 把平台/网络的生硬错误翻成老人能看懂的话 */
function friendlyError(msg, status) {
  const m = String(msg || "");
  if (/makers-conversation-id/i.test(m)) return "网络出了点小状况，再试一次";
  if (status >= 500) return "服务开小差了，稍等一下再试";
  return m || `服务开小差了(${status})`;
}

async function call(action, payload = {}, opts = {}) {
  const timeoutMs = opts.timeout ?? 55000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let r;
  try {
    r = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "makers-conversation-id": getCid() },
      body: JSON.stringify({ action, ...payload }),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e && e.name === "AbortError") throw new Error("服务响应有点慢，请稍等几秒再试");
    throw new Error("网络不稳定，再试一次");
  }
  clearTimeout(timer);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401) {
      notifyAuthLost();
      throw new Error("登录过期了，请重新登录");
    }
    if (r.status === 524) throw new Error("服务有点忙，请稍等几秒再试");
    throw new Error(friendlyError(j.error, r.status));
  }
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

/** 保存编辑后的记忆（档案 / 用药提醒）；后端只覆盖传了的字段 */
export function saveMemory(memory) {
  return call("memory_save", { token: getToken(), memory });
}

/** 一键清空当前用户所有记忆 */
export function clearMemory() {
  return call("memory_clear", { token: getToken() });
}

/** 独立删除一条记忆记录 */
export function deleteMemoryItem(item) {
  return call("memory_item_delete", { token: getToken(), ...item });
}
