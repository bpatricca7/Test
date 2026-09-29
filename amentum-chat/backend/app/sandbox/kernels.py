"""Stateful Python code interpreter built on Jupyter kernels.

Each conversation gets its own kernel and working directory. Variables persist
between tool calls, uploaded files are placed in the working directory, and any
file the code creates or modifies is detected and handed back to the chat.

Runs in two places with the same code:
  * embedded in the backend process (developer laptops), or
  * inside the locked-down ``sandbox`` container (no network, non-root) that
    the backend reaches over HTTP (GCC High / production).
"""

from __future__ import annotations

import asyncio
import base64
import logging
import os
import re
import shutil
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .convert import find_soffice

log = logging.getLogger(__name__)

ANSI_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
SKIP_DIRS = {"__pycache__", ".ipynb_checkpoints", ".cache", ".config", ".local", ".matplotlib", ".ipython"}
MAX_STREAM_CHARS = 20_000
MAX_IMAGES = 8

STARTUP_CODE = r'''
import os as _os, warnings as _w
_w.filterwarnings("ignore")
DATA_DIR = _os.getcwd()
try:
    import matplotlib as _mpl
    from cycler import cycler as _cycler
    _mpl.rcParams.update({
        "figure.dpi": 110, "figure.figsize": (8, 4.5), "axes.spines.top": False, "axes.spines.right": False,
        "axes.grid": True, "grid.alpha": 0.25, "font.size": 10,
        "axes.prop_cycle": _cycler(color=["#30448B", "#009D4F", "#5B8DEF", "#F2A541", "#8E6CEF", "#4B4F58"]),
    })
    get_ipython().run_line_magic("matplotlib", "inline")
except Exception:
    pass
try:
    import pandas as _pd
    _pd.set_option("display.max_columns", 50); _pd.set_option("display.width", 200)
except Exception:
    pass

def to_pdf(path, outdir=None):
    """Convert a Word/Excel/PowerPoint file to PDF with LibreOffice. Returns the PDF path."""
    import subprocess, shutil, tempfile
    soffice = SOFFICE or shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        raise RuntimeError("LibreOffice is not installed in this sandbox")
    outdir = outdir or _os.path.dirname(_os.path.abspath(path)) or "."
    profile = tempfile.mkdtemp(prefix="lo_")
    subprocess.run([soffice, f"-env:UserInstallation=file://{profile}", "--headless", "--convert-to", "pdf",
                    "--outdir", outdir, path], check=True, capture_output=True, timeout=180)
    pdf = _os.path.join(outdir, _os.path.splitext(_os.path.basename(path))[0] + ".pdf")
    return _os.path.relpath(pdf) if _os.path.abspath(pdf).startswith(_os.getcwd()) else pdf
'''


def _safe_rel(root: Path, rel: str) -> Path:
    p = (root / rel).resolve()
    if root.resolve() not in p.parents and p != root.resolve():
        raise ValueError("Path escapes the sandbox workspace")
    return p


def _snapshot(root: Path) -> dict[str, tuple[int, int]]:
    snap: dict[str, tuple[int, int]] = {}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
        for fn in filenames:
            if fn.startswith("."):
                continue
            p = Path(dirpath) / fn
            try:
                st = p.stat()
            except OSError:
                continue
            snap[p.relative_to(root).as_posix()] = (st.st_mtime_ns, st.st_size)
    return snap


def _clip(text: str, limit: int = MAX_STREAM_CHARS) -> str:
    if len(text) <= limit:
        return text
    head = text[: limit // 2]
    tail = text[-limit // 2 :]
    return f"{head}\n… [{len(text) - limit} characters truncated] …\n{tail}"


def _kernel_env(workdir: Path) -> dict[str, str]:
    """Minimal environment: never leak API keys / client secrets into model-written code."""
    keep = ("PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "TZ", "TMP", "TEMP", "TMPDIR",
            "LD_LIBRARY_PATH", "VIRTUAL_ENV", "CONDA_PREFIX", "PYTHONHOME", "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS")
    env = {k: v for k, v in os.environ.items() if k in keep}
    home = workdir.parent / ".home"
    home.mkdir(parents=True, exist_ok=True)
    env.update(
        HOME=str(home),
        USERPROFILE=str(home),
        MPLCONFIGDIR=str(home / ".matplotlib"),
        PYTHONUNBUFFERED="1",
        PYDEVD_DISABLE_FILE_VALIDATION="1",
        JUPYTER_PLATFORM_DIRS="1",
    )
    return env


@dataclass
class Session:
    id: str
    workdir: Path
    km: Any
    kc: Any
    last_used: float = field(default_factory=time.time)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class LocalSandbox:
    """Kernel pool keyed by session id (= conversation id)."""

    def __init__(self, root: Path, exec_timeout: int = 180, idle_timeout: int = 1800, max_sessions: int = 24,
                 soffice: str | None = None):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.exec_timeout = exec_timeout
        self.idle_timeout = idle_timeout
        self.max_sessions = max_sessions
        self.soffice = soffice or find_soffice()
        self._sessions: dict[str, Session] = {}
        self._create_lock = asyncio.Lock()
        self._reaper: asyncio.Task | None = None

    # ---- lifecycle ---------------------------------------------------------------------------
    def start_reaper(self) -> None:
        if self._reaper is None:
            self._reaper = asyncio.create_task(self._reap_loop())

    async def _reap_loop(self) -> None:
        while True:
            await asyncio.sleep(60)
            cutoff = time.time() - self.idle_timeout
            for sid, s in list(self._sessions.items()):
                if s.last_used < cutoff and not s.lock.locked():
                    log.info("Reaping idle sandbox kernel %s", sid)
                    await self._shutdown(sid)

    async def close(self) -> None:
        if self._reaper:
            self._reaper.cancel()
        for sid in list(self._sessions):
            await self._shutdown(sid)

    async def _shutdown(self, sid: str) -> None:
        s = self._sessions.pop(sid, None)
        if not s:
            return
        try:
            s.kc.stop_channels()
            await s.km.shutdown_kernel(now=True)
        except Exception:  # pragma: no cover
            log.exception("Kernel shutdown failed for %s", sid)

    def workdir(self, sid: str) -> Path:
        if not re.fullmatch(r"[A-Za-z0-9_\-]{1,80}", sid):
            raise ValueError("invalid session id")
        d = self.root / sid / "work"
        d.mkdir(parents=True, exist_ok=True)
        return d

    async def ensure_session(self, sid: str) -> tuple[Session, bool]:
        async with self._create_lock:
            s = self._sessions.get(sid)
            if s is not None:
                if await s.km.is_alive():
                    s.last_used = time.time()
                    return s, False
                await self._shutdown(sid)
            if len(self._sessions) >= self.max_sessions:
                lru = min(self._sessions.values(), key=lambda x: x.last_used)
                await self._shutdown(lru.id)
            s = await self._start(sid)
            self._sessions[sid] = s
            return s, True

    async def _start(self, sid: str) -> Session:
        from jupyter_client.manager import AsyncKernelManager

        workdir = self.workdir(sid)
        km = AsyncKernelManager(kernel_name="python3")
        await km.start_kernel(cwd=str(workdir), env=_kernel_env(workdir))
        kc = km.client()
        kc.start_channels()
        await kc.wait_for_ready(timeout=90)
        session = Session(id=sid, workdir=workdir, km=km, kc=kc)
        boot = f"SOFFICE = {self.soffice!r}\n" + STARTUP_CODE
        await self._run(session, boot, timeout=90)
        log.info("Started sandbox kernel for %s (python=%s)", sid, sys.executable)
        return session

    async def has_session(self, sid: str) -> bool:
        s = self._sessions.get(sid)
        return bool(s and await s.km.is_alive())

    async def reset(self, sid: str, wipe_files: bool = False) -> None:
        await self._shutdown(sid)
        if wipe_files:
            shutil.rmtree(self.root / sid, ignore_errors=True)

    # ---- execution -------------------------------------------------------------------------------
    async def execute(self, sid: str, code: str, timeout: int | None = None) -> dict[str, Any]:
        session, created = await self.ensure_session(sid)
        async with session.lock:
            before = _snapshot(session.workdir)
            started = time.time()
            result = await self._run(session, code, timeout or self.exec_timeout)
            after = _snapshot(session.workdir)
            session.last_used = time.time()
        changed = [
            {"path": p, "size": sz}
            for p, (mt, sz) in sorted(after.items())
            if p not in before or before[p] != (mt, sz)
        ]
        result.update(files=changed, duration_ms=int((time.time() - started) * 1000), new_session=created)
        return result

    async def _run(self, session: Session, code: str, timeout: float) -> dict[str, Any]:
        kc = session.kc
        msg_id = kc.execute(code, store_history=True, allow_stdin=False, stop_on_error=True)
        stdout: list[str] = []
        stderr: list[str] = []
        results: list[str] = []
        images: list[str] = []
        error: dict[str, Any] | None = None
        deadline = time.monotonic() + timeout
        timed_out = False
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                if timed_out:
                    break  # kernel ignored the interrupt; give up draining
                timed_out = True
                await session.km.interrupt_kernel()
                deadline = time.monotonic() + 10  # drain output produced before the interrupt
                remaining = 10
            try:
                msg = await kc.get_iopub_msg(timeout=remaining)
            except Exception:  # queue.Empty on timeout
                if timed_out:
                    break
                continue
            if msg.get("parent_header", {}).get("msg_id") != msg_id:
                continue
            mtype = msg["header"]["msg_type"]
            content = msg["content"]
            if mtype == "stream":
                (stdout if content.get("name") == "stdout" else stderr).append(content.get("text", ""))
            elif mtype in ("execute_result", "display_data"):
                data = content.get("data", {})
                if "image/png" in data and len(images) < MAX_IMAGES:
                    images.append(data["image/png"])
                elif "text/plain" in data:
                    results.append(data["text/plain"])
            elif mtype == "error":
                tb = "\n".join(ANSI_RE.sub("", line) for line in content.get("traceback", []))
                error = {"name": content.get("ename"), "value": content.get("evalue"), "traceback": _clip(tb, 6000)}
            elif mtype == "status" and content.get("execution_state") == "idle":
                break
        if timed_out:
            error = {"name": "TimeoutError", "value": f"Execution exceeded {int(timeout)}s and was interrupted.",
                     "traceback": ""}
        return {
            "stdout": _clip("".join(stdout)),
            "stderr": _clip(ANSI_RE.sub("", "".join(stderr)), 8000),
            "results": [_clip(r, 8000) for r in results],
            "images": images,  # base64 PNG
            "error": error,
        }

    # ---- files ---------------------------------------------------------------------------------------
    async def put_file(self, sid: str, name: str, data: bytes, overwrite: bool = False) -> str:
        wd = self.workdir(sid)
        name = Path(name.replace("\\", "/")).name
        target = _safe_rel(wd, name)
        if target.exists() and not overwrite:
            if target.read_bytes() == data:
                return target.relative_to(wd).as_posix()
            stem, suffix = target.stem, target.suffix
            i = 1
            while target.exists():
                target = wd / f"{stem} ({i}){suffix}"
                i += 1
        target.write_bytes(data)
        return target.relative_to(wd).as_posix()

    async def read_file(self, sid: str, rel: str) -> bytes:
        return _safe_rel(self.workdir(sid), rel).read_bytes()

    async def list_files(self, sid: str) -> list[dict[str, Any]]:
        wd = self.workdir(sid)
        return [{"path": p, "size": sz} for p, (_, sz) in sorted(_snapshot(wd).items())]

    async def convert_pdf(self, name: str, data: bytes) -> bytes:
        from .convert import convert_to_pdf

        return await convert_to_pdf(name, data, self.soffice)

    def info(self) -> dict[str, Any]:
        return {
            "mode": "embedded",
            "python": sys.version.split()[0],
            "active_sessions": len(self._sessions),
            "libreoffice": bool(self.soffice),
        }


def b64_to_bytes(b64: str) -> bytes:
    return base64.b64decode(b64)
