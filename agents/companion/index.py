# 陪诊小暖业务入口：文本处理、结构化卡片与用户系统；实时语音由 Node WebSocket 入口承接
import json
import re
import time
import uuid
from datetime import datetime

from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage

from . import _users
from ._graph import build_graph
from ._vision import parse_medication_photo

DEMO_PATIENT = {"称呼": "叔叔阿姨"}

# 老人常以呼唤开头（"小暖，我今天头晕"），剥掉称呼让识别更稳
_WAKE_RE = re.compile(r"^(?:喂|嘿|哎|你好|您好|哈喽)*(?:小暖|暖暖|小暖暖|小小暖)[,，。!！?？~、\s]*")


async def handler(ctx):
    body = ctx.request.body or {}
    action = body.get("action") or ctx.request.query.get("action") or ""
    token = (body.get("token") or "").strip()

    # ---- 能力探测：前端据此决定是否降级演示模式（无需登录）----
    if action == "caps":
        return {"realtime": bool(ctx.env.get("DOUBAO_REALTIME_API_KEY")), "agent": bool(ctx.env.get("MIMO_API_KEY"))}

    # ---- 注册 / 登录 / 退出 ----
    if action == "register":
        username = (body.get("username") or "").strip()
        tok, err = await _users.register(ctx, username, body.get("password") or "")
        if err:
            return {"error": err}, 400
        return {"token": tok, "username": username, "cid": _users.conv_id(username)}

    if action == "login":
        username = (body.get("username") or "").strip()
        tok, err = await _users.login(ctx, username, body.get("password") or "")
        if err:
            return {"error": err}, 400
        return {"token": tok, "username": username, "cid": _users.conv_id(username)}

    if action == "logout":
        await _users.logout(ctx, token)
        return {"ok": True}

    # ---- 以下全部要求登录：数据按用户彻底隔离，多人共用不串号 ----
    username = await _users.username_of(ctx, token)
    if not username:
        return {"error": "请先登录"}, 401

    # WebSocket 语音代理只需验证登录态，不返回个人档案或记忆数据。
    if action == "auth_check":
        return {"ok": True}

    # ---- 记忆面板：查看小暖保存的记忆 ----
    if action == "memory":
        mem = await _users.load_memory(ctx, username)
        mem["username"] = username
        return mem

    # ---- 语音会话上下文：让端到端语音模型带上用户用药/档案，理解并操作 ----
    if action == "voice_context":
        mem = await _users.load_memory(ctx, username)
        now = datetime.now()
        today = now.strftime("%Y-%m-%d")
        meds = mem.get("medications") or []
        meds_out = []
        for m in meds:
            if not isinstance(m, dict) or not m.get("name"):
                continue
            times = [str(t) for t in (m.get("reminder_times") or []) if re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", str(t))]
            log = m.get("taken_log") or []
            status = {}
            for t in times:
                entry = next((e for e in log if isinstance(e, dict) and e.get("date") == today and e.get("time") == t), None)
                status[t] = entry.get("status") if isinstance(entry, dict) and entry.get("status") in ("taken", "skipped") else "pending"
            meds_out.append({
                "name": m["name"],
                "dosage": (m.get("dosage") or "").strip(),
                "frequency": (m.get("frequency") or "").strip(),
                "reminder_times": times,
                "today_status": status,
            })
        return {
            "now": now.strftime("%H:%M"),
            "today": today,
            "profile": _safe_profile(mem.get("profile")),
            "medications": meds_out,
        }

    # ---- 标记某顿药已服/跳过：语音模型调用，可靠落库，不走模糊解析 ----
    if action == "medication_taken":
        name = (body.get("med_name") or "").strip()
        dose_time = (body.get("dose_time") or "").strip()
        status = (body.get("status") or "taken").strip()
        if status not in ("taken", "skipped"):
            status = "taken"
        if not name or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", dose_time):
            return {"error": "请说明是哪一顿药、几点"}, 400
        mem = await _users.load_memory(ctx, username)
        meds = mem.get("medications") or []
        target = next((m for m in meds if isinstance(m, dict) and m.get("name") == name), None)
        if not target:
            return {"error": f"没找到「{name}」的用药记录"}, 404
        today = datetime.now().strftime("%Y-%m-%d")
        log = [e for e in (target.get("taken_log") or []) if isinstance(e, dict)]
        log = [e for e in log if not (e.get("date") == today and e.get("time") == dose_time)]
        log.append({"date": today, "time": dose_time, "status": status, "at": int(time.time())})
        target["taken_log"] = log[-60:]
        await _users.save_memory(ctx, username, medications=meds, replace_medications=False)
        label = "记下了，这顿吃过了" if status == "taken" else "好的，这顿先不吃了"
        return {"ok": True, "med_name": name, "dose_time": dose_time, "status": status, "message": label}

    # ---- 一键清空记忆 ----
    if action == "memory_clear":
        await _users.clear_memory(ctx, username)
        return {"ok": True}

    if action == "memory_item_delete":
        try:
            await _users.delete_memory_item(
                ctx, username,
                category=body.get("category") or "",
                index=body.get("index"),
                key=body.get("key"),
                expected=body.get("expected"),
            )
        except ValueError as e:
            return {"error": str(e)}, 400
        return {"ok": True}

        # ---- 记忆保存：前端编辑健康档案 / 用药记录 ----
    if action == "memory_save":
        data = body.get("memory") or {}
        if not isinstance(data, dict):
            return {"error": "memory 格式不对"}, 400
        meds = data.get("medications")
        if meds is not None and not isinstance(meds, list):
            return {"error": "medications 格式不对"}, 400
        cards = data.get("cards")
        if cards is not None and (not isinstance(cards, list) or len(cards) > 5):
            return {"error": "卡片格式不对"}, 400
        await _users.save_memory(
            ctx, username,
            profile=_safe_profile(data.get("profile")) if "profile" in data else None,
            medications=meds,
            cards=cards,
            replace_medications=True,
        )
        return {"ok": True}

    # ---- 拍照整理医嘱：只识别候选内容，不自动写入或设置提醒 ----
    if action == "medication_photo_parse":
        try:
            result = await parse_medication_photo(
                ctx.env,
                body.get("image") or "",
                body.get("mime") or "",
            )
        except ValueError as e:
            return {"error": str(e)}, 422
        return result

    message = (body.get("message") or "").strip()

    if not message:
        return {"error": "请提供需要整理的文字"}, 400

    heard = message
    cleaned = _WAKE_RE.sub("", message).strip()
    if cleaned:
        message = cleaned                # 传给模型的指令去掉唤醒称呼

    # 已去掉就诊前/就诊后模式：完全按用户当次意图自动处理（后端图内自行判断）
    effective_mode = "auto"

    # 凭据校验
    if not ctx.env.get("MIMO_API_KEY"):
        return {"error": "模型服务未配置（MIMO_API_KEY）"}, 500

    # 档案和用药记录从当前登录账号的服务端记忆读取，避免共享设备上的本地数据串号。
    user_memory = await _users.load_memory(ctx, username)
    patient = _safe_profile(user_memory.get("profile"))

    checkpointer = getattr(ctx.store, "langgraph_checkpointer", None) if ctx.store else None
    graph = build_graph(ctx.env, checkpointer=checkpointer)
    # 每个用户一条独立会话线：对话历史、问诊进度、记忆互不串扰
    thread_id = _users.conv_id(username)

    async def gen():
        t_req = time.perf_counter()
        yield ctx.utils.sse({"type": "mode", "mode": effective_mode})
        collected = []   # 本轮 AI 回复原文（记忆用）
        cards_seen = []  # 本轮生成的卡片
        meds_seen = None
        profile_updates_seen = {}

        reply_streamed = False  # reply 节点是否已按 token 流过（兜底判断用）

        # 图输入：带上已保存的用药清单，让模型知道之前的记录
        existing_meds = user_memory.get("medications") or []

        async def stream_graph(tid: str):
            nonlocal meds_seen, profile_updates_seen, reply_streamed
            async for payload in graph.astream(
                {
                    "messages": [HumanMessage(content=message)],
                    "patient": patient,
                    "medications": existing_meds,
                    "mode": effective_mode,
                    "profile_updates": {},
                },
                config={"configurable": {"thread_id": tid}},
                stream_mode=["messages", "updates"],
            ):
                if ctx.request.signal.is_set():
                    break
                # 多模式流的载荷格式随 langgraph 版本而变，两种都要认：
                #   新版：("messages"|"updates", 数据)；旧版：messages -> (消息, 元数据)，updates -> {节点: 增量}
                ch_mode = None
                if isinstance(payload, tuple) and len(payload) == 2 and isinstance(payload[0], str):
                    ch_mode, payload = payload
                is_msg = ch_mode == "messages" or (
                    ch_mode is None and isinstance(payload, tuple) and len(payload) == 2
                )
                if is_msg:
                    # messages 通道：(消息块, 元数据)。只转发病程节点的 AI 文本 token 块；
                    # 分类/结构化节点（triage/pre/post）的原始输出一律不透传；
                    # 节点收尾回吐的整条消息（AIMessage，非 chunk）也跳过：内容已随 token 流过，
                    # 防整句重复播报；messages 通道整体不可用时由 updates 的整条消息兜底。
                    if not (isinstance(payload, tuple) and len(payload) == 2):
                        continue
                    m, meta = payload
                    if not (isinstance(meta, dict) and meta.get("langgraph_node") == "reply"):
                        continue
                    # 只认流式 token 块。注意：langchain-core 1.x 的 AIMessageChunk.type 是
                    # "AIMessageChunk" 而不是 "ai"，不能按 type 字符串判，用 isinstance
                    if not isinstance(m, AIMessageChunk) or getattr(m, "tool_calls", None):
                        continue
                    content = m.content if isinstance(m.content, str) else json.dumps(m.content, ensure_ascii=False)
                    if content.strip():
                        reply_streamed = True
                        collected.append(content)
                        yield ctx.utils.sse({"type": "ai_response", "content": content})
                    continue
                # updates 模式：{节点: 增量}
                for node, delta in (payload or {}).items():
                    if not delta:
                        continue
                    card = delta.get("result_card")
                    if card:
                        cards_seen.append(card)
                        yield ctx.utils.sse({"type": "card", "node": node, "data": card})
                    ms = delta.get("medications")
                    if ms and isinstance(ms, list):
                        meds_seen = ms
                    profile_updates = delta.get("profile_updates")
                    if isinstance(profile_updates, dict):
                        profile_updates_seen.update(profile_updates)
                    if node == "reply" and reply_streamed:
                        continue  # 文本已随 token 流过，跳过整段防重复
                    for m in (delta.get("messages") or []):
                        if not isinstance(m, AIMessage) or getattr(m, "tool_calls", None):
                            continue
                        content = m.content if isinstance(m.content, str) else json.dumps(m.content, ensure_ascii=False)
                        if content.strip():
                            collected.append(content)
                            yield ctx.utils.sse({"type": "ai_response", "content": content})

        got = False
        t_first = None
        try:
            async for chunk in stream_graph(thread_id):
                got = True
                if t_first is None:
                    t_first = time.perf_counter()
                yield chunk
        except Exception as e:
            import traceback
            traceback.print_exc()
            if ctx.request.signal.is_set():
                pass
            elif got:
                # 中途才出错：直接告诉老人出了小状况
                yield ctx.utils.sse({"type": "error_message", "content": f"哎呀，小暖这边出了点小状况：{e}"})
            else:
                # 部署更新或请求中断会让旧会话的 checkpoint 失配（pending writes corrupt/incompatible），
                # 换一个全新 thread 重试一次：牺牲旧上下文换可用性
                collected.clear()
                cards_seen.clear()
                meds_seen = None
                try:
                    async for chunk in stream_graph(f"{thread_id}-r{uuid.uuid4().hex[:6]}"):
                        yield chunk
                except Exception as e2:
                    yield ctx.utils.sse({"type": "error_message", "content": f"哎呀，小暖这边出了点小状况：{e2}"})

        # 落记忆：只写入本轮 AI 整理出的结构化信息（档案/用药/卡片），
        # 不存对话原文——记忆面板用于回看整理结果，不当聊天记录。
        if not ctx.request.signal.is_set():
            await _users.save_memory(
                ctx,
                username,
                profile_updates=_safe_profile(profile_updates_seen),
                medications=meds_seen,
                cards=cards_seen,
            )
        _first_ms = int((t_first - t_req) * 1000) if t_first else -1
        print(f"[latency] first={_first_ms}ms total={int((time.perf_counter() - t_req) * 1000)}ms heard={heard[:12]!r}", flush=True)
        yield ctx.utils.sse({"type": "ping", "ts": int(time.time() * 1000)})
        yield b"data: [DONE]\n\n"

    return ctx.utils.stream_sse(gen())


def _safe_profile(profile: dict) -> dict:
    """只保留短字符串和简单列表，限制档案输入体积。"""
    if not isinstance(profile, dict):
        return {}
    keep = {}
    for k, v in profile.items():
        if isinstance(v, str) and v.strip():
            keep[str(k)[:20]] = v.strip()[:300]
        elif isinstance(v, list) and v and all(isinstance(x, (str, int, float)) for x in v):
            keep[str(k)[:20]] = [str(x)[:100] for x in v[:8]]
    return keep
