# MiMo 语音模型客户端（OpenAI 兼容 chat/completions 协议）
# ASR: mimo-v2.5-asr  -> POST /chat/completions + input_audio (wav/mp3 base64)
# TTS: mimo-v2.5-tts  -> POST /chat/completions + audio{format,voice} -> message.audio.data
# 凭据来自 ctx.env（MIMO_API_KEY / MIMO_BASE_URL），未配置则功能自动降级
import httpx

ASR_MODEL = "mimo-v2.5-asr"
TTS_MODEL = "mimo-v2.5-tts"
TTS_VOICE = "冰糖"  # 预置中文女声

TTS_STYLE = "用非常温柔、亲切、柔和的语气朗读这段话，像贴心的孙女陪着爷爷奶奶说话：语速缓慢，吐字清晰，声音轻软不刺耳，语调平稳绵软，句尾轻轻收住；说到药名、时间和数字时稍微放慢，说清楚，但不要生硬，像哄着老人一样自然温暖。"


def _conf(env: dict) -> tuple[str, str] | None:
    api_key = env.get("MIMO_API_KEY")
    base_url = (env.get("MIMO_BASE_URL") or "").rstrip("/")
    if not api_key or not base_url:
        return None
    return api_key, base_url


def speech_available(env: dict) -> bool:
    return _conf(env) is not None


async def transcribe(env: dict, audio_b64: str, mime: str = "audio/wav") -> str:
    """音频 base64 -> 文本。返回空串表示转写失败。"""
    conf = _conf(env)
    if not conf or not audio_b64:
        return ""
    api_key, base_url = conf
    fmt = "mp3" if "mp3" in (mime or "").lower() else "wav"
    try:
        async with httpx.AsyncClient(timeout=90) as client:
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
    """文本 -> base64 wav。返回空串表示合成失败。"""
    conf = _conf(env)
    if not conf or not text:
        return ""
    api_key, base_url = conf
    try:
        async with httpx.AsyncClient(timeout=180) as client:
            resp = await client.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "model": TTS_MODEL,
                    "messages": [
                        {"role": "user", "content": TTS_STYLE},
                        {"role": "assistant", "content": text[:1200]},
                    ],
                    "audio": {"format": "wav", "voice": TTS_VOICE},
                },
            )
            resp.raise_for_status()
            msg = resp.json()["choices"][0]["message"]
            audio = msg.get("audio") or {}
            return audio.get("data") or ""
    except Exception:
        return ""
