"""Stream events and the message "parts" timeline they build.

An assistant message is an ordered list of parts, e.g.

    reasoning -> tool (python) -> reasoning -> text

The same reducer runs in the browser (frontend/src/lib/parts.ts) so a live
stream and a reloaded conversation render identically.
"""

from __future__ import annotations

import json
import time
from typing import Any


class PartsBuilder:
    def __init__(self) -> None:
        self.parts: list[dict[str, Any]] = []

    def _find(self, ptype: str, pid: str) -> dict[str, Any] | None:
        for p in reversed(self.parts):
            if p["type"] == ptype and p.get("id") == pid:
                return p
        return None

    def apply(self, ev: dict[str, Any]) -> None:
        t = ev.get("type")
        now = time.time()
        if t == "reasoning_start":
            self.parts.append({"type": "reasoning", "id": ev["id"], "text": "", "status": "running", "started_at": now})
        elif t == "reasoning_delta":
            p = self._find("reasoning", ev["id"])
            if p is None:
                p = {"type": "reasoning", "id": ev["id"], "text": "", "status": "running", "started_at": now}
                self.parts.append(p)
            p["text"] += ev["delta"]
        elif t == "reasoning_end":
            p = self._find("reasoning", ev["id"])
            if p is not None:
                p["status"] = "done"
                p["duration_ms"] = ev.get("duration_ms", 0)
        elif t == "text_delta":
            if self.parts and self.parts[-1]["type"] == "text":
                self.parts[-1]["text"] += ev["delta"]
            else:
                self.parts.append({"type": "text", "text": ev["delta"]})
        elif t == "tool_start":
            self.parts.append({
                "type": "tool", "id": ev["id"], "kind": ev.get("kind", "mcp"), "name": ev.get("name", ""),
                "server": ev.get("server", ""), "label": ev.get("label", ""), "input": "", "status": "running",
                "started_at": now,
            })
        elif t == "tool_input_delta":
            p = self._find("tool", ev["id"])
            if p is not None and isinstance(p.get("input"), str):
                p["input"] += ev["delta"]
        elif t == "tool_input":
            p = self._find("tool", ev["id"])
            if p is not None:
                p["input"] = ev["input"]
        elif t == "tool_end":
            p = self._find("tool", ev["id"])
            if p is not None:
                p["status"] = ev.get("status", "done")
                p["output"] = ev.get("output")
                p["duration_ms"] = ev.get("duration_ms", 0)
        elif t == "files":
            self.parts.append({"type": "files", "files": ev.get("files", [])})
        elif t == "notice":
            self.parts.append({"type": "notice", "level": ev.get("level", "info"), "text": ev.get("text", "")})

    def finalize(self, stopped: bool = False) -> None:
        for p in self.parts:
            if p.get("status") == "running":
                # A tool that never reported a result didn't finish, even if the turn did.
                p["status"] = "stopped" if stopped or p["type"] == "tool" else "done"

    @property
    def text(self) -> str:
        return "".join(p["text"] for p in self.parts if p["type"] == "text")

    def history_summary(self) -> str:
        """Compact text used to replay this assistant turn to the model on later turns."""
        lines = []
        for p in self.parts:
            if p["type"] == "tool":
                out = p.get("output") or {}
                files = [f.get("sandbox_path") or f.get("name") for f in out.get("files", [])] if isinstance(out, dict) else []
                what = "ran Python" if p["kind"] in ("code", "hosted_code") else f"called {p.get('label') or p['name']}"
                lines.append(f"[{what}{'; created ' + ', '.join(files) if files else ''}]")
            elif p["type"] == "files":
                lines.append("[created " + ", ".join(f.get("name", "") for f in p.get("files", [])) + "]")
        return "\n".join(lines)


def sse(ev: dict[str, Any]) -> str:
    return f"data: {json.dumps(ev, default=str, separators=(',', ':'))}\n\n"
