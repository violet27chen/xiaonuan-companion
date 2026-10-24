"""MiMo vision helper for reading user-selected prescription photos."""
import base64
import json
import re

import httpx


MAX_IMAGE_BYTES = 6 * 1024 * 1024
_TIME_RE = re.compile(r"(?:[01]\d|2[0-3]):[0-5]\d")

PROMPT = """请阅读这张药盒、药品包装、处方、出院记录或医生交代单，只整理图上明确可读的信息，不做诊断、不提出治疗建议。
严格按 JSON 输出，不要 Markdown，格式：
{"document_type":"处方/出院记录/其他/无法判断","medications":[{"name":"","dosage":"","frequency":"","timing":"","reminder_times":[],"evidence":"原文短句","uncertain_fields":[]}],"warnings":[],"follow_up":{"department":"","time_hint":"","bring":[]},"unreadable":[]}
规则：药盒/包装照片可以识别包装上明确印出的药名、规格和文字，并把可核对的包装原文写入 evidence；包装规格不等于每次剂量，dosage、frequency、timing 只能填写图中明确写出的实际服用方法，不能从药品名称或常见用法推断；“每日一次”不能换算成钟点，只有图上明确写了具体时刻才填写 reminder_times（HH:MM）；看不清的字段留空并把字段名放进 uncertain_fields；图中没有明确写出的信息一律留空。最多提取20种药。"""


def _short(value, limit=180):
    return value.strip()[:limit] if isinstance(value, str) else ""


def _json_from_text(text):
    text = (text or "").strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.I)
    try:
        return json.loads(text)
    except Exception:
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            raise ValueError("识别结果格式不正确，请换一张清晰照片")
        try:
            return json.loads(text[start:end + 1])
        except Exception as exc:
            raise ValueError("识别结果格式不正确，请换一张清晰照片") from exc


def _sanitize(data):
    if not isinstance(data, dict):
        raise ValueError("没有读出医嘱内容，请换一张清晰照片")
    meds = []
    for item in (data.get("medications") or [])[:20]:
        if not isinstance(item, dict):
            continue
        reminder_times = item.get("reminder_times")
        meds.append({
            "name": _short(item.get("name"), 80),
            "dosage": _short(item.get("dosage"), 100),
            "frequency": _short(item.get("frequency"), 100),
            "timing": _short(item.get("timing"), 100),
            "reminder_times": [v for v in (reminder_times if isinstance(reminder_times, list) else [])
                               if isinstance(v, str) and _TIME_RE.fullmatch(v)][:4],
            "evidence": _short(item.get("evidence"), 220),
            "uncertain_fields": [_short(v, 40) for v in (item.get("uncertain_fields") or [])
                                 if isinstance(v, str)][:10],
        })
    follow = data.get("follow_up") if isinstance(data.get("follow_up"), dict) else {}
    return {
        "document_type": _short(data.get("document_type"), 30) or "医嘱",
        "medications": meds,
        "warnings": [_short(v, 180) for v in (data.get("warnings") or []) if isinstance(v, str)][:20],
        "follow_up": {
            "department": _short(follow.get("department"), 100),
            "time_hint": _short(follow.get("time_hint"), 100),
            "bring": [_short(v, 100) for v in (follow.get("bring") or []) if isinstance(v, str)][:10],
        },
        "unreadable": [_short(v, 120) for v in (data.get("unreadable") or []) if isinstance(v, str)][:20],
    }


async def parse_medication_photo(env, image_b64, mime):
    """认读但不保存照片；返回需要用户逐项核对的候选内容。"""
    api_key = env.get("MIMO_API_KEY")
    base_url = (env.get("MIMO_BASE_URL") or "").rstrip("/")
    if not api_key or not base_url:
        raise ValueError("图片识别服务暂不可用，请稍后再试")
    if not isinstance(mime, str) or not mime.lower().startswith("image/") or not isinstance(image_b64, str):
        raise ValueError("请选择图片文件（JPG、PNG、WebP、HEIC 等都可以）")
    if len(image_b64) > (MAX_IMAGE_BYTES * 4 // 3) + 16:
        raise ValueError("照片太大，请重新拍摄或先裁剪")
    try:
        raw = base64.b64decode(image_b64, validate=True)
    except Exception as exc:
        raise ValueError("图片读取失败，请重新选择") from exc
    if not raw or len(raw) > MAX_IMAGE_BYTES:
        raise ValueError("图片太大或内容为空，请重新拍摄")

    payload = {
        "model": env.get("MIMO_VISION_MODEL") or "mimo-v2.6-flash",
        "messages": [{
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{image_b64}"}},
                {"type": "text", "text": PROMPT},
            ],
        }],
        "max_completion_tokens": 1800,
    }
    try:
        async with httpx.AsyncClient(timeout=40) as client:
            response = await client.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=payload,
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"].get("content", "")
            if isinstance(content, list):
                content = "".join(part.get("text", "") for part in content if isinstance(part, dict))
            return _sanitize(_json_from_text(content))
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError("这次没有识别成功，请检查网络或换一张清晰照片") from exc
