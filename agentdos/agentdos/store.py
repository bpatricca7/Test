"""SQLite-backed task store for AGENTDOS.

All board state lives here: tasks, the per-task activity log ("events"), and
the agents that have checked in. Every mutation runs in a single locked
transaction, which is what makes claiming a task atomic: two agents asking
for the next task at the same moment can never both get it.

Task lifecycle::

    todo ──claim──▶ doing ──complete──▶ review ──approve──▶ done
      ▲               │  ╲                  │
      │            release  block           reject
      │               │      ╲              │
      └───────────────┴── blocked ◀─────────┘ (back to todo)
                         (reply)

A claim is a *lease*. If the agent stops heartbeating (any progress log
counts), the lease expires and the task returns to the queue.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterable, Iterator

STATUSES = ("todo", "doing", "blocked", "review", "done")
PRIORITIES = ("low", "normal", "high", "urgent")
HUMAN = "human"

DEFAULT_LEASE = 15 * 60
MIN_LEASE = 30
MAX_LEASE = 24 * 3600
AGENT_IDLE_AFTER = 10 * 60  # seconds without contact before an agent shows as offline
DONE_SHOWN = 100  # most recent done tasks returned on the board

MAX_TITLE = 200
MAX_DESCRIPTION = 20_000
MAX_RESULT = 100_000
MAX_MESSAGE = 8_000
MAX_TAGS = 8

NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._@-]{0,39}$")
TAG_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,23}$")

PRIORITY_ALIASES = {
    "low": 0, "lo": 0, "p3": 0,
    "normal": 1, "norm": 1, "med": 1, "medium": 1, "p2": 1,
    "high": 2, "hi": 2, "p1": 2,
    "urgent": 3, "crit": 3, "critical": 3, "p0": 3,
}


class StoreError(Exception):
    """Base error; ``status`` doubles as the HTTP status code."""

    status = 400


class NotFound(StoreError):
    status = 404


class Conflict(StoreError):
    status = 409


# ── helpers ──────────────────────────────────────────────────────────────────

def iso(ts: float | None) -> str | None:
    if ts is None:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _text(value: Any, field: str, limit: int, required: bool = False) -> str:
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise StoreError(f"{field} must be a string")
    value = value.replace("\r\n", "\n").strip()
    if required and not value:
        raise StoreError(f"{field} is required")
    if len(value) > limit:
        raise StoreError(f"{field} is too long (max {limit} characters)")
    return value


def norm_priority(value: Any) -> int:
    if value is None or value == "":
        return 1
    if isinstance(value, bool):
        raise StoreError("priority must be one of: " + ", ".join(PRIORITIES))
    if isinstance(value, int) and 0 <= value <= 3:
        return value
    if isinstance(value, str) and value.strip().lower() in PRIORITY_ALIASES:
        return PRIORITY_ALIASES[value.strip().lower()]
    raise StoreError("priority must be one of: " + ", ".join(PRIORITIES))


def norm_tags(value: Any) -> list[str]:
    if value is None or value == "":
        return []
    if isinstance(value, str):
        value = re.split(r"[\s,]+", value)
    if not isinstance(value, (list, tuple)):
        raise StoreError("tags must be a list of strings")
    tags: list[str] = []
    for raw in value:
        if not isinstance(raw, str):
            raise StoreError("tags must be a list of strings")
        tag = raw.strip().lstrip("#").lower()
        if not tag:
            continue
        if not TAG_RE.match(tag):
            raise StoreError(f"invalid tag {raw!r} (letters, digits, . _ - ; max 24 chars)")
        if tag not in tags:
            tags.append(tag)
    if len(tags) > MAX_TAGS:
        raise StoreError(f"at most {MAX_TAGS} tags per task")
    return tags


def norm_assignee(value: Any) -> str | None:
    """None means "any agent"; "human" means the board owner only."""
    if value is None:
        return None
    if not isinstance(value, str):
        raise StoreError("assignee must be a string")
    value = value.strip().lstrip("@")
    if value.lower() in ("", "any", "*", "agent", "agents"):
        return None
    if value.lower() in ("human", "me", "you", "owner"):
        return HUMAN
    if not NAME_RE.match(value):
        raise StoreError(f"invalid assignee {value!r}")
    return value


def norm_agent(value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        raise StoreError("agent name required (send an X-Agent header or an 'agent' field)")
    value = value.strip()
    if not NAME_RE.match(value):
        raise StoreError(f"invalid agent name {value!r} (letters, digits, . _ - @ ; max 40 chars)")
    if value.lower() == HUMAN:
        raise StoreError("'human' is reserved for the board owner")
    return value


def norm_actor(value: Any) -> str:
    if value is None or (isinstance(value, str) and not value.strip()):
        return HUMAN
    if isinstance(value, str) and value.strip().lower() == HUMAN:
        return HUMAN
    return norm_agent(value)


def norm_lease(value: Any) -> int:
    if value is None or value == "":
        return DEFAULT_LEASE
    try:
        seconds = int(value)
    except (TypeError, ValueError):
        raise StoreError("lease_seconds must be an integer") from None
    return max(MIN_LEASE, min(MAX_LEASE, seconds))


def norm_bool(value: Any, field: str) -> bool:
    if isinstance(value, bool):
        return value
    if value in (0, 1):
        return bool(value)
    raise StoreError(f"{field} must be true or false")


def norm_status(value: Any) -> str:
    if isinstance(value, str) and value.strip().lower() in STATUSES:
        return value.strip().lower()
    raise StoreError("status must be one of: " + ", ".join(STATUSES))


def _task(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "title": row["title"],
        "description": row["description"],
        "status": row["status"],
        "priority": PRIORITIES[row["priority"]],
        "assignee": row["assignee"],
        "tags": json.loads(row["tags"]),
        "review": bool(row["review"]),
        "claimed_by": row["claimed_by"],
        "claimed_at": iso(row["claimed_at"]),
        "lease_expires": iso(row["lease_expires"]),
        "question": row["question"],
        "result": row["result"],
        "created_by": row["created_by"],
        "created_at": iso(row["created_at"]),
        "updated_at": iso(row["updated_at"]),
        "completed_at": iso(row["completed_at"]),
    }


def _event(row: sqlite3.Row) -> dict[str, Any]:
    out = {
        "id": row["id"],
        "task_id": row["task_id"],
        "ts": iso(row["ts"]),
        "actor": row["actor"],
        "kind": row["kind"],
        "message": row["message"],
    }
    if "task_title" in row.keys():
        out["task_title"] = row["task_title"]
    return out


SCHEMA = """
CREATE TABLE IF NOT EXISTS tasks (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    title         TEXT    NOT NULL,
    description   TEXT    NOT NULL DEFAULT '',
    status        TEXT    NOT NULL DEFAULT 'todo',
    priority      INTEGER NOT NULL DEFAULT 1,
    assignee      TEXT,
    tags          TEXT    NOT NULL DEFAULT '[]',
    review        INTEGER NOT NULL DEFAULT 1,
    claimed_by    TEXT,
    claimed_at    REAL,
    lease_expires REAL,
    question      TEXT,
    result        TEXT,
    created_by    TEXT    NOT NULL DEFAULT 'human',
    created_at    REAL    NOT NULL,
    updated_at    REAL    NOT NULL,
    completed_at  REAL
);
CREATE INDEX IF NOT EXISTS tasks_status ON tasks(status);
CREATE TABLE IF NOT EXISTS events (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id  INTEGER,
    ts       REAL    NOT NULL,
    actor    TEXT    NOT NULL,
    kind     TEXT    NOT NULL,
    message  TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS events_task ON events(task_id);
CREATE TABLE IF NOT EXISTS agents (
    name       TEXT PRIMARY KEY,
    first_seen REAL NOT NULL,
    last_seen  REAL NOT NULL
);
"""

TASK_FIELDS = ("title", "description", "priority", "assignee", "tags", "review", "status")


class Store:
    def __init__(self, path: str, clock=time.time):
        self.path = path
        self.clock = clock
        if path != ":memory:":
            os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        self._lock = threading.RLock()
        self._cond = threading.Condition(self._lock)
        self.version = 0
        self._db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._db.row_factory = sqlite3.Row
        if path != ":memory:":
            self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA busy_timeout=5000")
        self._db.executescript(SCHEMA)

    def close(self) -> None:
        with self._lock:
            self._db.close()

    # ── plumbing ─────────────────────────────────────────────────────────────

    @contextmanager
    def _tx(self) -> Iterator[sqlite3.Cursor]:
        """Locked write transaction. Bumps the version (waking SSE streams) on commit."""
        with self._lock:
            cur = self._db.cursor()
            cur.execute("BEGIN IMMEDIATE")
            try:
                yield cur
            except BaseException:
                cur.execute("ROLLBACK")
                raise
            cur.execute("COMMIT")
            self._bump()

    def _bump(self) -> None:
        with self._cond:
            self.version += 1
            self._cond.notify_all()

    def wake_all(self) -> None:
        """Wake every waiter (used on shutdown)."""
        with self._cond:
            self._cond.notify_all()

    def wait_for_change(self, since: int, timeout: float) -> int:
        with self._cond:
            if self.version == since:
                self._cond.wait(timeout)
            return self.version

    def _log(self, cur: sqlite3.Cursor, task_id: int | None, actor: str, kind: str, message: str = "") -> None:
        cur.execute(
            "INSERT INTO events (task_id, ts, actor, kind, message) VALUES (?, ?, ?, ?, ?)",
            (task_id, self.clock(), actor, kind, message),
        )

    def _row(self, cur: sqlite3.Cursor, task_id: int) -> sqlite3.Row:
        row = cur.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if row is None:
            raise NotFound(f"task #{task_id} not found")
        return row

    def _touch(self, cur: sqlite3.Cursor, agent: str) -> None:
        now = self.clock()
        cur.execute(
            "INSERT INTO agents (name, first_seen, last_seen) VALUES (?, ?, ?) "
            "ON CONFLICT(name) DO UPDATE SET last_seen = excluded.last_seen",
            (agent, now, now),
        )

    def _sweep(self, cur: sqlite3.Cursor) -> int:
        now = self.clock()
        rows = cur.execute(
            "SELECT id, claimed_by FROM tasks WHERE status = 'doing' "
            "AND lease_expires IS NOT NULL AND lease_expires < ?",
            (now,),
        ).fetchall()
        for row in rows:
            cur.execute(
                "UPDATE tasks SET status = 'todo', claimed_by = NULL, claimed_at = NULL, "
                "lease_expires = NULL, updated_at = ? WHERE id = ?",
                (now, row["id"]),
            )
            self._log(cur, row["id"], "system", "expired",
                      f"{row['claimed_by']} went quiet; lease expired, task is back in the queue")
        return len(rows)

    def sweep(self) -> int:
        """Return expired leases to the queue. Cheap when nothing has expired."""
        with self._lock:
            hit = self._db.execute(
                "SELECT 1 FROM tasks WHERE status = 'doing' AND lease_expires IS NOT NULL "
                "AND lease_expires < ? LIMIT 1",
                (self.clock(),),
            ).fetchone()
            if not hit:
                return 0
            with self._tx() as cur:
                return self._sweep(cur)

    # ── reads ────────────────────────────────────────────────────────────────

    def get_task(self, task_id: int, events: bool = True) -> dict[str, Any]:
        self.sweep()
        with self._lock:
            cur = self._db.cursor()
            task = _task(self._row(cur, task_id))
            if events:
                task["events"] = [
                    _event(r) for r in cur.execute(
                        "SELECT * FROM events WHERE task_id = ? ORDER BY id", (task_id,)
                    )
                ]
            return task

    def list_tasks(
        self,
        status: str | Iterable[str] | None = None,
        assignee: str | None = None,
        tag: str | None = None,
        available_for: str | None = None,
        query: str | None = None,
        limit: int = 500,
    ) -> list[dict[str, Any]]:
        self.sweep()
        where, args = [], []
        if status:
            statuses = [status] if isinstance(status, str) else list(status)
            statuses = [norm_status(s) for s in statuses]
            where.append("status IN (%s)" % ",".join("?" * len(statuses)))
            args += statuses
        if assignee is not None:
            a = norm_assignee(assignee)
            if a is None:
                where.append("assignee IS NULL")
            else:
                where.append("assignee = ?")
                args.append(a)
        if available_for:
            agent = norm_agent(available_for)
            where.append("status = 'todo' AND (assignee IS NULL OR assignee = ?)")
            args.append(agent)
        if query:
            where.append("(title LIKE ? OR description LIKE ?)")
            args += [f"%{query}%"] * 2
        sql = "SELECT * FROM tasks"
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY priority DESC, id ASC LIMIT ?"
        args.append(max(1, min(int(limit), 2000)))
        with self._lock:
            tasks = [_task(r) for r in self._db.execute(sql, args)]
        if tag:
            wanted = norm_tags(tag)
            tasks = [t for t in tasks if set(wanted) & set(t["tags"])]
        return tasks

    def events(self, limit: int = 60, since_id: int = 0) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._db.execute(
                "SELECT e.*, t.title AS task_title FROM events e LEFT JOIN tasks t ON t.id = e.task_id "
                "WHERE e.id > ? ORDER BY e.id DESC LIMIT ?",
                (since_id, max(1, min(int(limit), 500))),
            ).fetchall()
        return [_event(r) for r in reversed(rows)]

    def agents(self) -> list[dict[str, Any]]:
        now = self.clock()
        with self._lock:
            rows = self._db.execute("SELECT * FROM agents ORDER BY last_seen DESC LIMIT 50").fetchall()
            working: dict[str, list[int]] = {}
            for r in self._db.execute(
                "SELECT id, claimed_by FROM tasks WHERE status = 'doing' AND claimed_by IS NOT NULL ORDER BY claimed_at"
            ):
                working.setdefault(r["claimed_by"], []).append(r["id"])
        out = []
        for r in rows:
            tasks = working.get(r["name"], [])
            if tasks:
                state = "working"
            elif now - r["last_seen"] < AGENT_IDLE_AFTER:
                state = "idle"
            else:
                state = "offline"
            out.append({
                "name": r["name"],
                "state": state,
                "tasks": tasks,
                "first_seen": iso(r["first_seen"]),
                "last_seen": iso(r["last_seen"]),
            })
        return out

    def board(self) -> dict[str, Any]:
        self.sweep()
        with self._lock:
            open_rows = self._db.execute(
                "SELECT * FROM tasks WHERE status != 'done' ORDER BY priority DESC, id ASC"
            ).fetchall()
            done_rows = self._db.execute(
                "SELECT * FROM tasks WHERE status = 'done' ORDER BY completed_at DESC, id DESC LIMIT ?",
                (DONE_SHOWN,),
            ).fetchall()
            counts = {s: 0 for s in STATUSES}
            for r in self._db.execute("SELECT status, COUNT(*) AS n FROM tasks GROUP BY status"):
                counts[r["status"]] = r["n"]
            version = self.version
        return {
            "version": version,
            "now": iso(self.clock()),
            "counts": counts,
            "tasks": [_task(r) for r in open_rows] + [_task(r) for r in done_rows],
            "agents": self.agents(),
            "events": self.events(limit=80),
        }

    # ── human-facing writes ──────────────────────────────────────────────────

    def create_task(self, data: dict[str, Any], actor: str = HUMAN) -> dict[str, Any]:
        actor = norm_actor(actor)
        title = _text(data.get("title"), "title", MAX_TITLE, required=True)
        description = _text(data.get("description"), "description", MAX_DESCRIPTION)
        priority = norm_priority(data.get("priority"))
        assignee = norm_assignee(data.get("assignee"))
        tags = norm_tags(data.get("tags"))
        review = norm_bool(data.get("review", True), "review")
        now = self.clock()
        with self._tx() as cur:
            if actor != HUMAN:
                self._touch(cur, actor)
            cur.execute(
                "INSERT INTO tasks (title, description, priority, assignee, tags, review, created_by, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (title, description, priority, assignee, json.dumps(tags), int(review), actor, now, now),
            )
            task_id = cur.lastrowid
            self._log(cur, task_id, actor, "created", title)
        return self.get_task(task_id)

    def update_task(self, task_id: int, data: dict[str, Any], actor: str = HUMAN) -> dict[str, Any]:
        actor = norm_actor(actor)
        unknown = set(data) - set(TASK_FIELDS) - {"agent"}
        if unknown:
            raise StoreError("unknown field(s): " + ", ".join(sorted(unknown)))
        now = self.clock()
        with self._tx() as cur:
            self._sweep(cur)
            row = self._row(cur, task_id)
            sets: dict[str, Any] = {}
            changed: list[str] = []
            if "title" in data:
                sets["title"] = _text(data["title"], "title", MAX_TITLE, required=True)
            if "description" in data:
                sets["description"] = _text(data["description"], "description", MAX_DESCRIPTION)
            if "priority" in data:
                sets["priority"] = norm_priority(data["priority"])
            if "assignee" in data:
                sets["assignee"] = norm_assignee(data["assignee"])
            if "tags" in data:
                sets["tags"] = json.dumps(norm_tags(data["tags"]))
            if "review" in data:
                sets["review"] = int(norm_bool(data["review"], "review"))
            for key, value in sets.items():
                if row[key] != value:
                    changed.append(key)
                else:
                    sets[key] = row[key]
            if "status" in data:
                new = norm_status(data["status"])
                old = row["status"]
                if new != old:
                    sets["status"] = new
                    if new == "todo":
                        sets.update(claimed_by=None, claimed_at=None, lease_expires=None)
                    elif new == "doing":
                        # A human dragging a card into DOING takes it themselves (no lease).
                        sets.update(claimed_by=actor, claimed_at=now, lease_expires=None)
                    else:
                        sets["lease_expires"] = None
                    sets["completed_at"] = now if new == "done" else None
                    self._log(cur, task_id, actor, "moved", f"{old} → {new}")
            if changed:
                self._log(cur, task_id, actor, "edited", ", ".join(changed))
            if sets:
                sets["updated_at"] = now
                cols = ", ".join(f"{k} = ?" for k in sets)
                cur.execute(f"UPDATE tasks SET {cols} WHERE id = ?", (*sets.values(), task_id))
        return self.get_task(task_id)

    def delete_task(self, task_id: int, actor: str = HUMAN) -> None:
        actor = norm_actor(actor)
        with self._tx() as cur:
            row = self._row(cur, task_id)
            cur.execute("DELETE FROM events WHERE task_id = ?", (task_id,))
            cur.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
            self._log(cur, None, actor, "deleted", f"#{task_id} {row['title']}")

    def comment(self, task_id: int, message: str, actor: str = HUMAN) -> dict[str, Any]:
        """Add a note. From the agent holding the task it is a progress update and renews the lease."""
        actor = norm_actor(actor)
        message = _text(message, "message", MAX_MESSAGE, required=True)
        now = self.clock()
        with self._tx() as cur:
            self._sweep(cur)
            row = self._row(cur, task_id)
            if actor != HUMAN:
                self._touch(cur, actor)
            if row["status"] == "doing" and row["claimed_by"] == actor and actor != HUMAN:
                cur.execute(
                    "UPDATE tasks SET lease_expires = ?, updated_at = ? WHERE id = ?",
                    (now + self._lease_len(row), now, task_id),
                )
                self._log(cur, task_id, actor, "progress", message)
            else:
                cur.execute("UPDATE tasks SET updated_at = ? WHERE id = ?", (now, task_id))
                self._log(cur, task_id, actor, "comment", message)
        return self.get_task(task_id)

    def reply(self, task_id: int, message: str, actor: str = HUMAN) -> dict[str, Any]:
        """Answer a blocked task's question and put it back in the queue."""
        actor = norm_actor(actor)
        message = _text(message, "message", MAX_MESSAGE, required=True)
        now = self.clock()
        with self._tx() as cur:
            row = self._row(cur, task_id)
            if row["status"] != "blocked":
                raise Conflict(f"task #{task_id} is not waiting for an answer (status: {row['status']})")
            cur.execute(
                "UPDATE tasks SET status = 'todo', claimed_by = NULL, claimed_at = NULL, lease_expires = NULL, "
                "updated_at = ? WHERE id = ?",
                (now, task_id),
            )
            self._log(cur, task_id, actor, "replied", message)
        return self.get_task(task_id)

    def approve(self, task_id: int, message: str = "", actor: str = HUMAN) -> dict[str, Any]:
        actor = norm_actor(actor)
        message = _text(message, "message", MAX_MESSAGE)
        now = self.clock()
        with self._tx() as cur:
            row = self._row(cur, task_id)
            if row["status"] != "review":
                raise Conflict(f"task #{task_id} is not in review (status: {row['status']})")
            cur.execute(
                "UPDATE tasks SET status = 'done', completed_at = ?, updated_at = ? WHERE id = ?",
                (now, now, task_id),
            )
            self._log(cur, task_id, actor, "approved", message)
        return self.get_task(task_id)

    def reject(self, task_id: int, message: str, actor: str = HUMAN) -> dict[str, Any]:
        """Send reviewed work back to the queue with feedback for the next attempt."""
        actor = norm_actor(actor)
        message = _text(message, "feedback", MAX_MESSAGE, required=True)
        now = self.clock()
        with self._tx() as cur:
            row = self._row(cur, task_id)
            if row["status"] != "review":
                raise Conflict(f"task #{task_id} is not in review (status: {row['status']})")
            cur.execute(
                "UPDATE tasks SET status = 'todo', claimed_by = NULL, claimed_at = NULL, lease_expires = NULL, "
                "updated_at = ? WHERE id = ?",
                (now, task_id),
            )
            self._log(cur, task_id, actor, "rejected", message)
        return self.get_task(task_id)

    # ── agent-facing writes ──────────────────────────────────────────────────

    @staticmethod
    def _eligible(row: sqlite3.Row, agent: str) -> bool:
        return row["assignee"] is None or row["assignee"] == agent

    def _lease_len(self, row: sqlite3.Row) -> float:
        if row["lease_expires"] and row["claimed_at"]:
            return max(MIN_LEASE, row["lease_expires"] - row["claimed_at"])
        return DEFAULT_LEASE

    def _claim_row(self, cur: sqlite3.Cursor, row: sqlite3.Row, agent: str, lease: int) -> None:
        now = self.clock()
        cur.execute(
            "UPDATE tasks SET status = 'doing', claimed_by = ?, claimed_at = ?, lease_expires = ?, "
            "question = NULL, updated_at = ? WHERE id = ?",
            (agent, now, now + lease, now, row["id"]),
        )
        self._log(cur, row["id"], agent, "claimed", f"lease {lease // 60}m" if lease >= 60 else f"lease {lease}s")

    def claim(self, task_id: int, agent: str, lease_seconds: Any = None) -> dict[str, Any]:
        agent = norm_agent(agent)
        lease = norm_lease(lease_seconds)
        with self._tx() as cur:
            self._sweep(cur)
            self._touch(cur, agent)
            row = self._row(cur, task_id)
            if row["status"] == "doing" and row["claimed_by"] == agent:
                now = self.clock()
                cur.execute("UPDATE tasks SET lease_expires = ?, updated_at = ? WHERE id = ?",
                            (now + lease, now, task_id))
            elif row["status"] != "todo":
                holder = f" by {row['claimed_by']}" if row["status"] == "doing" else ""
                raise Conflict(f"task #{task_id} is not available (status: {row['status']}{holder})")
            elif not self._eligible(row, agent):
                who = "the human" if row["assignee"] == HUMAN else row["assignee"]
                raise Conflict(f"task #{task_id} is reserved for {who}")
            else:
                self._claim_row(cur, row, agent, lease)
        return self.get_task(task_id)

    def claim_next(self, agent: str, tags: Any = None, lease_seconds: Any = None) -> dict[str, Any] | None:
        """Atomically claim the most important task this agent may take. None if the queue is empty."""
        agent = norm_agent(agent)
        wanted = set(norm_tags(tags))
        lease = norm_lease(lease_seconds)
        with self._tx() as cur:
            self._sweep(cur)
            self._touch(cur, agent)
            rows = cur.execute(
                "SELECT * FROM tasks WHERE status = 'todo' AND (assignee IS NULL OR assignee = ?) "
                "ORDER BY priority DESC, (assignee IS NOT NULL) DESC, id ASC",
                (agent,),
            ).fetchall()
            pick = None
            for row in rows:
                if not wanted or wanted & set(json.loads(row["tags"])):
                    pick = row
                    break
            if pick is None:
                return None
            self._claim_row(cur, pick, agent, lease)
            task_id = pick["id"]
        return self.get_task(task_id)

    def heartbeat(self, task_id: int, agent: str, lease_seconds: Any = None) -> dict[str, Any]:
        agent = norm_agent(agent)
        with self._tx() as cur:
            self._sweep(cur)
            self._touch(cur, agent)
            row = self._row(cur, task_id)
            if row["status"] != "doing" or row["claimed_by"] != agent:
                raise Conflict(f"task #{task_id} is not claimed by {agent}")
            lease = norm_lease(lease_seconds) if lease_seconds is not None else self._lease_len(row)
            now = self.clock()
            cur.execute("UPDATE tasks SET lease_expires = ?, updated_at = ? WHERE id = ?",
                        (now + lease, now, task_id))
        return self.get_task(task_id, events=False)

    def _own_or_takeover(self, cur: sqlite3.Cursor, task_id: int, agent: str, verb: str) -> sqlite3.Row:
        """The agent must hold the task. A task that went back to the queue (lease expired)
        can still be finished by an eligible agent, so late work is not lost."""
        row = self._row(cur, task_id)
        if row["status"] == "doing" and row["claimed_by"] == agent:
            return row
        if row["status"] == "todo" and self._eligible(row, agent):
            return row
        holder = f" (held by {row['claimed_by']})" if row["status"] == "doing" else ""
        raise Conflict(f"cannot {verb} task #{task_id}: status is {row['status']}{holder}")

    def complete(self, task_id: int, agent: str, result: str) -> dict[str, Any]:
        agent = norm_agent(agent)
        result = _text(result, "result", MAX_RESULT, required=True)
        now = self.clock()
        with self._tx() as cur:
            self._sweep(cur)
            self._touch(cur, agent)
            row = self._own_or_takeover(cur, task_id, agent, "complete")
            status = "review" if row["review"] else "done"
            cur.execute(
                "UPDATE tasks SET status = ?, claimed_by = ?, lease_expires = NULL, result = ?, "
                "completed_at = ?, updated_at = ? WHERE id = ?",
                (status, agent, result, now if status == "done" else None, now, task_id),
            )
            first_line = result.splitlines()[0][:160] if result else ""
            self._log(cur, task_id, agent, "completed", first_line)
        return self.get_task(task_id)

    def block(self, task_id: int, agent: str, question: str) -> dict[str, Any]:
        agent = norm_agent(agent)
        question = _text(question, "question", MAX_MESSAGE, required=True)
        now = self.clock()
        with self._tx() as cur:
            self._sweep(cur)
            self._touch(cur, agent)
            self._own_or_takeover(cur, task_id, agent, "block")
            cur.execute(
                "UPDATE tasks SET status = 'blocked', claimed_by = ?, lease_expires = NULL, question = ?, "
                "updated_at = ? WHERE id = ?",
                (agent, question, now, task_id),
            )
            self._log(cur, task_id, agent, "blocked", question)
        return self.get_task(task_id)

    def release(self, task_id: int, agent: str, reason: str = "") -> dict[str, Any]:
        agent = norm_agent(agent)
        reason = _text(reason, "reason", MAX_MESSAGE)
        now = self.clock()
        with self._tx() as cur:
            self._sweep(cur)
            self._touch(cur, agent)
            row = self._row(cur, task_id)
            if row["status"] != "doing" or row["claimed_by"] != agent:
                raise Conflict(f"task #{task_id} is not claimed by {agent}")
            cur.execute(
                "UPDATE tasks SET status = 'todo', claimed_by = NULL, claimed_at = NULL, lease_expires = NULL, "
                "updated_at = ? WHERE id = ?",
                (now, task_id),
            )
            self._log(cur, task_id, agent, "released", reason)
        return self.get_task(task_id)

    def seen(self, agent: str) -> None:
        """Record that an agent checked in (e.g. read the board). Announces brand-new agents."""
        agent = norm_agent(agent)
        with self._lock:
            row = self._db.execute("SELECT last_seen FROM agents WHERE name = ?", (agent,)).fetchone()
            now = self.clock()
            if row is None or now - row["last_seen"] > AGENT_IDLE_AFTER:
                with self._tx() as cur:
                    self._touch(cur, agent)
            else:
                self._db.execute("UPDATE agents SET last_seen = ? WHERE name = ?", (now, agent))
