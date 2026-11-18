"""Tiny HTTP client for the AGENTDOS API (standard library only).

Used by the CLI and the MCP server, and handy for writing your own agents::

    from agentdos.client import Client
    board = Client(agent="my-bot")
    task = board.next()            # claim the most important available task
    board.log(task["id"], "working on it")
    board.complete(task["id"], "Done: ...")
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any
from urllib.parse import urlencode, urlsplit

from . import DEFAULT_URL


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


class Client:
    def __init__(self, url: str | None = None, agent: str | None = None,
                 token: str | None = None, timeout: float = 20):
        self.url = (url or os.environ.get("AGENTDOS_URL") or DEFAULT_URL).rstrip("/")
        self.agent = agent or os.environ.get("AGENTDOS_AGENT") or None
        self.token = token or os.environ.get("AGENTDOS_TOKEN") or None
        self.timeout = timeout
        host = (urlsplit(self.url).hostname or "").lower()
        handlers = []
        if host in ("localhost", "127.0.0.1", "::1"):
            # Never route local traffic through an HTTP(S)_PROXY from the environment.
            handlers.append(urllib.request.ProxyHandler({}))
        self._opener = urllib.request.build_opener(*handlers)

    # ── transport ────────────────────────────────────────────────────────────

    def request(self, method: str, path: str, body: dict[str, Any] | None = None,
                query: dict[str, Any] | None = None) -> Any:
        url = self.url + path
        if query:
            clean = {k: v for k, v in query.items() if v not in (None, "", [])}
            if clean:
                url += "?" + urlencode(clean)
        headers = {"Accept": "application/json"}
        data = None
        if method in ("POST", "PATCH"):
            data = json.dumps(body or {}).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if self.agent:
            headers["X-Agent"] = self.agent
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with self._opener.open(req, timeout=self.timeout) as resp:
                raw = resp.read()
        except urllib.error.HTTPError as exc:
            try:
                message = json.loads(exc.read().decode("utf-8")).get("error") or exc.reason
            except Exception:
                message = str(exc.reason)
            raise ApiError(exc.code, message) from None
        except (urllib.error.URLError, OSError) as exc:
            reason = getattr(exc, "reason", exc)
            raise ApiError(0, f"cannot reach AGENTDOS at {self.url} ({reason}). "
                              "Is the board running? Start it with: python3 dos.py serve") from None
        return json.loads(raw.decode("utf-8")) if raw else None

    # ── board ────────────────────────────────────────────────────────────────

    def health(self) -> dict[str, Any]:
        return self.request("GET", "/api/health")

    def board(self) -> dict[str, Any]:
        return self.request("GET", "/api/board")

    def tasks(self, status: str | None = None, tag: str | None = None, assignee: str | None = None,
              available_for: str | None = None, q: str | None = None) -> list[dict[str, Any]]:
        return self.request("GET", "/api/tasks", query={
            "status": status, "tag": tag, "assignee": assignee, "available_for": available_for, "q": q,
        })["tasks"]

    def get(self, task_id: int) -> dict[str, Any]:
        return self.request("GET", f"/api/tasks/{int(task_id)}")

    def create(self, title: str, description: str = "", priority: str | None = None,
               tags: list[str] | None = None, assignee: str | None = None,
               review: bool | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"title": title, "description": description}
        if priority is not None:
            body["priority"] = priority
        if tags is not None:
            body["tags"] = tags
        if assignee is not None:
            body["assignee"] = assignee
        if review is not None:
            body["review"] = review
        return self.request("POST", "/api/tasks", body)

    def update(self, task_id: int, **fields: Any) -> dict[str, Any]:
        return self.request("PATCH", f"/api/tasks/{int(task_id)}", fields)

    def delete(self, task_id: int) -> dict[str, Any]:
        return self.request("DELETE", f"/api/tasks/{int(task_id)}")

    def agents(self) -> list[dict[str, Any]]:
        return self.request("GET", "/api/agents")["agents"]

    # ── agent workflow ───────────────────────────────────────────────────────

    def _action(self, task_id: int, action: str, **body: Any) -> dict[str, Any]:
        body = {k: v for k, v in body.items() if v is not None}
        return self.request("POST", f"/api/tasks/{int(task_id)}/{action}", body)

    def next(self, tags: list[str] | None = None, lease_seconds: int | None = None) -> dict[str, Any] | None:
        body: dict[str, Any] = {}
        if tags:
            body["tags"] = tags
        if lease_seconds:
            body["lease_seconds"] = lease_seconds
        return self.request("POST", "/api/tasks/next", body)["task"]

    def claim(self, task_id: int, lease_seconds: int | None = None) -> dict[str, Any]:
        return self._action(task_id, "claim", lease_seconds=lease_seconds)

    def heartbeat(self, task_id: int, lease_seconds: int | None = None) -> dict[str, Any]:
        return self._action(task_id, "heartbeat", lease_seconds=lease_seconds)

    def log(self, task_id: int, message: str) -> dict[str, Any]:
        return self._action(task_id, "log", message=message)

    def complete(self, task_id: int, result: str) -> dict[str, Any]:
        return self._action(task_id, "complete", result=result)

    def block(self, task_id: int, question: str) -> dict[str, Any]:
        return self._action(task_id, "block", question=question)

    def release(self, task_id: int, reason: str = "") -> dict[str, Any]:
        return self._action(task_id, "release", reason=reason)

    # ── review (usually the human, from the UI) ──────────────────────────────

    def reply(self, task_id: int, message: str) -> dict[str, Any]:
        return self._action(task_id, "reply", message=message)

    def approve(self, task_id: int, message: str = "") -> dict[str, Any]:
        return self._action(task_id, "approve", message=message)

    def reject(self, task_id: int, feedback: str) -> dict[str, Any]:
        return self._action(task_id, "reject", feedback=feedback)
