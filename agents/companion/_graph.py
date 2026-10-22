# 陪诊小暖 LangGraph 图：单节点统一回复
# 产品定位：诊前/诊中不使用，诊后聊天告诉 AI 用药 → 自动保存吃药时间提醒，首页显示下次吃药时间
# 后端：口播模型自由回复（流式），提取模型并行解析用药清单和下次吃药时间
import asyncio
import json
import re
from functools import partial
from typing import Annotated, TypedDict

from langchain_core.messages import AIMessage
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from pydantic import BaseModel, Field

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


# ---------------- 结构化输出模型 ----------------


class ExtractOut(BaseModel):
    """每轮后台提取：从自然对话补全长期档案与明确用药，不阻塞口播"""

    profile_updates: dict = Field(
        default_factory=dict,
        description="只记录用户明确说出的、适合长期参考的本人信息，例如称呼、年龄、长期疾病、过敏史、居住地、行动/听力情况、沟通偏好。键为简短中文字段名，值为简短字符串或字符串列表。未明确的信息留空；短期症状放入 visit_summary，不作为长期档案。",
    )

    medications_added: list[dict] = Field(
        default_factory=list,
        description="本轮用户明确说自己正在使用、医生安排使用或明确要求记下的药物：[{name 药名, dosage 剂量（如1粒、半片）, frequency 频次（如 每天3次、早晚各1次）, timing 服药时机/时间（如 饭后半小时、早上8点）, reminder_times 明确说出的每日钟点列表（仅HH:MM格式）, notes 备注}]。药物提问、假设、他人用药不记；不明确的字段留空，不推测；不要把‘饭后’猜成具体钟点。",
    )
    next_dose_time: str = Field(default="", description="本轮确认的下次吃药时间（大白话，如 '今天晚上8点'、'明天早上饭后'），没有就留空")
    warnings: list[str] = Field(default_factory=list, description="忌口、注意事项等大白话短句，没有留空")
    follow_up: dict = Field(default_factory=dict, description="复诊提醒 {department, time_hint, bring[], notes}，没有空 dict")
    visit_summary: dict = Field(
        default_factory=dict,
        description="诊前就诊摘要：仅整理用户明确说过的信息，字段为 symptoms（症状）、duration（持续时间）、history（既往情况）、current_meds（当前用药）、questions（想问医生的问题）、missing（建议就诊时补充的信息）；没有的信息留空，不推断、不诊断",
    )


# ---------------- State ----------------


class CompanionState(TypedDict):
    messages: Annotated[list, add_messages]
    patient: dict                 # 当前账号保存的健康档案
    medications: list             # 当前账号保存的用药记录
    result_card: dict             # 本轮生成的结构化卡片
    mode: str                     # pre：诊前整理；post：诊后医嘱整理


# ---------------- 节点 ----------------


async def reply_node(state: CompanionState, env: dict):
    """统一回复节点：口播模型自由说，提取模型并行更新用药/提醒"""
    meds_so_far = list(state.get("medications") or [])

    requested_mode = state.get("mode")
    mode = requested_mode if requested_mode in {"pre", "post", "chat"} else "chat"
    mode_rule = {
        "pre": "当前是就诊前准备：帮助用户整理已明确说出的症状、持续时间、既往情况、当前用药和想问医生的问题；不诊断、不推测病因、不推荐治疗。资料不全时提醒用户就诊时补充。",
        "post": "当前是就诊后整理：仅按用户转述的医生医嘱整理药物、注意事项和复诊安排；不自行补充剂量、不改医嘱。",
        "chat": "当前是日常聊天：自然回应用户当下的话题，不主动把普通话题引向疾病；如果用户提到就医或用药，按其实际需要提供整理帮助。",
    }[mode]
    task_reply_rule = {
        "pre": "优先用一两个短句复述并核对刚才提到的就诊信息。",
        "post": "把已明确转述的药物安排逐条复述，请用户核对；没有说清的剂量和时间要标明待确认，不要猜。",
        "chat": "自然回应当前内容，避免套用固定问候或医疗话术；需要健康信息时只问一个具体问题。",
    }[mode]
    sys = (
        "你是 AI 陪诊员「小暖」，正在陪一位老人说话。\n"
        + mode_rule + "\n"
        + task_reply_rule + "\n"
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
    mode_extract_rule = {
        "pre": "当前在准备就诊。填写 visit_summary 的 symptoms、duration、history、current_meds、questions、missing；只整理用户明确说出的信息，不诊断、不推断。\n",
        "post": "当前在整理就诊后的安排。\n",
        "chat": "当前是日常聊天。只有用户确实在说就医相关内容时才整理就医信息，普通闲聊不要生成 visit_summary。\n",
    }[mode]
    extract_prompt = (
        "你在为 AI 陪诊员做后台信息整理，分析老人这一轮的话：\n"
        "先检查是否有适合长期记住的本人信息（称呼、年龄、长期疾病、过敏史、居住地、行动/听力情况、沟通偏好等）。只记录用户明确说的本人事实，填入 profile_updates；不要把短期症状或第三方信息放进档案，不推断。没有就留空 {}。\n"
        + mode_extract_rule
        + "只要用户明确说自己正在使用某种药、医生安排了某种药，或明确要求记下用药，就写入 medications_added；提问、假设、他人用药不记。药名/剂量/频次/时机只填明确说出的内容，其他留空字符串，不要猜。只有用户明确说了每天的具体钟点才填 reminder_times（HH:MM列表），‘早上’‘饭后’等不明确钟点不能猜。\n"
        + ("整理用户提到的忌口、注意事项、复诊时间；没有就留空。\n" if mode == "post" else "warnings 和 follow_up 留空。\n")
        + "只输出 JSON。\n"
        "【最近几轮用户提供的信息】\n" + "\n".join(recent_user_inputs) + "\n"
        "【已保存的用药提醒】" + meds_block(meds_so_far)
    )

    # 提取调用与口播并行：后台任务，失败/超时都不影响口播
    try:
        extract_task = asyncio.ensure_future(
            get_model(env, 0).with_structured_output(ExtractOut).ainvoke([{"role": "user", "content": extract_prompt}])
        )
    except Exception:
        extract_task = None

    parts: list[str] = []
    out: ExtractOut | None = None
    try:
        async for chunk in get_model(env, 0.4).astream([{"role": "system", "content": sys}] + history):
            c = chunk.content
            if isinstance(c, str) and c:
                parts.append(c)
    finally:
        if extract_task is not None:
            try:
                out = await extract_task
            except Exception:
                out = None

    update: dict = {"messages": [AIMessage(content="".join(parts))]}
    if out is None:
        return update

    # 只增量更新明确提到的本人长期信息，保留用户已填的其他档案字段。
    profile_updates = {}
    if isinstance(out.profile_updates, dict):
        for key, value in out.profile_updates.items():
            key = str(key).strip()[:20]
            if not key:
                continue
            if isinstance(value, str) and value.strip():
                profile_updates[key] = value.strip()[:300]
            elif isinstance(value, list):
                values = [str(v).strip()[:100] for v in value if isinstance(v, (str, int, float)) and str(v).strip()]
                if values:
                    profile_updates[key] = values[:8]
    if profile_updates:
        update["profile_updates"] = profile_updates

    # 合并新用药（按药名去重，同药名覆盖旧剂量/频次/时机）
    new_items: list[dict] = []
    if out.medications_added:
        for m in out.medications_added:
            if not isinstance(m, dict) or not m.get("name"):
                continue
            existing_idx = next((i for i, e in enumerate(meds_so_far) if e.get("name") == m["name"]), -1)
            previous = meds_so_far[existing_idx] if existing_idx >= 0 else {}
            reminder_times = m.get("reminder_times") if isinstance(m.get("reminder_times"), list) else []
            if not reminder_times:
                reminder_times = previous.get("reminder_times") or []
            entry = {
                "name": m.get("name", "").strip(),
                "dosage": (m.get("dosage") or previous.get("dosage") or "").strip(),
                "frequency": (m.get("frequency") or previous.get("frequency") or "").strip(),
                "timing": (m.get("timing") or previous.get("timing") or "").strip(),
                "notes": (m.get("notes") or previous.get("notes") or "").strip(),
                "reminder_times": [
                    value for value in reminder_times
                    if isinstance(value, str) and re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value)
                ][:4] if isinstance(reminder_times, list) else [],
            }
            if existing_idx >= 0:
                meds_so_far[existing_idx] = entry
            else:
                meds_so_far.append(entry)
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

    # 本轮有新用药 / 有诊后注意 → 推一张提醒卡给前端展示
    if mode == "pre" and out.visit_summary and any(out.visit_summary.values()):
        summary = {
            key: out.visit_summary.get(key) or ""
            for key in ("symptoms", "duration", "history", "current_meds", "questions", "missing")
        }
        update["result_card"] = {"type": "pre", "visit_summary": summary}
    elif (mode == "post" and (new_items or out.warnings or out.follow_up or out.next_dose_time)) or new_items:
        update["result_card"] = {
            "type": "post",
            "medications": meds_so_far,
            "new_items": new_items,
            "warnings": out.warnings or [],
            "follow_up": out.follow_up or {},
            "next_dose_time": out.next_dose_time or "",
        }
    return update


# ---------------- 图构建 ----------------


def build_graph(env: dict, checkpointer=None):
    g = StateGraph(CompanionState)
    g.add_node("reply", partial(reply_node, env=env))
    g.add_edge(START, "reply")
    g.add_edge("reply", END)
    return g.compile(checkpointer=checkpointer)
