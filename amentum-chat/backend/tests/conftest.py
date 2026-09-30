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

    @app.post("/strict/v1/chat/completions")  # mimics api.openai.com for GPT-5.x on Chat Completions
    async def strict_chat(request: Request):
        from fastapi.responses import JSONResponse

        body = await request.json()
        if body.get("tools") and body.get("reasoning_effort") not in (None, "none"):
            model = body.get("model")
            return JSONResponse(status_code=400, content={"error": {
                "message": f"Function tools with reasoning_effort are not supported for {model} in "
                           "/v1/chat/completions. To use function tools, use /v1/responses or set "
                           "reasoning_effort to 'none'.",
                "type": "invalid_request_error", "param": "reasoning_effort", "code": None}})
        return await chat_completions(request)

    _mount_truncating(app, responses, chat_completions)

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


TRUNC_LOG: list[dict] = []  # streaming request bodies seen by the truncating endpoints
CONTINUE_MARK = "[Automatic message]"


def _mount_truncating(app, responses, chat_completions) -> None:
    """Endpoints that behave like a model hitting its output-token limit.

    /trunc/...     cut off on the first request, finish once the engine asks it to continue
    /truncall/...  cut off every time
    Non-streaming requests (conversation titles) are answered by the demo simulator.
    """
    from fastapi.responses import StreamingResponse

    def sse(etype: str, **data) -> str:
        return f"event: {etype}\ndata: {json.dumps({'type': etype, 'sequence_number': 0, **data})}\n\n"

    def response(status: str, output: list, reason: str | None = None) -> dict:
        return {"id": "resp_t", "object": "response", "created_at": 0, "model": "m", "status": status,
                "output": output, "error": None, "parallel_tool_calls": True, "tool_choice": "auto", "tools": [],
                "incomplete_details": {"reason": reason} if reason else None,
                "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15,
                          "input_tokens_details": {"cached_tokens": 0},
                          "output_tokens_details": {"reasoning_tokens": 0}}}

    def message(text: str, status: str) -> dict:
        return {"id": f"msg_{status}", "type": "message", "role": "assistant", "status": status,
                "content": [{"type": "output_text", "text": text, "annotations": []}]}

    async def responses_stream(cut: bool):
        yield sse("response.created", response=response("in_progress", []))
        if cut:
            rs = {"id": "rs_1", "type": "reasoning", "summary": [], "encrypted_content": "eA=="}
            yield sse("response.output_item.added", output_index=0, item={**rs, "encrypted_content": None})
            yield sse("response.output_item.done", output_index=0, item=rs)
            yield sse("response.output_item.added", output_index=1, item={**message("", "in_progress"), "content": []})
            yield sse("response.output_text.delta", item_id="msg_in_progress", output_index=1, content_index=0,
                      delta="The first half, ", logprobs=[])
            yield sse("response.incomplete", response=response(
                "incomplete", [rs, message("The first half, ", "incomplete")], "max_output_tokens"))
        else:
            yield sse("response.output_item.added", output_index=0, item={**message("", "in_progress"), "content": []})
            yield sse("response.output_text.delta", item_id="msg_in_progress", output_index=0, content_index=0,
                      delta="and the second half.", logprobs=[])
            done = message("and the second half.", "completed")
            yield sse("response.output_item.done", output_index=0, item=done)
            yield sse("response.completed", response=response("completed", [done]))

    async def chat_stream(cut: bool):
        def chunk(delta: dict, finish: str | None = None) -> str:
            return "data: " + json.dumps({"id": "c", "object": "chat.completion.chunk", "created": 0, "model": "m",
                                          "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}) + "\n\n"
        yield chunk({"role": "assistant", "content": ""})
        yield chunk({"content": "Part one, " if cut else "part two."})
        yield chunk({}, "length" if cut else "stop")
        yield "data: " + json.dumps({"id": "c", "object": "chat.completion.chunk", "created": 0, "model": "m",
                                     "choices": [], "usage": {"prompt_tokens": 10, "completion_tokens": 5,
                                                              "total_tokens": 15}}) + "\n\n"
        yield "data: [DONE]\n\n"

    def continuing(body: dict) -> bool:
        return CONTINUE_MARK in json.dumps(body.get("input") or body.get("messages") or [])

    for mode in ("trunc", "truncall"):
        def make(mode: str):
            async def trunc_responses(request: Request):
                body = await request.json()
                if not body.get("stream"):
                    return await responses(request)
                TRUNC_LOG.append(body)
                cut = mode == "truncall" or not continuing(body)
                return StreamingResponse(responses_stream(cut), media_type="text/event-stream")

            async def trunc_chat(request: Request):
                body = await request.json()
                if not body.get("stream"):
                    return await chat_completions(request)
                TRUNC_LOG.append(body)
                cut = mode == "truncall" or not continuing(body)
                return StreamingResponse(chat_stream(cut), media_type="text/event-stream")

            app.post(f"/{mode}/v1/responses")(trunc_responses)
            app.post(f"/{mode}/v1/chat/completions")(trunc_chat)

        make(mode)


@pytest.fixture
def trunc_log():
    TRUNC_LOG.clear()
    return TRUNC_LOG


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
