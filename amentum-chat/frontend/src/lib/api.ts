import type { AppConfig, Connector, ConnectorPreset, ConversationSummary, FileRef, Message, StreamEvent } from "./types";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...init.headers },
    credentials: "same-origin",
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? body);
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  config: () => request<AppConfig>("/api/config"),
  conversations: (q = "") => request<ConversationSummary[]>(`/api/conversations?q=${encodeURIComponent(q)}`),
  conversation: (id: string) =>
    request<ConversationSummary & { messages: Message[]; files: FileRef[] }>(`/api/conversations/${id}`),
  patchConversation: (id: string, body: { title?: string; pinned?: boolean }) =>
    request(`/api/conversations/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteConversation: (id: string) => request(`/api/conversations/${id}`, { method: "DELETE" }),
  upload: (files: File[]) => {
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f, f.name));
    return request<FileRef[]>("/api/files", { method: "POST", body: fd });
  },
  stop: (messageId: string) => request(`/api/chat/${messageId}/stop`, { method: "POST" }),
  connectors: () =>
    request<{ servers: Connector[]; presets: ConnectorPreset[]; can_manage: boolean; allow_stdio: boolean }>(
      "/api/connectors",
    ),
  addConnector: (body: Partial<Connector>) =>
    request<Connector>("/api/connectors", { method: "POST", body: JSON.stringify(body) }),
  updateConnector: (id: string, body: Partial<Connector>) =>
    request<Connector>(`/api/connectors/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteConnector: (id: string) => request(`/api/connectors/${id}`, { method: "DELETE" }),
  reconnectConnector: (id: string) => request<Connector>(`/api/connectors/${id}/reconnect`, { method: "POST" }),
  testConnector: (body: Partial<Connector>) =>
    request<{ ok: boolean; error: string; tools: Connector["tools"]; server_info?: Connector["server_info"] }>(
      "/api/connectors/test",
      { method: "POST", body: JSON.stringify(body) },
    ),
  importConnectors: (json_text: string) =>
    request<Connector[]>("/api/connectors/import", { method: "POST", body: JSON.stringify({ json_text }) }),
  usage: (days: number, scope: "me" | "all") => request<UsageReport>(`/api/usage?days=${days}&scope=${scope}`),
  diagnostics: (probe = false) => request<Diagnostics>(`/api/diagnostics?probe=${probe}`),
};

export interface UsageRow {
  requests: number;
  input_tokens: number;
  cached_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cost_usd: number;
  calls: number;
  model?: string;
  day?: string;
  user?: string;
}

export interface UsageReport {
  days: number;
  scope: string;
  totals: UsageRow;
  by_model: UsageRow[];
  by_day: UsageRow[];
  by_user: UsageRow[];
  labels: Record<string, string>;
}

export interface Diagnostics {
  llm: Record<string, string | boolean>;
  problems: string[];
  code_interpreter: string;
  sandbox: Record<string, unknown> & { ok?: boolean; error?: string };
  connectors: { total: number; connected: number };
  probe?: { ok: boolean; model: string; latency_ms?: number; error?: string };
}

export interface ChatPayload {
  message: string;
  conversation_id: string | null;
  model: string;
  effort: string | null;
  attachments: string[];
  connectors: string[] | null;
  code_interpreter: boolean;
  edit_message_id?: string | null;
}

/** POST /api/chat and parse the Server-Sent Events stream. */
export async function streamChat(payload: ChatPayload, onEvent: (ev: StreamEvent) => void, signal: AbortSignal) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok || !res.body) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      for (const line of frame.split("\n")) {
        if (line.startsWith("data: ")) {
          try {
            onEvent(JSON.parse(line.slice(6)));
          } catch {
            /* ignore malformed frame */
          }
        }
      }
    }
  }
}
