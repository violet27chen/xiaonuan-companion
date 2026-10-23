# 用户系统：用户名 + 密码（PBKDF2 加盐哈希）、会话令牌、按用户隔离的记忆存储
# 纯标准库实现；持久化用 ctx.kv（EdgeOne 每路由 KV store，生产环境 blob 持久化）
import hashlib
import re
import secrets
import time

SESSION_TTL = 90 * 24 * 3600  # 会话 90 天
MAX_CARDS = 20                # 每用户最多留存的卡片数
_USER_RE = re.compile(r"^\w{2,20}$")  # 字母/数字/下划线/汉字，2-20 个


def _uid(username: str) -> str:
    """用户名 -> 稳定存储 key 片段（ASCII 安全，避免中文 key）"""
    return hashlib.sha1(username.encode("utf-8")).hexdigest()[:16]


def user_key(username: str) -> str:
    return f"xn:u:{_uid(username)}"


def sess_key(token: str) -> str:
    return f"xn:s:{token}"


def conv_id(username: str) -> str:
    """按用户的会话线 id：ASCII 安全，符合平台 header 规范（6-36 位 [0-9a-zA-Z-_.]）"""
    return f"u-{_uid(username)}"


def profile_key(username: str) -> str:
    return f"xn:p:{_uid(username)}"


def meds_key(username: str) -> str:
    return f"xn:m:{_uid(username)}"


def cards_key(username: str) -> str:
    return f"xn:c:{_uid(username)}"


def recent_key(username: str) -> str:
    return f"xn:r:{_uid(username)}"


def _hash_pw(password: str, salt: bytes) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 120000).hex()


def _kv(ctx):
    return getattr(ctx, "kv", None)


async def register(ctx, username: str, password: str):
    """注册并直接登录。返回 (token, error)"""
    kv = _kv(ctx)
    if kv is None:
        return None, "服务存储不可用，稍后再试"
    username = (username or "").strip()
    if not _USER_RE.match(username):
        return None, "用户名要2-20个字母、数字或汉字"
    if not password or len(password) < 8:
        return None, "密码至少8位"
    if await kv.get(user_key(username)):
        return None, "这个用户名已经有人用了，换一个吧"
    salt = secrets.token_bytes(16)
    await kv.set(
        user_key(username),
        {
            "username": username,
            "salt": salt.hex(),
            "hash": _hash_pw(password, salt),
            "created_at": int(time.time()),
        },
    )
    return await new_session(ctx, username), None


async def login(ctx, username: str, password: str):
    """登录。返回 (token, error)"""
    kv = _kv(ctx)
    if kv is None:
        return None, "服务存储不可用，稍后再试"
    username = (username or "").strip()
    rec = await kv.get(user_key(username))
    if not isinstance(rec, dict) or not rec.get("hash"):
        return None, "用户名或密码不对"
    try:
        salt = bytes.fromhex(rec.get("salt") or "")
        ok = secrets.compare_digest(rec["hash"], _hash_pw(password or "", salt))
    except Exception:
        ok = False
    if not ok:
        return None, "用户名或密码不对"
    return await new_session(ctx, username), None


async def new_session(ctx, username: str) -> str:
    token = secrets.token_urlsafe(24)
    await _kv(ctx).set(sess_key(token), {"u": username, "at": int(time.time())}, ttl=SESSION_TTL)
    return token


async def username_of(ctx, token: str):
    """令牌 -> 用户名；无效/过期返回 None"""
    kv = _kv(ctx)
    if kv is None or not token:
        return None
    try:
        data = await kv.get(sess_key(token))
    except Exception:
        return None
    if isinstance(data, dict) and data.get("u"):
        return data["u"]
    return None


async def logout(ctx, token: str):
    kv = _kv(ctx)
    if kv is None or not token:
        return
    try:
        await kv.delete(sess_key(token))
    except Exception:
        pass


async def save_memory(ctx, username: str, *, profile=None, profile_updates=None, medications=None, cards=None, replace_medications=False):
    """把一轮对话里 AI 整理出的结构化信息按用户落下（KV 持久化，失败不影响对话）。

    只存档案/用药/卡片这类整理结果，不存对话原文——老人自己知道说过什么，
    记忆面板的用途是回看小暖整理出来的信息。
    """
    kv = _kv(ctx)
    if kv is None:
        return
    try:
        if profile is not None:
            await kv.set(profile_key(username), profile)
        if profile_updates:
            old_profile = await kv.get(profile_key(username)) or {}
            if not isinstance(old_profile, dict):
                old_profile = {}
            old_profile.update(profile_updates)
            await kv.set(profile_key(username), old_profile)
        if medications is not None:
            # 防御：参数不是 list（比如 dict 或其他脏数据）→ 重置
            if not isinstance(medications, list):
                medications = []
            old = [] if replace_medications else (await kv.get(meds_key(username)) or [])
            if not isinstance(old, list):
                old = []
            merged = []
            for m in medications:
                if not isinstance(m, dict) or not m.get("name"):
                    continue
                merged.append(m)
            # 合并旧：保留旧列表中未被覆盖的药
            old_names = {m.get("name") for m in merged if isinstance(m, dict)}
            for om in old:
                if isinstance(om, dict) and om.get("name") and om["name"] not in old_names:
                    merged.append(om)
            # 最终按药名去重（双重保险，防止 LangGraph checkpoint 带重复）
            seen = set()
            deduped = []
            for m in merged:
                key = (m.get("name") or "").strip()
                if key and key not in seen:
                    seen.add(key)
                    deduped.append(m)
            await kv.set(meds_key(username), deduped)
        if cards:
            old = await kv.get(cards_key(username)) or []
            if not isinstance(old, list):
                old = []
            ts = int(time.time() * 1000)
            old.extend({"ts": ts, "card": c} for c in cards)
            await kv.set(cards_key(username), old[-MAX_CARDS:])
    except Exception:
        pass


async def load_memory(ctx, username: str) -> dict:
    """记忆面板数据：档案 / 用药记录 / 保存的卡片（只含 AI 整理的结构化信息）"""
    kv = _kv(ctx)
    if kv is None:
        return {}
    out = {"profile": {}, "medications": [], "cards": []}
    try:
        out["profile"] = (await kv.get(profile_key(username))) or {}
        out["medications"] = _sanitize_meds(await kv.get(meds_key(username)))
        out["cards"] = (await kv.get(cards_key(username))) or []
    except Exception:
        pass
    return out


def _sanitize_meds(raw) -> list:
    """加载用药时强制类型 + 按 name 去重（防御旧 schema 污染或 LangGraph checkpoint 带重复）"""
    if not isinstance(raw, list):
        return []
    seen = set()
    out = []
    for m in raw:
        if not isinstance(m, dict):
            continue
        key = (m.get("name") or "").strip()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append({
            "name": key,
            "dosage": (m.get("dosage") or "").strip(),
            "frequency": (m.get("frequency") or "").strip(),
            "timing": (m.get("timing") or "").strip(),
            "notes": (m.get("notes") or "").strip(),
            "reminder_times": [
                value for value in (m.get("reminder_times") or [])
                if isinstance(value, str) and re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value)
            ][:4],
        })
    return out


async def clear_memory(ctx, username: str):
    """一键清空：档案、用药、卡片（登录态保留）；同时清掉旧版本的对话流水"""
    kv = _kv(ctx)
    if kv is None:
        return
    for key in (profile_key, meds_key, cards_key, recent_key):
        try:
            await kv.delete(key(username))
        except Exception:
            pass


async def delete_memory_item(ctx, username: str, *, category: str, index=None, key=None, expected=None):
    """只删除一条记忆；列表项携带预期内容，避免列表更新后误删别项。"""
    kv = _kv(ctx)
    if kv is None:
        raise ValueError("服务存储不可用")
    if category == "profile":
        if not isinstance(key, str) or not key:
            raise ValueError("档案项目不正确")
        data = await kv.get(profile_key(username)) or {}
        if isinstance(data, dict) and key in data:
            del data[key]
            await kv.set(profile_key(username), data)
        return

    storage_keys = {
        "medications": meds_key(username),
        "cards": cards_key(username),
    }
    storage_key = storage_keys.get(category)
    if not storage_key:
        raise ValueError("记忆类型不正确")
    items = await kv.get(storage_key) or []
    if not isinstance(items, list):
        return
    try:
        idx = int(index)
    except (TypeError, ValueError):
        raise ValueError("记忆项目不正确")
    if idx < 0 or idx >= len(items):
        return
    if expected is not None and items[idx] != expected:
        # 发生并发新增/删除时按内容定位；完全相同的重复项只删除一条。
        try:
            idx = items.index(expected)
        except ValueError:
            return
    items.pop(idx)
    await kv.set(storage_key, items)
