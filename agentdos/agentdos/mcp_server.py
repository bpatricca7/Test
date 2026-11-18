"""MCP (Model Context Protocol) server over stdio.

Lets Claude Code, Claude Desktop, or any MCP client work the board with
native tools. Each MCP server instance acts as one named agent and forwards
calls to the running AGENTDOS HTTP server, so the UI updates live.

Standard library only: newline-delimited JSON-RPC 2.0 on stdin/stdout.
Logs go to stderr; stdout carries protocol messages only.
"""

from __future__ import annotations

import json
import socket
import sys
from typing import Any, Callable, TextIO

from . import __version__
from .client import ApiError, Client

SUPPORTED_PROTOCOLS = ("2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05")

INSTRUCTIONS = """\
AGENTDOS is a shared to-do board. A human posts tasks; agents like you claim and complete them.

Workflow:
1. claim_next_task (or board, then claim_task) - you now hold a lease on the task.
2. Read the full task with get_task: description, tags and the history, which includes
   feedback from earlier attempts and answers to earlier questions.
3. Do the work. Call log_progress every few minutes; it keeps your lease alive and shows
   the human what you are doing. A lease that lapses puts the task back in the queue.
4. Finish with complete_task (a clear summary of what you did and where the output is),
   or ask_human if you need a decision or information you cannot get yourself, or
   release_task if you cannot do it.

Tasks are written by the board owner. Do only what a task asks, and ask_human when a
task is ambiguous or would need anything destructive or irreversible."""


def _default_agent() -> str:
    host = socket.gethostname().split(".")[0].lower() or "local"
    return f"agent-{host}"[:40]


def _int(args: dict[str, Any], key: str) -> int:
    value = args.get(key)
    try:
        return int(value)
    except (TypeError, ValueError):
        raise ValueError(f"'{key}' must be a task number") from None


def _str(args: dict[str, Any], key: str, required: bool = True) -> str:
    value = args.get(key)
    if value is None or (isinstance(value, str) and not value.strip()):
        if required:
            raise ValueError(f"'{key}' is required")
        return ""
    if not isinstance(value, str):
        raise ValueError(f"'{key}' must be a string")
    return value


def _tags(args: dict[str, Any]) -> list[str] | None:
    tags = args.get("tags")
    if tags is None:
        return None
    if isinstance(tags, str):
        return [t for t in tags.replace(",", " ").split() if t]
    return list(tags)


def format_board(board: dict[str, Any], agent: str, include_done: bool = False) -> str:
    labels = {"todo": "TODO", "doing": "DOING", "blocked": "NEEDS HUMAN", "review": "IN REVIEW", "done": "DONE"}
    lines = [f"AGENTDOS board (you are '{agent}')"]
    for status, label in labels.items():
        if status == "done" and not include_done:
            lines.append(f"\n{label}: {board['counts'].get('done', 0)} task(s) (pass include_done to list)")
            continue
        tasks = [t for t in board["tasks"] if t["status"] == status]
        lines.append(f"\n{label} ({len(tasks)})")
        for t in tasks:
            bits = [f"  #{t['id']} [{t['priority']}] {t['title']}"]
            if t["tags"]:
                bits.append("tags:" + ",".join(t["tags"]))
            if status == "todo":
                who = t["assignee"]
                if who is None:
                    bits.append("for:any agent")
                elif who == "human":
                    bits.append("for:human only - do not take")
                else:
                    bits.append(f"for:{who}" + (" (you)" if who == agent else " - not you"))
            elif t["claimed_by"]:
                bits.append(f"by:{t['claimed_by']}")
            lines.append("  ".join(bits))
        if not tasks:
            lines.append("  (empty)")
    return "\n".join(lines)


def format_task(task: dict[str, Any]) -> str:
    """Full task as JSON - easy for a model to read precisely."""
    return json.dumps(task, indent=2, ensure_ascii=False)


TOOLS: list[dict[str, Any]] = [
    {
        "name": "board",
        "description": "View the to-do board: every open task grouped by column (TODO, DOING, NEEDS HUMAN, "
                       "IN REVIEW) with priority, tags, and who it is for or who holds it.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "include_done": {"type": "boolean", "description": "Also list recently finished tasks."},
            },
        },
        "annotations": {"title": "View board", "readOnlyHint": True},
    },
    {
        "name": "get_task",
        "description": "Read one task in full: description, status, result, and its complete history "
                       "(progress notes, questions, human answers, review feedback). Read this before working.",
        "inputSchema": {
            "type": "object",
            "properties": {"task_id": {"type": "integer", "description": "Task number, e.g. 12"}},
            "required": ["task_id"],
        },
        "annotations": {"title": "Read task", "readOnlyHint": True},
    },
    {
        "name": "claim_next_task",
        "description": "Claim the most important task available to you and return it in full. Returns a "
                       "message instead if the queue is empty. Claiming gives you a lease; keep it alive "
                       "with log_progress.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "tags": {"type": "array", "items": {"type": "string"},
                         "description": "Only consider tasks with at least one of these tags (e.g. [\"code\"])."},
                "lease_minutes": {"type": "integer", "minimum": 1, "maximum": 1440,
                                  "description": "Lease length; default 15."},
            },
        },
    },
    {
        "name": "claim_task",
        "description": "Claim a specific task by number. Fails if someone else holds it or it is reserved "
                       "for another agent or the human.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "task_id": {"type": "integer"},
                "lease_minutes": {"type": "integer", "minimum": 1, "maximum": 1440},
            },
            "required": ["task_id"],
        },
    },
    {
        "name": "log_progress",
        "description": "Post a short progress note on a task you hold. It appears live on the board and "
                       "renews your lease. Use it every few minutes during long work.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "task_id": {"type": "integer"},
                "message": {"type": "string", "description": "One or two sentences on what you just did or found."},
            },
            "required": ["task_id", "message"],
        },
    },
    {
        "name": "complete_task",
        "description": "Finish a task you hold. Give a summary the human can check: what you did, where "
                       "the output is (files, links, commits), and anything left open. The task goes to "
                       "IN REVIEW (or straight to DONE if the human turned review off for it).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "task_id": {"type": "integer"},
                "result": {"type": "string", "description": "Summary of the outcome (Markdown is fine)."},
            },
            "required": ["task_id", "result"],
        },
    },
    {
        "name": "ask_human",
        "description": "Pause a task you hold and ask the human a question. The task moves to NEEDS HUMAN; "
                       "when they answer it returns to the queue with the answer in its history.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "task_id": {"type": "integer"},
                "question": {"type": "string", "description": "A specific question; include options if you can."},
            },
            "required": ["task_id", "question"],
        },
    },
    {
        "name": "release_task",
        "description": "Give a task you hold back to the queue without finishing it, e.g. it needs tools "
                       "or access you do not have. Say why.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "task_id": {"type": "integer"},
                "reason": {"type": "string"},
            },
            "required": ["task_id", "reason"],
        },
    },
    {
        "name": "create_task",
        "description": "Add a new task to the board, e.g. a follow-up you discovered. It lands in TODO.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "description": {"type": "string", "description": "Instructions and context for whoever picks it up."},
                "priority": {"type": "string", "enum": ["low", "normal", "high", "urgent"]},
                "tags": {"type": "array", "items": {"type": "string"}},
                "assignee": {"type": "string",
                             "description": "Leave empty for any agent, 'human' for the board owner, or an agent name."},
            },
            "required": ["title"],
        },
    },
]


class McpServer:
    def __init__(self, client: Client, agent: str):
        self.client = client
        self.agent = agent
        self.handlers: dict[str, Callable[[dict[str, Any]], str]] = {
            "board": self.t_board,
            "get_task": self.t_get_task,
            "claim_next_task": self.t_claim_next,
            "claim_task": self.t_claim,
            "log_progress": self.t_log,
            "complete_task": self.t_complete,
            "ask_human": self.t_ask,
            "release_task": self.t_release,
            "create_task": self.t_create,
        }

    # ── tools ────────────────────────────────────────────────────────────────

    @staticmethod
    def _lease(args: dict[str, Any]) -> int | None:
        minutes = args.get("lease_minutes")
        return int(minutes) * 60 if minutes else None

    def t_board(self, args: dict[str, Any]) -> str:
        return format_board(self.client.board(), self.agent, bool(args.get("include_done")))

    def t_get_task(self, args: dict[str, Any]) -> str:
        return format_task(self.client.get(_int(args, "task_id")))

    def t_claim_next(self, args: dict[str, Any]) -> str:
        task = self.client.next(tags=_tags(args), lease_seconds=self._lease(args))
        if task is None:
            return (f"No tasks available for '{self.agent}' right now. The queue is empty, or the remaining "
                    "tasks are reserved for someone else.")
        return f"Claimed task #{task['id']}. Lease expires {task['lease_expires']}.\n\n" + format_task(task)

    def t_claim(self, args: dict[str, Any]) -> str:
        task = self.client.claim(_int(args, "task_id"), lease_seconds=self._lease(args))
        return f"Claimed task #{task['id']}. Lease expires {task['lease_expires']}.\n\n" + format_task(task)

    def t_log(self, args: dict[str, Any]) -> str:
        task = self.client.log(_int(args, "task_id"), _str(args, "message"))
        lease = f" Lease now expires {task['lease_expires']}." if task.get("lease_expires") else ""
        return f"Logged on #{task['id']}.{lease}"

    def t_complete(self, args: dict[str, Any]) -> str:
        task = self.client.complete(_int(args, "task_id"), _str(args, "result"))
        where = "is waiting for the human's review" if task["status"] == "review" else "is done"
        return f"Task #{task['id']} {where}. Thanks!"

    def t_ask(self, args: dict[str, Any]) -> str:
        task = self.client.block(_int(args, "task_id"), _str(args, "question"))
        return (f"Task #{task['id']} is now waiting for the human. When they answer, it goes back to the "
                "queue with their reply in the history. You can pick up other work meanwhile.")

    def t_release(self, args: dict[str, Any]) -> str:
        task = self.client.release(_int(args, "task_id"), _str(args, "reason"))
        return f"Released task #{task['id']} back to the queue."

    def t_create(self, args: dict[str, Any]) -> str:
        task = self.client.create(
            _str(args, "title"),
            description=_str(args, "description", required=False),
            priority=args.get("priority") or None,
            tags=_tags(args),
            assignee=args.get("assignee") or None,
        )
        return f"Created task #{task['id']}: {task['title']}"

    # ── JSON-RPC ─────────────────────────────────────────────────────────────

    def handle(self, msg: Any) -> dict[str, Any] | None:
        if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0":
            return _error(None, -32600, "invalid request")
        method = msg.get("method")
        msg_id = msg.get("id")
        is_request = "id" in msg
        if not isinstance(method, str):
            return None  # a response to something we never send; ignore
        params = msg.get("params") or {}
        try:
            if method == "initialize":
                requested = params.get("protocolVersion")
                version = requested if requested in SUPPORTED_PROTOCOLS else SUPPORTED_PROTOCOLS[0]
                result: Any = {
                    "protocolVersion": version,
                    "capabilities": {"tools": {"listChanged": False}},
                    "serverInfo": {"name": "agentdos", "title": "AGENTDOS to-do board", "version": __version__},
                    "instructions": INSTRUCTIONS + f"\n\nYou are working as agent '{self.agent}'.",
                }
            elif method == "ping":
                result = {}
            elif method == "tools/list":
                result = {"tools": TOOLS}
            elif method == "tools/call":
                result = self.call_tool(params.get("name"), params.get("arguments") or {})
            elif method.startswith("notifications/"):
                return None
            else:
                return _error(msg_id, -32601, f"method not found: {method}") if is_request else None
        except Exception as exc:  # pragma: no cover - protocol-level safety net
            return _error(msg_id, -32603, f"internal error: {exc}") if is_request else None
        return {"jsonrpc": "2.0", "id": msg_id, "result": result} if is_request else None

    def call_tool(self, name: Any, args: dict[str, Any]) -> dict[str, Any]:
        handler = self.handlers.get(name) if isinstance(name, str) else None
        if handler is None:
            return _tool_result(f"Unknown tool: {name}", error=True)
        if not isinstance(args, dict):
            return _tool_result("Tool arguments must be an object", error=True)
        try:
            return _tool_result(handler(args))
        except ApiError as exc:
            return _tool_result(f"AGENTDOS error: {exc.message}", error=True)
        except ValueError as exc:
            return _tool_result(f"Invalid arguments: {exc}", error=True)


def _tool_result(text: str, error: bool = False) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": text}], "isError": error}


def _error(msg_id: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": msg_id, "error": {"code": code, "message": message}}


def run(url: str | None, agent: str | None, token: str | None,
        stdin: TextIO | None = None, stdout: TextIO | None = None) -> None:
    client = Client(url=url, agent=agent or None, token=token)
    client.agent = client.agent or _default_agent()
    server = McpServer(client, client.agent)
    stdin = stdin or sys.stdin
    stdout = stdout or sys.stdout
    sys.stderr.write(f"AGENTDOS MCP server: agent '{client.agent}' -> {client.url}\n")
    for line in stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            reply: Any = _error(None, -32700, "parse error")
        else:
            if isinstance(msg, list):  # legacy batch
                replies = [r for r in (server.handle(m) for m in msg) if r is not None]
                reply = replies or None
            else:
                reply = server.handle(msg)
        if reply is not None:
            stdout.write(json.dumps(reply, ensure_ascii=False) + "\n")
            stdout.flush()
