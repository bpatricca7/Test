export interface ModelInfo {
  id: string;
  label: string;
  tier: string;
  description: string;
  api: "responses" | "chat";
  reasoning: boolean;
  efforts: string[];
  default_effort: string;
  vision: boolean;
  pricing: { input: number; cached_input: number; output: number };
}

export interface AppConfig {
  app_name: string;
  tagline: string;
  banner: { text: string; color: string } | null;
  provider: "demo" | "openai" | "azure" | "azure_gcc_high";
  provider_label: string;
  models: ModelInfo[];
  default_model: string;
  code_interpreter: "local" | "hosted" | "off";
  reasoning_summary: string;
  show_usage_default: boolean;
  max_upload_mb: number;
  user: { id: string; name: string; is_admin: boolean };
  problems: string[];
}

export interface FileRef {
  id: string | null;
  name: string;
  mime: string;
  size?: number;
  kind?: string;
  source?: string;
  sandbox_path?: string | null;
  previewable?: boolean;
  url: string;
}

export interface UsageInfo {
  input_tokens: number;
  cached_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  calls: number;
  cost_usd: number;
  model?: string;
  effort?: string | null;
  duration_ms?: number;
}

export interface CodeOutput {
  stdout: string;
  stderr: string;
  results: string[];
  error: { name: string; value: string; traceback?: string } | null;
  images: FileRef[];
  files: FileRef[];
  duration_ms?: number;
}

export interface McpOutput {
  content: { type: string; text?: string; uri?: string; name?: string; file?: FileRef }[];
  structured?: unknown;
  is_error?: boolean;
  error?: string;
  server?: string;
  tool?: string;
}

export type Part =
  | { type: "reasoning"; id: string; text: string; status: "running" | "done" | "stopped"; started_at?: number; duration_ms?: number }
  | { type: "text"; text: string }
  | {
      type: "tool";
      id: string;
      kind: "code" | "hosted_code" | "mcp";
      name: string;
      server: string;
      label: string;
      input: string | Record<string, unknown>;
      status: "running" | "done" | "error" | "stopped";
      output?: CodeOutput | McpOutput;
      started_at?: number;
      duration_ms?: number;
    }
  | { type: "files"; files: FileRef[] }
  | { type: "notice"; level: "info" | "warning" | "error"; text: string };

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  parts: Part[];
  attachments: FileRef[];
  usage: UsageInfo | null;
  model: string | null;
  status: "complete" | "streaming" | "stopped" | "error";
  created_at: number;
}

export interface ConversationSummary {
  id: string;
  title: string;
  model: string | null;
  pinned: boolean;
  created_at: number;
  updated_at: number;
  cost_usd: number;
}

export interface Connector {
  id: string;
  name: string;
  transport: "stdio" | "http" | "sse";
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  url: string;
  headers: Record<string, string>;
  enabled: boolean;
  description: string;
  icon: string;
  status: "connected" | "connecting" | "error" | "disconnected" | "disabled";
  error: string;
  server_info: { name?: string; version?: string };
  tools: { name: string; title: string; description: string }[];
}

export interface ConnectorPreset {
  key: string;
  name: string;
  description: string;
  icon: string;
  config: Partial<Connector>;
}

export interface StreamEvent {
  type: string;
  [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}
