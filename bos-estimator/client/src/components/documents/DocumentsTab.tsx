// Left panel › Documents (UI spec §5.4; replaces IngestPanel): one scroll body with the dropzone, pending files
// (skipped files listed with reasons), reader settings, the Analyze CTA, the no-API-key note, the documents in this
// project (kind, role, amendment, scanned pages, warnings), the last read, the previous-award summary and the
// browser's source-file cache (P1). Pending files, reader settings and analyze() live in the store, so the empty
// card and the drop overlay share them.
import { memo, useEffect, useState, type DragEvent } from 'react';
import { CircleAlert, CloudUpload, Info, LoaderCircle, Plus, ScanLine, TriangleAlert, X } from 'lucide-react';
import { useStore } from '../../store';
import { AI_MODEL_PRESETS, type AiConfig, type DocumentInfo } from '@shared/types';
import { duration, usdCompact } from '../../fmt';
import { ACCEPT_LABELS, fmtBytes } from '../lib/files';
import { cacheStats, clearCache, DOCS_CACHE_EVENT, type CacheStats } from '../lib/docsCache';
import { cx } from '../lib/cx';
import { Button, Chip, Field, Fields, Kbd, Popover, Segmented, Select, TextField, Tooltip, usePopover } from '../ui';
import { chooseFiles } from '../shell/fileChooser';
import { analyzeNow, fileIcon, readerLine, roleLabel, usesRuleBased } from './reader';
import '../../styles/documents.css';

export { readerLine } from './reader';

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
/** the no-API-key note is dismissible for the session (page lifetime), not persisted */
let noteDismissed = false;

export const DocumentsTab = memo(function DocumentsTab() {
  const project = useStore((s) => s.project);
  const running = useStore((s) => s.extraction.running);
  const runDocs = useStore((s) => s.extraction.docs);
  if (!project) return null;
  const docs = project.documents;
  return (
    <div className="docs panel__scroll">
      <Dropzone compact={docs.length > 0} running={running} />
      <PendingList />
      <ReaderCard running={running} />
      <Cta running={running} />
      <NoKeyNote />
      {running && runDocs.length > 0 && (
        <section className="docs__section" aria-label="Documents being read">
          <h3><LoaderCircle size={13} className="spin" aria-hidden />Reading now <span>{runDocs.length}</span></h3>
          <ul className="docs__list">{runDocs.map((d, i) => <DocRow key={`${d.name}-${i}`} d={d} />)}</ul>
        </section>
      )}
      {docs.length > 0 && (
        <section className="docs__section" aria-label="Documents in this project">
          <h3>In this project <span>{docs.length}</span></h3>
          <ul className="docs__list">{docs.map((d) => <DocRow key={d.name} d={d} />)}</ul>
        </section>
      )}
      <LastRead />
      <AwardSummary />
      <CacheLine />
    </div>
  );
});

// ------------------------------------------------------------------ 1. dropzone
function Dropzone({ compact, running }: { compact: boolean; running: boolean }) {
  const addPending = useStore((s) => s.addPendingFiles);
  const [drag, setDrag] = useState(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault(); setDrag(false);
    if (running) return;
    if (e.dataTransfer.files?.length) addPending(e.dataTransfer.files);
  };
  return (
    <div className={cx('docs__drop', compact && 'docs__drop--compact', drag && 'is-drag', running && 'is-disabled')}
      onDragEnter={(e) => { if (!running && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrag(true); } }}
      onDragOver={(e) => { if (running || !e.dataTransfer.types.includes('Files')) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDrag(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrag(false); }}
      onDrop={onDrop}>
      {compact ? (
        <Button variant="secondary" block icon={Plus} kbd="mod+o" disabled={running} tooltip={running ? 'Wait for the current read to finish' : 'Add documents (or drop files here)'} onClick={chooseFiles}>{drag ? 'Drop to add' : 'Add documents'}</Button>
      ) : (
        <button type="button" className="docs__drop-btn" disabled={running} onClick={chooseFiles} aria-describedby="docs-types">
          <CloudUpload size={26} strokeWidth={1.5} aria-hidden />
          <span className="docs__drop-title">{drag ? 'Drop to add to the package' : 'Drop PWS, technical exhibits, workload tables'}</span>
          <span className="docs__drop-sub">or click to choose files · <Kbd combo="mod+o" /></span>
          <span className="docs__types" id="docs-types">{ACCEPT_LABELS.map((t) => <span key={t}>{t}</span>)}</span>
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ 2. pending files
function PendingList() {
  const pending = useStore((s) => s.pendingFiles);
  const skipped = useStore((s) => s.pendingSkipped);
  const removePending = useStore((s) => s.removePendingFile);
  const pop = usePopover<HTMLButtonElement>();
  if (!pending.length && !skipped.length) return null;
  const bytes = pending.reduce((s, f) => s + f.size, 0);
  return (
    <section className="docs__pending-wrap" aria-label="Files to analyze">
      {pending.length > 0 && <div className="docs__pending-head"><span>{pending.length} file{pending.length > 1 ? 's' : ''} to analyze</span><span className="mono">{fmtBytes(bytes)}</span></div>}
      <ul className="docs__pending">
        {pending.map((f) => {
          const Icon = fileIcon(f.name);
          return (
            <li key={`${f.name}-${f.size}`}>
              <Icon size={14} strokeWidth={1.75} aria-hidden className="ic" />
              <span className="name" title={f.name}>{f.name}</span>
              <span className="size">{fmtBytes(f.size)}</span>
              <button type="button" aria-label={`Remove ${f.name}`} title="Remove" onClick={() => removePending(f)}><X size={14} aria-hidden /></button>
            </li>
          );
        })}
      </ul>
      {skipped.length > 0 && (
        <>
          <button ref={pop.anchorRef} type="button" className="docs__skipped" aria-expanded={pop.open} onClick={pop.toggle}>
            <TriangleAlert size={13} aria-hidden />{skipped.length} file{skipped.length > 1 ? 's' : ''} skipped · why?
          </button>
          <Popover {...pop.props} placement="bottom-start" label="Skipped files" className="docs__skipped-pop">
            <div className="docs__pop-title">Skipped: the reader can't open these</div>
            <ul>{skipped.map((x, i) => <li key={`${x.name}-${i}`}><span className="name" title={x.name}>{x.name}</span><span className="why">{x.reason}</span></li>)}</ul>
            <div className="docs__pop-foot">
              <span className="muted">Accepted: {ACCEPT_LABELS.join(' ')}</span>
              <Button size="sm" variant="ghost" onClick={() => { useStore.getState().clearSkipped(); pop.close(); }}>Clear</Button>
            </div>
          </Popover>
        </>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ 3. reader settings
function ReaderCard({ running }: { running: boolean }) {
  const ai = useStore((s) => s.project?.ai);
  const reader = useStore((s) => s.reader);
  const setReader = useStore((s) => s.setReader);
  const setAi = useStore((s) => s.setAi);
  const populated = useStore((s) => (s.project ? s.project.inventory.facilities.length + s.project.inventory.grounds.length > 0 : false));
  const [custom, setCustom] = useState(() => Boolean(ai && !AI_MODEL_PRESETS.some((p) => p.id === ai.model)));
  if (!ai) return null;
  return (
    <section className="docs__card" aria-label="Reader settings">
      <Fields>
        <Field label="Model" span="full">
          {(id) => (
            <select id={id} className="select" value={custom ? '__custom' : ai.model} disabled={running}
              onChange={(e) => { if (e.target.value === '__custom') setCustom(true); else { setCustom(false); setAi({ model: e.target.value }); } }}>
              {AI_MODEL_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              <option value="__custom">Custom model id…</option>
            </select>
          )}
        </Field>
        {custom && <Field label="Model id" span="full">{(id) => <TextField id={id} value={ai.model} placeholder="claude-…" disabled={running} onCommit={(v) => { if (v.trim()) setAi({ model: v.trim() }); }} />}</Field>}
        <Field label="Effort">{(id) => <Select id={id} value={ai.effort} disabled={running} onChange={(v) => setAi({ effort: v as AiConfig['effort'] })} options={EFFORTS.map((x) => ({ value: x, label: x }))} />}</Field>
        <Field label="Reader">{(id) => <Select id={id} value={reader.provider} disabled={running} onChange={(v) => setReader({ provider: v })} options={[{ value: 'auto', label: 'Auto' }, { value: 'claude', label: 'Claude only' }, { value: 'heuristic', label: 'Rule-based' }]} />}</Field>
        <Field label="PDF ingest" span="full">{(id) => <Select id={id} value={reader.ingest} disabled={running} onChange={(v) => setReader({ ingest: v })} options={[{ value: 'auto', label: 'Auto' }, { value: 'native_pdf', label: 'Native (model reads pages)' }, { value: 'text', label: 'Text layer only' }]} />}</Field>
        <div className="field field--full">
          <span className="field__label" id="docs-mode-label">Inventory</span>
          <Segmented block label="Inventory mode" value={reader.mode} onChange={(v) => setReader({ mode: v })} options={[{ value: 'replace', label: 'Replace' }, { value: 'append', label: 'Append' }]} />
          <span className="field__hint">{reader.mode === 'replace'
            ? (populated ? 'Replace re-reads the package into a staging list; your current inventory stays until it finishes and can be restored.' : 'Replace builds the inventory from this package.')
            : 'Append adds what the reader finds to the current inventory (matching buildings are merged).'}</span>
        </div>
      </Fields>
    </section>
  );
}

// ------------------------------------------------------------------ 4. CTA
function Cta({ running }: { running: boolean }) {
  const pending = useStore((s) => s.pendingFiles.length);
  const cancel = useStore((s) => s.cancelExtraction);
  useStore((s) => s.reader); useStore((s) => s.health); useStore((s) => s.project?.ai); // re-render the reader line
  if (running) return <div className="docs__cta"><Button variant="danger" block onClick={cancel}>Cancel run</Button></div>;
  return (
    <div className="docs__cta">
      <button type="button" className="docs__analyze" disabled={!pending} onClick={() => void analyzeNow()}
        title={pending ? undefined : 'Add documents first (drop them above or press Ctrl/⌘+O)'}>
        <span className="l1">Analyze {pending ? `${pending} file${pending > 1 ? 's' : ''}` : 'files'} <Kbd combo="mod+enter" /></span>
        <span className="l2">{readerLine()}</span>
      </button>
      <Button variant="secondary" block onClick={() => void analyzeNow({ sample: true })}>Try sample RFP</Button>
    </div>
  );
}

// ------------------------------------------------------------------ 5. no-API-key note (one line + popover)
function NoKeyNote() {
  const health = useStore((s) => s.health);
  const [hidden, setHidden] = useState(noteDismissed);
  const pop = usePopover<HTMLButtonElement>();
  if (!health || health.aiAvailable || hidden) return null;
  return (
    <div className="docs__note">
      <Info size={14} aria-hidden />
      <span className="txt" title="No API key on the server: the rule-based reader is used">No API key · rule-based reader</span>
      <button ref={pop.anchorRef} type="button" className="docs__note-why" aria-expanded={pop.open} onClick={pop.toggle}>Why?</button>
      <button type="button" className="docs__note-x" aria-label="Dismiss for this session" title="Dismiss for this session" onClick={() => { noteDismissed = true; setHidden(true); }}><X size={14} aria-hidden /></button>
      <Popover {...pop.props} placement="bottom-start" label="About the reader" className="docs__note-pop">
        <p><b>The server has no <code>ANTHROPIC_API_KEY</code>.</b> The rule-based parser reads well-structured facility lists and workload tables (XLSX, CSV, text-layer PDFs) and caps its confidence at 70%.</p>
        <p>Add the key to <code>.env</code> and restart the server to let Claude read scanned exhibits, drawings and free-form PWS text.</p>
      </Popover>
    </div>
  );
}

// ------------------------------------------------------------------ 6. document rows
interface DocLike { name: string; pages?: number; kind?: string; role?: string; amendment?: number; scannedPages?: number[]; warnings?: string[]; mode?: string }
function DocRow({ d }: { d: DocLike }) {
  const pop = usePopover<HTMLButtonElement>();
  const Icon = fileIcon(d.kind ?? d.name);
  const role = roleLabel(d as Pick<DocumentInfo, 'role' | 'amendment'>);
  const scanned = d.scannedPages?.length ?? 0;
  const warns = d.warnings?.length ?? 0;
  return (
    <li className="docs__doc">
      <Icon size={16} strokeWidth={1.6} aria-hidden className="ic" />
      <div className="docs__doc-main">
        <span className="name" title={d.name}>{d.name}</span>
        <span className="meta">
          {[d.pages ? `${d.pages.toLocaleString()} pp` : null, (d.kind ?? '').toUpperCase() || null, d.mode === 'native_pdf' ? 'native' : null].filter(Boolean).join(' · ')}
          {role && <Chip tone={d.role === 'amendment' ? 'accent' : 'neutral'}>{role}</Chip>}
          {scanned > 0 && <Tooltip content={`Pages without a text layer: ${d.scannedPages!.slice(0, 20).join(', ')}${scanned > 20 ? '…' : ''}`}><span className="warn" tabIndex={0}><ScanLine size={12} aria-hidden />{scanned} scanned page{scanned > 1 ? 's' : ''}</span></Tooltip>}
          {warns > 0 && (
            <>
              <button ref={pop.anchorRef} type="button" className="docs__doc-warn" aria-expanded={pop.open} onClick={pop.toggle} aria-label={`${warns} warning${warns > 1 ? 's' : ''} for ${d.name}`}><CircleAlert size={12} aria-hidden />{warns}</button>
              <Popover {...pop.props} placement="bottom-start" label={`Warnings for ${d.name}`} className="docs__warn-pop">
                <div className="docs__pop-title">{warns} warning{warns > 1 ? 's' : ''} · {d.name}</div>
                <ul>{d.warnings!.map((w, i) => <li key={i}>{w}</li>)}</ul>
              </Popover>
            </>
          )}
        </span>
      </div>
    </li>
  );
}

// ------------------------------------------------------------------ 7-8. last read, award summary, cache
function LastRead() {
  const x = useStore((s) => s.project?.extraction);
  if (!x) return null;
  return (
    <div className="docs__last">
      <span className="k">Last read</span>
      <span>{x.provider === 'claude' ? x.model ?? 'Claude' : 'Rule-based parser'} · {duration(x.durationMs)}{x.usage ? ` · ${x.usage.input.toLocaleString()} in / ${x.usage.output.toLocaleString()} out tokens` : ''}</span>
      <span className="muted">{new Date(x.finishedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
    </div>
  );
}

function AwardSummary() {
  const pa = useStore((s) => s.project?.priorAward);
  const openEstimate = useStore((s) => s.openEstimate);
  const value = pa?.annualValue ? `${usdCompact(pa.annualValue)}/yr` : pa?.totalValue ? `${usdCompact(pa.totalValue)} / ${pa.periodMonths ?? '?'} mo` : pa?.spendToDate ? `${usdCompact(pa.spendToDate)} spent / ${pa.spendPeriodMonths ?? '?'} mo` : null;
  return (
    <div className="docs__award">
      <span className="k">Previous award</span>
      <span className="v">{value ?? 'not found yet'}{pa?.incumbent ? <span className="muted"> · {pa.incumbent}</span> : null}</span>
      <button type="button" onClick={() => openEstimate('crosscheck')}>{value ? 'Edit in Estimate →' : 'Enter in Estimate →'}</button>
    </div>
  );
}

function CacheLine() {
  const projectId = useStore((s) => s.projectId);
  const [stats, setStats] = useState<CacheStats | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => { void cacheStats(projectId).then((x) => { if (live) setStats(x); }); };
    load();
    window.addEventListener(DOCS_CACHE_EVENT, load);
    return () => { live = false; window.removeEventListener(DOCS_CACHE_EVENT, load); };
  }, [projectId]);
  if (!stats?.count) return null;
  return (
    <div className="docs__cache">
      <Tooltip content={`Kept in this browser only, so the source pages stay viewable:\n${stats.names.slice(0, 12).join('\n')}${stats.count > 12 ? '\n…' : ''}`}>
        <span tabIndex={0}>Source files cached: {stats.count} ({fmtBytes(stats.bytes)})</span>
      </Tooltip>
      <button type="button" onClick={() => void clearCache(projectId)}>Clear</button>
    </div>
  );
}

export { usesRuleBased };
