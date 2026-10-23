"""Standalone FastAPI adapter for the EdgeOne companion agent."""
from __future__ import annotations

import asyncio
import json
import os
import time
import urllib.parse
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace

import asyncpg
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from agents.companion.index import handler


def _build_dsn() -> str:
    user = os.environ.get("POSTGRES_USER", "xiaonuan")
    pw = os.environ.get("POSTGRES_PASSWORD", "")
    host = os.environ.get("POSTGRES_HOST", "127.0.0.1")
    port = os.environ.get("POSTGRES_PORT", "5432")
    db = os.environ.get("POSTGRES_DB", "xiaonuan")
    # 仅本机连接，关闭 SSL 握手（sslmode=disable 对 asyncpg / psycopg 都生效）
    return (
        "postgresql://"
        f"{urllib.parse.quote(user, safe='')}:{urllib.parse.quote(pw, safe='')}"
        f"@{host}:{port}/{db}?sslmode=disable"
    )


PG_DSN = _build_dsn()


class PostgresKV:
    """Async KV adapter backed by PostgreSQL.

    Drop-in replacement for the prior SQLite/MySQL KV: preserves the exact
    get/set/delete(key, value, ttl) interface used by agents.companion._users.
    Holds all business data: accounts, sessions, profiles, medications, cards
    and recent chat. The LangGraph conversation checkpoint now also lives in
    PostgreSQL (AsyncPostgresSaver).
    """

    def __init__(self, pool: asyncpg.Pool):
        self.pool = pool

    async def get(self, key):
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT value, expires_at FROM kv WHERE key=$1", key
            )
            if row is None:
                return None
            expires = row["expires_at"]
            if expires is not None and expires <= time.time():
                await conn.execute("DELETE FROM kv WHERE key=$1", key)
                return None
            return json.loads(row["value"])

    async def set(self, key, value, ttl=None):
        expires = time.time() + ttl if ttl else None
        encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        async with self.pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO kv(key, value, expires_at) VALUES($1, $2, $3) "
                "ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, expires_at=EXCLUDED.expires_at",
                key, encoded, expires,
            )

    async def delete(self, key):
        async with self.pool.acquire() as conn:
            await conn.execute("DELETE FROM kv WHERE key=$1", key)


class SseBody:
    def __init__(self, iterator):
        self.iterator = iterator


class CompanionUtils:
    @staticmethod
    def sse(data):
        return f"data: {json.dumps(data, ensure_ascii=False, separators=(',', ':'))}\n\n".encode()

    @staticmethod
    def stream_sse(iterator):
        return SseBody(iterator)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ---- PostgreSQL：业务 KV + LangGraph 会话 checkpoint 均落库 ----
    pg_pool = await asyncpg.create_pool(dsn=PG_DSN, min_size=1, max_size=10)
    async with pg_pool.acquire() as conn:
        await conn.execute(
            "CREATE TABLE IF NOT EXISTS kv ("
            "key TEXT PRIMARY KEY, "
            "value TEXT NOT NULL, "
            "expires_at DOUBLE PRECISION DEFAULT NULL)"
        )

    async with AsyncPostgresSaver.from_conn_string(PG_DSN) as saver:
        await saver.setup()
        app.state.checkpointer = saver
        app.state.kv = PostgresKV(pg_pool)
        app.state.pg_pool = pg_pool
        try:
            yield
        finally:
            await pg_pool.close()


app = FastAPI(title="Xiaonuan Companion", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"ok": True}


@app.post("/companion")
async def companion(request: Request):
    body = await request.json()
    query = request.query_params
    local_request = SimpleNamespace(body=body, query=query, signal=asyncio.Event())
    context = SimpleNamespace(
        request=local_request,
        env=dict(os.environ),
        kv=app.state.kv,
        store=SimpleNamespace(langgraph_checkpointer=app.state.checkpointer),
        utils=CompanionUtils(),
    )
    result = await handler(context)
    if isinstance(result, SseBody):
        return StreamingResponse(
            result.iterator,
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
        )
    if isinstance(result, tuple) and len(result) == 2:
        payload, status = result
        return JSONResponse(payload, status_code=status)
    return JSONResponse(result)
