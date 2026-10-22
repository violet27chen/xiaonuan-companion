# MiMo 语音模型客户端（OpenAI 兼容 chat/completions 协议）
# ASR: mimo-v2.5-asr  -> POST /chat/completions + input_audio (wav/mp3 base64)
# TTS: mimo-v2.5-tts  -> POST /chat/completions + audio{format,voice} -> message.audio.data
#                       stream:true 时走 SSE，choices[].delta.audio.data 为 base64 片段，直接拼接即完整文件
# 凭据来自 ctx.env（MIMO_API_KEY / MIMO_BASE_URL），未配置则功能自动降级
import json

import httpx

ASR_MODEL = "mimo-v2.5-asr"
TTS_MODEL = "mimo-v2.5-tts"
TTS_VOICE = "冰糖"  # 预置中文女声

# 风格提示词必须短：实测 100+ 字的长提示让单句合成从 1.5s 涨到 3.3s（推理模型逐字过 prompt）
TTS_STYLE = "温柔亲切，像孙女陪老人说话，语速慢，吐字清，句尾轻收。"


def _conf(env: dict) -> tuple[str, str] | None:
    api_key = env.get("MIMO_API_KEY")
    base_url = (env.get("MIMO_BASE_URL") or "").rstrip("/")
    if not api_key or not base_url:
        return None
    return api_key, base_url


def speech_available(env: dict) -> bool:
    return _conf(env) is not None


# 全模块共用一个连接池：ASR/TTS 每次调用都复用 TCP+TLS 连接，
# 比「每次新建 AsyncClient」省掉一握手（移动网络上百毫秒级）
_client: httpx.AsyncClient | None = None


def _shared_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=90,
            limits=httpx.Limits(max_connections=8, max_keepalive_connections=4),
        )
    return _client


async def transcribe(env: dict, audio_b64: str, mime: str = "audio/wav") -> str:
    """音频 base64 -> 文本。返回空串表示转写失败。"""
    conf = _conf(env)
    if not conf or not audio_b64:
        return ""
    api_key, base_url = conf
    fmt = "mp3" if "mp3" in (mime or "").lower() else "wav"
    try:
        client = _shared_client()
        resp = await client.post(
            f"{base_url}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": ASR_MODEL,
                "messages": [{
                    "role": "user",
                    "content": [{
                        "type": "input_audio",
                        "input_audio": {"data": f"data:audio/{fmt};base64,{audio_b64}"},
                    }],
                }],
                "asr_options": {"language": "zh"},
            },
        )
        resp.raise_for_status()
        msg = resp.json()["choices"][0]["message"]
        return (msg.get("content") or "").strip()
    except Exception:
        return ""


async def synthesize(env: dict, text: str) -> str:
    """文本 -> base64 mp3。返回空串表示合成失败。"""
    conf = _conf(env)
    if not conf or not text:
        return ""
    api_key, base_url = conf
    try:
        client = _shared_client()
        resp = await client.post(
            f"{base_url}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": TTS_MODEL,
                "messages": [
                    {"role": "user", "content": TTS_STYLE},
                    {"role": "assistant", "content": text[:1200]},
                ],
                "audio": {"format": "mp3", "voice": TTS_VOICE},
            },
        )
        resp.raise_for_status()
        msg = resp.json()["choices"][0]["message"]
        audio = msg.get("audio") or {}
        return audio.get("data") or ""
    except Exception:
        return ""


async def synthesize_stream(env: dict, text: str):
    """流式合成：逐个 yield base64 音频片段（mp3），拼接即完整文件。首音 ~0.7s。

    MiMo 的 SSE chunk 结构：choices[0].delta.audio.data；chunk0 只带 role 无音频，
    末 chunk delta 为空。异常/不支持时静默结束（前端回退整句合成）。"""
    conf = _conf(env)
    if not conf or not text:
        return
    api_key, base_url = conf
    try:
        async with _shared_client().stream(
            "POST",
            f"{base_url}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": TTS_MODEL,
                "messages": [
                    {"role": "user", "content": TTS_STYLE},
                    {"role": "assistant", "content": text[:1200]},
                ],
                "audio": {"format": "mp3", "voice": TTS_VOICE},
                "stream": True,
            },
        ) as resp:
            async for line in resp.aiter_lines():
                if not line.startswith("data:"):
                    continue
                s = line[5:].strip()
                if s == "[DONE]":
                    break
                try:
                    ev = json.loads(s)
                except Exception:
                    continue
                delta = ((ev.get("choices") or [{}])[0]).get("delta") or {}
                data = ((delta.get("audio") or {}).get("data")) or ""
                if data:
                    yield data
    except Exception:
        return
