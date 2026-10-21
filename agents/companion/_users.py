# 用户系统：用户名 + 密码（PBKDF2 加盐哈希）、会话令牌、按用户隔离的记忆存储
# 纯标准库实现；持久化用 ctx.kv（EdgeOne 每路由 KV store，生产环境 blob 持久化）
import hashlib
import re
import secrets
import time

SESSION_TTL = 90 * 24 * 3600  # 会话 90 天
MAX_CARDS = 20                # 每用户最多留存的卡片数
MAX_RECENT = 40               # 每用户最多留存的近期对话条数
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


def cards_key(username: str) -> str:
    return f"xn:c:{_uid(username)}"


def interview_key(username: str) -> str:
    return f"xn:i:{_uid(username)}"


def recent_key(username: str) -> str:
    return f"xn:m:{_uid(username)}"


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
    if not password or len(password) < 4:
        return None, "密码至少4位"
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


async def save_memory(ctx, username: str, *, profile=None, interview=None, cards=None, heard=None, reply=None):
    """把一轮对话里值得记住的东西按用户落下（KV 持久化，失败不影响对话）"""
    kv = _kv(ctx)
    if kv is None:
        return
    try:
        if profile:
            await kv.set(profile_key(username), profile)
        if interview:
            await kv.set(
                interview_key(username),
                {k: v for k, v in interview.items() if not str(k).startswith("_")},
            )
        if cards:
            old = await kv.get(cards_key(username)) or []
            if not isinstance(old, list):
                old = []
            ts = int(time.time() * 1000)
            old.extend({"ts": ts, "card": c} for c in cards)
            await kv.set(cards_key(username), old[-MAX_CARDS:])
        if reply:
            old = await kv.get(recent_key(username)) or []
            if not isinstance(old, list):
                old = []
            if heard:
                old.append({"who": "您", "text": str(heard)[:500]})
            old.append({"who": "小暖", "text": str(reply)[:1000]})
            await kv.set(recent_key(username), old[-MAX_RECENT:])
    except Exception:
        pass


async def load_memory(ctx, username: str) -> dict:
    """记忆面板数据：档案 / 问诊收集 / 保存的卡片 / 最近的对话"""
    kv = _kv(ctx)
    if kv is None:
        return {}
    out = {"profile": {}, "interview": {}, "cards": [], "recent": []}
    try:
        out["profile"] = (await kv.get(profile_key(username))) or {}
        out["interview"] = (await kv.get(interview_key(username))) or {}
        out["cards"] = (await kv.get(cards_key(username))) or []
        out["recent"] = (await kv.get(recent_key(username))) or []
    except Exception:
        pass
    return out
