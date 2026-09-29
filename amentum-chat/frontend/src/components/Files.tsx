import { useEffect, useState } from "react";
import { Download, Eye, File, FileArchive, FileCode, FileSpreadsheet, FileText, Image as ImageIcon, Presentation, Printer, X } from "lucide-react";
import type { FileRef } from "../lib/types";
import { fmtBytes } from "../lib/format";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../lib/store";
import { OrbitSpinner } from "./ThinkingSpinner";

const KIND: Record<string, { icon: typeof File; color: string; label: string }> = {
  word: { icon: FileText, color: "#3b82f6", label: "Word" },
  excel: { icon: FileSpreadsheet, color: "#1fae5f", label: "Excel" },
  powerpoint: { icon: Presentation, color: "#ea6a2e", label: "PowerPoint" },
  pdf: { icon: FileText, color: "#ef4d56", label: "PDF" },
  image: { icon: ImageIcon, color: "#a472f5", label: "Image" },
  code: { icon: FileCode, color: "#38b6d8", label: "Data" },
  text: { icon: FileText, color: "#8b95b0", label: "Text" },
  archive: { icon: FileArchive, color: "#d6a33a", label: "Archive" },
  file: { icon: File, color: "#8b95b0", label: "File" },
};

export function kindOf(f: FileRef) {
  const k = f.kind ?? (f.mime?.startsWith("image/") ? "image" : "file");
  return KIND[k] ?? KIND.file;
}

export function FileIcon({ file, size = 18 }: { file: FileRef; size?: number }) {
  const k = kindOf(file);
  const Icon = k.icon;
  return (
    <span className="file-icon" style={{ color: k.color, background: `${k.color}1f` }}>
      <Icon size={size} />
    </span>
  );
}

const pdfUrl = (f: FileRef) => (f.kind === "pdf" || f.kind === "image" ? `${f.url}?inline=1` : `/api/files/${f.id}/pdf`);

export async function printFile(f: FileRef, toast: (t: string, k?: "info" | "error" | "success") => void) {
  if (!f.id) return;
  const url = pdfUrl(f);
  toast(`Preparing ${f.name} for printing…`);
  try {
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(detail.detail ?? res.statusText);
    }
    const blobUrl = URL.createObjectURL(await res.blob());
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    frame.src = blobUrl;
    frame.onload = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } catch {
        window.open(blobUrl, "_blank");
      }
      setTimeout(() => frame.remove(), 60_000);
    };
    document.body.appendChild(frame);
  } catch (e) {
    toast(`Could not print: ${(e as Error).message}`, "error");
  }
}

export function FileCard({ file }: { file: FileRef }) {
  const { setPreview, toast } = useStore(useShallow((s) => ({ setPreview: s.setPreview, toast: s.toast })));
  const k = kindOf(file);
  const canPreview = file.id && file.previewable;
  return (
    <div className="file-card">
      <FileIcon file={file} size={20} />
      <button className="file-meta" onClick={() => canPreview && setPreview(file)} disabled={!canPreview}>
        <span className="file-name" title={file.name}>{file.name}</span>
        <span className="file-sub">
          {k.label}
          {file.size ? ` · ${fmtBytes(file.size)}` : ""}
          {file.source === "generated" && <span className="file-badge">New</span>}
        </span>
      </button>
      <div className="file-actions">
        {canPreview && (
          <button className="icon-btn subtle" title="Preview" onClick={() => setPreview(file)}>
            <Eye size={15} />
          </button>
        )}
        {canPreview && (
          <button className="icon-btn subtle" title="Print" onClick={() => printFile(file, toast)}>
            <Printer size={15} />
          </button>
        )}
        {file.id && (
          <a className="icon-btn subtle" title="Download" href={file.url} download={file.name}>
            <Download size={15} />
          </a>
        )}
      </div>
    </div>
  );
}

export function FilePreviewModal() {
  const { preview, setPreview, toast } = useStore(useShallow((s) => ({ preview: s.preview, setPreview: s.setPreview, toast: s.toast })));
  const [state, setState] = useState<{ loading: boolean; error: string | null; src: string | null }>({
    loading: true, error: null, src: null,
  });

  useEffect(() => {
    if (!preview) return;
    setState({ loading: true, error: null, src: null });
    const isImage = preview.kind === "image" || preview.mime?.startsWith("image/");
    if (isImage) {
      setState({ loading: false, error: null, src: `${preview.url}?inline=1` });
      return;
    }
    // Warm the server-side PDF render first so errors can be shown nicely, then point the
    // viewer at the real (now cached) URL so the browser's PDF toolbar shows the file name.
    const url = pdfUrl(preview);
    let cancelled = false;
    fetch(url, { method: "GET" })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? r.statusText);
        if (!cancelled) setState({ loading: false, error: null, src: url });
      })
      .catch((e) => !cancelled && setState({ loading: false, error: (e as Error).message, src: null }));
    return () => {
      cancelled = true;
    };
  }, [preview]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPreview(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPreview]);

  if (!preview) return null;
  const isImage = preview.kind === "image" || preview.mime?.startsWith("image/");
  return (
    <div className="modal-backdrop" onClick={() => setPreview(null)}>
      <div className="modal preview-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <FileIcon file={preview} />
          <div className="modal-title">
            <h3>{preview.name}</h3>
            <span>{kindOf(preview).label}{preview.size ? ` · ${fmtBytes(preview.size)}` : ""}</span>
          </div>
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => printFile(preview, toast)}>
              <Printer size={15} /> Print
            </button>
            <a className="btn ghost" href={preview.url} download={preview.name}>
              <Download size={15} /> Download
            </a>
            <button className="icon-btn" onClick={() => setPreview(null)} title="Close">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="preview-body">
          {state.loading && (
            <div className="preview-status">
              <OrbitSpinner size={40} />
              <span>Rendering preview…</span>
            </div>
          )}
          {state.error && <div className="preview-status error">{state.error}</div>}
          {state.src && (isImage ? <img src={state.src} alt={preview.name} /> : <iframe src={state.src} title={preview.name} />)}
        </div>
      </div>
    </div>
  );
}
