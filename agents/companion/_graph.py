# 陪诊小暖 LangGraph 图：单节点统一回复
# 产品定位：诊前/诊中不使用，诊后聊天告诉 AI 用药 → 自动保存吃药时间提醒，首页显示下次吃药时间
# 后端：口播模型自由回复（流式），提取模型并行解析用药清单和下次吃药时间
import asyncio
import json
import re
from datetime import datetime, timedelta
from functools import partial
from typing import Annotated, TypedDict

from langchain_core.messages import AIMessage
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages

from ._llm import get_model

# 回复会被直接合成语音念给老人听：不能带舞台提示，长短要克制
VOICE_RULE = "【口播规矩】你的回复会被直接念出来：只说要出口的话，不要语气提示、舞台指示（如（轻柔地））、动作描写；一般一两个短句说完。不要反复说『想聊身体的事随时开口』『有不舒服告诉我』这类固定客套话；用户没提身体或症状时，不要主动把话题引向身体或疾病。每轮只围绕用户刚说的内容自然回应；资料不足时只问一个具体问题，不需要追问时就简短回应，不强行加邀请或结束语。"


# ---------------- 档案文本化 ----------------


def patient_block(patient: dict) -> str:
    if not patient or not any(v for v in patient.values() if isinstance(v, str) and v.strip()):
        return "（暂无档案信息）"
    lines = []
    for k, v in patient.items():
        if isinstance(v, str) and v.strip():
            lines.append(f"{k}：{v.strip()}")
        elif isinstance(v, list) and v:
            lines.append(f"{k}：{'；'.join(str(x) for x in v)}")
    return "\n".join(lines) if lines else "（暂无档案信息）"


def meds_block(medications: list) -> str:
    if not medications:
        return "（还没保存用药提醒）"
    lines = []
    for m in medications:
        if not isinstance(m, dict):
            continue
        parts = [m.get("name", ""), m.get("dosage", "")]
        if m.get("frequency"):
            parts.append(m["frequency"])
        if m.get("timing"):
            parts.append(f"（{m['timing']}）")
        line = " ".join(p for p in parts if p).strip()
        if line:
            lines.append(line)
    return "；".join(lines) if lines else "（还没保存用药提醒）"


# ---------------- 结构化输出：自己解析 JSON ----------------
# MiMo 的 function calling 有时不按 schema 的英文字段名返回（例如把 name 写成
# "药名"、dosage 写成 "剂量"），直接按英文键读取会把整条记录丢弃。
# 这里做一层别名归一化，中英文键名都能正确落库。

_MED_KEY_MAP = {
    "name": "name", "药名": "name", "名称": "name", "药品": "name", "药品名": "name", "药物": "name", "药物名称": "name", "medicine": "name",
    "dosage": "dosage", "剂量": "dosage", "用法用量": "dosage", "dose": "dosage",
    "frequency": "frequency", "频次": "frequency", "频率": "frequency",
    "timing": "timing", "时机": "timing", "服药时机": "timing", "服药时间": "timing",
    "notes": "notes", "备注": "notes",
    "reminder_times": "reminder_times", "提醒时间": "reminder_times", "提醒钟点": "reminder_times", "钟点": "reminder_times",
}

_FOLLOWUP_KEY_MAP = {
    "department": "department", "科室": "department", "地点": "department", "医院": "department",
    "time_hint": "time_hint", "复诊时间": "time_hint", "时间": "time_hint",
    "bring": "bring", "携带": "bring", "携带物": "bring", "带": "bring",
    "notes": "notes", "备注": "notes",
}

_VISIT_KEY_MAP = {
    "symptoms": "symptoms", "症状": "symptoms", "主要不适": "symptoms",
    "duration": "duration", "持续时间": "duration", "患病时长": "duration",
    "history": "history", "既往情况": "history", "既往病史": "history",
    "current_meds": "current_meds", "当前用药": "current_meds", "在用的药": "current_meds",
    "questions": "questions", "想问医生": "questions", "想问医生的问题": "questions",
    "missing": "missing", "建议补充": "missing", "就诊时可补充": "missing",
}

# 档案键名中文化：模型可能返回 name/chronic_conditions/surname 等英文字段，
# 面板里显示英文键对老人不友好。未列出的键原样保留（用户手填的也不动）。
_PROFILE_KEY_MAP = {
    "name": "称呼", "姓名": "称呼", "称呼": "称呼", "surname": "称呼", "姓": "称呼", "姓氏": "称呼",
    "age": "年龄", "年龄": "年龄", "年纪": "年龄", "岁数": "年龄",
    "chronic_conditions": "慢性疾病", "长期疾病": "慢性疾病", "慢性病": "慢性疾病", "疾病": "慢性疾病",
    "allergies": "过敏史", "过敏": "过敏史", "过敏史": "过敏史",
    "location": "居住地", "居住地": "居住地", "现居": "居住地",
    "hearing": "听力情况", "听力": "听力情况", "听力情况": "听力情况",
    "mobility": "行动情况", "行动": "行动情况", "行动情况": "行动情况",
    "communication_preference": "沟通偏好", "沟通偏好": "沟通偏好", "说话习惯": "沟通偏好",
}


def _norm_med(raw) -> dict:
    if not isinstance(raw, dict):
        return {}
    out = {}
    for k, v in raw.items():
        key = _MED_KEY_MAP.get(str(k).strip())
        if not key or key in out:
            continue
        if key == "reminder_times":
            if isinstance(v, list):
                out[key] = v
            elif isinstance(v, str) and v.strip():
                out[key] = [x.strip() for x in v.replace("，", ",").split(",") if x.strip()]
            continue
        if isinstance(v, str) and v.strip():
            out[key] = v.strip()
    return out


def _norm_follow_up(raw) -> dict:
    if not isinstance(raw, dict):
        return {}
    out = {}
    for k, v in raw.items():
        key = _FOLLOWUP_KEY_MAP.get(str(k).strip())
        if not key or key in out:
            continue
        if key == "bring":
            if isinstance(v, list):
                out[key] = [str(x) for x in v]
            elif isinstance(v, str) and v.strip():
                out[key] = [v.strip()]
            continue
        if isinstance(v, str) and v.strip():
            out[key] = v.strip()
    return out


def _norm_visit_summary(raw) -> dict:
    if not isinstance(raw, dict):
        return {}
    out = {}
    for k, v in raw.items():
        key = _VISIT_KEY_MAP.get(str(k).strip())
        if not key or key in out:
            continue
        if isinstance(v, list):
            values = [str(x) for x in v if str(x).strip()]
            if values:
                out[key] = values
        elif isinstance(v, str) and v.strip():
            out[key] = v.strip()
    return out


# ---------------- 结构化输出：自己解析 JSON ----------------
# 不用 with_structured_output：MiMo 的 function calling 会不按 schema 字段名返回
# （中文字段名、缺字段、加字段都出现过），pydantic 会静默丢弃。改为让模型直接
# 输出 JSON 文本，本地宽松解析 + 字段名归一化，中英文键名都能正确落库。


def _parse_json_loose(text: str):
    if not text:
        return None
    t = str(text).strip()
    if t.startswith("```"):
        t = t.strip("`")
        if t[:4].lower() == "json":
            t = t[4:]
    start = t.find("{")
    end = t.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        return json.loads(t[start : end + 1])
    except Exception:
        return None


def _first_key(data: dict, names: tuple):
    for name in names:
        value = data.get(name)
        if value is not None:
            return value
    return None


async def _run_extract(model, prompt: str) -> dict:
    """后台提取：模型直接吐 JSON，宽松解析。任何失败都返回 {}，不影响口播。"""
    try:
        msg = await model.ainvoke([{"role": "user", "content": prompt}])
    except Exception:
        return {}
    data = _parse_json_loose(getattr(msg, "content", ""))
    return data if isinstance(data, dict) else {}


# ---------------- 服药时间自动推算 ----------------
# 老人口语："每8小时吃一次""一天3次""第一次早上8点吃""现在是第3次"。
# 提取模型只需把这些说法原样放进 frequency/timing，具体钟点由这里推算，
# 不依赖模型猜时间（模型猜钟点不可靠，且中文字段名时整条会被丢弃）。

# 中文时段词 -> 小时修正
_CN_PERIOD_HOUR = {
    "凌晨": lambda h: h % 24,
    "早上": lambda h: h % 24,
    "上午": lambda h: h % 24,
    "中午": lambda h: (h + 12) if h < 12 else h,
    "下午": lambda h: (h + 12) if h < 12 else h,
    "晚上": lambda h: 0 if h == 12 else (h + 12) if h < 12 else h,
}


# 中文数字（老人常说"一天两次""每八小时""七十二岁"，不总用阿拉伯数字）
_CN_DIGIT = {"一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}


def _cn_int(value):
    """解析阿拉伯数字或中文数字：3 / 三 / 十二 / 二十 / 三十五 / 七十二。"""
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.isdigit():
        return int(text)
    if "十" in text:
        left, _, right = text.partition("十")
        if left and left not in _CN_DIGIT:
            return None
        if right and right not in _CN_DIGIT:
            return None
        tens = _CN_DIGIT.get(left, 1) if left else 1
        ones = _CN_DIGIT.get(right, 0) if right else 0
        return tens * 10 + ones
    return _CN_DIGIT.get(text)


def _fmt_hhmm(minutes: int) -> str:
    minutes = int(round(minutes)) % 1440
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def compute_dose_times(text: str, med: dict) -> dict:
    """从用户原话推算服药钟点。推算不出返回 {}。

    支持：每X小时一次 / 一天X次 / 第一次(早上|上午|中午|下午|晚上)X点(半) /
    现在是第X次（结合间隔反推第一次）/ 用户直接报出一天的两个以上钟点。
    """
    blob = " ".join([
        str(text or ""),
        str(med.get("frequency") or ""),
        str(med.get("timing") or ""),
    ]).replace("：", ":")

    # 服药间隔（分钟）
    step = None
    m = re.search(r"每\s*([0-9一二两三四五六七八九十]+)\s*个?\s*小时", blob)
    if m:
        step = _cn_int(m.group(1))
        step = step * 60 if step else None
    else:
        m = re.search(r"([0-9一二两三四五六七八九十]+)\s*个?\s*小时\s*(?:一|1)?次", blob)
        if m:
            step = _cn_int(m.group(1))
            step = step * 60 if step else None

    # 一天几次（能整除 24 小时时换算成间隔）
    times_per_day = None
    m = re.search(r"(?:一天|每天|每日|1天|整天)\s*(?:吃|服|用)?\s*([0-9一二两三四五六七八九十]+)\s*次", blob)
    if m:
        times_per_day = _cn_int(m.group(1))
    else:
        m = re.search(r"([0-9一二两三四五六七八九十]+)\s*次\s*(?:一天|每天|每日)", blob)
        if m:
            times_per_day = _cn_int(m.group(1))
    if times_per_day is None and re.search(r"早晚各?一?次|早晚各?吃", blob):
        times_per_day = 2  # "早晚各一次"
    if step is None and times_per_day and 1 <= times_per_day <= 8:
        step = 1440 / times_per_day

    # 第一次服药时间："第一次早上8点吃" / "首次8:00" / "第一顿晚上8点半"
    first_minutes = None
    m = re.search(
        r"(?:第一次|首次|第一顿|第一回|第一回吃)[^0-9]{0,8}?(凌晨|早上|上午|中午|下午|晚上)?\s*(\d{1,2})\s*[:点]\s*(?:(\d{1,2})\s*分?|半)?",
        blob,
    )
    if m:
        period, hh, mm = m.group(1), int(m.group(2)), m.group(3)
        minute = 30 if (mm is None and "半" in (m.group(0) or "")) else int(mm or 0)
        if period in _CN_PERIOD_HOUR:
            hh = _CN_PERIOD_HOUR[period](hh)
        if 0 <= hh < 24 and 0 <= minute < 60:
            first_minutes = hh * 60 + minute

    # "现在是第3次"：结合间隔反推第一次时间
    current_n = None
    m = re.search(r"第\s*(\d+)\s*次", blob)
    if m:
        current_n = int(m.group(1))
    if first_minutes is None and current_n and step:
        now = datetime.now()
        first_dt = now - timedelta(minutes=step * (current_n - 1))
        first_minutes = first_dt.hour * 60 + first_dt.minute

    # 用户直接报了一天里的多个钟点（"早上8点、晚上8点各一次"）
    explicit: list[int] = []
    for m in re.finditer(r"(凌晨|早上|上午|中午|下午|晚上)?\s*(\d{1,2})\s*[:点]\s*(\d{1,2})?", blob):
        period, hh, mm = m.group(1), int(m.group(2)), int(m.group(3) or 0)
        if blob[max(0, m.start() - 2):m.start()].endswith("第"):
            continue
        if period in _CN_PERIOD_HOUR:
            hh = _CN_PERIOD_HOUR[period](hh)
        if 0 <= hh < 24 and 0 <= mm < 60:
            explicit.append(hh * 60 + mm)
    explicit = sorted(set(explicit))

    # anchored：第一次服药时间来自用户原话（第一次X点 / 现在是第X次），
    # 而不是默认的早上8点。调用方据此决定要不要用推算结果覆盖模型/历史钟点。
    anchored = first_minutes is not None or len(explicit) >= 2
    times_minutes: list[int] = []
    if step and first_minutes is None:
        first_minutes = 8 * 60  # 只说了间隔没说第一次时间：默认早上8点起排
    if len(explicit) >= 2:
        # 用户直接报了一天里的钟点（"早上7点、晚上9点"）：以用户说的为准
        times_minutes = explicit
    elif step and first_minutes is not None:
        count = max(1, round(1440 / step))
        times_minutes = [int(first_minutes + i * step) % 1440 for i in range(count)]
    elif step and times_per_day:
        # 知道一天几次但不知道第一次时间：默认从早上8点排起
        count = max(1, round(1440 / step))
        times_minutes = [int(8 * 60 + i * step) % 1440 for i in range(count)]

    if not times_minutes:
        return {}

    times_minutes = sorted(set(times_minutes))
    # 距离现在最近的一次服药（今天已过完就说明天）
    now_minutes = datetime.now().hour * 60 + datetime.now().minute
    upcoming = [t for t in times_minutes if t > now_minutes]
    next_minutes = upcoming[0] if upcoming else times_minutes[0]
    next_label = "今天" if upcoming else "明天"
    return {
        "reminder_times": [_fmt_hhmm(t) for t in times_minutes],
        "next_dose_time": f"{next_label}{_fmt_hhmm(next_minutes)}",
        "anchored": anchored,
    }


# ---------------- 档案正则兜底 ----------------
# 老人自我介绍高度模式化（"我姓王""今年72了"），模型偶尔漏提取。
# 对这几个最固定的说法做正则兜底：只在模型没给出时补，不覆盖模型结果。

_PROFILE_FALLBACK_RULES = [
    ("称呼", re.compile(r"我(?:姓|叫)([一-龥A-Za-z]{1,4})")),
    ("年龄", re.compile(r"我(?:今年|如今|现在)?\s*([0-9一二两三四五六七八九十]{1,3})\s*岁")),
]


def _profile_fallback(text: str, profile_updates: dict) -> dict:
    """从用户原话兜底补档案字段（称呼/年龄），不覆盖已提取到的值。"""
    if not text:
        return profile_updates
    for key, pattern in _PROFILE_FALLBACK_RULES:
        if profile_updates.get(key):
            continue
        m = pattern.search(str(text))
        if not m:
            continue
        value = m.group(1).strip()
        if key == "年龄":
            num = _cn_int(value)
            if num is None or not (1 <= num <= 120):
                continue
            value = str(num)
        if value:
            profile_updates[key] = value
    return profile_updates


# ---------------- State ----------------


class CompanionState(TypedDict):
    messages: Annotated[list, add_messages]
    patient: dict                 # 当前账号保存的健康档案
    medications: list             # 当前账号保存的用药记录
    result_card: dict             # 本轮生成的结构化卡片
    mode: str                     # pre：诊前整理；post：诊后医嘱整理
    profile_updates: dict         # 本轮提取到的档案增量：透传给上层落库用（必须声明，否则 updates 通道会被过滤）


# ---------------- 节点 ----------------


async def reply_node(state: CompanionState, env: dict):
    """统一回复节点：口播模型自然应答，提取模型并行整理档案/用药/提醒（全自动，无模式切换）"""
    meds_so_far = list(state.get("medications") or [])

    # 用户原话（取最后一轮）：用于服药时间推算
    raw_user_text = ""
    for m in reversed(state.get("messages") or []):
        if getattr(m, "type", "") == "human":
            raw_user_text = str(m.content)
            break

    sys = (
        "你是 AI 陪诊员「小暖」，正在陪一位老人说话。\n"
        "自然、亲切地回应用户当下的话题，像孙女和爷爷奶奶聊天；一般一两个短句。\n"
        "用户在说普通话题时，不要把话题引向身体或疾病；用户在说就医、用药、复查安排时，"
        "就按他实际需要的帮忙：复述核对、提醒时间、整理注意事项。\n"
        "回答使用大白话，不代替医生判断。\n"
        "【安全红线】你不做诊断、不推荐药物、不说『没事/是XX病』；剧烈胸痛、呼吸困难、意识不清、大出血等紧急情况，"
        "立刻建议马上拨打120或去急诊。\n"
        "【老人档案】\n" + patient_block(state.get("patient") or {}) + "\n"
        "【已保存的用药提醒】\n" + meds_block(meds_so_far) + "\n"
        + VOICE_RULE
    )
    history = [
        {"role": "user" if m.type == "human" else "assistant", "content": str(m.content)}
        for m in state["messages"][-10:]
    ]

    recent_user_inputs = [
        str(m.content) for m in state["messages"][-12:] if getattr(m, "type", "") == "human"
    ][-6:]
    extract_prompt = (
        "你在为 AI 陪诊员做后台信息整理，分析老人这一轮的话：\n"
        "【输出格式】只输出 JSON，所有字段名必须用英文：profile_updates / medications_added / next_dose_time / warnings / follow_up / visit_summary；medications_added 每项用 name/dosage/frequency/timing/notes/reminder_times；follow_up 用 department/time_hint/bring/notes。不要使用中文字段名。\n"
        "先检查是否有适合长期记住的本人信息（称呼、年龄、长期疾病、过敏史、居住地、行动/听力情况、沟通偏好等）。用户说出称呼（如“我是老李”“我姓王”）或长期疾病（如高血压、糖尿病）时，必须填入 profile_updates；不要把短期症状或第三方信息放进档案，不推断。没有就留空 {}。\n"
        "用户说哪里不舒服、持续多久、想问医生什么时，整理进 visit_summary（symptoms 症状 / duration 持续时间 / history 既往情况 / current_meds 当前用药 / questions 想问医生的问题 / missing 建议补充）；没有就留空。\n"
        "只要用户明确说自己正在使用某种药、医生安排了某种药，或明确要求记下用药，就写入 medications_added；提问、假设、他人用药不记。medications_added 每项必须使用英文字段名 name/dosage/frequency/timing/notes/reminder_times，不要写成中文字段名。用户说‘每X小时一次’‘一天X次’‘第一次X点吃’‘现在是第X次’这类安排时，原样写进 frequency/timing（如 frequency='每8小时一次'），reminder_times 留空由系统自动推算；只有用户明确说出每天的具体钟点（如‘早上8点、晚上8点’）才填 reminder_times（HH:MM列表）。\n"
        "用户提到忌口、注意事项时整理进 warnings（大白话短句列表）；提到复诊安排时整理进 follow_up（department 科室 / time_hint 时间 / bring 要带的东西 / notes 备注）；没有就留空。\n"
        "只输出 JSON。\n"
        "【最近几轮用户提供的信息】\n" + "\n".join(recent_user_inputs) + "\n"
        "【已保存的用药提醒】" + meds_block(meds_so_far)
    )

    # 提取调用与口播并行：后台任务，失败/超时都不影响口播
    try:
        extract_task = asyncio.ensure_future(_run_extract(get_model(env, 0), extract_prompt))
    except Exception:
        extract_task = None

    parts: list[str] = []
    data: dict = {}
    try:
        async for chunk in get_model(env, 0.4).astream([{"role": "system", "content": sys}] + history):
            c = chunk.content
            if isinstance(c, str) and c:
                parts.append(c)
    finally:
        if extract_task is not None:
            try:
                data = await extract_task or {}
            except Exception:
                data = {}

    update: dict = {"messages": [AIMessage(content="".join(parts))]}
    if not data:
        return update

    # 只增量更新明确提到的本人长期信息，保留用户已填的其他档案字段。
    profile_updates = {}
    profile_raw = _first_key(data, ("profile_updates", "档案更新", "档案"))
    if isinstance(profile_raw, dict):
        for key, value in profile_raw.items():
            key = _PROFILE_KEY_MAP.get(str(key).strip(), str(key).strip())[:20]
            if not key:
                continue
            if isinstance(value, str) and value.strip():
                profile_updates[key] = value.strip()[:300]
            elif isinstance(value, list):
                values = [str(v).strip()[:100] for v in value if isinstance(v, (str, int, float)) and str(v).strip()]
                if values:
                    profile_updates[key] = values[:8]
    if profile_updates:
        # 模型漏提取时，用正则兜底补最固定的自我介绍（称呼/年龄）
        profile_updates = _profile_fallback(raw_user_text, profile_updates)
        update["profile_updates"] = profile_updates

    # 合并新用药（按药名去重，同药名覆盖旧剂量/频次/时机）
    meds_raw = _first_key(data, ("medications_added", "用药", "用药记录", "新增用药"))
    new_items: list[dict] = []
    schedule_next_dose = ""  # 本轮推算出的下次服药时间（模型没给时兜底）
    if isinstance(meds_raw, list):
        for raw_med in meds_raw:
            m = _norm_med(raw_med)
            if not m.get("name"):
                continue
            existing_idx = next((i for i, e in enumerate(meds_so_far) if e.get("name") == m["name"]), -1)
            previous = meds_so_far[existing_idx] if existing_idx >= 0 else {}
            previous_times = previous.get("reminder_times") if isinstance(previous.get("reminder_times"), list) else []
            model_times = m.get("reminder_times") if isinstance(m.get("reminder_times"), list) else []
            # 先按用户原话推算（每X小时一次 / 一天X次 / 第一次X点吃 / 现在是第X次）。
            # 模型经常只回显它注意到的一两个钟点（如"第一次早上8点"只给 08:00），
            # 此时以推算的完整安排为准；原话推不出（如"七点半"中文钟点）才用模型给的。
            schedule = compute_dose_times(raw_user_text, m)
            computed_times = schedule.get("reminder_times") or []
            freq_changed = existing_idx < 0 or (m.get("frequency") or "").strip() != (previous.get("frequency") or "").strip()
            if computed_times and (schedule.get("anchored") or freq_changed or not previous_times):
                reminder_times = computed_times
            elif model_times and (not previous_times or len(model_times) >= len(previous_times)):
                # 模型回显的钟点比已保存的还少（如只回显"早上8点"）时不可靠，以已保存的为准
                reminder_times = model_times
            elif previous_times:
                reminder_times = previous_times
            else:
                reminder_times = []
            if schedule.get("next_dose_time") and not schedule_next_dose:
                schedule_next_dose = schedule["next_dose_time"]
            frequency = (m.get("frequency") or previous.get("frequency") or "").strip()
            if not frequency and reminder_times:
                frequency = f"一天{len(reminder_times)}次"
            entry = {
                "name": m.get("name", "").strip(),
                "dosage": (m.get("dosage") or previous.get("dosage") or "").strip(),
                "frequency": frequency,
                "timing": (m.get("timing") or previous.get("timing") or "").strip(),
                "notes": (m.get("notes") or previous.get("notes") or "").strip(),
                "reminder_times": [
                    value for value in reminder_times
                    if isinstance(value, str) and re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value)
                ][:6] if isinstance(reminder_times, list) else [],
            }
            # 「刚记下的用药提醒」只放真正新增或信息有变化的药：模型经常把已保存的
            # 用药原样带回，若不比对，每轮聊天都会把全部旧药当成新记的弹出来。
            # notes 不参与比对：模型每轮改写的措辞都不同，只更新记录不重复提示。
            def _same_value(field: str) -> bool:
                old, new = previous.get(field), entry[field]
                if field == "reminder_times":
                    return sorted(map(str, old or [])) == sorted(map(str, new or []))
                return str(old or "") == str(new or "")
            changed = existing_idx < 0 or any(
                not _same_value(field) for field in ("name", "dosage", "frequency", "timing", "reminder_times")
            )
            if existing_idx >= 0:
                meds_so_far[existing_idx] = entry
            else:
                meds_so_far.append(entry)
            if changed:
                new_items.append(entry)
        # 防御：按药名去重（LangGraph checkpointer 可能带重复、模型可能回传现有药）
        seen = set()
        deduped = []
        for m in meds_so_far:
            key = (m.get("name") or "").strip()
            if key and key not in seen:
                seen.add(key)
                deduped.append(m)
        meds_so_far = deduped
        update["medications"] = meds_so_far

    # 本轮有新用药 / 有注意事项 / 有复诊安排 → 推一张提醒卡；只有症状信息 → 推就诊摘要卡。
    # 完全按内容自动判断，不再有就诊前/就诊后模式切换。注意：只有 next_dose_time
    # 时不弹卡——模型闲聊时也会回显这个字段，每轮弹卡片太吵。
    warnings_raw = _first_key(data, ("warnings", "注意事项"))
    next_dose_raw = _first_key(data, ("next_dose_time", "下次吃药时间"))
    follow_up = _norm_follow_up(_first_key(data, ("follow_up", "复诊")) or {})
    visit_summary = _norm_visit_summary(_first_key(data, ("visit_summary", "就诊摘要")) or {})
    warnings = [str(w) for w in warnings_raw if str(w).strip()] if isinstance(warnings_raw, list) else []
    next_dose_time = str(next_dose_raw).strip() if isinstance(next_dose_raw, str) else ""
    # 模型只回显了裸钟点（"08:00"）时，用推算结果（带"今天/明天"）替代，信息更完整
    if schedule_next_dose and (not next_dose_time or re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", next_dose_time)):
        next_dose_time = schedule_next_dose
    if new_items or warnings or follow_up:
        update["result_card"] = {
            "type": "post",
            "medications": meds_so_far,
            "new_items": new_items,
            "warnings": warnings,
            "follow_up": follow_up,
            "next_dose_time": next_dose_time,
        }
    elif visit_summary and any(visit_summary.get(k) for k in ("symptoms", "duration", "questions", "missing")):
        # 只有本轮患者主动说的不适/时长/想问的问题才生成就诊摘要卡；
        # history/current_meds 常是模型对已存档案的回显，不作为触发条件。
        summary = {
            key: visit_summary.get(key) or ""
            for key in ("symptoms", "duration", "history", "current_meds", "questions", "missing")
        }
        update["result_card"] = {"type": "pre", "visit_summary": summary}
    return update


# ---------------- 图构建 ----------------


def build_graph(env: dict, checkpointer=None):
    g = StateGraph(CompanionState)
    g.add_node("reply", partial(reply_node, env=env))
    g.add_edge(START, "reply")
    g.add_edge("reply", END)
    return g.compile(checkpointer=checkpointer)
