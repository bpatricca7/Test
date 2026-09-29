import type { Part, StreamEvent } from "./types";

/** Applies one stream event to a message's parts timeline.
 *  Mirrors backend/app/llm/parts.py so live and reloaded messages render identically. */
export function applyEvent(parts: Part[], ev: StreamEvent): Part[] {
  const next = parts.slice();
  const now = Date.now() / 1000;
  const findIdx = (type: string, id: string) => {
    for (let i = next.length - 1; i >= 0; i--) {
      const p = next[i] as { type: string; id?: string };
      if (p.type === type && p.id === id) return i;
    }
    return -1;
  };

  switch (ev.type) {
    case "reasoning_start":
      next.push({ type: "reasoning", id: ev.id, text: "", status: "running", started_at: now });
      break;
    case "reasoning_delta": {
      const i = findIdx("reasoning", ev.id);
      if (i < 0) next.push({ type: "reasoning", id: ev.id, text: ev.delta, status: "running", started_at: now });
      else {
        const p = next[i] as Extract<Part, { type: "reasoning" }>;
        next[i] = { ...p, text: p.text + ev.delta };
      }
      break;
    }
    case "reasoning_end": {
      const i = findIdx("reasoning", ev.id);
      if (i >= 0) next[i] = { ...(next[i] as Extract<Part, { type: "reasoning" }>), status: "done", duration_ms: ev.duration_ms };
      break;
    }
    case "text_delta": {
      const last = next[next.length - 1];
      if (last && last.type === "text") next[next.length - 1] = { ...last, text: last.text + ev.delta };
      else next.push({ type: "text", text: ev.delta });
      break;
    }
    case "tool_start":
      next.push({
        type: "tool", id: ev.id, kind: ev.kind, name: ev.name, server: ev.server ?? "", label: ev.label ?? ev.name,
        input: "", status: "running", started_at: now,
      });
      break;
    case "tool_input_delta": {
      const i = findIdx("tool", ev.id);
      if (i >= 0) {
        const p = next[i] as Extract<Part, { type: "tool" }>;
        if (typeof p.input === "string") next[i] = { ...p, input: p.input + ev.delta };
      }
      break;
    }
    case "tool_input": {
      const i = findIdx("tool", ev.id);
      if (i >= 0) next[i] = { ...(next[i] as Extract<Part, { type: "tool" }>), input: ev.input };
      break;
    }
    case "tool_end": {
      const i = findIdx("tool", ev.id);
      if (i >= 0)
        next[i] = {
          ...(next[i] as Extract<Part, { type: "tool" }>),
          status: ev.status, output: ev.output, duration_ms: ev.duration_ms,
        };
      break;
    }
    case "files":
      next.push({ type: "files", files: ev.files });
      break;
    case "notice":
      next.push({ type: "notice", level: ev.level, text: ev.text });
      break;
    default:
      return parts;
  }
  return next;
}

export function finalizeParts(parts: Part[], stopped: boolean): Part[] {
  return parts.map((p) =>
    "status" in p && p.status === "running" ? ({ ...p, status: stopped ? "stopped" : "done" } as Part) : p,
  );
}

export function textOf(parts: Part[]): string {
  return parts.filter((p): p is Extract<Part, { type: "text" }> => p.type === "text").map((p) => p.text).join("");
}
