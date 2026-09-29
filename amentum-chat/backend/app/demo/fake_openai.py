"""OpenAI-compatible simulator (``LLM_PROVIDER=demo``).

Implements just enough of ``/v1/responses`` and ``/v1/chat/completions`` -
including streamed reasoning summaries, function calls and usage - for the
real ``openai`` SDK and the real engine to run against it. That makes the demo
mode a faithful rehearsal of the production code path.
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from typing import Any, AsyncIterator

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse

from .scenarios import Plan, plan_for, title_for

router = APIRouter()

TOKEN_DELAY = 0.018
THINK_DELAY = 0.045
THINK_WARMUP = 0.6  # real models pause before the first summary arrives


def _uid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:24]}"


def _chunks(text: str, size: int = 3) -> list[str]:
    """Split text into small word groups so streaming looks natural."""
    words = text.split(" ")
    out = []
    for i in range(0, len(words), size):
        piece = " ".join(words[i : i + size])
        out.append(piece + (" " if i + size < len(words) else ""))
    return out


def _estimate(obj: Any) -> int:
    return max(1, len(json.dumps(obj, default=str)) // 4)


def _text_of(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(c.get("text", "") for c in content if isinstance(c, dict))
    return ""


def _analyse_responses_input(body: dict[str, Any]) -> tuple[str, str | None, str | None]:
    items = body.get("input")
    if isinstance(items, str):
        return items, None, None
    items = items or []
    last_user = ""
    for it in items:
        if it.get("role") == "user":
            last_user = _text_of(it.get("content"))
    after_tool = tool_used = None
    if items and items[-1].get("type") == "function_call_output":
        after_tool = items[-1].get("output", "")
        call_id = items[-1].get("call_id")
        for it in items:
            if it.get("type") == "function_call" and it.get("call_id") == call_id:
                tool_used = it.get("name")
    return last_user, after_tool, tool_used


def _tool_names(tools: list[dict[str, Any]] | None) -> list[str]:
    names = []
    for t in tools or []:
        if "function" in t:
            names.append(t["function"]["name"])
        elif t.get("name"):
            names.append(t["name"])
    return names


# ---------------------------------------------------------------------------------------------------------
# Responses API
# ---------------------------------------------------------------------------------------------------------
@router.post("/responses")
async def responses(request: Request) -> Any:
    body = await request.json()
    model = body.get("model", "demo")
    if not body.get("stream"):
        # Non-streaming is only used for conversation titles.
        prompt = body["input"] if isinstance(body.get("input"), str) else _analyse_responses_input(body)[0]
        title = title_for(prompt)
        return JSONResponse({
            "id": _uid("resp"), "object": "response", "created_at": int(time.time()), "model": model,
            "status": "completed",
            "output": [{"id": _uid("msg"), "type": "message", "role": "assistant", "status": "completed",
                        "content": [{"type": "output_text", "text": title, "annotations": []}]}],
            "usage": {"input_tokens": _estimate(prompt), "output_tokens": 6, "total_tokens": _estimate(prompt) + 6,
                      "input_tokens_details": {"cached_tokens": 0}, "output_tokens_details": {"reasoning_tokens": 0}},
            "parallel_tool_calls": True, "tool_choice": "auto", "tools": [],
        })
    user_text, after_tool, tool_used = _analyse_responses_input(body)
    tools = _tool_names(body.get("tools"))
    if body.get("tool_choice") == "none":
        tools = []
    plan = plan_for(user_text, tools, after_tool, tool_used)
    effort = (body.get("reasoning") or {}).get("effort", "medium")
    wants_summary = bool((body.get("reasoning") or {}).get("summary"))
    return StreamingResponse(_responses_stream(body, model, plan, effort, wants_summary), media_type="text/event-stream")


async def _responses_stream(body: dict, model: str, plan: Plan, effort: str, wants_summary: bool) -> AsyncIterator[str]:
    seq = 0
    rid = _uid("resp")
    created = int(time.time())
    output: list[dict[str, Any]] = []

    def ev(etype: str, **data: Any) -> str:
        nonlocal seq
        seq += 1
        return f"event: {etype}\ndata: {json.dumps({'type': etype, 'sequence_number': seq, **data})}\n\n"

    def resp(status: str, usage: dict | None = None) -> dict:
        return {"id": rid, "object": "response", "created_at": created, "model": model, "status": status,
                "output": output, "parallel_tool_calls": True, "tool_choice": body.get("tool_choice", "auto"),
                "tools": body.get("tools", []), "usage": usage, "error": None, "incomplete_details": None}

    yield ev("response.created", response=resp("in_progress"))
    yield ev("response.in_progress", response=resp("in_progress"))
    reasoning_tokens = 0

    # ---- reasoning -------------------------------------------------------------------------------------
    if effort != "none":
        idx = len(output)
        rs_id = _uid("rs")
        item = {"id": rs_id, "type": "reasoning", "summary": []}
        yield ev("response.output_item.added", output_index=idx, item=item)
        summaries = []
        await asyncio.sleep(THINK_WARMUP)
        if wants_summary:
            for si, part in enumerate(plan.reasoning):
                yield ev("response.reasoning_summary_part.added", item_id=rs_id, output_index=idx, summary_index=si,
                         part={"type": "summary_text", "text": ""})
                for chunk in _chunks(part, 2):
                    await asyncio.sleep(THINK_DELAY)
                    yield ev("response.reasoning_summary_text.delta", item_id=rs_id, output_index=idx,
                             summary_index=si, delta=chunk)
                yield ev("response.reasoning_summary_text.done", item_id=rs_id, output_index=idx, summary_index=si,
                         text=part)
                yield ev("response.reasoning_summary_part.done", item_id=rs_id, output_index=idx, summary_index=si,
                         part={"type": "summary_text", "text": part})
                summaries.append({"type": "summary_text", "text": part})
        else:
            await asyncio.sleep(1.2)
        reasoning_tokens = sum(len(p) for p in plan.reasoning) // 3 + {"low": 40, "medium": 120}.get(effort, 300)
        item = {"id": rs_id, "type": "reasoning", "summary": summaries, "encrypted_content": "ZGVtbw=="}
        output.append(item)
        yield ev("response.output_item.done", output_index=idx, item=item)

    out_tokens = reasoning_tokens
    # ---- function call -------------------------------------------------------------------------------
    if plan.call is not None:
        name, args = plan.call
        idx = len(output)
        fc_id, call_id = _uid("fc"), _uid("call")
        arguments = json.dumps(args)
        item = {"id": fc_id, "type": "function_call", "call_id": call_id, "name": name, "arguments": "",
                "status": "in_progress"}
        yield ev("response.output_item.added", output_index=idx, item=item)
        for i in range(0, len(arguments), 24):
            await asyncio.sleep(0.012)
            yield ev("response.function_call_arguments.delta", item_id=fc_id, output_index=idx,
                     delta=arguments[i : i + 24])
        yield ev("response.function_call_arguments.done", item_id=fc_id, output_index=idx, arguments=arguments)
        item = {**item, "arguments": arguments, "status": "completed"}
        output.append(item)
        yield ev("response.output_item.done", output_index=idx, item=item)
        out_tokens += len(arguments) // 4

    # ---- assistant text -----------------------------------------------------------------------------
    if plan.text:
        idx = len(output)
        msg_id = _uid("msg")
        item = {"id": msg_id, "type": "message", "role": "assistant", "status": "in_progress", "content": []}
        yield ev("response.output_item.added", output_index=idx, item=item)
        yield ev("response.content_part.added", item_id=msg_id, output_index=idx, content_index=0,
                 part={"type": "output_text", "text": "", "annotations": []})
        for chunk in _chunks(plan.text, 2):
            await asyncio.sleep(TOKEN_DELAY)
            yield ev("response.output_text.delta", item_id=msg_id, output_index=idx, content_index=0, delta=chunk,
                     logprobs=[])
        part = {"type": "output_text", "text": plan.text, "annotations": []}
        yield ev("response.output_text.done", item_id=msg_id, output_index=idx, content_index=0, text=plan.text,
                 logprobs=[])
        yield ev("response.content_part.done", item_id=msg_id, output_index=idx, content_index=0, part=part)
        item = {**item, "status": "completed", "content": [part]}
        output.append(item)
        yield ev("response.output_item.done", output_index=idx, item=item)
        out_tokens += len(plan.text) // 4

    in_tokens = _estimate(body.get("input")) + _estimate(body.get("instructions", "")) + _estimate(body.get("tools", []))
    cached = (in_tokens // 2) if isinstance(body.get("input"), list) and len(body["input"]) > 2 else 0
    usage = {"input_tokens": in_tokens, "input_tokens_details": {"cached_tokens": cached}, "output_tokens": out_tokens,
             "output_tokens_details": {"reasoning_tokens": reasoning_tokens}, "total_tokens": in_tokens + out_tokens}
    yield ev("response.completed", response=resp("completed", usage))


# ---------------------------------------------------------------------------------------------------------
# Chat Completions API
# ---------------------------------------------------------------------------------------------------------
@router.post("/chat/completions")
async def chat_completions(request: Request) -> Any:
    body = await request.json()
    model = body.get("model", "demo")
    messages = body.get("messages", [])
    last_user = next((_text_of(m.get("content")) for m in reversed(messages) if m.get("role") == "user"), "")
    if not body.get("stream"):
        title = title_for(last_user)
        return JSONResponse({
            "id": _uid("chatcmpl"), "object": "chat.completion", "created": int(time.time()), "model": model,
            "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": title}}],
            "usage": {"prompt_tokens": _estimate(messages), "completion_tokens": 6,
                      "total_tokens": _estimate(messages) + 6},
        })
    after_tool = tool_used = None
    if messages and messages[-1].get("role") == "tool":
        after_tool = messages[-1].get("content", "")
        tcid = messages[-1].get("tool_call_id")
        for m in messages:
            for tc in m.get("tool_calls") or []:
                if tc.get("id") == tcid:
                    tool_used = tc["function"]["name"]
    tools = [] if body.get("tool_choice") == "none" else _tool_names(body.get("tools"))
    plan = plan_for(last_user, tools, after_tool, tool_used)
    return StreamingResponse(_chat_stream(body, model, plan), media_type="text/event-stream")


async def _chat_stream(body: dict, model: str, plan: Plan) -> AsyncIterator[str]:
    cid = _uid("chatcmpl")
    created = int(time.time())

    def chunk(delta: dict | None, finish: str | None = None, usage: dict | None = None) -> str:
        data: dict[str, Any] = {"id": cid, "object": "chat.completion.chunk", "created": created, "model": model,
                                "choices": [] if delta is None else
                                [{"index": 0, "delta": delta, "finish_reason": finish}]}
        if usage:
            data["usage"] = usage
        return f"data: {json.dumps(data)}\n\n"

    yield chunk({"role": "assistant", "content": ""})
    reasoning_tokens = 0
    if body.get("reasoning_effort", "medium") != "none":
        # Some Azure-hosted models stream "reasoning_content"; the engine renders it as a thinking trace.
        for part in plan.reasoning:
            for c in _chunks(part + "\n\n", 2):
                await asyncio.sleep(THINK_DELAY)
                yield chunk({"reasoning_content": c})
        reasoning_tokens = sum(len(p) for p in plan.reasoning) // 3 + 80
    out = reasoning_tokens
    if plan.call is not None:
        name, args = plan.call
        arguments = json.dumps(args)
        yield chunk({"tool_calls": [{"index": 0, "id": _uid("call"), "type": "function",
                                     "function": {"name": name, "arguments": ""}}]})
        for i in range(0, len(arguments), 24):
            await asyncio.sleep(0.012)
            yield chunk({"tool_calls": [{"index": 0, "function": {"arguments": arguments[i : i + 24]}}]})
        yield chunk({}, "tool_calls")
        out += len(arguments) // 4
    else:
        for c in _chunks(plan.text, 2):
            await asyncio.sleep(TOKEN_DELAY)
            yield chunk({"content": c})
        yield chunk({}, "stop")
        out += len(plan.text) // 4
    prompt_tokens = _estimate(body.get("messages")) + _estimate(body.get("tools", []))
    yield chunk(None, usage={"prompt_tokens": prompt_tokens, "completion_tokens": out,
                             "total_tokens": prompt_tokens + out,
                             "prompt_tokens_details": {"cached_tokens": 0},
                             "completion_tokens_details": {"reasoning_tokens": reasoning_tokens}})
    yield "data: [DONE]\n\n"


@router.get("/models")
async def models() -> dict:
    from ..catalog import get_catalog

    return {"object": "list", "data": [{"id": m.deployment, "object": "model", "owned_by": "demo"}
                                       for m in get_catalog().all()]}
