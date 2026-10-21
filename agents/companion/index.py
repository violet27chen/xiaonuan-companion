# 陪诊小暖 入口：SSE 流式（文本回复 + 结构化卡片 + 语音）
import json
import re
import time
import uuid

from langchain_core.messages import HumanMessage

from ._graph import build_graph
from ._speech import speech_available, synthesize, transcribe

DEMO_PATIENT = {"称呼": "叔叔阿姨"}

# 老人常以呼唤开头（"小暖，我今天头晕"），剥掉称呼让识别更稳
_WAKE_RE = re.compile(r"^(?:喂|嘿|哎|你好|您好|哈喽)*(?:小暖|暖暖|小暖暖|小小暖)[,，。!！?？~、\s]*")


async def handler(ctx):
    body = ctx.request.body or {}
    action = body.get("action") or ctx.request.query.get("action") or ""

    # ---- 能力探测：前端据此决定是否显示录音/朗读按钮 ----
    if action == "caps":
        return {"asr": speech_available(ctx.env), "tts": speech_available(ctx.env)}

    # ---- 单独 TTS：把一段文字念出来（卡片上的喇叭按钮） ----
    if action == "tts":
        text = (body.get("text") or "").strip()
        if not text:
            return {"error": "text is required"}, 400
        audio = await synthesize(ctx.env, text)
        if not audio:
            return {"error": "tts_unavailable"}, 503
        return {"audio": audio}

    message = (body.get("message") or "").strip()
    audio_b64 = body.get("audio") or ""
    mime = body.get("mime") or "audio/webm"
    mode = (body.get("mode") or "").strip()  # 前端按钮显式指定 pre/post
    profile = body.get("profile") or {}

    # ---- 语音输入：录音转写（失败降级提示） ----
    from_audio = False
    if not message and audio_b64:
        from_audio = True
        message = await transcribe(ctx.env, audio_b64, mime)
        if not message:
            return {"error": "语音没听清，麻烦再说一遍，或者用下面的输入框打字"}, 422

    if not message:
        return {"error": "请说话或在输入框输入内容"}, 400

    heard = message                      # asr 回显用原文（含称呼，老人看着自然）
    cleaned = _WAKE_RE.sub("", message).strip()
    if cleaned:
        message = cleaned                # 传给模型的指令去掉唤醒称呼

    # 凭据校验
    if not ctx.env.get("AI_GATEWAY_API_KEY"):
        return {"error": "模型网关未配置（AI_GATEWAY_API_KEY）"}, 500

    # 档案：来自前端本地存储；仅保留字符串/简单列表，限制体积
    patient = _safe_profile(profile)

    checkpointer = getattr(ctx.store, "langgraph_checkpointer", None) if ctx.store else None
    graph = build_graph(ctx.env, checkpointer=checkpointer)
    thread_id = ctx.conversation_id or f"t-{uuid.uuid4().hex}"

    async def gen():
        try:
            if from_audio:
                yield ctx.utils.sse({"type": "asr", "content": heard})
            async for mode_ in graph.astream(
                {"messages": [HumanMessage(content=message)], "patient": patient, **({"mode": mode} if mode in ("pre", "post") else {})},
                config={"configurable": {"thread_id": thread_id}},
                stream_mode=["updates", "messages"],
            ):
                if ctx.request.signal.is_set():
                    break
                kind, payload = mode_
                if kind == "updates":
                    for node, delta in (payload or {}).items():
                        if not delta:
                            continue
                        card = delta.get("result_card")
                        if card:
                            yield ctx.utils.sse({"type": "card", "node": node, "data": card})
                elif kind == "messages":
                    msg = payload[0] if isinstance(payload, tuple) else payload
                    if msg is None or not getattr(msg, "content", ""):
                        continue
                    if getattr(msg, "type", "") != "ai":
                        continue
                    if msg.tool_calls:
                        continue
                    content = msg.content if isinstance(msg.content, str) else json.dumps(msg.content, ensure_ascii=False)
                    if content.strip():
                        yield ctx.utils.sse({"type": "ai_response", "content": content})
        except Exception as e:
            if not ctx.request.signal.is_set():
                yield ctx.utils.sse({"type": "error_message", "content": f"哎呀，小暖这边出了点小状况：{e}"})
        yield ctx.utils.sse({"type": "ping", "ts": int(time.time() * 1000)})
        yield b"data: [DONE]\n\n"

    return ctx.utils.stream_sse(gen())


def _safe_profile(profile: dict) -> dict:
    """只保留白名单字段与字符串/列表值，防止注入体积"""
    if not isinstance(profile, dict):
        return {}
    keep = {}
    for k, v in profile.items():
        if isinstance(v, str) and v.strip():
            keep[str(k)[:20]] = v.strip()[:300]
        elif isinstance(v, list) and v and all(isinstance(x, (str, int, float)) for x in v):
            keep[str(k)[:20]] = [str(x)[:100] for x in v[:8]]
    return keep or DEMO_PATIENT
