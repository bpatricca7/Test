"""HTTP server: JSON API for agents and the UI, a live event stream, and static files.

Standard library only. One process owns the SQLite file; agents and the UI all
talk to it over HTTP, so every change shows up on the board immediately.
"""

from __future__ import annotations

import hmac
import ipaddress
import json
import mimetypes
import os
import re
import sys
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlsplit

from . import __version__
from .store import HUMAN, Store, StoreError

PACKAGE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(PACKAGE_DIR, "static")
PROJECT_DIR = os.path.dirname(PACKAGE_DIR)
MAX_BODY = 1_000_000

LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1"}

ROUTES: list[tuple[str, re.Pattern[str], str]] = [
    (method, re.compile(f"^{pattern}$"), name)
    for method, pattern, name in [
        ("GET", r"/api/health", "health"),
        ("GET", r"/api/config", "config"),
        ("GET", r"/api/board", "board"),
        ("GET", r"/api/tasks", "list_tasks"),
        ("POST", r"/api/tasks", "create_task"),
        ("POST", r"/api/tasks/next", "claim_next"),
        ("GET", r"/api/tasks/(\d+)", "get_task"),
        ("PATCH", r"/api/tasks/(\d+)", "update_task"),
        ("DELETE", r"/api/tasks/(\d+)", "delete_task"),
        ("POST", r"/api/tasks/(\d+)/(claim|heartbeat|log|complete|block|release|reply|approve|reject)", "task_action"),
        ("GET", r"/api/agents", "agents"),
        ("GET", r"/api/events", "events"),
        ("GET", r"/api/stream", "stream"),
    ]
]

PUBLIC_PATHS = {"/api/health"}


class HttpError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def _is_loopback(host: str) -> bool:
    if host in LOOPBACK_HOSTS:
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _host_only(host_header: str) -> str:
    host = host_header.strip().lower()
    if host.startswith("["):
        return host[1:].split("]", 1)[0]
    return host.rsplit(":", 1)[0] if host.count(":") == 1 else host


class App:
    def __init__(self, store: Store, host: str = "127.0.0.1", port: int = 6400, token: str | None = None):
        self.store = store
        self.host = host
        self.port = port
        self.token = token or None
        self.stopping = threading.Event()
        self.loopback_only = _is_loopback(host)


class Handler(BaseHTTPRequestHandler):
    server_version = f"AGENTDOS/{__version__}"
    app: App  # set by make_server
    verbose = False

    # ── plumbing ─────────────────────────────────────────────────────────────

    def log_message(self, fmt: str, *args: Any) -> None:  # noqa: D401 - stdlib signature
        if self.verbose:
            sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))

    def _send(self, status: int, body: bytes, ctype: str, extra: dict[str, str] | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, status: int, payload: Any) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self._send(status, body, "application/json; charset=utf-8")

    def _error(self, status: int, message: str) -> None:
        self._json(status, {"error": message, "status": status})

    def _query(self) -> dict[str, str]:
        qs = parse_qs(urlsplit(self.path).query)
        return {k: v[-1] for k, v in qs.items()}

    def _body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            raise HttpError(413, "request body too large")
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise HttpError(400, "body must be valid JSON") from None
        if not isinstance(data, dict):
            raise HttpError(400, "body must be a JSON object")
        return data

    def _actor(self, body: dict[str, Any] | None = None) -> str | None:
        """Who is calling: X-Agent header, then 'agent' in the body or query string."""
        name = self.headers.get("X-Agent") or (body or {}).get("agent") or self._query().get("agent")
        return name.strip() if isinstance(name, str) and name.strip() else None

    # ── guards ───────────────────────────────────────────────────────────────

    def _guard(self, path: str) -> None:
        app = self.app
        # DNS-rebinding protection: a loopback-bound server only answers to loopback names.
        if app.loopback_only:
            host = _host_only(self.headers.get("Host", ""))
            if host and not _is_loopback(host):
                raise HttpError(403, "unexpected Host header")
        if self.command in ("POST", "PATCH", "DELETE"):
            # Cross-site request forgery protection. Browsers always send Origin on
            # cross-origin writes; requiring a JSON content type also forces a CORS
            # preflight, which this server never approves.
            origin = self.headers.get("Origin")
            if origin and origin != "null":
                o = urlsplit(origin)
                if o.netloc.lower() != (self.headers.get("Host") or "").lower():
                    raise HttpError(403, "cross-origin request refused")
            elif origin == "null":
                raise HttpError(403, "cross-origin request refused")
            if self.command != "DELETE":
                ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
                if ctype != "application/json":
                    raise HttpError(415, "send Content-Type: application/json")
        if app.token and path.startswith("/api/") and path not in PUBLIC_PATHS:
            supplied = ""
            auth = self.headers.get("Authorization") or ""
            if auth.lower().startswith("bearer "):
                supplied = auth[7:].strip()
            supplied = supplied or self.headers.get("X-Agentdos-Token") or self._query().get("token", "")
            if not hmac.compare_digest(supplied.encode(), app.token.encode()):
                raise HttpError(401, "access token required")

    # ── dispatch ─────────────────────────────────────────────────────────────

    def do_GET(self) -> None:
        self._dispatch()

    def do_HEAD(self) -> None:
        self._dispatch()

    def do_POST(self) -> None:
        self._dispatch()

    def do_PATCH(self) -> None:
        self._dispatch()

    def do_DELETE(self) -> None:
        self._dispatch()

    def do_PUT(self) -> None:
        self._dispatch()  # no PUT routes; answers 405 rather than the stdlib's 501

    def _dispatch(self) -> None:
        path = urlsplit(self.path).path
        try:
            self._guard(path)
            if not path.startswith("/api/"):
                if self.command not in ("GET", "HEAD"):
                    raise HttpError(405, "method not allowed")
                return self._static(path)
            method = "GET" if self.command == "HEAD" else self.command
            path_matched = False
            for route_method, pattern, name in ROUTES:
                match = pattern.match(path)
                if not match:
                    continue
                path_matched = True
                if route_method == method:
                    return getattr(self, "api_" + name)(*match.groups())
            raise HttpError(405 if path_matched else 404, "method not allowed" if path_matched else "not found")
        except HttpError as exc:
            self._error(exc.status, exc.message)
        except StoreError as exc:
            self._error(exc.status, str(exc))
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as exc:  # pragma: no cover - last-resort guard
            sys.stderr.write(f"AGENTDOS internal error: {exc!r}\n")
            try:
                self._error(500, "internal error")
            except OSError:
                pass

    # ── static files ─────────────────────────────────────────────────────────

    def _static(self, path: str) -> None:
        if path in ("/", "/index.html"):
            file = os.path.join(STATIC_DIR, "index.html")
        elif path == "/AGENTS.md":
            file = os.path.join(PROJECT_DIR, "AGENTS.md")
            if not os.path.isfile(file):
                file = os.path.join(STATIC_DIR, "AGENTS.md")
        elif path == "/favicon.ico":
            file = os.path.join(STATIC_DIR, "favicon.svg")
        elif path.startswith("/static/"):
            file = os.path.realpath(os.path.join(STATIC_DIR, path[len("/static/"):]))
            if not file.startswith(os.path.realpath(STATIC_DIR) + os.sep):
                raise HttpError(404, "not found")
        else:
            raise HttpError(404, "not found")
        if not os.path.isfile(file):
            raise HttpError(404, "not found")
        ctype = mimetypes.guess_type(file)[0] or "application/octet-stream"
        if file.endswith(".md"):
            ctype = "text/markdown"
        if file.endswith(".js"):
            ctype = "text/javascript"
        if ctype.startswith("text/") or ctype.endswith(("javascript", "json", "svg+xml")):
            ctype += "; charset=utf-8"
        with open(file, "rb") as fh:
            body = fh.read()
        extra = {}
        if file.endswith(".html"):
            extra = {
                "Content-Security-Policy": (
                    "default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; "
                    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
                    "font-src 'self' https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'none'"
                ),
                "X-Frame-Options": "DENY",
            }
        self._send(200, body, ctype, extra)

    # ── API ──────────────────────────────────────────────────────────────────

    def _note_agent(self) -> None:
        name = self._actor()
        if name and name.lower() != HUMAN:
            try:
                self.app.store.seen(name)
            except StoreError:
                pass

    def api_health(self) -> None:
        self._json(200, {"ok": True, "name": "AGENTDOS", "version": __version__, "auth": bool(self.app.token)})

    def api_config(self) -> None:
        host = self.headers.get("Host") or f"{self.app.host}:{self.app.port}"
        dos = os.path.join(PROJECT_DIR, "dos.py")
        # How an agent should launch AGENTDOS on this machine (shown in "Connect an agent").
        launcher = [sys.executable or "python3", dos] if os.path.isfile(dos) else ["agentdos"]
        self._json(200, {
            "version": __version__,
            "url": f"http://{host}",
            "launcher": launcher,
            "auth": bool(self.app.token),
        })

    def api_board(self) -> None:
        self._note_agent()
        self._json(200, self.app.store.board())

    def api_list_tasks(self) -> None:
        self._note_agent()
        q = self._query()
        status = [s for s in q.get("status", "").split(",") if s] or None
        tasks = self.app.store.list_tasks(
            status=status,
            assignee=q.get("assignee"),
            tag=q.get("tag"),
            available_for=q.get("available_for"),
            query=q.get("q"),
            limit=int(q.get("limit") or 500),
        )
        self._json(200, {"tasks": tasks})

    def api_create_task(self) -> None:
        body = self._body()
        actor = self._actor(body) or HUMAN
        body.pop("agent", None)
        self._json(201, self.app.store.create_task(body, actor=actor))

    def api_claim_next(self) -> None:
        body = self._body()
        task = self.app.store.claim_next(self._actor(body), tags=body.get("tags"),
                                         lease_seconds=body.get("lease_seconds"))
        self._json(200, {"task": task})

    def api_get_task(self, task_id: str) -> None:
        self._note_agent()
        self._json(200, self.app.store.get_task(int(task_id)))

    def api_update_task(self, task_id: str) -> None:
        body = self._body()
        actor = self._actor(body) or HUMAN
        body.pop("agent", None)
        self._json(200, self.app.store.update_task(int(task_id), body, actor=actor))

    def api_delete_task(self, task_id: str) -> None:
        self.app.store.delete_task(int(task_id), actor=self._actor() or HUMAN)
        self._json(200, {"deleted": int(task_id)})

    def api_task_action(self, task_id: str, action: str) -> None:
        store, tid = self.app.store, int(task_id)
        body = self._body()
        agent = self._actor(body)
        lease = body.get("lease_seconds")
        msg = body.get("message")
        if action == "claim":
            task = store.claim(tid, agent, lease)
        elif action == "heartbeat":
            task = store.heartbeat(tid, agent, lease)
        elif action == "log":
            task = store.comment(tid, msg, actor=agent or HUMAN)
        elif action == "complete":
            task = store.complete(tid, agent, body.get("result", msg))
        elif action == "block":
            task = store.block(tid, agent, body.get("question", msg))
        elif action == "release":
            task = store.release(tid, agent, body.get("reason", msg) or "")
        elif action == "reply":
            task = store.reply(tid, msg, actor=agent or HUMAN)
        elif action == "approve":
            task = store.approve(tid, msg or "", actor=agent or HUMAN)
        else:  # reject
            task = store.reject(tid, body.get("feedback", msg), actor=agent or HUMAN)
        self._json(200, task)

    def api_agents(self) -> None:
        self._json(200, {"agents": self.app.store.agents()})

    def api_events(self) -> None:
        q = self._query()
        self._json(200, {"events": self.app.store.events(limit=int(q.get("limit") or 60),
                                                          since_id=int(q.get("since") or 0))})

    def api_stream(self) -> None:
        """Server-sent events: a 'change' event whenever the board changes."""
        store, app = self.app.store, self.app
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        version = store.version
        self.wfile.write(f"retry: 3000\nevent: change\ndata: {version}\n\n".encode())
        self.wfile.flush()
        while not app.stopping.is_set():
            new = store.wait_for_change(version, timeout=15)
            if app.stopping.is_set():
                break
            if new != version:
                version = new
                # Coalesce bursts (an agent posting several updates at once).
                time.sleep(0.05)
                version = store.version
                self.wfile.write(f"event: change\ndata: {version}\n\n".encode())
            else:
                self.wfile.write(b": keep-alive\n\n")
            self.wfile.flush()


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def make_server(app: App, verbose: bool = False) -> Server:
    handler = type("BoundHandler", (Handler,), {"app": app, "verbose": verbose})
    return Server((app.host, app.port), handler)


def _sweeper(app: App) -> None:
    while not app.stopping.wait(5):
        try:
            app.store.sweep()
        except Exception as exc:  # pragma: no cover
            sys.stderr.write(f"lease sweep failed: {exc!r}\n")


def start_background(app: App, verbose: bool = False) -> tuple[Server, threading.Thread]:
    """Start the server in a thread (used by tests and embedding)."""
    server = make_server(app, verbose)
    app.port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    threading.Thread(target=_sweeper, args=(app,), daemon=True).start()
    return server, thread


def stop(app: App, server: Server) -> None:
    app.stopping.set()
    app.store.wake_all()
    server.shutdown()
    server.server_close()


BANNER = r"""
  ▄▀▄ █▀▀ █▀▀ █▄ █ ▀█▀ █▀▄ █▀█ █▀
  █▀█ █▄█ ██▄ █ ▀█  █  █▄▀ █▄█ ▄█   v{version}
"""


def serve(app: App, verbose: bool = False) -> None:
    try:
        server = make_server(app, verbose)
    except OSError as exc:
        sys.exit(f"Cannot listen on {app.host}:{app.port}: {exc.strerror or exc}. Try --port.")
    app.port = server.server_address[1]
    threading.Thread(target=_sweeper, args=(app,), daemon=True).start()
    shown_host = "127.0.0.1" if app.host in ("", "0.0.0.0") else app.host
    url = f"http://{shown_host}:{app.port}"
    print(BANNER.format(version=__version__))
    print(f"  Board ......... {url}")
    print(f"  Database ...... {app.store.path}")
    print(f"  Agent docs .... {url}/AGENTS.md")
    print(f"  Access token .. {'required' if app.token else 'off (local only)'}")
    if not app.loopback_only and not app.token:
        print("\n  WARNING: listening beyond localhost with no --token. Anyone who can reach this")
        print("  port can add tasks that your agents will act on. Set --token or AGENTDOS_TOKEN.")
    print("\n  Ctrl+C to stop.\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  AGENTDOS shut down. Goodbye.")
    finally:
        app.stopping.set()
        app.store.wake_all()
        server.server_close()
        app.store.close()
