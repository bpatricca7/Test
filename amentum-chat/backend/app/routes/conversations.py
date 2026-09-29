"""Conversation history."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..auth import User, current_user
from ..db import get_db
from ..files import public_file

router = APIRouter()


class ConversationPatch(BaseModel):
    title: str | None = None
    pinned: bool | None = None


@router.get("/conversations")
async def list_conversations(q: str = "", user: User = Depends(current_user)) -> list[dict]:
    rows = get_db().list_conversations(user.id, q.strip())
    return [{"id": r["id"], "title": r["title"], "model": r["model"], "pinned": bool(r["pinned"]),
             "created_at": r["created_at"], "updated_at": r["updated_at"], "cost_usd": r["cost_usd"]} for r in rows]


@router.get("/conversations/{cid}")
async def get_conversation(cid: str, user: User = Depends(current_user)) -> dict:
    db = get_db()
    conv = db.get_conversation(cid, user.id)
    if conv is None:
        raise HTTPException(404, "Conversation not found")
    messages = db.list_messages(cid)
    for m in messages:
        m.pop("conversation_id", None)
    return {
        "id": conv["id"], "title": conv["title"], "model": conv["model"], "pinned": bool(conv["pinned"]),
        "created_at": conv["created_at"], "updated_at": conv["updated_at"], "messages": messages,
        "files": [public_file(f) for f in db.list_files(cid) if f["source"] != "image"],
    }


@router.patch("/conversations/{cid}")
async def patch_conversation(cid: str, body: ConversationPatch, user: User = Depends(current_user)) -> dict:
    db = get_db()
    if db.get_conversation(cid, user.id) is None:
        raise HTTPException(404, "Conversation not found")
    fields = {}
    if body.title is not None:
        fields["title"] = body.title.strip()[:120] or "Untitled"
    if body.pinned is not None:
        fields["pinned"] = int(body.pinned)
    db.update_conversation(cid, **fields)
    return {"ok": True}


@router.delete("/conversations/{cid}")
async def delete_conversation(cid: str, user: User = Depends(current_user)) -> dict:
    db = get_db()
    if db.get_conversation(cid, user.id) is None:
        raise HTTPException(404, "Conversation not found")
    for p in db.delete_conversation(cid):
        Path(p).unlink(missing_ok=True)
    try:
        from ..tools.code_interpreter import get_sandbox

        await get_sandbox().reset(cid, wipe_files=True)
    except Exception:  # noqa: BLE001 - sandbox may be offline; files are already gone from storage
        pass
    return {"ok": True}
