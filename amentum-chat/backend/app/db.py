"""SQLite persistence for conversations, messages, files and token usage.

SQLite keeps the deployment footprint to a single container volume. The
repository-style functions below are the only place SQL lives, so swapping in
Azure SQL / PostgreSQL later only touches this module.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from .config import get_settings

_SCHEMA = """
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    user TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'New chat',
    model TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    container_id TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_conv_user ON conversations(user, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    parts TEXT NOT NULL DEFAULT '[]',
    attachments TEXT NOT NULL DEFAULT '[]',
    usage TEXT,
    model TEXT,
    status TEXT NOT NULL DEFAULT 'complete',
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_msg_conv ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    conversation_id TEXT,
    user TEXT NOT NULL,
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    path TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'upload',
    sandbox_path TEXT,
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_files_conv ON files(conversation_id);

CREATE TABLE IF NOT EXISTS usage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at REAL NOT NULL,
    user TEXT NOT NULL,
    conversation_id TEXT,
    message_id TEXT,
    model TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'chat',
    input_tokens INTEGER NOT NULL DEFAULT 0,
    cached_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    reasoning_tokens INTEGER NOT NULL DEFAULT 0,
    calls INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_usage_time ON usage_events(created_at);
CREATE INDEX IF NOT EXISTS ix_usage_user ON usage_events(user, created_at);
"""


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:20]}"


class Database:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._conn.executescript(_SCHEMA)

    # ---- low level -------------------------------------------------------------------
    def _exec(self, sql: str, params: tuple | dict = ()) -> sqlite3.Cursor:
        with self._lock:
            return self._conn.execute(sql, params)

    def _one(self, sql: str, params: tuple | dict = ()) -> dict | None:
        with self._lock:
            row = self._conn.execute(sql, params).fetchone()
        return dict(row) if row else None

    def _all(self, sql: str, params: tuple | dict = ()) -> list[dict]:
        with self._lock:
            return [dict(r) for r in self._conn.execute(sql, params).fetchall()]

    # ---- conversations ---------------------------------------------------------------
    def create_conversation(self, user: str, model: str, title: str = "New chat") -> dict:
        now = time.time()
        cid = new_id("conv")
        self._exec(
            "INSERT INTO conversations (id, user, title, model, created_at, updated_at) VALUES (?,?,?,?,?,?)",
            (cid, user, title, model, now, now),
        )
        return self.get_conversation(cid, user)  # type: ignore[return-value]

    def get_conversation(self, cid: str, user: str | None = None) -> dict | None:
        if user is None:
            return self._one("SELECT * FROM conversations WHERE id=?", (cid,))
        return self._one("SELECT * FROM conversations WHERE id=? AND user=?", (cid, user))

    def list_conversations(self, user: str, q: str = "", limit: int = 200) -> list[dict]:
        sql = """
            SELECT c.*,
                   COALESCE((SELECT SUM(cost_usd) FROM usage_events u WHERE u.conversation_id=c.id), 0) AS cost_usd
            FROM conversations c WHERE c.user=?
        """
        params: list[Any] = [user]
        if q:
            sql += " AND (c.title LIKE ? OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id=c.id AND m.content LIKE ?))"
            params += [f"%{q}%", f"%{q}%"]
        sql += " ORDER BY c.pinned DESC, c.updated_at DESC LIMIT ?"
        params.append(limit)
        return self._all(sql, tuple(params))

    def update_conversation(self, cid: str, **fields: Any) -> None:
        allowed = {"title", "model", "pinned", "container_id", "updated_at"}
        sets = {k: v for k, v in fields.items() if k in allowed}
        if not sets:
            return
        cols = ", ".join(f"{k}=?" for k in sets)
        self._exec(f"UPDATE conversations SET {cols} WHERE id=?", (*sets.values(), cid))

    def touch_conversation(self, cid: str) -> None:
        self.update_conversation(cid, updated_at=time.time())

    def delete_conversation(self, cid: str) -> list[str]:
        """Delete a conversation; returns on-disk file paths the caller should remove."""
        paths = [r["path"] for r in self._all("SELECT path FROM files WHERE conversation_id=?", (cid,))]
        with self._lock:
            self._conn.execute("DELETE FROM messages WHERE conversation_id=?", (cid,))
            self._conn.execute("DELETE FROM files WHERE conversation_id=?", (cid,))
            self._conn.execute("DELETE FROM conversations WHERE id=?", (cid,))
        return paths

    # ---- messages -------------------------------------------------------------------------
    def add_message(
        self,
        conversation_id: str,
        role: str,
        content: str = "",
        parts: list | None = None,
        attachments: list | None = None,
        usage: dict | None = None,
        model: str | None = None,
        status: str = "complete",
        message_id: str | None = None,
    ) -> dict:
        mid = message_id or new_id("msg")
        self._exec(
            "INSERT INTO messages (id, conversation_id, role, content, parts, attachments, usage, model, status, created_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)",
            (
                mid,
                conversation_id,
                role,
                content,
                json.dumps(parts or []),
                json.dumps(attachments or []),
                json.dumps(usage) if usage else None,
                model,
                status,
                time.time(),
            ),
        )
        return {"id": mid}

    def update_message(self, mid: str, **fields: Any) -> None:
        enc = {}
        for k, v in fields.items():
            if k in ("parts", "attachments", "usage"):
                enc[k] = json.dumps(v) if v is not None else None
            elif k in ("content", "status", "model"):
                enc[k] = v
        if enc:
            cols = ", ".join(f"{k}=?" for k in enc)
            self._exec(f"UPDATE messages SET {cols} WHERE id=?", (*enc.values(), mid))

    def list_messages(self, conversation_id: str) -> list[dict]:
        rows = self._all("SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at, rowid", (conversation_id,))
        for r in rows:
            r["parts"] = json.loads(r["parts"] or "[]")
            r["attachments"] = json.loads(r["attachments"] or "[]")
            r["usage"] = json.loads(r["usage"]) if r["usage"] else None
        return rows

    def delete_messages_from(self, conversation_id: str, message_id: str) -> None:
        """Delete a message and everything after it (used by regenerate / edit)."""
        row = self._one("SELECT created_at FROM messages WHERE id=? AND conversation_id=?", (message_id, conversation_id))
        if row:
            self._exec(
                "DELETE FROM messages WHERE conversation_id=? AND created_at>=?", (conversation_id, row["created_at"])
            )

    # ---- files ----------------------------------------------------------------------------
    def add_file(
        self,
        user: str,
        name: str,
        mime: str,
        size: int,
        path: str,
        source: str = "upload",
        conversation_id: str | None = None,
        sandbox_path: str | None = None,
        file_id: str | None = None,
    ) -> dict:
        fid = file_id or new_id("file")
        self._exec(
            "INSERT INTO files (id, conversation_id, user, name, mime, size, path, source, sandbox_path, created_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)",
            (fid, conversation_id, user, name, mime, size, path, source, sandbox_path, time.time()),
        )
        return self.get_file(fid)  # type: ignore[return-value]

    def get_file(self, fid: str) -> dict | None:
        return self._one("SELECT * FROM files WHERE id=?", (fid,))

    def list_files(self, conversation_id: str) -> list[dict]:
        return self._all("SELECT * FROM files WHERE conversation_id=? ORDER BY created_at", (conversation_id,))

    def update_file(self, fid: str, **fields: Any) -> None:
        allowed = {"conversation_id", "sandbox_path"}
        sets = {k: v for k, v in fields.items() if k in allowed}
        if sets:
            cols = ", ".join(f"{k}=?" for k in sets)
            self._exec(f"UPDATE files SET {cols} WHERE id=?", (*sets.values(), fid))

    # ---- usage ----------------------------------------------------------------------------
    def record_usage(
        self,
        user: str,
        model: str,
        usage: dict,
        conversation_id: str | None = None,
        message_id: str | None = None,
        kind: str = "chat",
        duration_ms: int = 0,
    ) -> None:
        self._exec(
            "INSERT INTO usage_events (created_at, user, conversation_id, message_id, model, kind, input_tokens,"
            " cached_tokens, output_tokens, reasoning_tokens, calls, cost_usd, duration_ms)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                time.time(),
                user,
                conversation_id,
                message_id,
                model,
                kind,
                usage.get("input_tokens", 0),
                usage.get("cached_tokens", 0),
                usage.get("output_tokens", 0),
                usage.get("reasoning_tokens", 0),
                usage.get("calls", 0),
                usage.get("cost_usd", 0.0),
                duration_ms,
            ),
        )

    def usage_summary(self, user: str | None, days: int = 30) -> dict:
        since = time.time() - days * 86400
        where = "WHERE created_at>=?"
        params: list[Any] = [since]
        if user is not None:
            where += " AND user=?"
            params.append(user)
        agg = """COUNT(DISTINCT COALESCE(message_id, id)) AS requests, SUM(input_tokens) AS input_tokens,
                 SUM(cached_tokens) AS cached_tokens, SUM(output_tokens) AS output_tokens,
                 SUM(reasoning_tokens) AS reasoning_tokens, SUM(cost_usd) AS cost_usd, SUM(calls) AS calls"""
        totals = self._one(f"SELECT {agg} FROM usage_events {where}", tuple(params)) or {}
        by_model = self._all(f"SELECT model, {agg} FROM usage_events {where} GROUP BY model ORDER BY cost_usd DESC", tuple(params))
        by_day = self._all(
            f"SELECT date(created_at, 'unixepoch', 'localtime') AS day, {agg} FROM usage_events {where}"
            " GROUP BY day ORDER BY day",
            tuple(params),
        )
        by_user = []
        if user is None:
            by_user = self._all(
                f"SELECT user, {agg} FROM usage_events {where} GROUP BY user ORDER BY cost_usd DESC LIMIT 50",
                tuple(params),
            )
        clean = lambda d: {k: (v or 0) if k not in ("model", "day", "user") else v for k, v in d.items()}  # noqa: E731
        return {
            "days": days,
            "totals": clean(totals),
            "by_model": [clean(r) for r in by_model],
            "by_day": [clean(r) for r in by_day],
            "by_user": [clean(r) for r in by_user],
        }


_db: Database | None = None


def get_db() -> Database:
    global _db
    if _db is None:
        _db = Database(get_settings().data_path / "amentum_chat.db")
    return _db


def reset_db_for_tests(path: Path) -> Database:
    global _db
    _db = Database(path)
    return _db
