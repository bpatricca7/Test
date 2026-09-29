import { create } from "zustand";
import { api, ApiError, streamChat, type ChatPayload } from "./api";
import { applyEvent, finalizeParts, textOf } from "./parts";
import type { AppConfig, Connector, ConversationSummary, FileRef, Message } from "./types";

type Theme = "system" | "dark" | "light";
type Modal = null | "connectors" | "usage" | "settings";

interface Prefs {
  theme: Theme;
  showUsage: boolean | null; // null = follow server default
  expandThinking: boolean;
  model: string | null;
  efforts: Record<string, string>;
  codeInterpreter: boolean;
  disabledConnectors: string[];
}

const PREFS_KEY = "amentum-ai.prefs.v1";
const defaultPrefs: Prefs = {
  theme: "system", showUsage: null, expandThinking: false, model: null, efforts: {}, codeInterpreter: true,
  disabledConnectors: [],
};

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...defaultPrefs, ...JSON.parse(raw) } : defaultPrefs;
  } catch {
    return defaultPrefs;
  }
}

function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
}

export interface Toast {
  id: number;
  kind: "info" | "error" | "success";
  text: string;
}

interface Streaming {
  controller: AbortController;
  assistantId: string;
  startedAt: number;
}

interface State {
  config: AppConfig | null;
  bootError: string | null;
  conversations: ConversationSummary[];
  search: string;
  currentId: string | null;
  messages: Message[];
  loadingConversation: boolean;
  streaming: Streaming | null;
  connectors: Connector[];
  canManageConnectors: boolean;
  prefs: Prefs;
  modal: Modal;
  preview: FileRef | null;
  sidebarOpen: boolean;
  toasts: Toast[];
  draft: string;
  setDraft: (d: string) => void;

  init: () => Promise<void>;
  setPrefs: (p: Partial<Prefs>) => void;
  setModal: (m: Modal) => void;
  setPreview: (f: FileRef | null) => void;
  setSidebarOpen: (open: boolean) => void;
  toast: (text: string, kind?: Toast["kind"]) => void;
  dismissToast: (id: number) => void;

  refreshConversations: (q?: string) => Promise<void>;
  newChat: () => void;
  openConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;

  send: (text: string, attachments: FileRef[], editMessageId?: string) => Promise<void>;
  stop: () => void;
  regenerate: () => void;

  loadConnectors: () => Promise<void>;
  toggleChatConnector: (id: string) => void;

  model: () => string;
  effort: () => string | null;
  showUsage: () => boolean;
}

let toastSeq = 0;

export const useStore = create<State>((set, get) => ({
  config: null,
  bootError: null,
  conversations: [],
  search: "",
  currentId: null,
  messages: [],
  loadingConversation: false,
  streaming: null,
  connectors: [],
  canManageConnectors: true,
  prefs: loadPrefs(),
  modal: null,
  preview: null,
  sidebarOpen: typeof window !== "undefined" ? window.innerWidth > 900 : true,
  toasts: [],
  draft: "",
  setDraft: (draft) => set({ draft }),

  init: async () => {
    try {
      const config = await api.config();
      set({ config });
      document.title = config.app_name;
      await Promise.all([get().refreshConversations(), get().loadConnectors()]);
      const id = new URLSearchParams(location.search).get("c");
      if (id) await get().openConversation(id);
    } catch (e) {
      set({ bootError: e instanceof Error ? e.message : String(e) });
    }
  },

  setPrefs: (p) => {
    const prefs = { ...get().prefs, ...p };
    savePrefs(prefs);
    set({ prefs });
  },
  setModal: (modal) => set({ modal }),
  setPreview: (preview) => set({ preview }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  toast: (text, kind = "info") => {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts, { id, kind, text }] });
    setTimeout(() => get().dismissToast(id), kind === "error" ? 7000 : 3500);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  model: () => {
    const { config, prefs } = get();
    if (!config) return "";
    const ids = config.models.map((m) => m.id);
    return prefs.model && ids.includes(prefs.model) ? prefs.model : config.default_model;
  },
  effort: () => {
    const { config, prefs } = get();
    const m = config?.models.find((x) => x.id === get().model());
    if (!m || !m.reasoning) return null;
    const chosen = prefs.efforts[m.id];
    return chosen && m.efforts.includes(chosen) ? chosen : m.default_effort;
  },
  showUsage: () => {
    const { prefs, config } = get();
    return prefs.showUsage ?? config?.show_usage_default ?? false;
  },

  refreshConversations: async (q) => {
    const search = q ?? get().search;
    try {
      const conversations = await api.conversations(search);
      set({ conversations, search });
    } catch (e) {
      get().toast(`Could not load conversations: ${(e as Error).message}`, "error");
    }
  },

  newChat: () => {
    if (get().streaming) get().stop();
    set({ currentId: null, messages: [] });
    history.replaceState(null, "", location.pathname);
    if (window.innerWidth <= 900) set({ sidebarOpen: false });
  },

  openConversation: async (id) => {
    if (get().streaming) get().stop();
    set({ currentId: id, loadingConversation: true, messages: [] });
    if (window.innerWidth <= 900) set({ sidebarOpen: false });
    try {
      const conv = await api.conversation(id);
      if (get().currentId !== id) return;
      set({ messages: conv.messages, loadingConversation: false });
      history.replaceState(null, "", `?c=${id}`);
      if (conv.model && get().config?.models.some((m) => m.id === conv.model)) get().setPrefs({ model: conv.model });
    } catch (e) {
      set({ loadingConversation: false, currentId: null });
      get().toast(e instanceof ApiError && e.status === 404 ? "Conversation not found" : (e as Error).message, "error");
      history.replaceState(null, "", location.pathname);
    }
  },

  renameConversation: async (id, title) => {
    await api.patchConversation(id, { title });
    set({ conversations: get().conversations.map((c) => (c.id === id ? { ...c, title } : c)) });
  },

  togglePin: async (id) => {
    const c = get().conversations.find((x) => x.id === id);
    if (!c) return;
    await api.patchConversation(id, { pinned: !c.pinned });
    await get().refreshConversations();
  },

  deleteConversation: async (id) => {
    await api.deleteConversation(id);
    if (get().currentId === id) get().newChat();
    set({ conversations: get().conversations.filter((c) => c.id !== id) });
  },

  send: async (text, attachments, editMessageId) => {
    const s = get();
    if (s.streaming || !s.config) return;
    const controller = new AbortController();
    const now = Date.now() / 1000;
    const model = s.model();
    const tempUserId = `tmp_u_${now}`;
    const tempAsstId = `tmp_a_${now}`;
    let base = s.messages;
    if (editMessageId) {
      const idx = base.findIndex((m) => m.id === editMessageId);
      if (idx >= 0) base = base.slice(0, idx);
    }
    const userMsg: Message = {
      id: tempUserId, role: "user", content: text, parts: [], attachments, usage: null, model: null,
      status: "complete", created_at: now,
    };
    const asstMsg: Message = {
      id: tempAsstId, role: "assistant", content: "", parts: [], attachments: [], usage: null, model,
      status: "streaming", created_at: now,
    };
    set({ messages: [...base, userMsg, asstMsg], streaming: { controller, assistantId: tempAsstId, startedAt: Date.now() } });

    let assistantId = tempAsstId;
    const patchAssistant = (fn: (m: Message) => Message) =>
      set({ messages: get().messages.map((m) => (m.id === assistantId ? fn(m) : m)) });

    const enabledConnectors = s.connectors
      .filter((c) => c.status === "connected" && !s.prefs.disabledConnectors.includes(c.id))
      .map((c) => c.id);
    const payload: ChatPayload = {
      message: text,
      conversation_id: s.currentId,
      model,
      effort: s.effort(),
      attachments: attachments.map((a) => a.id!).filter(Boolean),
      connectors: enabledConnectors,
      code_interpreter: s.prefs.codeInterpreter && s.config.code_interpreter !== "off",
      edit_message_id: editMessageId?.startsWith("tmp_") ? null : editMessageId ?? null,
    };

    let finalStatus: Message["status"] = "complete";
    let finalized = false;
    const finalize = () => {
      if (finalized) return;
      finalized = true;
      patchAssistant((m) => ({
        ...m,
        status: finalStatus,
        parts: finalizeParts(m.parts, finalStatus === "stopped"),
        content: textOf(m.parts),
      }));
      set({ streaming: null });
      get().refreshConversations();
    };
    try {
      await streamChat(
        payload,
        (ev) => {
          switch (ev.type) {
            case "meta": {
              const oldAsst = assistantId;
              assistantId = ev.assistant_message_id;
              set({
                messages: get().messages.map((m) =>
                  m.id === tempUserId ? { ...m, id: ev.user_message_id } : m.id === oldAsst ? { ...m, id: assistantId } : m,
                ),
                streaming: get().streaming ? { ...get().streaming!, assistantId } : null,
              });
              if (ev.created) {
                set({
                  currentId: ev.conversation_id,
                  conversations: [
                    { id: ev.conversation_id, title: ev.title, model, pinned: false, created_at: now, updated_at: now, cost_usd: 0 },
                    ...get().conversations,
                  ],
                });
                history.replaceState(null, "", `?c=${ev.conversation_id}`);
              }
              break;
            }
            case "usage":
              patchAssistant((m) => ({ ...m, usage: ev.usage }));
              break;
            case "title":
              set({
                conversations: get().conversations.map((c) => (c.id === ev.conversation_id ? { ...c, title: ev.title } : c)),
              });
              get().refreshConversations(); // DB already has the new title; avoids a stale in-flight refresh winning
              break;
            case "done":
              finalStatus = ev.status;
              finalize(); // unlock the composer; a title event may still follow
              break;
            default:
              patchAssistant((m) => ({ ...m, parts: applyEvent(m.parts, ev) }));
          }
        },
        controller.signal,
      );
    } catch (e) {
      if (controller.signal.aborted) finalStatus = "stopped";
      else {
        finalStatus = "error";
        patchAssistant((m) => ({
          ...m,
          parts: [...m.parts, { type: "notice", level: "error", text: `Request failed: ${(e as Error).message}` }],
        }));
      }
    } finally {
      finalize();
    }
  },

  stop: () => {
    const st = get().streaming;
    if (!st) return;
    if (!st.assistantId.startsWith("tmp_")) api.stop(st.assistantId).catch(() => undefined);
    st.controller.abort();
  },

  regenerate: () => {
    const msgs = get().messages;
    const lastUser = [...msgs].reverse().find((m) => m.role === "user");
    if (!lastUser || get().streaming) return;
    get().send(lastUser.content, lastUser.attachments, lastUser.id);
  },

  loadConnectors: async () => {
    try {
      const r = await api.connectors();
      set({ connectors: r.servers, canManageConnectors: r.can_manage });
    } catch {
      /* connectors are optional */
    }
  },

  toggleChatConnector: (id) => {
    const disabled = new Set(get().prefs.disabledConnectors);
    if (disabled.has(id)) disabled.delete(id);
    else disabled.add(id);
    get().setPrefs({ disabledConnectors: [...disabled] });
  },
}));
