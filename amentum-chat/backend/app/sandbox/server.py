"""Stand-alone code interpreter service.

Run inside the isolated ``sandbox`` container (no outbound network, non-root,
CPU/memory limits) so model-written code can never reach the Amentum network or
the backend's secrets:

    uvicorn app.sandbox.server:app --host 0.0.0.0 --port 8100

All requests must carry ``X-Sandbox-Token`` when SANDBOX_TOKEN is set.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response
from pydantic import BaseModel

from .convert import ConversionError
from .kernels import LocalSandbox

TOKEN = os.environ.get("SANDBOX_TOKEN", "")
sandbox = LocalSandbox(
    root=Path(os.environ.get("SANDBOX_ROOT", "/sandbox/sessions")),
    exec_timeout=int(os.environ.get("SANDBOX_EXEC_TIMEOUT_S", "180")),
    idle_timeout=int(os.environ.get("SANDBOX_IDLE_TIMEOUT_S", "1800")),
    max_sessions=int(os.environ.get("SANDBOX_MAX_SESSIONS", "24")),
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    sandbox.start_reaper()
    yield
    await sandbox.close()


app = FastAPI(title="Amentum Code Interpreter Sandbox", lifespan=lifespan, docs_url=None, redoc_url=None)


def auth(x_sandbox_token: str = Header(default="")) -> None:
    if TOKEN and x_sandbox_token != TOKEN:
        raise HTTPException(status_code=401, detail="bad sandbox token")


class ExecRequest(BaseModel):
    code: str
    timeout: int | None = None


@app.get("/health")
async def health() -> dict:
    return {"ok": True, **sandbox.info(), "mode": "service"}


@app.get("/sessions/{sid}", dependencies=[Depends(auth)])
async def session_state(sid: str) -> dict:
    return {"alive": await sandbox.has_session(sid)}


@app.post("/sessions/{sid}/execute", dependencies=[Depends(auth)])
async def execute(sid: str, req: ExecRequest) -> dict:
    try:
        return await sandbox.execute(sid, req.code, req.timeout)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.put("/sessions/{sid}/files", dependencies=[Depends(auth)])
async def put_file(sid: str, request: Request, name: str = Query(...), overwrite: bool = False) -> dict:
    data = await request.body()
    try:
        return {"path": await sandbox.put_file(sid, name, data, overwrite)}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/sessions/{sid}/files", dependencies=[Depends(auth)])
async def list_files(sid: str) -> list[dict]:
    return await sandbox.list_files(sid)


@app.get("/sessions/{sid}/files/content", dependencies=[Depends(auth)])
async def read_file(sid: str, path: str = Query(...)) -> Response:
    try:
        return Response(await sandbox.read_file(sid, path), media_type="application/octet-stream")
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(404, str(exc)) from exc


@app.delete("/sessions/{sid}", dependencies=[Depends(auth)])
async def reset(sid: str, wipe: bool = False) -> dict:
    await sandbox.reset(sid, wipe)
    return {"ok": True}


@app.post("/convert", dependencies=[Depends(auth)])
async def convert(request: Request, name: str = Query(...)) -> Response:
    try:
        pdf = await sandbox.convert_pdf(name, await request.body())
    except ConversionError as exc:
        raise HTTPException(422, str(exc)) from exc
    return Response(pdf, media_type="application/pdf")
