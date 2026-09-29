"""Code interpreter tool: bridges the chat engine with the Python sandbox."""

from __future__ import annotations

import base64
import logging
from pathlib import Path
from typing import Any

from ..config import get_settings
from ..db import get_db
from ..files import public_file, store_bytes

log = logging.getLogger(__name__)

TOOL_NAME = "python"
MAX_PULL_BYTES = 200 * 1024 * 1024

TOOL_DESCRIPTION = (
    "Execute Python code in a stateful Jupyter sandbox (variables persist across calls). "
    "The current working directory contains the user's uploaded files; save every output file "
    "(edited documents, spreadsheets, decks, charts, PDFs) into the current working directory so the "
    "user can download it. Available: pandas, numpy, matplotlib, openpyxl, python-docx, python-pptx, "
    "pypdf, reportlab, and to_pdf(path) for converting Office files to PDF. Charts shown with "
    "plt.show() are displayed to the user. No internet access."
)

FUNCTION_TOOL_RESPONSES = {
    "type": "function",
    "name": TOOL_NAME,
    "description": TOOL_DESCRIPTION,
    "parameters": {
        "type": "object",
        "properties": {"code": {"type": "string", "description": "Python source code to execute."}},
        "required": ["code"],
        "additionalProperties": False,
    },
}

FUNCTION_TOOL_CHAT = {
    "type": "function",
    "function": {k: v for k, v in FUNCTION_TOOL_RESPONSES.items() if k != "type"},
}

_sandbox: Any = None


def get_sandbox() -> Any:
    global _sandbox
    if _sandbox is None:
        s = get_settings()
        if s.sandbox_url:
            from ..sandbox.remote import RemoteSandbox

            _sandbox = RemoteSandbox(s.sandbox_url, s.sandbox_token, s.sandbox_exec_timeout_s)
        else:
            from ..sandbox.kernels import LocalSandbox

            _sandbox = LocalSandbox(
                root=s.data_path / "sandbox",
                exec_timeout=s.sandbox_exec_timeout_s,
                idle_timeout=s.sandbox_idle_timeout_s,
                max_sessions=s.sandbox_max_sessions,
                soffice=s.libreoffice_path or None,
            )
    return _sandbox


async def sync_files(conversation_id: str) -> list[dict]:
    """Make sure every file of the conversation exists in the sandbox workspace."""
    db = get_db()
    sandbox = get_sandbox()
    files = db.list_files(conversation_id)
    present = {f["path"] for f in await sandbox.list_files(conversation_id)}
    synced = []
    for f in files:
        if f["source"] == "image":
            continue
        if f.get("sandbox_path") and f["sandbox_path"] in present:
            synced.append(f)
            continue
        if f["source"] == "generated" and f.get("sandbox_path"):
            # Generated file whose workspace copy vanished (sandbox restarted) - restore it in place.
            data = Path(f["path"]).read_bytes()
            rel = await sandbox.put_file(conversation_id, f["sandbox_path"], data, overwrite=True)
        else:
            data = Path(f["path"]).read_bytes()
            rel = await sandbox.put_file(conversation_id, f["name"], data)
        db.update_file(f["id"], sandbox_path=rel)
        f["sandbox_path"] = rel
        present.add(rel)
        synced.append(f)
    return synced


async def run_code(conversation_id: str, user: str, code: str) -> tuple[str, dict]:
    """Execute code; returns (text for the model, rich payload for the UI)."""
    sandbox = get_sandbox()
    try:
        await sync_files(conversation_id)
        result = await sandbox.execute(conversation_id, code)
    except Exception as exc:
        log.exception("Sandbox execution failed")
        msg = f"Sandbox error: {exc}"
        return msg, {"stdout": "", "stderr": "", "results": [], "error": {"name": "SandboxError", "value": str(exc)},
                     "images": [], "files": [], "duration_ms": 0}

    images = []
    for i, b64 in enumerate(result.get("images", []), 1):
        rec = store_bytes(user, f"figure-{i}.png", base64.b64decode(b64), source="image", conversation_id=conversation_id)
        images.append(public_file(rec))

    # Files are synced before the pre-execution snapshot, so anything reported here was
    # created or modified by the code itself (including uploads edited in place).
    out_files = []
    for ch in result.get("files", []):
        rel = ch["path"]
        if ch["size"] > MAX_PULL_BYTES:
            continue
        data = await sandbox.read_file(conversation_id, rel)
        rec = store_bytes(user, Path(rel).name, data, source="generated", conversation_id=conversation_id,
                          sandbox_path=rel)
        out_files.append(public_file(rec))

    # ---- text returned to the model ----------------------------------------------------------
    lines: list[str] = []
    if result.get("stdout"):
        lines.append(f"stdout:\n{result['stdout']}")
    if result.get("results"):
        lines.append("result:\n" + "\n".join(result["results"]))
    if result.get("stderr"):
        lines.append(f"stderr:\n{result['stderr']}")
    if result.get("error"):
        err = result["error"]
        lines.append(f"ERROR {err.get('name')}: {err.get('value')}\n{err.get('traceback', '')}")
    if images:
        lines.append(f"[{len(images)} chart/image(s) displayed to the user]")
    if out_files:
        listing = ", ".join(f"{f['sandbox_path']} ({f['size']:,} bytes)" for f in out_files)
        lines.append(f"Files created/updated (the user can download them from the chat): {listing}")
    text = "\n\n".join(lines) or "(no output)"

    payload = {
        "stdout": result.get("stdout", ""),
        "stderr": result.get("stderr", ""),
        "results": result.get("results", []),
        "error": result.get("error"),
        "images": images,
        "files": out_files,
        "duration_ms": result.get("duration_ms", 0),
    }
    return text, payload
