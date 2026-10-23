// DropOverlay (UI spec §5.13, P1): a window-level dragenter counter, active only while files are dragged
// (dataTransfer.types includes "Files"). Full window --scrim with a 4 px blur at z --z-drop, holding two targets on a
// populated project ("Re-read package (Replace)", "Add to N facilities (Append)") or one on an empty project
// ("Read these documents"). A drop adds the files to Pending, sets the inventory mode and opens the Documents tab with
// Analyze focused. Nothing auto-starts. While a read runs the overlay says so and accepts nothing.
import { useEffect, useRef, useState, type DragEvent as ReactDragEvent } from 'react';
import { CloudUpload, FilePlus2, RefreshCw } from 'lucide-react';
import { useStore } from '../../store';
import { cx } from '../lib/cx';
import { Portal } from '../ui';
import type { IconType } from '../ui';

const hasFiles = (e: DragEvent | ReactDragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

export function DropOverlay() {
  const [active, setActive] = useState(false);
  const [hot, setHot] = useState<string | null>(null);
  const depth = useRef(0);
  const running = useStore((s) => s.extraction.running);
  const facilities = useStore((s) => s.project?.inventory.facilities.length ?? 0);
  const grounds = useStore((s) => s.project?.inventory.grounds.length ?? 0);

  useEffect(() => {
    const reset = () => { depth.current = 0; setActive(false); setHot(null); };
    const onEnter = (e: DragEvent) => { if (!hasFiles(e)) return; depth.current++; setActive(true); };
    const onLeave = (e: DragEvent) => { if (!hasFiles(e)) return; depth.current = Math.max(0, depth.current - 1); if (!depth.current) reset(); };
    // files dropped anywhere else must not navigate the tab away from the project
    const onOver = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const onDrop = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); reset(); };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('blur', reset);
    };
  }, []);

  if (!active) return null;
  const empty = facilities + grounds === 0;
  const accept = (mode: 'replace' | 'append') => (e: ReactDragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (!files?.length || running) return;
    const s = useStore.getState();
    s.setReader({ mode });
    s.addPendingFiles(files);
    s.openLeft('documents');
    let tries = 0;
    const focus = () => { const b = document.querySelector<HTMLButtonElement>('.docs__analyze'); if (b && !b.disabled) b.focus(); else if (++tries < 10) requestAnimationFrame(focus); };
    requestAnimationFrame(focus);
  };
  const target = (id: string, mode: 'replace' | 'append', Icon: IconType, title: string, sub: string) => (
    <div key={id} className={cx('drop-ov__target', hot === id && 'is-hot')}
      onDragEnter={() => setHot(id)} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHot((h) => (h === id ? null : h)); }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }} onDrop={accept(mode)}>
      <Icon size={28} strokeWidth={1.5} aria-hidden />
      <span className="drop-ov__title">{title}</span>
      <span className="drop-ov__sub">{sub}</span>
    </div>
  );
  return (
    <Portal>
      <div className="drop-ov" role="presentation" aria-hidden>
        {running ? (
          <div className="drop-ov__target is-off"><CloudUpload size={28} strokeWidth={1.5} aria-hidden /><span className="drop-ov__title">A read is running</span><span className="drop-ov__sub">Drop the files again when it finishes.</span></div>
        ) : empty ? (
          target('read', 'replace', CloudUpload, 'Read these documents', 'Adds them to the Documents tab; Analyze starts the read')
        ) : (
          <>
            {target('replace', 'replace', RefreshCw, 'Re-read package (Replace)', 'Reads into a staging list; your inventory stays until it finishes and can be restored')}
            {target('append', 'append', FilePlus2, `Add to ${facilities.toLocaleString()} facilit${facilities === 1 ? 'y' : 'ies'} (Append)`, 'New rows are added; existing rows are updated by id')}
          </>
        )}
      </div>
    </Portal>
  );
}
