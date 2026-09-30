"""Agent engine: one user turn -> streamed reasoning, tool calls and answer.

Two wire protocols, same event stream to the UI:

* Responses API (preferred): streams reasoning *summaries* ("thinking traces"),
  supports the hosted code_interpreter tool, and carries reasoning between
  tool calls via encrypted reasoning items (store=false = nothing retained at
  the provider).
* Chat Completions (fallback for deployments without the Responses API):
  function tools + streaming. Thinking text only appears if the model streams
  `reasoning_content`; GPT-5.x rejects tools + reasoning_effort here, so such
  requests are retried with reasoning_effort="none".
"""

from __future__ import annotations

import base64
import json
import logging
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable

import openai

from ..catalog import ModelInfo, Usage, get_catalog
from ..config import get_settings
from ..db import get_db
from ..files import IMAGE_MIMES, extract_text, file_kind, public_file, store_bytes
from ..tools import code_interpreter as ci
from ..tools.mcp_manager import get_mcp
from .clients import get_client
from .parts import PartsBuilder
from .prompts import TITLE_PROMPT, build_instructions

log = logging.getLogger(__name__)

Emit = Callable[[dict[str, Any]], Awaitable[None]]
MAX_IMAGE_BYTES = 15 * 1024 * 1024


class ProviderError(RuntimeError):
    pass


@dataclass
class TurnRequest:
    user_id: str
    conversation_id: str
    model: ModelInfo
    effort: str | None
    text: str
    attachments: list[dict]  # DB rows of files attached to this message
    history: list[dict]  # earlier DB messages, oldest first
    mcp_server_ids: list[str] | None  # None = all connected servers
    use_code: bool = True
    demo_base_url: str | None = None


class CodeArgStream:
    """Incrementally decode the "code" string from streamed JSON tool arguments,
    so the UI can show the code being written live."""

    _ESC = {"n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f", '"': '"', "\\": "\\", "/": "/"}

    def __init__(self) -> None:
        self.buf = ""
        self.pos: int | None = None
        self.done = False

    def feed(self, delta: str) -> str:
        self.buf += delta
        if self.done:
            return ""
        if self.pos is None:
            m = re.search(r'"code"\s*:\s*"', self.buf)
            if not m:
                return ""
            self.pos = m.end()
        b, i, out = self.buf, self.pos, []
        while i < len(b):
            c = b[i]
            if c == '"':
                self.done = True
                i += 1
                break
            if c == "\\":
                if i + 1 >= len(b):
                    break
                e = b[i + 1]
                if e == "u":
                    if i + 6 > len(b):
                        break
                    try:
                        out.append(chr(int(b[i + 2 : i + 6], 16)))
                    except ValueError:
                        pass
                    i += 6
                    continue
                out.append(self._ESC.get(e, e))
                i += 2
                continue
            out.append(c)
            i += 1
        self.pos = i
        return "".join(out)


def friendly_error(exc: BaseException, deployment: str = "") -> str:
    name = type(exc).__name__
    if name == "ClientAuthenticationError" or "CredentialUnavailable" in name:
        return ("Could not get an Entra ID token for Azure OpenAI. Check AZURE_TENANT_ID / AZURE_CLIENT_ID / "
                f"credential settings and that the authority matches your cloud. Details: {exc}")
    if isinstance(exc, openai.AuthenticationError):
        return ("The model provider rejected the credentials (401). Check the API key, or for Entra ID that the "
                "identity has the 'Cognitive Services OpenAI User' role on the Azure OpenAI resource.")
    if isinstance(exc, openai.PermissionDeniedError):
        return f"Access denied by the model provider (403): {getattr(exc, 'message', exc)}"
    if isinstance(exc, openai.NotFoundError):
        return (f"Model deployment '{deployment}' (or this API route) was not found (404). Check MODEL_DEPLOYMENTS. "
                "If the deployment does not support the Responses API yet, set \"api\": \"chat\" for it in "
                "config/models.json.")
    if isinstance(exc, openai.RateLimitError):
        return "Rate limit or quota exceeded (429). Wait a moment and retry, or raise the deployment's TPM quota."
    if isinstance(exc, openai.APITimeoutError):
        return "The model request timed out. Try again, or lower the reasoning effort."
    if isinstance(exc, openai.APIConnectionError):
        return ("Could not reach the model endpoint. Check the egress allow-list (e.g. <resource>.openai.azure.us and "
                "login.microsoftonline.us), the OUTBOUND_PROXY setting and the TLS-inspection CA bundle.")
    if isinstance(exc, openai.BadRequestError):
        return f"The model provider rejected the request (400): {getattr(exc, 'message', exc)}"
    if isinstance(exc, openai.APIStatusError):
        return f"Model provider error ({exc.status_code}): {getattr(exc, 'message', exc)}"
    if isinstance(exc, ProviderError):
        return str(exc)
    return f"Unexpected error: {name}: {exc}"


def _dump(item: Any) -> dict[str, Any]:
    if isinstance(item, dict):
        return item
    return item.model_dump(exclude_none=True, mode="json")


def continue_prompt(partial: str) -> str:
    """Ask the model to pick up a reply the output-token limit cut off."""
    text = ("[Automatic message] Your previous reply was cut off by the output-token limit. Resume from the exact "
            "point where it stopped, as if there had been no interruption. Don't repeat anything and don't "
            "restart the task.")
    tail = partial[-160:].split("\n")[-1]
    if tail.strip():
        # Quoting the last line keeps the join clean, e.g. finishing a sentence before the next list item.
        text += (f' Your reply so far ends with: "{tail}". What you write is appended directly after that, so '
                 "begin with exactly what comes next: the rest of that line (starting with a space if the next "
                 "word is a new word), then a line break if needed.")
    return text


def join_continuation(before: str, after: str) -> str:
    """The start of a continuation, adjusted so it reads on cleanly from the cut-off reply."""
    last = before.rsplit("\n", 1)[-1].strip()
    stripped = after.lstrip()
    if len(last) >= 8 and stripped.startswith(last):
        after = stripped[len(last):]  # the model restated the unfinished last line
    else:
        for k in range(min(len(before), len(after), 200), 7, -1):
            if before.endswith(after[:k]):
                after = after[k:]  # the model repeated the end of what it had written
                break
    return mend_seam(before, after)


def mend_seam(before: str, after: str) -> str:
    """Fix the join between a cut-off reply and its continuation where the fix is unambiguous:
    a missing space after punctuation. Letter-to-letter joins are left alone (it may be a split word)."""
    if not before or not after or before[-1].isspace() or after[0].isspace():
        return after
    if before[-1] in ",;:" and after[0].isalnum():
        return " " + after
    if before[-1] in ".!?" and after[0].isupper():
        return " " + after
    return after


def _cut_off_output(code: bool, what: str) -> dict[str, Any]:
    """Tool output for a call that was cut off before it ran, shaped for the code or connector card."""
    message = f"This {what} was cut off by the output limit before it ran."
    if code:
        return {"stdout": "", "stderr": "", "results": [], "images": [], "files": [],
                "error": {"name": "Incomplete", "value": message, "traceback": ""}}
    return {"content": [], "is_error": True, "error": message}


def _carry_forward(output: list[Any], cut: bool) -> list[dict[str, Any]]:
    """Output items to send back as input for the next request.

    A response cut off by the output limit ends in unfinished items (a partial message, code that never
    ran, half a reasoning item). Those can't be sent back as-is: keep the finished items, drop reasoning
    that no longer has the item it led to, and resend any partial text as a plain assistant message.
    """
    items = [_dump(o) for o in output]
    if not cut:
        return items
    kept: list[dict[str, Any]] = []
    partial = ""
    for it in items:
        if it.get("status", "completed") == "completed":
            kept.append(it)
        elif it.get("type") == "message":
            partial += "".join(c.get("text", "") for c in it.get("content") or [] if c.get("type") == "output_text")
    while kept and kept[-1].get("type") == "reasoning":
        kept.pop()
    if partial:
        kept.append({"role": "assistant", "content": partial})
    return kept


def _fmt_size(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024  # type: ignore[assignment]
    return str(n)


KIND_LABEL = {"word": "Word document", "excel": "spreadsheet", "powerpoint": "PowerPoint deck", "pdf": "PDF",
              "image": "image", "text": "text file", "code": "code/data file", "archive": "archive"}


class Turn:
    def __init__(self, req: TurnRequest, emit: Emit):
        self.req = req
        self._emit = emit
        self.settings = get_settings()
        self.client = get_client(req.demo_base_url)
        self.mcp = get_mcp()
        self.usage = Usage()
        self.builder = PartsBuilder()
        self._reasoning_open: dict[str, float] = {}
        self._tool_labels: dict[str, str] = {}
        self._container_id: str | None = None
        self._hosted_started: dict[str, float] = {}
        self._text_so_far = ""
        self._continuing = False  # the next text starts a continuation
        self._seam_buf = ""  # start of a continuation, held until its join with the earlier text is settled
        self.code_mode = self._code_mode()

    async def emit(self, ev: dict[str, Any]) -> None:
        if self._continuing and ev["type"] in ("tool_start", "files", "notice"):
            await self._flush_seam()
        self.builder.apply(ev)
        await self._emit(ev)

    def _code_mode(self) -> str:
        mode = self.settings.code_interpreter
        if not self.req.use_code or mode == "off":
            return "off"
        if mode == "hosted" and self.req.model.api == "responses":
            return "hosted"
        return "local"

    # ---- public ------------------------------------------------------------------------------------
    async def run(self) -> None:
        if self.code_mode == "local" and (self.req.attachments or any(m.get("attachments") for m in self.req.history)):
            await ci.sync_files(self.req.conversation_id)
            db = get_db()
            self.req.attachments = [db.get_file(a["id"]) or a for a in self.req.attachments]
        connectors = self.mcp.instructions_for(self.req.mcp_server_ids)
        instructions = build_instructions(self.code_mode, connectors)
        try:
            if self.req.model.api == "chat":
                await self._run_chat(instructions)
            else:
                await self._run_responses(instructions)
        finally:
            await self._flush_seam()

    # ---- message construction ---------------------------------------------------------------------
    def _manifest(self, files: list[dict]) -> str:
        docs = [f for f in files if not (f["mime"] in IMAGE_MIMES and self.req.model.vision)]
        if not docs:
            return ""
        if self.code_mode == "off":
            chunks = []
            for f in docs:
                if f["mime"] in IMAGE_MIMES:
                    chunks.append(f"[Attached image {f['name']} - this model cannot view images]")
                else:
                    chunks.append(f'<attached_file name="{f["name"]}">\n{extract_text(f["path"])}\n</attached_file>')
            return "\n\n".join(chunks)
        where = "/mnt/data" if self.code_mode == "hosted" else "the code interpreter working directory"
        lines = [f"[Attached files - available in {where}:]"]
        for f in docs:
            path = f.get("sandbox_path") or f["name"]
            lines.append(f"- {path} ({KIND_LABEL.get(file_kind(f['name']), 'file')}, {_fmt_size(f['size'])})")
        return "\n".join(lines)

    def _images(self, files: list[dict]) -> list[str]:
        urls = []
        if not self.req.model.vision:
            return urls
        for f in files:
            if f["mime"] in IMAGE_MIMES and f["size"] <= MAX_IMAGE_BYTES:
                b64 = base64.b64encode(Path(f["path"]).read_bytes()).decode()
                urls.append(f"data:{f['mime']};base64,{b64}")
        return urls

    def _user_text(self, text: str, files: list[dict]) -> str:
        manifest = self._manifest(files)
        return f"{text}\n\n{manifest}" if manifest else text

    def _history(self, api: str) -> list[dict[str, Any]]:
        db = get_db()
        out: list[dict[str, Any]] = []
        for m in self.req.history:
            if m["role"] == "user":
                files = [db.get_file(a["id"]) or a for a in m.get("attachments", [])]
                files = [f for f in files if "path" in f]
                imgs = [f["name"] for f in files if f["mime"] in IMAGE_MIMES]
                text = self._user_text(m["content"], [f for f in files if f["mime"] not in IMAGE_MIMES])
                if imgs:
                    text += "\n[Earlier attached image(s): " + ", ".join(imgs) + "]"
                out.append({"role": "user", "content": text})
            elif m["role"] == "assistant":
                pb = PartsBuilder()
                pb.parts = m.get("parts") or []
                summary = pb.history_summary()
                text = (m.get("content") or "").strip()
                if summary:
                    text = f"{summary}\n{text}" if text else summary
                if text:
                    out.append({"role": "assistant", "content": text})
        return out

    def _current_user(self, api: str) -> dict[str, Any]:
        text = self._user_text(self.req.text, self.req.attachments)
        images = self._images(self.req.attachments)
        if not images:
            return {"role": "user", "content": text}
        if api == "chat":
            content = [{"type": "text", "text": text}] + [
                {"type": "image_url", "image_url": {"url": u}} for u in images]
        else:
            content = [{"type": "input_text", "text": text}] + [
                {"type": "input_image", "image_url": u, "detail": "auto"} for u in images]
        return {"role": "user", "content": content}

    # ---- reasoning bookkeeping ----------------------------------------------------------------------
    async def _reasoning_start(self, rid: str) -> None:
        if rid not in self._reasoning_open:
            self._reasoning_open[rid] = time.time()
            await self.emit({"type": "reasoning_start", "id": rid})

    async def _reasoning_end(self, rid: str) -> None:
        started = self._reasoning_open.pop(rid, None)
        if started is not None:
            await self.emit({"type": "reasoning_end", "id": rid, "duration_ms": int((time.time() - started) * 1000)})

    async def _close_reasoning(self) -> None:
        for rid in list(self._reasoning_open):
            await self._reasoning_end(rid)

    # ---- tools --------------------------------------------------------------------------------------------
    async def _tool_start(self, tid: str, name: str) -> None:
        if name == ci.TOOL_NAME:
            ev = {"type": "tool_start", "id": tid, "kind": "code", "name": name, "server": "", "label": "Code interpreter"}
        else:
            hit = self.mcp.resolve(name)
            server = hit[0].config.name if hit else "Connector"
            tool = hit[1] if hit else name
            ev = {"type": "tool_start", "id": tid, "kind": "mcp", "name": tool, "server": server, "label": tool}
        await self.emit(ev)

    async def _execute(self, call: dict[str, Any]) -> str:
        name, tid = call["name"], call["id"]
        raw = call.get("arguments") or "{}"
        try:
            args = json.loads(raw) if raw.strip() else {}
        except json.JSONDecodeError:
            args = {"code": raw} if name == ci.TOOL_NAME else {}
        started = time.time()
        if name == ci.TOOL_NAME:
            code = args.get("code", "") if isinstance(args, dict) else ""
            await self.emit({"type": "tool_input", "id": tid, "input": code})
            text, payload = await ci.run_code(self.req.conversation_id, self.req.user_id, code)
            status = "error" if payload.get("error") else "done"
        else:
            await self.emit({"type": "tool_input", "id": tid, "input": args})
            text, payload = await self.mcp.call(name, args if isinstance(args, dict) else {})
            for block in payload.get("content", []):
                if block.get("type") == "image" and block.get("data"):
                    ext = (block.get("mime") or "image/png").split("/")[-1]
                    rec = store_bytes(self.req.user_id, f"{payload.get('tool', 'tool')}.{ext}",
                                      base64.b64decode(block.pop("data")), source="image",
                                      conversation_id=self.req.conversation_id)
                    block["file"] = public_file(rec)
            status = "error" if payload.get("is_error") or payload.get("error") else "done"
        await self.emit({"type": "tool_end", "id": tid, "status": status, "output": payload,
                         "duration_ms": int((time.time() - started) * 1000)})
        return text

    # ---- Responses API -------------------------------------------------------------------------------
    async def _run_responses(self, instructions: str) -> None:
        s, m = self.settings, self.req.model
        items: list[Any] = self._history("responses") + [self._current_user("responses")]
        tools: list[dict[str, Any]] = []
        include: list[str] = []
        if self.code_mode == "local":
            tools.append(ci.FUNCTION_TOOL_RESPONSES)
        elif self.code_mode == "hosted":
            tools.append({"type": "code_interpreter", "container": await self._ensure_container()})
            include.append("code_interpreter_call.outputs")
        tools += self.mcp.function_tools(self.req.mcp_server_ids, "responses")

        reasoning: dict[str, Any] | None = None
        if m.reasoning and self.req.effort:
            reasoning = {"effort": self.req.effort}
            if s.reasoning_summary != "off" and self.req.effort != "none":
                reasoning["summary"] = s.reasoning_summary
            if not s.responses_store:
                include.append("reasoning.encrypted_content")

        step = continuations = 0
        while True:
            params: dict[str, Any] = {
                "model": m.deployment, "input": items, "instructions": instructions,
                "stream": True, "store": s.responses_store,
            }
            if tools:
                params["tools"] = tools
                if step >= s.max_tool_steps:
                    params["tool_choice"] = "none"
            if reasoning:
                params["reasoning"] = reasoning
            if include:
                params["include"] = include
            if s.max_output_tokens:
                params["max_output_tokens"] = s.max_output_tokens

            final, calls, cut = await self._stream_response(params)
            if cut:
                await self._abandon_hosted_code()
            if final is not None:
                self.usage.add(Usage.from_api(getattr(final, "usage", None)))
                items.extend(_carry_forward(getattr(final, "output", None) or [], bool(cut)))
            elif calls:
                items.extend({"type": "function_call", "call_id": c["call_id"], "name": c["name"],
                              "arguments": c["arguments"]} for c in calls)
            if cut and not calls:
                if cut == "max_output_tokens" and continuations < s.max_continuations:
                    # Hosted tools run inside one response, so a long job can use up a whole response's
                    # output budget; pick up where it stopped in a fresh response.
                    continuations += 1
                    log.info("Reply hit max_output_tokens; continuing (%d/%d)", continuations, s.max_continuations)
                    last = items[-1] if items else {}
                    partial = last.get("content", "") if last.get("role") == "assistant" else ""
                    items.append({"role": "developer", "content": continue_prompt(partial)})
                    await self._flush_seam()  # a continuation that was itself cut off
                    self._continuing = True
                    continue
                await self._cut_short_notice(cut, continuations)
            if not calls or step >= s.max_tool_steps:
                break
            step += 1
            for call in calls:
                output = await self._execute(call)
                items.append({"type": "function_call_output", "call_id": call["call_id"], "output": output})

        if self.code_mode == "hosted":
            await self._collect_container_files()

    async def _stream_response(self, params: dict[str, Any]) -> tuple[Any, list[dict[str, Any]], str | None]:
        """Stream one response. Returns (final response, completed function calls, why it was cut short)."""
        stream = await self.client.responses.create(**params)
        final = None
        cut: str | None = None
        calls: list[dict[str, Any]] = []
        by_item: dict[str, dict[str, Any]] = {}
        summary_index: dict[str, int] = {}
        async for ev in stream:
            t = getattr(ev, "type", "")
            if t == "response.output_item.added":
                item = ev.item
                itype = getattr(item, "type", "")
                if itype == "reasoning":
                    await self._reasoning_start(item.id)
                elif itype == "function_call":
                    await self._close_reasoning()
                    call = {"id": item.call_id or item.id, "call_id": item.call_id, "name": item.name,
                            "arguments": "", "decoder": CodeArgStream() if item.name == ci.TOOL_NAME else None}
                    by_item[item.id] = call
                    await self._tool_start(call["id"], item.name)
                elif itype == "code_interpreter_call":
                    await self._close_reasoning()
                    self._hosted_started[item.id] = time.monotonic()
                    await self.emit({"type": "tool_start", "id": item.id, "kind": "hosted_code", "name": "python",
                                     "server": "", "label": "Code interpreter"})
            elif t in ("response.reasoning_summary_text.delta", "response.reasoning_text.delta"):
                rid = ev.item_id
                await self._reasoning_start(rid)
                delta = ev.delta
                idx = getattr(ev, "summary_index", None)
                if idx is not None:
                    prev = summary_index.get(rid)
                    if prev is not None and prev != idx:
                        delta = "\n\n" + delta
                    summary_index[rid] = idx
                await self.emit({"type": "reasoning_delta", "id": rid, "delta": delta})
            elif t == "response.output_text.delta":
                await self._close_reasoning()
                await self._text_delta(ev.delta)
            elif t == "response.function_call_arguments.delta":
                call = by_item.get(ev.item_id)
                if call is not None:
                    call["arguments"] += ev.delta
                    if call["decoder"] is not None:
                        chunk = call["decoder"].feed(ev.delta)
                        if chunk:
                            await self.emit({"type": "tool_input_delta", "id": call["id"], "delta": chunk})
            elif t == "response.code_interpreter_call_code.delta":
                await self.emit({"type": "tool_input_delta", "id": ev.item_id, "delta": ev.delta})
            elif t == "response.output_item.done":
                item = ev.item
                itype = getattr(item, "type", "")
                if itype == "reasoning":
                    await self._reasoning_end(item.id)
                elif itype == "function_call":
                    call = by_item.get(item.id) or {"id": item.call_id, "name": item.name, "decoder": None}
                    call.update(call_id=item.call_id, name=item.name, arguments=item.arguments or call.get("arguments", ""))
                    calls.append(call)
                elif itype == "code_interpreter_call":
                    await self._hosted_code_done(item)
            elif t in ("response.completed", "response.incomplete"):
                final = ev.response
                if t == "response.incomplete":
                    cut = getattr(getattr(final, "incomplete_details", None), "reason", None) or "unknown"
            elif t == "response.failed":
                err = getattr(ev.response, "error", None)
                raise ProviderError(f"The model failed to respond: {getattr(err, 'message', 'unknown error')}")
            elif t == "error":
                raise ProviderError(f"Model stream error: {getattr(ev, 'message', ev)}")
        await self._close_reasoning()
        return final, calls, cut

    async def _text_delta(self, delta: str) -> None:
        if self._continuing:
            # Hold the start of a continuation back until there's enough to compare with the last line.
            self._seam_buf += delta
            last = self._text_so_far.rsplit("\n", 1)[-1].strip()
            if len(self._seam_buf) >= min(200, max(8, len(last) + 2)):
                await self._flush_seam()
            return
        self._text_so_far += delta
        await self.emit({"type": "text_delta", "delta": delta})

    async def _flush_seam(self) -> None:
        if not self._continuing:
            return
        self._continuing = False
        delta, self._seam_buf = join_continuation(self._text_so_far, self._seam_buf), ""
        if delta:
            self._text_so_far += delta
            await self.emit({"type": "text_delta", "delta": delta})

    async def _cut_short_notice(self, reason: str, continuations: int) -> None:
        if reason == "max_output_tokens":
            tries = f" after {continuations} automatic continuation{'s' if continuations != 1 else ''}" if continuations else ""
            text = (f"This reply hit the output-token limit and was cut short{tries}. Ask it to continue, or raise "
                    "MAX_OUTPUT_TOKENS / MAX_CONTINUATIONS.")
        elif reason == "content_filter":
            text = "The reply was stopped by the provider's content filter."
        else:
            text = f"The reply was cut short ({reason})."
        await self.emit({"type": "notice", "level": "warning", "text": text})

    # ---- hosted code interpreter (provider containers) -------------------------------------------------
    async def _ensure_container(self) -> str:
        db = get_db()
        cid = self.req.conversation_id
        conv = db.get_conversation(cid) or {}
        container_id = conv.get("container_id")
        if container_id:
            try:
                c = await self.client.containers.retrieve(container_id)
                if getattr(c, "status", "running") not in ("running", "active"):
                    container_id = None
            except openai.NotFoundError:
                container_id = None
        if not container_id:
            c = await self.client.containers.create(name=f"amentum-{cid}")
            container_id = c.id
            db.update_conversation(cid, container_id=container_id)
        existing = set()
        async for f in self.client.containers.files.list(container_id):
            existing.add(Path(f.path).name)
        for f in db.list_files(cid):
            if f["source"] in ("upload", "generated") and f["name"] not in existing:
                await self.client.containers.files.create(container_id=container_id,
                                                          file=(f["name"], Path(f["path"]).read_bytes()))
                existing.add(f["name"])
        self._container_id = container_id
        return container_id

    async def _hosted_code_done(self, item: Any) -> None:
        logs, images = [], []
        for o in getattr(item, "outputs", None) or []:
            if getattr(o, "type", "") == "logs":
                logs.append(o.logs)
            elif getattr(o, "type", "") == "image":
                images.append({"id": None, "name": "figure.png", "url": o.url, "mime": "image/png"})
        started = self._hosted_started.pop(item.id, None)
        duration = int((time.monotonic() - started) * 1000) if started else 0
        status = getattr(item, "status", None) or "completed"
        error = None
        if status == "failed":
            error = {"name": "Error", "value": "The hosted code interpreter reported a failure.", "traceback": ""}
        elif status != "completed":
            error = {"name": "Incomplete", "value": "This code step was cut off before it finished.", "traceback": ""}
        await self.emit({"type": "tool_input", "id": item.id, "input": getattr(item, "code", "") or ""})
        await self.emit({"type": "tool_end", "id": item.id, "duration_ms": duration,
                         "status": {"completed": "done", "failed": "error"}.get(status, "stopped"),
                         "output": {"stdout": "\n".join(logs), "stderr": "", "results": [], "error": error,
                                    "images": images, "files": []}})

    async def _abandon_hosted_code(self) -> None:
        """Close code cards whose step never finished because the response was cut off."""
        for item_id in list(self._hosted_started):
            del self._hosted_started[item_id]
            await self.emit({"type": "tool_end", "id": item_id, "status": "stopped", "duration_ms": 0,
                             "output": _cut_off_output(True, "code step")})

    async def _collect_container_files(self) -> None:
        if not self._container_id:
            return
        db = get_db()
        known = {f.get("sandbox_path") for f in db.list_files(self.req.conversation_id)}
        new_files = []
        async for f in self.client.containers.files.list(self._container_id):
            key = f"container:{f.id}"
            if getattr(f, "source", "") != "assistant" or key in known:
                continue
            content = await self.client.containers.files.content.retrieve(f.id, container_id=self._container_id)
            rec = store_bytes(self.req.user_id, Path(f.path).name, content.content, source="generated",
                              conversation_id=self.req.conversation_id, sandbox_path=key)
            new_files.append(public_file(rec))
        if new_files:
            await self.emit({"type": "files", "files": new_files})

    # ---- Chat Completions -------------------------------------------------------------------------------
    async def _run_chat(self, instructions: str) -> None:
        s, m = self.settings, self.req.model
        messages: list[dict[str, Any]] = [{"role": "system", "content": instructions}]
        messages += self._history("chat") + [self._current_user("chat")]
        tools: list[dict[str, Any]] = [ci.FUNCTION_TOOL_CHAT] if self.code_mode == "local" else []
        tools += self.mcp.function_tools(self.req.mcp_server_ids, "chat")
        effort = self.req.effort if m.reasoning else None

        step = continuations = requests = 0
        while True:
            requests += 1
            params: dict[str, Any] = {"model": m.deployment, "messages": messages, "stream": True,
                                      "stream_options": {"include_usage": True}}
            if tools:
                params["tools"] = tools
                if step >= s.max_tool_steps:
                    params["tool_choice"] = "none"
            if effort:
                params["reasoning_effort"] = effort
            if s.max_output_tokens:
                params["max_completion_tokens"] = s.max_output_tokens

            rid = f"rs_chat_{requests}"
            try:
                stream = await self.client.chat.completions.create(**params)
            except openai.BadRequestError as exc:
                # GPT-5.x on /chat/completions rejects function tools combined with reasoning_effort
                # (other than "none"). Keep the tools and retry this request without extended thinking.
                if not (tools and effort not in (None, "none") and "reasoning_effort" in str(exc)):
                    raise
                effort = "none"
                params["reasoning_effort"] = effort
                await self.emit({"type": "notice", "level": "info", "text":
                                 "This model's Chat Completions endpoint can't combine tools with extended thinking, "
                                 "so this answer used tools without it. Use the Responses API (\"api\": \"responses\") "
                                 "to get both."})
                stream = await self.client.chat.completions.create(**params)
            # Chat Completions only reveals thinking if the model streams `reasoning_content`; the UI's
            # live "Thinking" indicator covers the silent wait, so no empty thinking block is created.
            text = ""
            finish: str | None = None
            pending: dict[int, dict[str, Any]] = {}
            async for chunk in stream:
                if getattr(chunk, "usage", None):
                    self.usage.add(Usage.from_api(chunk.usage))
                if not chunk.choices:
                    continue
                finish = chunk.choices[0].finish_reason or finish
                delta = chunk.choices[0].delta
                rc = getattr(delta, "reasoning_content", None)
                if rc:
                    await self._reasoning_start(rid)
                    await self.emit({"type": "reasoning_delta", "id": rid, "delta": rc})
                if delta.content:
                    await self._close_reasoning()
                    text += delta.content
                    await self._text_delta(delta.content)
                for tc in delta.tool_calls or []:
                    await self._close_reasoning()
                    entry = pending.setdefault(tc.index, {"id": "", "call_id": "", "name": "", "arguments": "",
                                                          "decoder": None, "started": False})
                    if tc.id:
                        entry["call_id"] = entry["id"] = tc.id
                    fn = tc.function
                    if fn is not None and fn.name:
                        entry["name"] = fn.name
                    if not entry["started"] and entry["name"] and entry["id"]:
                        entry["started"] = True
                        entry["decoder"] = CodeArgStream() if entry["name"] == ci.TOOL_NAME else None
                        await self._tool_start(entry["id"], entry["name"])
                        if entry["arguments"] and entry["decoder"]:
                            chunk_text = entry["decoder"].feed(entry["arguments"])
                            if chunk_text:
                                await self.emit({"type": "tool_input_delta", "id": entry["id"], "delta": chunk_text})
                    if fn is not None and fn.arguments:
                        entry["arguments"] += fn.arguments
                        if entry["started"] and entry["decoder"] is not None:
                            chunk_text = entry["decoder"].feed(fn.arguments)
                            if chunk_text:
                                await self.emit({"type": "tool_input_delta", "id": entry["id"], "delta": chunk_text})
            await self._close_reasoning()
            if finish == "length":
                # Cut off by the output limit. Any tool call in flight has truncated arguments: drop it.
                for c in pending.values():
                    if c["started"]:
                        await self.emit({"type": "tool_end", "id": c["id"], "status": "stopped", "duration_ms": 0,
                                         "output": _cut_off_output(c["name"] == ci.TOOL_NAME, "call")})
                if continuations < s.max_continuations:
                    continuations += 1
                    log.info("Reply hit the output limit; continuing (%d/%d)", continuations, s.max_continuations)
                    if text:
                        messages.append({"role": "assistant", "content": text})
                    messages.append({"role": "user", "content": continue_prompt(text)})
                    await self._flush_seam()  # a continuation that was itself cut off
                    self._continuing = True
                    continue
                await self._cut_short_notice("max_output_tokens", continuations)
                break
            if finish == "content_filter":
                await self._cut_short_notice("content_filter", continuations)
            if not pending or step >= s.max_tool_steps:
                break
            step += 1
            calls = [pending[i] for i in sorted(pending)]
            for c in calls:
                if not c["started"]:
                    c["id"] = c["call_id"] = c["call_id"] or f"call_{requests}_{len(calls)}"
                    await self._tool_start(c["id"], c["name"])
            messages.append({
                "role": "assistant", "content": text or None,
                "tool_calls": [{"id": c["call_id"], "type": "function",
                                "function": {"name": c["name"], "arguments": c["arguments"] or "{}"}} for c in calls],
            })
            for c in calls:
                output = await self._execute(c)
                messages.append({"role": "tool", "tool_call_id": c["call_id"], "content": output})


async def generate_title(first_message: str, demo_base_url: str | None) -> tuple[str, Usage, ModelInfo]:
    """Short conversation title from the title model (defaults to the cheapest model)."""
    catalog = get_catalog()
    settings = get_settings()
    model = catalog.get(settings.title_model)
    client = get_client(demo_base_url)
    prompt = TITLE_PROMPT.format(message=first_message[:2000])
    if model.api == "chat":
        params: dict[str, Any] = {"model": model.deployment, "messages": [{"role": "user", "content": prompt}]}
        if model.reasoning and model.efforts:
            params["reasoning_effort"] = "none" if "none" in model.efforts else model.efforts[0]
        r = await client.chat.completions.create(**params)
        title = r.choices[0].message.content or ""
    else:
        params = {"model": model.deployment, "input": prompt, "store": False}
        if model.reasoning and model.efforts:
            params["reasoning"] = {"effort": "none" if "none" in model.efforts else model.efforts[0]}
        r = await client.responses.create(**params)
        title = getattr(r, "output_text", "") or ""
    title = re.sub(r"\s+", " ", title).strip().strip('"\'.').strip()
    return title[:80], Usage.from_api(getattr(r, "usage", None)), model
