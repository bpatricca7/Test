"""App configuration, health, diagnostics and usage reporting."""

from __future__ import annotations

import time

from fastapi import APIRouter, Depends, HTTPException

from ..auth import User, current_user
from ..catalog import get_catalog
from ..config import get_settings
from ..db import get_db
from ..llm.clients import describe_endpoint, get_client

router = APIRouter()


@router.get("/config")
async def app_config(user: User = Depends(current_user)) -> dict:
    s = get_settings()
    catalog = get_catalog()
    return {
        "app_name": s.app_name,
        "tagline": s.app_tagline,
        "banner": {"text": s.ui_banner_text, "color": s.ui_banner_color} if s.ui_banner_text else None,
        "provider": s.llm_provider,
        "provider_label": s.provider_label,
        "models": [m.public() for m in catalog.all()],
        "default_model": catalog.get(s.default_model).id,
        "code_interpreter": s.code_interpreter,
        "reasoning_summary": s.reasoning_summary,
        "show_usage_default": s.show_usage_by_default,
        "max_upload_mb": s.max_upload_mb,
        "user": {"id": user.id, "name": user.name, "is_admin": user.is_admin},
        "problems": s.validate_runtime(),
    }


@router.get("/health")
async def health() -> dict:
    return {"ok": True, "time": time.time()}


@router.get("/diagnostics")
async def diagnostics(probe: bool = False, user: User = Depends(current_user)) -> dict:
    """Connection details for the status panel. probe=true makes a tiny live model call."""
    from ..tools.code_interpreter import get_sandbox
    from ..tools.mcp_manager import get_mcp

    s = get_settings()
    out: dict = {"llm": describe_endpoint(s), "problems": s.validate_runtime(), "code_interpreter": s.code_interpreter}
    sandbox = get_sandbox()
    try:
        out["sandbox"] = await sandbox.health() if hasattr(sandbox, "health") else {"ok": True, **sandbox.info()}
    except Exception as exc:  # noqa: BLE001
        out["sandbox"] = {"ok": False, "error": str(exc)}
    servers = get_mcp().list()
    out["connectors"] = {"total": len(servers), "connected": sum(1 for x in servers if x["status"] == "connected")}
    if probe:
        catalog = get_catalog()
        m = catalog.get(s.title_model)
        started = time.time()
        try:
            client = get_client(s.demo_base_url or None)
            if m.api == "chat":
                await client.chat.completions.create(model=m.deployment, messages=[{"role": "user", "content": "ping"}],
                                                     max_completion_tokens=16)
            else:
                await client.responses.create(model=m.deployment, input="Reply with: pong", store=False,
                                              max_output_tokens=16)
            out["probe"] = {"ok": True, "model": m.deployment, "latency_ms": int((time.time() - started) * 1000)}
        except Exception as exc:  # noqa: BLE001
            from ..llm.engine import friendly_error

            out["probe"] = {"ok": False, "model": m.deployment, "error": friendly_error(exc, m.deployment)}
    return out


@router.get("/usage")
async def usage(days: int = 30, scope: str = "me", user: User = Depends(current_user)) -> dict:
    if scope == "all" and not user.is_admin:
        raise HTTPException(403, "Organization-wide usage is limited to administrators")
    days = max(1, min(days, 365))
    data = get_db().usage_summary(None if scope == "all" else user.id, days)
    data["scope"] = scope
    data["pricing"] = {m.id: vars(m.pricing) for m in get_catalog().all()}
    data["labels"] = {m.id: m.label for m in get_catalog().all()}
    return data
