import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "./lib/store";
import { Composer } from "./components/Composer";
import { ConnectorsModal } from "./components/ConnectorsModal";
import { EmptyState } from "./components/EmptyState";
import { FilePreviewModal } from "./components/Files";
import { Header } from "./components/Header";
import { MessageView } from "./components/MessageView";
import { SettingsModal } from "./components/SettingsModal";
import { Sidebar } from "./components/Sidebar";
import { LogoLoader } from "./components/ThinkingSpinner";
import { Toasts } from "./components/ui";
import { UsageModal } from "./components/UsageModal";
import { BrandMark } from "./components/Brand";

function useTheme() {
  const theme = useStore((s) => s.prefs.theme);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && mq.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
}

function Thread() {
  const { messages, loadingConversation, streaming } = useStore(
    useShallow((s) => ({ messages: s.messages, loadingConversation: s.loadingConversation, streaming: s.streaming })),
  );
  const scroller = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 120);
  };

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned) el.scrollTop = el.scrollHeight;
  }, [messages, pinned]);

  useEffect(() => {
    if (streaming) setPinned(true);
  }, [streaming?.controller]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loadingConversation) {
    return <div className="thread center"><LogoLoader width={48} /></div>;
  }
  if (!messages.length) {
    return <div className="thread empty-thread"><EmptyState /></div>;
  }
  return (
    <div className="thread" ref={scroller} onScroll={onScroll}>
      <div className="thread-inner">
        {messages.map((m, i) => (
          <MessageView key={m.id} msg={m} isLast={i === messages.length - 1} />
        ))}
      </div>
      {!pinned && (
        <button className="scroll-down" onClick={() => setPinned(true)} title="Scroll to latest">
          <ArrowDown size={16} />
        </button>
      )}
    </div>
  );
}

export default function App() {
  const { init, config, bootError, modal, newChat } = useStore(
    useShallow((s) => ({ init: s.init, config: s.config, bootError: s.bootError, modal: s.modal, newChat: s.newChat })),
  );
  useTheme();

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        newChat();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newChat]);

  if (bootError) {
    return (
      <div className="boot">
        <BrandMark width={48} />
        <h2>Can't reach the Amentum AI service</h2>
        <p>{bootError}</p>
        <button className="btn primary" onClick={() => location.reload()}>Retry</button>
      </div>
    );
  }
  if (!config) {
    return (
      <div className="boot">
        <LogoLoader width={56} />
      </div>
    );
  }

  return (
    <div className="app">
      {config.banner && (
        <div className="class-banner" style={{ background: config.banner.color }}>{config.banner.text}</div>
      )}
      <div className="app-body">
        <Sidebar />
        <main className="main">
          <Header />
          <Thread />
          <div className="composer-dock">
            <Composer />
            <p className="disclaimer">
              AI can make mistakes. Verify important information · {config.provider_label}
            </p>
          </div>
        </main>
      </div>
      {modal === "connectors" && <ConnectorsModal />}
      {modal === "usage" && <UsageModal />}
      {modal === "settings" && <SettingsModal />}
      <FilePreviewModal />
      <Toasts />
    </div>
  );
}
