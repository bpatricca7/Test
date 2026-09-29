"""POST /api/chat - run one turn and stream events (Server-Sent Events)."""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..auth import User, current_user
from ..catalog import get_catalog
from ..config import get_settings
from ..db import get_db, new_id
from ..files import public_file
from ..llm.engine import Turn, TurnRequest, friendly_error, generate_title
from ..llm.parts import sse

log = logging.getLogger(__name__)
router = APIRouter()

ACTIVE: dict[str, tuple[asyncio.Task, str]] = {}  # assistant message id -> (task, user id)


class ChatRequest(BaseModel):
    message: str = ""
    conversation_id: str | None = None
    model: str | None = None
    effort: str | None = None
    attachments: list[str] = Field(default_factory=list)
    connectors: list[str] | None = None  # None = every connected server
    code_interpreter: bool = True
    edit_message_id: str | None = None  # re-run from this user message (edit / regenerate)


def _placeholder_title(text: str) -> str:
    text = " ".join(text.split())
    return (text[:57] + "…") if len(text) > 58 else (text or "New chat")


@router.post("/chat")
async def chat(req: ChatRequest, request: Request, user: User = Depends(current_user)) -> StreamingResponse:
    db = get_db()
    settings = get_settings()
    catalog = get_catalog()
    model = catalog.get(req.model)
    effort = req.effort if req.effort in model.efforts else (model.default_effort if model.reasoning else None)
    if not req.message.strip() and not req.attachments:
        raise HTTPException(400, "Message is empty")

    created = False
    if req.conversation_id:
        conv = db.get_conversation(req.conversation_id, user.id)
        if conv is None:
            raise HTTPException(404, "Conversation not found")
    else:
        conv = db.create_conversation(user.id, model.id, _placeholder_title(req.message))
        created = True
    cid = conv["id"]
    if req.edit_message_id:
        db.delete_messages_from(cid, req.edit_message_id)
    history = [m for m in db.list_messages(cid) if m["status"] != "streaming"]
    is_first = not any(m["role"] == "user" for m in history)

    files = []
    for fid in req.attachments:
        f = db.get_file(fid)
        if f is None or f["user"] != user.id:
            raise HTTPException(404, f"File {fid} not found")
        if f["conversation_id"] is None:
            db.update_file(fid, conversation_id=cid)
            f = db.get_file(fid)
        files.append(f)

    user_msg = db.add_message(cid, "user", content=req.message, attachments=[public_file(f) for f in files])
    assistant_id = new_id("msg")
    db.add_message(cid, "assistant", message_id=assistant_id, model=model.id, status="streaming")
    db.update_conversation(cid, model=model.id, updated_at=time.time())

    queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
    base_url = str(request.base_url).rstrip("/")
    turn_req = TurnRequest(
        user_id=user.id, conversation_id=cid, model=model, effort=effort, text=req.message, attachments=files,
        history=history, mcp_server_ids=req.connectors, use_code=req.code_interpreter, demo_base_url=base_url,
    )

    async def emit(ev: dict[str, Any]) -> None:
        await queue.put(ev)

    async def run() -> None:
        started = time.time()
        turn = Turn(turn_req, emit)
        status = "complete"
        try:
            await turn.run()
        except asyncio.CancelledError:
            status = "stopped"
        except Exception as exc:  # noqa: BLE001
            log.exception("Turn failed")
            status = "error"
            message = friendly_error(exc, model.deployment)
            await turn.emit({"type": "notice", "level": "error", "text": message})
        finally:
            turn.builder.finalize(stopped=status == "stopped")
            usage = turn.usage.as_dict(model.pricing)
            usage.update(model=model.id, effort=effort, duration_ms=int((time.time() - started) * 1000))
            db.update_message(assistant_id, content=turn.builder.text, parts=turn.builder.parts, usage=usage,
                              status=status)
            if turn.usage.calls:
                db.record_usage(user.id, model.id, usage, cid, assistant_id, "chat", usage["duration_ms"])
            queue.put_nowait({"type": "usage", "message_id": assistant_id, "usage": usage})
            ACTIVE.pop(assistant_id, None)
        # The answer is complete; the UI unlocks now. A title (first turn only) may follow.
        queue.put_nowait({"type": "done", "status": status, "message_id": assistant_id})
        if is_first and status == "complete" and settings.auto_title:
            try:
                title, t_usage, t_model = await asyncio.wait_for(
                    generate_title(req.message or files[0]["name"], base_url), timeout=25)
                if title:
                    db.update_conversation(cid, title=title)
                    queue.put_nowait({"type": "title", "conversation_id": cid, "title": title})
                if t_usage.calls:
                    db.record_usage(user.id, t_model.id, t_usage.as_dict(t_model.pricing), cid, assistant_id, "title")
            except Exception as exc:  # noqa: BLE001
                log.warning("Title generation failed: %s", exc)
        queue.put_nowait(None)

    task = asyncio.create_task(run())
    ACTIVE[assistant_id] = (task, user.id)

    async def stream():
        yield sse({"type": "meta", "conversation_id": cid, "created": created, "title": conv["title"],
                   "user_message_id": user_msg["id"], "assistant_message_id": assistant_id, "model": model.id,
                   "effort": effort})
        try:
            while True:
                ev = await queue.get()
                if ev is None:
                    break
                yield sse(ev)
        except asyncio.CancelledError:  # client went away -> stop the turn
            task.cancel()
            raise

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/chat/{message_id}/stop")
async def stop(message_id: str, user: User = Depends(current_user)) -> dict:
    entry = ACTIVE.get(message_id)
    if entry is None or entry[1] != user.id:
        return {"stopped": False}
    entry[0].cancel()
    return {"stopped": True}

