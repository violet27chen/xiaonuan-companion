# 陪诊小暖 LangGraph 图：分诊 -> 诊前追问 / 诊后医嘱 / 档案问答
import json
from functools import partial
from typing import Annotated, TypedDict

from langchain_core.messages import AIMessage
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from pydantic import BaseModel, Field

from ._llm import get_model

MAX_INTERVIEW_TURNS = 8  # 追问轮数上限，防止无限循环

INTERVIEW_KEYS = ["主诉", "起病时间", "症状变化", "加重或缓解因素", "伴随症状", "既往病史", "在服药物", "药物过敏", "近期检查"]

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


# ---------------- 结构化输出模型 ----------------


class InterviewOut(BaseModel):
    """诊前问诊单轮输出"""

    reply: str = Field(description="对老人说的话，大白话、短句、一次最多问两个问题")
    collected_update: dict = Field(default_factory=dict, description="本轮新提取到的信息，键取自预定义字段，没有就留空 dict")
    done: bool = Field(description="关键信息是否已经收集足够，可以生成病史摘要卡")


class PostOut(BaseModel):
    """诊后医嘱解析输出"""

    reply: str = Field(description="跟老人确认的话，大白话")
    medications: list[dict] = Field(default_factory=list, description="[{name 药名, dosage 剂量, frequency 频次, timing 服药时机, notes 备注}]")
    warnings: list[str] = Field(default_factory=list, description="忌口、注意事项等提醒")
    follow_up: dict | None = Field(default_factory=dict, description="{department 科室, time_hint 时间, bring 需要带的东西[], notes 备注}，没有复诊安排则留空 dict")


class TriageOut(BaseModel):
    mode: str = Field(description="pre 或 post 或 archive")


# ---------------- State ----------------


class CompanionState(TypedDict):
    messages: Annotated[list, add_messages]
    patient: dict           # 前端传入的老人档案（本地存储摘要）
    mode: str               # pre / post / archive / chat
    interview: dict         # 诊前已收集信息（跨轮持久）
    interview_done: bool
    result_card: dict       # 本轮生成的结构化卡片 {"type": ..., ...}


# ---------------- 节点 ----------------


async def triage_node(state: CompanionState, env: dict):
    """自由输入时判断模式；前端按钮显式指定 pre/post 时直接放行，不浪费一次调用"""
    if state.get("mode") in ("pre", "post"):
        return {}
    last = state["messages"][-1].content
    prompt = (
        "判断这位用户在陪诊场景下的需求属于哪一类：\n"
        "pre=看病前的病情整理/问诊准备；post=刚看完医生，需要整理医嘱/处方/服药安排；"
        "archive=询问健康档案里的信息或健康常识问答。\n"
        f"用户输入：{last}\n只输出JSON：{{\"mode\": \"pre|post|archive\"}}"
    )
    try:
        out = await get_model(env, 0).with_structured_output(TriageOut).ainvoke(prompt)
        return {"mode": out.mode}
    except Exception:
        return {"mode": "archive"}


async def pre_node(state: CompanionState, env: dict):
    """诊前：记者式追问循环，收齐后生成病史摘要卡"""
    interview = dict(state.get("interview") or {})
    turns = len(interview.get("_turns", [])) + 1
    collected_txt = json.dumps({k: v for k, v in interview.items() if not k.startswith("_")}, ensure_ascii=False)

    sys = (
        "你是 AI 陪诊员「小暖」，正在帮一位老人做看病前的病情整理。你的任务是像有耐心的记者一样，"
        "通过几轮轻松的聊天，把看病要用的关键信息收集齐。\n"
        "【说话规矩】用大白话，短句，像晚辈聊天；一次最多问两个问题；老人答不上来的别追问，记为没问出来；"
        "语气温暖，先接住对方的话再问。\n"
        "【要收集的关键字段】" + "、".join(INTERVIEW_KEYS) + "\n"
        "【安全红线】你不做任何诊断、不推荐药物、不说『没事/是XX病』；"
        "如果老人提到剧烈胸痛、呼吸困难、意识不清、大出血等紧急情况，reply 必须立刻建议马上拨打120或去急诊，并把 done 置为 true。\n"
        "【已收集信息】" + (collected_txt if collected_txt != "{}" else "（还没有）") + "\n"
        "【老人档案】\n" + patient_block(state.get("patient") or {}) + "\n"
        f"【本轮是第{turns}轮】综合历史信息和老人的最新讲述，提取新增信息；"
        "判断还缺哪些关键字段：还缺就追问（done=false），信息够（或已到轮数上限）就 done=true。"
    )
    last_text = state["messages"][-1].content
    out = await get_model(env, 0.4).with_structured_output(InterviewOut).ainvoke(
        [{"role": "system", "content": sys}, {"role": "user", "content": str(last_text)}]
    )

    # 合并本轮提取
    merged = dict(interview)
    merged.setdefault("_turns", []).append(1)
    for k, v in (out.collected_update or {}).items():
        if v and str(v).strip():
            merged[k] = str(v).strip()
    force_done = turns >= MAX_INTERVIEW_TURNS
    done = bool(out.done) or force_done

    if not done:
        return {
            "interview": merged,
            "interview_done": False,
            "messages": [AIMessage(content=out.reply)],
        }

    # 信息收齐 -> 生成病史摘要卡
    card_sys = (
        "你是 AI 陪诊员「小暖」。请根据收集到的问诊信息和老人档案，生成一张『病史摘要卡』JSON，"
        "给医生快速看病用。字段：type 固定为 summary；patient_name 姓名(可空串)；age 年龄(可空)；gender 性别(可空)；"
        "chief_complaint 主诉(一句话)；timeline 症状时间线(数组，如『3个月前：开始胸闷』)；"
        "history 既往病史(数组)；medications 在服药物(数组)；allergies 药物过敏(数组，无则空)；"
        "last_exam 近期检查(可空)。没有的信息写空串或空数组，不要编造。"
        "只输出JSON。\n【问诊收集】" + json.dumps({k: v for k, v in merged.items() if not k.startswith("_")}, ensure_ascii=False)
        + "\n【老人档案】\n" + patient_block(state.get("patient") or {})
    )
    card_raw = await (await get_model(env, 0.2).ainvoke(card_sys)).content
    card = _safe_json(card_raw, {"type": "summary"})
    card.setdefault("type", "summary")

    reply = (
        "好啦，我都记下来了，整理成了一张「病史摘要卡」，明天看病的时候把它给医生看就行，医生一眼就能明白您的情况。"
        if not force_done
        else "咱们聊得很充分了，我把已知的信息整理成了「病史摘要卡」，看病时给医生看，有需要医生会再问您的。"
    )
    return {
        "interview": merged,
        "interview_done": True,
        "result_card": card,
        "messages": [AIMessage(content=reply)],
    }


async def post_node(state: CompanionState, env: dict):
    """诊后：把医生叮嘱翻译成服药表 + 复诊提醒卡"""
    sys = (
        "你是 AI 陪诊员「小暖」。老人刚看完医生，家属把医生的叮嘱转述给你。"
        "请解析成两张给老人用的卡片数据：\n"
        "1. 服药表 medications：[{name 药名, dosage 剂量(如『1片(100mg)』), frequency 频次(如『每天3次』), "
        "timing 时机(用大白话如『早中晚饭后』), notes 特别提醒(可空)}]\n"
        "2. warnings：忌口、不能一起做的事等提醒（大白话短句数组）\n"
        "3. follow_up 复诊提醒：{department 科室, time_hint 时间(如『2周后』『下个月3号』), "
        "bring 要带的东西[], notes 备注}，没有复诊安排就是空 dict。\n"
        "reply 用大白话跟老人确认并概括安排，温暖短句。\n"
        "【安全红线】只整理医生原话，不加自己的医疗建议、不改剂量。\n"
        "【老人档案】\n" + patient_block(state.get("patient") or {})
    )
    last_text = state["messages"][-1].content
    out = await get_model(env, 0.2).with_structured_output(PostOut).ainvoke(
        [{"role": "system", "content": sys}, {"role": "user", "content": str(last_text)}]
    )
    cards = {"type": "post", "medications": out.medications, "warnings": out.warnings, "follow_up": out.follow_up or {}}
    return {"result_card": cards, "messages": [AIMessage(content=out.reply)]}


async def archive_node(state: CompanionState, env: dict):
    """档案问答 / 日常健康答疑（基于本地档案，不做诊断）"""
    sys = (
        "你是 AI 陪诊员「小暖」，老人或家属在问健康相关的问题。请根据【老人档案】回答。\n"
        "【规矩】大白话、短句；只解释常识和档案里已有的安排（比如『今天该吃什么药』）；"
        "不做诊断、不开药、不改剂量；问题复杂或紧急时建议去医院；语气像晚辈，温暖。\n"
        "【老人档案】\n" + patient_block(state.get("patient") or {})
    )
    msgs = [{"role": "system", "content": sys}] + [
        {"role": "user" if m.type == "human" else "assistant", "content": str(m.content)}
        for m in state["messages"][-6:]
    ]
    out = await get_model(env, 0.4).ainvoke(msgs)
    return {"messages": [AIMessage(content=out.content)]}


def _safe_json(raw: str, fallback: dict) -> dict:
    raw = str(raw).strip()
    if raw.startswith("```"):
        raw = raw.strip("`").lstrip("json").strip()
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else fallback
    except Exception:
        # 兜底截取首个 { 到末个 }
        s, e = raw.find("{"), raw.rfind("}")
        if s >= 0 and e > s:
            try:
                data = json.loads(raw[s : e + 1])
                return data if isinstance(data, dict) else fallback
            except Exception:
                pass
        return fallback


def route_mode(state: CompanionState) -> str:
    return {"pre": "pre", "post": "post"}.get(state.get("mode") or "", "archive")


# ---------------- 图构建 ----------------


def build_graph(env: dict, checkpointer=None):
    g = StateGraph(CompanionState)
    g.add_node("triage", partial(triage_node, env=env))
    g.add_node("pre", partial(pre_node, env=env))
    g.add_node("post", partial(post_node, env=env))
    g.add_node("archive", partial(archive_node, env=env))
    g.add_edge(START, "triage")
    g.add_conditional_edges("triage", route_mode, {"pre": "pre", "post": "post", "archive": "archive"})
    g.add_edge("pre", END)
    g.add_edge("post", END)
    g.add_edge("archive", END)
    return g.compile(checkpointer=checkpointer)
