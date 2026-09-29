"""Amentum AI - FastAPI application entrypoint.

    uvicorn app.main:app --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .catalog import get_catalog
from .config import get_settings
from .db import get_db
from .routes import chat, connectors, conversations, files, system

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("amentum")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    for problem in settings.validate_runtime():
        log.warning("CONFIG: %s", problem)
    if settings.is_gov and settings.enforce_gov_endpoints and any("non-government" in p for p in settings.validate_runtime()):
        raise RuntimeError("Refusing to start: GCC High profile is pointed at a non-government endpoint.")
    get_catalog()
    get_db()
    log.info("Provider: %s | code interpreter: %s | models: %s", settings.provider_label, settings.code_interpreter,
             ", ".join(m.id for m in get_catalog().all()))

    from .tools.code_interpreter import get_sandbox
    from .tools.mcp_manager import get_mcp

    sandbox = get_sandbox()
    sandbox.start_reaper()
    mcp = get_mcp()
    mcp_task = asyncio.create_task(mcp.start_all())  # connect in the background; never block startup
    yield
    mcp_task.cancel()
    await mcp.close()
    await sandbox.close()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name, lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    for r in (chat.router, conversations.router, files.router, connectors.router, system.router):
        app.include_router(r, prefix="/api")

    if settings.llm_provider == "demo":
        from .demo.fake_openai import router as demo_router

        app.include_router(demo_router, prefix="/demo/v1")

    dist = Path(settings.frontend_dist)
    if (dist / "index.html").exists():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        async def spa(path: str) -> FileResponse:
            candidate = (dist / path).resolve()
            if path and candidate.is_file() and dist.resolve() in candidate.parents:
                return FileResponse(candidate)
            return FileResponse(dist / "index.html", headers={"Cache-Control": "no-cache"})

    return app


app = create_app()
