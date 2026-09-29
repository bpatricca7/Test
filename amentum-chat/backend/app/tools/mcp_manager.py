"""MCP (Model Context Protocol) connector manager.

The backend is the MCP *client*. It runs inside the Amentum network, so it can
reach internal MCP servers (SharePoint, SQL, ServiceNow, file shares, …) while
only the model call leaves the network. Tools from connected servers are
exposed to the model as ordinary function tools named
``mcp__<server>__<tool>`` and executed here.

Supported transports: ``stdio`` (local command), ``http`` (Streamable HTTP)
and ``sse`` (legacy HTTP+SSE).
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Literal

from ..config import get_settings
from ..db import new_id

log = logging.getLogger(__name__)

MASK = "••••••••"
Transport = Literal["stdio", "http", "sse"]


def _attr(obj: Any, *names: str, default: Any = None) -> Any:
    for n in names:
        if isinstance(obj, dict) and n in obj:
            return obj[n]
        if hasattr(obj, n):
            v = getattr(obj, n)
            if v is not None:
                return v
    return default


def _slug(text: str, limit: int = 20) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    return (s or "server")[:limit]


@dataclass
class ServerConfig:
    id: str
    name: str
    transport: Transport = "stdio"
    command: str = ""
    args: list[str] = field(default_factory=list)
    env: dict[str, str] = field(default_factory=dict)
    cwd: str = ""
    url: str = ""
    headers: dict[str, str] = field(default_factory=dict)
    enabled: bool = True
    description: str = ""
    icon: str = ""
    created_at: float = field(default_factory=time.time)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "ServerConfig":
        known = {f for f in cls.__dataclass_fields__}  # type: ignore[attr-defined]
        data = {k: v for k, v in d.items() if k in known}
        if not data.get("id"):
            data["id"] = new_id("mcp")
        if data.get("transport") in ("streamable_http", "streamable-http", "streamableHttp", "https"):
            data["transport"] = "http"
        data["args"] = [str(a) for a in data.get("args") or []]
        data["env"] = {str(k): str(v) for k, v in (data.get("env") or {}).items()}
        data["headers"] = {str(k): str(v) for k, v in (data.get("headers") or {}).items()}
        return cls(**data)

    def public(self) -> dict[str, Any]:
        d = asdict(self)
        d["env"] = {k: MASK for k in self.env}
        d["headers"] = {k: MASK for k in self.headers}
        return d


class Connection:
    def __init__(self, config: ServerConfig):
        self.config = config
        self.status: str = "disconnected"
        self.error: str = ""
        self.tools: list[Any] = []
        self.server_info: dict[str, Any] = {}
        self.instructions: str = ""
        self.session: Any = None
        self.connected_at: float | None = None
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()
        self._ready = asyncio.Event()
        self._errlog: Any = None

    # The transport context managers use anyio task groups, which must be entered and
    # exited from the same task - so each connection lives in its own long-running task.
    async def start(self, wait: float = 45.0) -> None:
        await self.stop()
        self._stop = asyncio.Event()
        self._ready = asyncio.Event()
        self.status, self.error = "connecting", ""
        self._task = asyncio.create_task(self._run(), name=f"mcp:{self.config.name}")
        try:
            await asyncio.wait_for(self._ready.wait(), timeout=wait)
        except asyncio.TimeoutError:
            self.status, self.error = "error", f"Timed out after {wait:.0f}s while connecting"
            await self.stop(keep_status=True)

    async def stop(self, keep_status: bool = False) -> None:
        if self._task and not self._task.done():
            self._stop.set()
            try:
                await asyncio.wait_for(self._task, timeout=10)
            except (asyncio.TimeoutError, asyncio.CancelledError, Exception):
                self._task.cancel()
        self._task = None
        self.session = None
        if not keep_status:
            self.status = "disconnected"

    def _transport(self) -> Any:
        c = self.config
        if c.transport == "stdio":
            from mcp.client.stdio import StdioServerParameters, stdio_client

            if not get_settings().mcp_allow_stdio:
                raise PermissionError("stdio MCP servers are disabled on this deployment (MCP_ALLOW_STDIO=false)")
            params = StdioServerParameters(command=c.command, args=c.args, env=c.env or None, cwd=c.cwd or None)
            log_dir = get_settings().data_path / "logs"
            log_dir.mkdir(parents=True, exist_ok=True)
            self._errlog = open(log_dir / f"mcp-{c.id}.log", "a", encoding="utf-8")  # noqa: SIM115
            return stdio_client(params, errlog=self._errlog)
        if c.transport == "sse":
            from mcp.client.sse import sse_client

            return sse_client(c.url, headers=c.headers or None)
        # Streamable HTTP
        from mcp.client import streamable_http as sh

        if hasattr(sh, "streamable_http_client"):  # mcp >= 2
            import httpx2

            client = httpx2.AsyncClient(headers=c.headers, timeout=httpx2.Timeout(30.0, read=300.0))
            return sh.streamable_http_client(c.url, http_client=client)
        return sh.streamablehttp_client(c.url, headers=c.headers or None)  # mcp 1.x

    async def _run(self) -> None:
        from mcp import ClientSession

        try:
            async with self._transport() as streams:
                read, write = streams[0], streams[1]
                async with ClientSession(read, write) as session:
                    init = await session.initialize()
                    info = _attr(init, "server_info", "serverInfo")
                    self.server_info = {"name": _attr(info, "name", default=""), "version": _attr(info, "version", default="")}
                    self.instructions = _attr(init, "instructions", default="") or ""
                    self.tools = await self._list_tools(session)
                    self.session = session
                    self.status, self.error = "connected", ""
                    self.connected_at = time.time()
                    self._ready.set()
                    await self._stop.wait()
        except BaseException as exc:  # noqa: BLE001 - surface everything (incl. ExceptionGroup) to the UI
            if not self._stop.is_set():
                self.status = "error"
                self.error = _describe(exc)
                log.warning("MCP server %s failed: %s", self.config.name, self.error)
            if isinstance(exc, asyncio.CancelledError):
                raise
        finally:
            self.session = None
            if self.status == "connected":
                self.status = "disconnected"
            if self._errlog is not None:
                self._errlog.close()
                self._errlog = None
            self._ready.set()

    @staticmethod
    async def _list_tools(session: Any) -> list[Any]:
        tools: list[Any] = []
        cursor = None
        for _ in range(20):
            if cursor:
                from mcp_types import PaginatedRequestParams

                res = await session.list_tools(params=PaginatedRequestParams(cursor=cursor))
            else:
                res = await session.list_tools()
            tools.extend(res.tools)
            cursor = _attr(res, "next_cursor", "nextCursor")
            if not cursor:
                break
        return tools

    async def call(self, tool: str, arguments: dict[str, Any], timeout: float) -> Any:
        if self.session is None:
            raise RuntimeError(f"Connector '{self.config.name}' is not connected ({self.error or self.status})")
        return await asyncio.wait_for(self.session.call_tool(tool, arguments), timeout=timeout)

    def public(self) -> dict[str, Any]:
        d = self.config.public()
        d.update(
            status=self.status if self.config.enabled else "disabled",
            error=self.error,
            server_info=self.server_info,
            connected_at=self.connected_at,
            tools=[
                {"name": t.name, "title": _attr(t, "title", default="") or "", "description": (t.description or "")[:500]}
                for t in self.tools
            ],
        )
        return d


def _describe(exc: BaseException) -> str:
    # Unwrap anyio/asyncio ExceptionGroups to the first real cause.
    while isinstance(exc, BaseExceptionGroup) and exc.exceptions:
        exc = exc.exceptions[0]
    text = f"{type(exc).__name__}: {exc}".strip()
    if isinstance(exc, FileNotFoundError):
        text += " - is the command installed and on PATH?"
    return text[:600]


class MCPManager:
    def __init__(self, path: Path):
        self.path = path
        self.connections: dict[str, Connection] = {}
        self._tool_index: dict[str, tuple[str, str]] = {}  # function name -> (server id, tool name)
        self._lock = asyncio.Lock()

    # ---- persistence ------------------------------------------------------------------------------
    def load(self) -> None:
        if self.path.exists():
            raw = json.loads(self.path.read_text(encoding="utf-8") or "{}")
            for d in raw.get("servers", []):
                cfg = ServerConfig.from_dict(d)
                self.connections[cfg.id] = Connection(cfg)

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        data = {"servers": [asdict(c.config) for c in self.connections.values()]}
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
        tmp.replace(self.path)

    # ---- lifecycle ----------------------------------------------------------------------------------
    async def start_all(self) -> None:
        await asyncio.gather(*(c.start() for c in self.connections.values() if c.config.enabled),
                             return_exceptions=True)
        self._reindex()

    async def close(self) -> None:
        await asyncio.gather(*(c.stop() for c in self.connections.values()), return_exceptions=True)

    def list(self) -> list[dict[str, Any]]:
        return [c.public() for c in sorted(self.connections.values(), key=lambda c: c.config.created_at)]

    def get(self, sid: str) -> Connection | None:
        return self.connections.get(sid)

    async def add(self, data: dict[str, Any]) -> dict[str, Any]:
        cfg = ServerConfig.from_dict({**data, "id": new_id("mcp")})
        self._validate(cfg)
        conn = Connection(cfg)
        self.connections[cfg.id] = conn
        self.save()
        if cfg.enabled:
            await conn.start()
        self._reindex()
        return conn.public()

    async def update(self, sid: str, data: dict[str, Any]) -> dict[str, Any]:
        conn = self.connections[sid]
        old = asdict(conn.config)
        merged = {**old, **{k: v for k, v in data.items() if k != "id"}}
        # Masked secrets coming back from the UI keep their stored value.
        for key in ("env", "headers"):
            new = data.get(key)
            if isinstance(new, dict):
                merged[key] = {k: (old[key].get(k, "") if v == MASK else v) for k, v in new.items()}
        cfg = ServerConfig.from_dict(merged)
        self._validate(cfg)
        conn.config = cfg
        self.save()
        await conn.stop()
        if cfg.enabled:
            await conn.start()
        self._reindex()
        return conn.public()

    async def remove(self, sid: str) -> None:
        conn = self.connections.pop(sid, None)
        if conn:
            await conn.stop()
        self.save()
        self._reindex()

    async def reconnect(self, sid: str) -> dict[str, Any]:
        conn = self.connections[sid]
        await conn.start()
        self._reindex()
        return conn.public()

    async def test(self, data: dict[str, Any]) -> dict[str, Any]:
        """Connect to a server config without saving it."""
        cfg = ServerConfig.from_dict({**data, "id": data.get("id") or new_id("mcptest")})
        if data.get("id") in self.connections:  # testing an existing server with masked secrets
            stored = self.connections[data["id"]].config
            for key in ("env", "headers"):
                cfg_map = getattr(cfg, key)
                for k, v in list(cfg_map.items()):
                    if v == MASK:
                        cfg_map[k] = getattr(stored, key).get(k, "")
        self._validate(cfg)
        conn = Connection(cfg)
        await conn.start(wait=30)
        result = {"ok": conn.status == "connected", "error": conn.error, "server_info": conn.server_info,
                  "tools": conn.public()["tools"]}
        await conn.stop()
        return result

    @staticmethod
    def _validate(cfg: ServerConfig) -> None:
        if not cfg.name.strip():
            raise ValueError("Connector name is required")
        if cfg.transport == "stdio":
            if not cfg.command.strip():
                raise ValueError("A command is required for stdio connectors")
            if not get_settings().mcp_allow_stdio:
                raise ValueError("Local (stdio) connectors are disabled on this deployment")
        elif not re.match(r"^https?://", cfg.url.strip()):
            raise ValueError("A http(s):// URL is required for HTTP/SSE connectors")

    # ---- tools ----------------------------------------------------------------------------------------
    def _reindex(self) -> None:
        index: dict[str, tuple[str, str]] = {}
        for conn in self.connections.values():
            prefix = f"mcp__{_slug(conn.config.name)}__"
            for t in conn.tools:
                name = prefix + re.sub(r"[^A-Za-z0-9_-]", "_", t.name)
                if len(name) > 64:
                    name = name[:55] + "_" + hashlib.sha1(name.encode()).hexdigest()[:8]
                index[name] = (conn.config.id, t.name)
        self._tool_index = index

    def active_tools(self, server_ids: list[str] | None) -> list[tuple[str, Connection, Any]]:
        """(function name, connection, tool) for connected servers, optionally filtered."""
        out = []
        for fname, (sid, tname) in self._tool_index.items():
            conn = self.connections.get(sid)
            if not conn or conn.status != "connected" or not conn.config.enabled:
                continue
            if server_ids is not None and sid not in server_ids:
                continue
            tool = next((t for t in conn.tools if t.name == tname), None)
            if tool is not None:
                out.append((fname, conn, tool))
        return out

    @staticmethod
    def _schema(tool: Any) -> dict[str, Any]:
        schema = _attr(tool, "input_schema", "inputSchema", default=None) or {"type": "object", "properties": {}}
        schema = dict(schema)
        schema.setdefault("type", "object")
        schema.setdefault("properties", {})
        return schema

    def function_tools(self, server_ids: list[str] | None, api: str) -> list[dict[str, Any]]:
        tools = []
        for fname, conn, tool in self.active_tools(server_ids):
            desc = f"[{conn.config.name}] {tool.description or _attr(tool, 'title', default='') or tool.name}"[:1024]
            if api == "chat":
                tools.append({"type": "function", "function": {"name": fname, "description": desc,
                                                                "parameters": self._schema(tool)}})
            else:
                tools.append({"type": "function", "name": fname, "description": desc,
                              "parameters": self._schema(tool), "strict": False})
        return tools

    def instructions_for(self, server_ids: list[str] | None) -> str:
        seen, parts = set(), []
        for _, conn, _ in self.active_tools(server_ids):
            if conn.config.id in seen:
                continue
            seen.add(conn.config.id)
            line = f"- {conn.config.name}"
            if conn.config.description:
                line += f": {conn.config.description}"
            if conn.instructions:
                line += f"\n  Server notes: {conn.instructions[:800]}"
            parts.append(line)
        return "\n".join(parts)

    def resolve(self, fname: str) -> tuple[Connection, str] | None:
        hit = self._tool_index.get(fname)
        if not hit:
            return None
        conn = self.connections.get(hit[0])
        return (conn, hit[1]) if conn else None

    async def call(self, fname: str, arguments: dict[str, Any]) -> tuple[str, dict[str, Any]]:
        settings = get_settings()
        hit = self.resolve(fname)
        if hit is None:
            return f"Unknown tool {fname}", {"error": f"Unknown tool {fname}", "content": []}
        conn, tool = hit
        try:
            result = await conn.call(tool, arguments, timeout=settings.mcp_tool_timeout_s)
        except asyncio.TimeoutError:
            msg = f"Tool '{tool}' on '{conn.config.name}' timed out after {settings.mcp_tool_timeout_s:.0f}s"
            return msg, {"error": msg, "content": []}
        except Exception as exc:  # noqa: BLE001
            msg = f"Tool '{tool}' failed: {_describe(exc)}"
            return msg, {"error": msg, "content": []}

        blocks: list[dict[str, Any]] = []
        texts: list[str] = []
        for c in _attr(result, "content", default=[]) or []:
            ctype = _attr(c, "type", default="")
            if ctype == "text":
                texts.append(c.text)
                blocks.append({"type": "text", "text": c.text[:20000]})
            elif ctype == "image":
                mime = _attr(c, "mime_type", "mimeType", default="image/png")
                blocks.append({"type": "image", "mime": mime, "data": c.data})
                texts.append(f"[image {mime} returned to the user]")
            elif ctype == "resource":
                res = c.resource
                text = _attr(res, "text", default=None)
                uri = str(_attr(res, "uri", default=""))
                texts.append(f"[resource {uri}]\n{text}" if text else f"[binary resource {uri}]")
                blocks.append({"type": "resource", "uri": uri, "text": (text or "")[:20000]})
            elif ctype == "resource_link":
                uri = str(_attr(c, "uri", default=""))
                texts.append(f"[resource link {_attr(c, 'name', default='')}: {uri}]")
                blocks.append({"type": "link", "uri": uri, "name": _attr(c, "name", default="")})
        structured = _attr(result, "structured_content", "structuredContent", default=None)
        if structured is not None and not texts:
            texts.append(json.dumps(structured, default=str))
        is_error = bool(_attr(result, "is_error", "isError", default=False))
        text = "\n".join(texts) or "(empty result)"
        limit = settings.mcp_max_result_chars
        if len(text) > limit:
            text = text[:limit] + f"\n… [truncated {len(text) - limit} characters]"
        payload = {"content": blocks, "structured": structured, "is_error": is_error,
                   "server": conn.config.name, "tool": tool}
        return ("ERROR: " + text) if is_error else text, payload


def parse_import(text: str) -> list[dict[str, Any]]:
    """Accept Claude Desktop / VS Code / Cursor style MCP JSON and return server configs."""
    data = json.loads(text)
    if isinstance(data, dict) and "mcpServers" in data:
        servers = data["mcpServers"]
    elif isinstance(data, dict) and "servers" in data and isinstance(data["servers"], dict):
        servers = data["servers"]
    elif isinstance(data, dict) and ("command" in data or "url" in data):
        servers = {data.get("name", "Imported server"): data}
    elif isinstance(data, dict):
        servers = data
    else:
        raise ValueError("Expected a JSON object such as {\"mcpServers\": {\"name\": {...}}}")
    out = []
    for name, spec in servers.items():
        if not isinstance(spec, dict):
            continue
        t = (spec.get("type") or spec.get("transport") or "").lower()
        if "url" in spec or t in ("http", "sse", "streamable-http", "streamable_http"):
            transport = "sse" if t == "sse" or str(spec.get("url", "")).rstrip("/").endswith("/sse") else "http"
        else:
            transport = "stdio"
        out.append({
            "name": spec.get("name") or name,
            "transport": transport,
            "command": spec.get("command", ""),
            "args": spec.get("args", []),
            "env": spec.get("env", {}),
            "cwd": spec.get("cwd", ""),
            "url": spec.get("url", ""),
            "headers": spec.get("headers", {}),
            "description": spec.get("description", ""),
            "enabled": not spec.get("disabled", False),
        })
    if not out:
        raise ValueError("No MCP servers found in the pasted JSON")
    return out


_manager: MCPManager | None = None


def get_mcp() -> MCPManager:
    global _manager
    if _manager is None:
        _manager = MCPManager(get_settings().mcp_config_path)
        _manager.load()
    return _manager
