"""Fast unit tests: cost math, streaming decoder, connector import, cloud guards."""

from __future__ import annotations

import json

import pytest

from app.catalog import Pricing, Usage
from app.llm.engine import CodeArgStream
from app.llm.parts import PartsBuilder
from app.tools.mcp_manager import parse_import


def test_cost_counts_cached_and_reasoning_tokens_correctly():
    u = Usage(input_tokens=10_000, cached_tokens=4_000, output_tokens=2_000, reasoning_tokens=1_500, calls=1)
    p = Pricing(input=2.0, cached_input=0.2, output=12.0)
    # 6,000 uncached * $2 + 4,000 cached * $0.20 + 2,000 output (reasoning included) * $12, per 1M
    assert u.cost(p) == pytest.approx((6_000 * 2 + 4_000 * 0.2 + 2_000 * 12) / 1_000_000)


def test_usage_from_both_api_shapes():
    responses = {"input_tokens": 100, "output_tokens": 50, "input_tokens_details": {"cached_tokens": 20},
                 "output_tokens_details": {"reasoning_tokens": 30}}
    chat = {"prompt_tokens": 100, "completion_tokens": 50, "prompt_tokens_details": {"cached_tokens": 20},
            "completion_tokens_details": {"reasoning_tokens": 30}}
    for raw in (responses, chat):
        u = Usage.from_api(raw)
        assert (u.input_tokens, u.cached_tokens, u.output_tokens, u.reasoning_tokens, u.calls) == (100, 20, 50, 30, 1)


def test_code_stream_decoder_handles_split_escapes():
    code = 'print("héllo\\n")\nfor i in range(3):\n\tprint(i)  # “quotes” ✓'
    raw = json.dumps({"code": code})
    for size in (1, 2, 3, 7):
        dec = CodeArgStream()
        out = "".join(dec.feed(raw[i : i + size]) for i in range(0, len(raw), size))
        assert out == code, size


def test_parts_builder_timeline():
    pb = PartsBuilder()
    for ev in [
        {"type": "reasoning_start", "id": "r1"},
        {"type": "reasoning_delta", "id": "r1", "delta": "Thinking"},
        {"type": "reasoning_end", "id": "r1", "duration_ms": 900},
        {"type": "tool_start", "id": "t1", "kind": "code", "name": "python"},
        {"type": "tool_input_delta", "id": "t1", "delta": "print(1)"},
        {"type": "tool_end", "id": "t1", "status": "done", "output": {"files": [{"name": "a.xlsx", "sandbox_path": "a.xlsx"}]}},
        {"type": "text_delta", "delta": "Hello "},
        {"type": "text_delta", "delta": "world"},
    ]:
        pb.apply(ev)
    assert [p["type"] for p in pb.parts] == ["reasoning", "tool", "text"]
    assert pb.text == "Hello world"
    assert "created a.xlsx" in pb.history_summary()


@pytest.mark.parametrize(
    "payload,expected",
    [
        ({"mcpServers": {"fs": {"command": "npx", "args": ["-y", "srv"]}}}, ("fs", "stdio")),
        ({"servers": {"sp": {"type": "http", "url": "https://x/mcp", "headers": {"Authorization": "Bearer t"}}}},
         ("sp", "http")),
        ({"legacy": {"url": "https://x/sse"}}, ("legacy", "sse")),
        ({"name": "solo", "command": "python", "args": ["s.py"]}, ("solo", "stdio")),
    ],
)
def test_parse_import_formats(payload, expected):
    cfg = parse_import(json.dumps(payload))[0]
    assert (cfg["name"], cfg["transport"]) == expected


def test_gcc_high_refuses_commercial_endpoint(monkeypatch, tmp_path):
    from tests.conftest import reset_singletons

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("LLM_PROVIDER", "gcc-high")
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://contoso.openai.azure.com/")
    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "k")
    reset_singletons()
    from app.config import get_settings

    s = get_settings()
    assert s.llm_provider == "azure_gcc_high"
    assert any("non-government" in p for p in s.validate_runtime())
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://amentum-ai.openai.azure.us/")
    reset_singletons()
    assert get_settings().validate_runtime() == []
    reset_singletons()


def test_gcc_high_client_uses_gov_endpoint(monkeypatch, tmp_path):
    from tests.conftest import reset_singletons

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("LLM_PROVIDER", "azure_gcc_high")
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://amentum-ai.openai.azure.us/")
    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "k")
    reset_singletons()
    import openai

    from app.llm.clients import build_client

    c = build_client()
    assert isinstance(c, openai.AsyncOpenAI)
    assert str(c.base_url) == "https://amentum-ai.openai.azure.us/openai/v1/"

    monkeypatch.setenv("AZURE_API_STYLE", "versioned")
    monkeypatch.setenv("AZURE_OPENAI_API_VERSION", "2025-04-01-preview")
    reset_singletons()
    c = build_client()
    assert isinstance(c, openai.AsyncAzureOpenAI)
    assert "amentum-ai.openai.azure.us/openai" in str(c.base_url)
    reset_singletons()


def test_gcc_high_entra_uses_government_authority_and_scope(monkeypatch, tmp_path):
    from tests.conftest import reset_singletons

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("LLM_PROVIDER", "azure_gcc_high")
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://amentum-ai.openai.azure.us/")
    monkeypatch.setenv("AZURE_AUTH", "entra")
    monkeypatch.setenv("AZURE_TENANT_ID", "tenant")
    monkeypatch.setenv("AZURE_CLIENT_ID", "client")
    monkeypatch.setenv("AZURE_CLIENT_SECRET", "secret")
    reset_singletons()
    captured: dict = {}

    import azure.identity.aio as aio

    class FakeCred:
        def __init__(self, **kw):
            captured["cred"] = kw

    def fake_provider(cred, scope):
        captured["scope"] = scope

        async def token():
            return "t"

        return token

    monkeypatch.setattr(aio, "ClientSecretCredential", FakeCred)
    monkeypatch.setattr(aio, "get_bearer_token_provider", fake_provider)
    from app.llm.clients import build_client

    build_client()
    assert captured["cred"]["authority"] == "login.microsoftonline.us"
    assert captured["scope"] == "https://cognitiveservices.azure.us/.default"
    reset_singletons()
