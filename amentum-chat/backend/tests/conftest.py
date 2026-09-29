from __future__ import annotations

import json
import os
import socket
import sys
import threading
import time
from pathlib import Path

import pytest
from fastapi import Request

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
os.environ["AMENTUM_ENV_FILE"] = str(BACKEND / "tests" / "no.env")  # never read a developer's .env in tests


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="session")
def fake_llm_url():
    """The demo simulator served on a real port, mounted like OpenAI and like Azure OpenAI
    (both the v1 and the date-versioned route shapes)."""
    import uvicorn
    from fastapi import FastAPI

    from app.demo.fake_openai import chat_completions, responses, router

    app = FastAPI()
    app.include_router(router, prefix="/demo/v1")
    app.include_router(router, prefix="/az/openai/v1")  # Azure v1 API
    app.include_router(router, prefix="/az/openai")  # Azure versioned: /openai/responses?api-version=

    @app.post("/az/openai/deployments/{deployment}/chat/completions")  # Azure versioned chat
    async def deployment_chat(deployment: str, request: Request):
        return await chat_completions(request)

    @app.post("/az/openai/deployments/{deployment}/responses")
    async def deployment_responses(deployment: str, request: Request):
        return await responses(request)

    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.05)
    yield f"http://127.0.0.1:{port}"
    server.should_exit = True


def reset_singletons() -> None:
    from app import catalog, config, db
    from app.llm import clients
    from app.tools import code_interpreter, mcp_manager

    config.get_settings.cache_clear()
    catalog.get_catalog.cache_clear()
    clients._client = None
    clients._client_key = None
    db._db = None
    code_interpreter._sandbox = None
    mcp_manager._manager = None


@pytest.fixture
def make_app(tmp_path, monkeypatch, fake_llm_url):
    def _make(**env: str):
        base = {"DATA_DIR": str(tmp_path / "data"), "LLM_PROVIDER": "demo", "DEMO_BASE_URL": fake_llm_url}
        base.update(env)
        for k, v in base.items():
            monkeypatch.setenv(k, v)
        reset_singletons()
        from app.main import create_app

        return create_app()

    yield _make
    reset_singletons()


def run_chat(client, payload: dict) -> list[dict]:
    events = []
    with client.stream("POST", "/api/chat", json=payload) as r:
        assert r.status_code == 200, r.read()
        for line in r.iter_lines():
            if line.startswith("data: "):
                events.append(json.loads(line[6:]))
    return events


@pytest.fixture
def chat():
    return run_chat
