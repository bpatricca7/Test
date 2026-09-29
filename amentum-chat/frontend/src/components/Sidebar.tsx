import { useEffect, useMemo, useRef, useState } from "react";
import { ChartColumn, Ellipsis, PanelLeftClose, Pencil, Pin, PinOff, Plug, Search, Settings, SquarePen, Trash2, ShieldCheck } from "lucide-react";
import clsx from "clsx";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../lib/store";
import type { ConversationSummary } from "../lib/types";
import { fmtCost, groupLabel } from "../lib/format";
import { BrandMark, Wordmark } from "./Brand";

function ConversationItem({ c, active }: { c: ConversationSummary; active: boolean }) {
  const { openConversation, renameConversation, togglePin, deleteConversation, toast } = useStore(useShallow((s) => ({ openConversation: s.openConversation, renameConversation: s.renameConversation, togglePin: s.togglePin, deleteConversation: s.deleteConversation, toast: s.toast })));
  const showUsage = useStore((s) => s.showUsage());
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(c.title);
  const [confirm, setConfirm] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setTitle(c.title), [c.title]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setMenu(false);
        setConfirm(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  const commit = async () => {
    setEditing(false);
    if (title.trim() && title !== c.title) await renameConversation(c.id, title.trim()).catch((e) => toast(e.message, "error"));
  };

  return (
    <div ref={ref} className={clsx("conv-item", active && "active", menu && "menu-open")}>
      {editing ? (
        <input className="conv-rename" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setEditing(false); setTitle(c.title); } }} />
      ) : (
        <button className="conv-link" onClick={() => openConversation(c.id)} title={c.title}>
          {c.pinned && <Pin size={12} className="conv-pin" />}
          <span className="conv-title">{c.title}</span>
          {showUsage && c.cost_usd > 0 && <span className="conv-cost">{fmtCost(c.cost_usd)}</span>}
        </button>
      )}
      <button className="icon-btn subtle conv-more" onClick={() => setMenu((m) => !m)} title="More">
        <Ellipsis size={15} />
      </button>
      {menu && (
        <div className="popover conv-menu">
          <button onClick={() => { setMenu(false); setEditing(true); }}><Pencil size={14} /> Rename</button>
          <button onClick={() => { setMenu(false); togglePin(c.id); }}>
            {c.pinned ? <><PinOff size={14} /> Unpin</> : <><Pin size={14} /> Pin</>}
          </button>
          <button className="danger" onClick={() => {
            if (!confirm) return setConfirm(true);
            setMenu(false);
            deleteConversation(c.id).catch((e) => toast(e.message, "error"));
          }}>
            <Trash2 size={14} /> {confirm ? "Click again to delete" : "Delete"}
          </button>
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const { config, conversations, currentId, newChat, refreshConversations, setModal, connectors, sidebarOpen, setSidebarOpen } = useStore(useShallow((s) => ({ config: s.config, conversations: s.conversations, currentId: s.currentId, newChat: s.newChat, refreshConversations: s.refreshConversations, setModal: s.setModal, connectors: s.connectors, sidebarOpen: s.sidebarOpen, setSidebarOpen: s.setSidebarOpen })));
  const showUsage = useStore((s) => s.showUsage());
  const [q, setQ] = useState("");

  useEffect(() => {
    const t = setTimeout(() => refreshConversations(q), 220);
    return () => clearTimeout(t);
  }, [q, refreshConversations]);

  const groups = useMemo(() => {
    const out: [string, ConversationSummary[]][] = [];
    const pinned = conversations.filter((c) => c.pinned);
    if (pinned.length) out.push(["Pinned", pinned]);
    for (const c of conversations.filter((x) => !x.pinned)) {
      const label = groupLabel(c.updated_at);
      const g = out.find(([l]) => l === label);
      if (g) g[1].push(c);
      else out.push([label, [c]]);
    }
    return out;
  }, [conversations]);

  const connected = connectors.filter((c) => c.status === "connected").length;
  const initials = (config?.user.name ?? "U").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const gov = config?.provider === "azure_gcc_high";

  return (
    <>
      <div className={clsx("sidebar-scrim", sidebarOpen && "show")} onClick={() => setSidebarOpen(false)} />
      <aside className={clsx("sidebar", sidebarOpen && "open")}>
        <div className="sidebar-top">
          <div className="brand">
            <BrandMark size={34} />
            <Wordmark name={config?.app_name ?? "Amentum AI"} />
          </div>
          <button className="icon-btn subtle" onClick={() => setSidebarOpen(false)} title="Close sidebar">
            <PanelLeftClose size={18} />
          </button>
        </div>

        <button className="new-chat" onClick={newChat}>
          <SquarePen size={16} />
          <span>New chat</span>
          <kbd>Ctrl ⇧ O</kbd>
        </button>

        <div className="search">
          <Search size={15} />
          <input placeholder="Search conversations" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>

        <nav className="conv-list">
          {groups.length === 0 && <div className="conv-empty">{q ? "No matches" : "Your conversations will appear here."}</div>}
          {groups.map(([label, items]) => (
            <div key={label} className="conv-group">
              <div className="conv-group-label">{label}</div>
              {items.map((c) => <ConversationItem key={c.id} c={c} active={c.id === currentId} />)}
            </div>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <button className="side-link" onClick={() => setModal("connectors")}>
            <Plug size={16} />
            <span>Connectors</span>
            {connectors.length > 0 && <span className={clsx("side-badge", connected > 0 && "ok")}>{connected}/{connectors.length}</span>}
          </button>
          {showUsage && (
            <button className="side-link" onClick={() => setModal("usage")}>
              <ChartColumn size={16} />
              <span>Usage & cost</span>
            </button>
          )}
          <button className="side-link" onClick={() => setModal("settings")}>
            <Settings size={16} />
            <span>Settings</span>
          </button>
          <div className="user-chip">
            <span className="avatar">{initials}</span>
            <div className="user-meta">
              <strong>{config?.user.name}</strong>
              <span className={clsx("env", gov && "gov")}>
                {gov && <ShieldCheck size={11} />}
                {config?.provider_label}
              </span>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
