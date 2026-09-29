"""MCP data connectors."""

from __future__ import annotations

import sys
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..auth import User, current_user, require_connector_admin
from ..config import PROJECT_DIR, get_settings
from ..tools.mcp_manager import get_mcp, parse_import

router = APIRouter()


class ImportBody(BaseModel):
    json_text: str


def presets() -> list[dict[str, Any]]:
    sample = PROJECT_DIR / "mcp-servers" / "amentum-demo" / "server.py"
    items = [
        {
            "key": "sample-portfolio",
            "name": "Program Portfolio (sample)",
            "description": "Synthetic programs, risks, milestones and labor hours - try connectors in seconds.",
            "icon": "briefcase",
            "config": {"transport": "stdio", "command": sys.executable, "args": [str(sample)]},
        },
        {
            "key": "remote-http",
            "name": "Remote MCP server (HTTP)",
            "description": "Any Streamable HTTP MCP endpoint inside the Amentum network, e.g. a SharePoint, "
            "ServiceNow or SQL gateway.",
            "icon": "globe",
            "config": {"transport": "http", "url": "https://mcp.internal.amentum.com/mcp",
                       "headers": {"Authorization": "Bearer <token>"}},
        },
        {
            "key": "filesystem",
            "name": "File share",
            "description": "Read documents from a directory or mounted network share (official filesystem server, "
            "needs Node.js).",
            "icon": "folder",
            "config": {"transport": "stdio", "command": "npx",
                       "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\Shares\\Engineering"]},
        },
        {
            "key": "sqlite",
            "name": "SQLite database",
            "description": "Query a local SQLite database (reference server, needs uv).",
            "icon": "database",
            "config": {"transport": "stdio", "command": "uvx", "args": ["mcp-server-sqlite", "--db-path", "data.db"]},
        },
    ]
    if not get_settings().mcp_allow_stdio:
        items = [p for p in items if p["config"]["transport"] != "stdio"]
    return items


@router.get("/connectors")
async def list_connectors(user: User = Depends(current_user)) -> dict:
    s = get_settings()
    return {
        "servers": get_mcp().list(),
        "presets": presets(),
        "can_manage": not s.connectors_admin_only or user.is_admin,
        "allow_stdio": s.mcp_allow_stdio,
    }


@router.post("/connectors")
async def add_connector(body: dict[str, Any], user: User = Depends(current_user)) -> dict:
    require_connector_admin(user)
    try:
        return await get_mcp().add(body)
    except (ValueError, PermissionError) as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/connectors/test")
async def test_connector(body: dict[str, Any], user: User = Depends(current_user)) -> dict:
    require_connector_admin(user)
    try:
        return await get_mcp().test(body)
    except (ValueError, PermissionError) as exc:
        return {"ok": False, "error": str(exc), "tools": []}


@router.post("/connectors/import")
async def import_connectors(body: ImportBody, user: User = Depends(current_user)) -> list[dict]:
    require_connector_admin(user)
    try:
        configs = parse_import(body.json_text)
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, f"Could not read that JSON: {exc}") from exc
    out = []
    for cfg in configs:
        try:
            out.append(await get_mcp().add(cfg))
        except (ValueError, PermissionError) as exc:
            out.append({"name": cfg.get("name"), "status": "error", "error": str(exc)})
    return out


@router.put("/connectors/{sid}")
async def update_connector(sid: str, body: dict[str, Any], user: User = Depends(current_user)) -> dict:
    require_connector_admin(user)
    if get_mcp().get(sid) is None:
        raise HTTPException(404, "Connector not found")
    try:
        return await get_mcp().update(sid, body)
    except (ValueError, PermissionError) as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/connectors/{sid}/reconnect")
async def reconnect(sid: str, user: User = Depends(current_user)) -> dict:
    if get_mcp().get(sid) is None:
        raise HTTPException(404, "Connector not found")
    return await get_mcp().reconnect(sid)


@router.delete("/connectors/{sid}")
async def delete_connector(sid: str, user: User = Depends(current_user)) -> dict:
    require_connector_admin(user)
    await get_mcp().remove(sid)
    return {"ok": True}
