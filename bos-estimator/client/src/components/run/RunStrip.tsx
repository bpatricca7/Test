// Run strip (UI spec §5.5): 40 px, the first row of .center (so it is part of --inset-top). Visible while a read runs
// and after done / failed / cancelled until dismissed or the next run. Stepper Upload → Read → Extract → Merge →
// Cross-check → Done, live counters, ticker, Log and Cancel; end states with Review N / Restore previous / Retry.
// The state machine is in store.ts (§7). Screen readers get one polite announcement at most every 5 s.
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Check, CircleAlert, CircleCheck, CircleSlash, LoaderCircle, ScrollText, TriangleAlert, X } from 'lucide-react';
import { useStore, type ExtractionDoc, type ExtractionState, type RunPhase } from '../../store';
import { useDerived } from '../../derived';
import { clockMs, duration } from '../../fmt';
import { cx } from '../lib/cx';
import { Button, IconButton, Tooltip } from '../ui';
import { startReview } from '../inventory/reviewLoop';
import { roleLabel } from '../documents/reader';
import '../../styles/run.css';

const STAGES: { id: string; label: string }[] = [
  { id: 'upload', label: 'Upload' }, { id: 'read', label: 'Read' }, { id: 'extract', label: 'Extract' },
  { id: 'merge', label: 'Merge' }, { id: 'cross', label: 'Cross-check' }, { id: 'done', label: 'Done' },
];
const ORDER: Record<RunPhase, number> = { idle: -1, uploading: 0, reading: 1, extracting: 2, merging: 3, crosscheck: 4, done: 5, failed: -1, cancelled: -1 };

/** ms since the run started, ticking at 1 Hz while running */
function useElapsed(x: Pick<ExtractionState, 'startedAt' | 'endedAt' | 'running'>) {
  const [, tick] = useState(0);
  useEffect(() => { if (!x.running) return; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, [x.running]);
  return x.startedAt ? (x.running ? Date.now() : x.endedAt ?? Date.now()) - x.startedAt : 0;
}

/** One polite announcement every 5 s at most (the visible strip itself is not a live region). */
function useThrottledAnnouncement(text: string) {
  const [said, setSaid] = useState(text);
  const latest = useRef(text); latest.current = text;
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (text === said) return;
    const wait = 5000 - (Date.now() - last.current);
    if (wait <= 0) { last.current = Date.now(); setSaid(text); return; }
    if (!timer.current) timer.current = setTimeout(() => { timer.current = null; last.current = Date.now(); setSaid(latest.current); }, wait);
  }, [text, said]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return said;
}

function docsTip(docs: ExtractionDoc[]) {
  return (
    <div className="rs-docs-tip">
      {docs.slice(0, 8).map((d, i) => (
        <div key={`${d.name}-${i}`} className="row">
          <span className="name">{d.name}</span>
          <span className="meta">{[d.pages ? `${d.pages} pp` : null, d.kind?.toUpperCase(), roleLabel({ role: d.role as never, amendment: d.amendment }), d.scannedPages?.length ? `${d.scannedPages.length} scanned` : null, d.warnings?.length ? `⚠ ${d.warnings.length}` : null].filter(Boolean).join(' · ')}</span>
        </div>
      ))}
      {docs.length > 8 && <div className="row muted">+{docs.length - 8} more</div>}
    </div>
  );
}

export const RunStrip = memo(function RunStrip() {
  const x = useStore((s) => s.extraction);
  const elapsed = useElapsed(x);
  const { counts } = useDerived();
  const summary = useMemo(() => {
    if (x.phase === 'idle') return '';
    if (x.phase === 'failed') return `Read failed: ${x.error ?? 'unknown error'}`;
    if (x.phase === 'cancelled') return 'Read cancelled.';
    if (x.phase === 'done') return `Read complete: ${x.progress.registered} facilities, ${x.progress.grounds} grounds areas, ${counts.needs} need review.`;
    return `Reading: ${STAGES[Math.max(0, ORDER[x.phase])]?.label ?? ''}. ${x.progress.registered} facilities found${x.progress.expected ? ` of about ${x.progress.expected}` : ''}.`;
  }, [x.phase, x.error, x.progress, counts.needs]);
  const said = useThrottledAnnouncement(summary);
  if (x.phase === 'idle') return null;
  return (
    <>
      {x.phase === 'failed' ? <Failed x={x} elapsed={elapsed} />
        : x.phase === 'cancelled' ? <Cancelled x={x} elapsed={elapsed} />
          : x.phase === 'done' ? <Done x={x} elapsed={elapsed} />
            : <Running x={x} elapsed={elapsed} />}
      <div className="sr-only" role="status" aria-live="polite">{said}</div>
    </>
  );
});

function Running({ x, elapsed }: { x: ExtractionState; elapsed: number }) {
  const openLog = useStore((s) => s.openLog);
  const cancel = useStore((s) => s.cancelExtraction);
  const cur = ORDER[x.phase];
  const pages = x.docs.reduce((s, d) => s + (d.pages ?? 0), 0);
  const scanned = x.docs.reduce((s, d) => s + (d.scannedPages?.length ?? 0), 0);
  const lastLine = useMemo(() => { for (let i = x.log.length - 1; i >= 0; i--) if (x.log[i].kind !== 'thinking') return x.log[i].text; return ''; }, [x.log]);
  const progressPct = x.progress.expected ? Math.min(100, (x.progress.registered / x.progress.expected) * 100) : null;
  const facLabel = `${x.progress.registered.toLocaleString()}${x.progress.expected ? ` / ~${x.progress.expected.toLocaleString()}` : ''}`;
  return (
    <div className={cx('runstrip', 'runstrip--running', x.staging.active && 'is-staged')} aria-label="Read in progress">
      <ol className="runstrip__steps" aria-label="Run progress">
        {STAGES.map((st, i) => (
          <li key={st.id} className={cx('runstrip__step', i < cur && 'is-done', i === cur && 'is-active')} aria-current={i === cur ? 'step' : undefined}>
            <span className="dot" aria-hidden>{i < cur ? <Check size={10} strokeWidth={3} /> : i === cur ? <LoaderCircle size={12} className="spin" /> : null}</span>
            <span className="label">{st.label}</span>
          </li>
        ))}
      </ol>
      <div className="runstrip__counters">
        {x.docs.length > 0 && (
          <Tooltip content={docsTip(x.docs)} placement="bottom-start">
            <span className="rs-c rs-docs" tabIndex={0}>Docs {x.docs.length}{pages ? ` · ${pages.toLocaleString()} pp` : ''}{scanned ? <span className="warn"> ({scanned} scanned)</span> : null}</span>
          </Tooltip>
        )}
        <span className="rs-c rs-fac" title={x.staging.active ? 'Read into a staging list; the current inventory stays until the read finishes' : undefined}>
          <span className="k">Facilities</span> <b>{facLabel}</b>{x.staging.active && <span className="rs-staged"> staged</span>}
        </span>
        <span className="rs-c rs-grounds"><span className="k">Grounds</span> <b>{x.progress.grounds.toLocaleString()}</b></span>
        {x.warnings.length > 0 && (
          <button type="button" className="rs-c runstrip__warn" onClick={() => openLog('warnings')} aria-label={`${x.warnings.length} warnings, open the log`} title="Open the log filtered to warnings">
            <TriangleAlert size={13} aria-hidden />{x.warnings.length}
          </button>
        )}
        <span className="rs-c rs-time mono" aria-label={`Elapsed ${duration(elapsed)}`}>{clockMs(elapsed)}</span>
      </div>
      <span className="runstrip__ticker mono" title={lastLine}>{lastLine}</span>
      <div className="runstrip__actions">
        <Button size="sm" variant="ghost" icon={ScrollText} className="rs-log" tooltip="Open the log" onClick={() => openLog()}>Log</Button>
        <Button size="sm" variant="secondary" onClick={cancel}>Cancel</Button>
      </div>
      <div className={cx('runstrip__bar', progressPct == null && 'is-indeterminate')} aria-hidden><span style={progressPct != null ? { width: `${progressPct}%` } : undefined} /></div>
    </div>
  );
}

function useRestore(x: ExtractionState) {
  const restore = useStore((s) => s.restorePrevious);
  return async () => {
    const n = x.snapshot ? x.snapshot.inventory.facilities.length + x.snapshot.inventory.grounds.length : 0;
    const choice = await useStore.getState().confirm({
      title: 'Restore the previous inventory?',
      body: `This puts back the ${n.toLocaleString()} rows the project had before this run and discards what the run read. Review marks are kept by id.`,
      actions: [{ id: 'cancel', label: 'Cancel' }, { id: 'restore', label: 'Restore previous', variant: 'primary' }],
    });
    if (choice === 'restore') await restore();
  };
}

function Done({ x, elapsed }: { x: ExtractionState; elapsed: number }) {
  const dismiss = useStore((s) => s.dismissRun);
  const { counts, estById, gestById } = useDerived();
  const askRestore = useRestore(x);
  const r = x.result;
  const delta = r && (x.startCount ?? 0) > 0 ? ` (+${r.added} new · ${r.changed} changed · ${r.removed} missing)` : '';
  const took = x.endedAt && x.startedAt ? x.endedAt - x.startedAt : elapsed;
  const full = `Read complete in ${duration(took)} · ${x.progress.registered.toLocaleString()} facilities · ${x.progress.grounds.toLocaleString()} grounds · ${counts.needs.toLocaleString()} need review · ${x.warnings.length} warning${x.warnings.length === 1 ? '' : 's'}${delta}`;
  // [Review N]: the Needs review chip sorted by Impact, and its first row selected (§5.5)
  const review = () => { startReview((id) => estById.get(id)?.fte ?? gestById.get(id)?.fte ?? 0, { needsChip: true }); };
  return (
    <div className="runstrip runstrip--done" aria-label="Read complete">
      <CircleCheck size={16} className="runstrip__icon" aria-hidden />
      <span className="runstrip__msg rs-long" title={full}>{full}</span>
      <span className="runstrip__msg rs-short" title={full}>Done in {duration(took)} · {x.progress.registered.toLocaleString()} facilities · {counts.needs.toLocaleString()} need review{x.warnings.length ? ` · ⚠ ${x.warnings.length}` : ''}{r && (x.startCount ?? 0) > 0 ? ` · +${r.added} new · ${r.changed} changed · ${r.removed} missing` : ''}</span>
      <div className="runstrip__actions">
        {counts.needs > 0 && <Button size="sm" variant="secondary" onClick={review}>Review {counts.needs.toLocaleString()}</Button>}
        {x.restorable && <Button size="sm" variant="ghost" onClick={() => void askRestore()}>Restore previous</Button>}
        <IconButton icon={X} size="sm" label="Dismiss" tooltip="Dismiss" onClick={dismiss} />
      </div>
    </div>
  );
}

function Failed({ x, elapsed }: { x: ExtractionState; elapsed: number }) {
  const dismiss = useStore((s) => s.dismissRun);
  const retry = useStore((s) => s.retryExtraction);
  const openLog = useStore((s) => s.openLog);
  const askRestore = useRestore(x);
  const took = x.endedAt && x.startedAt ? x.endedAt - x.startedAt : elapsed;
  return (
    <div className="runstrip runstrip--failed" role="alert" aria-label="Read failed">
      <CircleAlert size={16} className="runstrip__icon" aria-hidden />
      <span className="runstrip__msg" title={x.error}>Read failed after {duration(took)}: {x.error ?? 'unknown error'}{x.restorable ? ' · The inventory differs from before the run.' : ''}</span>
      <div className="runstrip__actions">
        <Button size="sm" variant="secondary" onClick={() => void retry()}>Retry</Button>
        <Button size="sm" variant="ghost" onClick={() => openLog('errors')}>Open log</Button>
        {x.restorable && <Button size="sm" variant="ghost" onClick={() => void askRestore()}>Restore previous</Button>}
        <IconButton icon={X} size="sm" label="Dismiss" tooltip="Dismiss" onClick={dismiss} />
      </div>
    </div>
  );
}

function Cancelled({ x, elapsed }: { x: ExtractionState; elapsed: number }) {
  const dismiss = useStore((s) => s.dismissRun);
  const askRestore = useRestore(x);
  const took = x.endedAt && x.startedAt ? x.endedAt - x.startedAt : elapsed;
  return (
    <div className="runstrip runstrip--cancelled" aria-label="Read cancelled">
      <CircleSlash size={16} className="runstrip__icon" aria-hidden />
      <span className="runstrip__msg">Cancelled after {duration(took)}. {x.restorable ? 'The inventory differs from before the run.' : 'Your inventory is unchanged.'}</span>
      <div className="runstrip__actions">
        {x.restorable && <Button size="sm" variant="ghost" onClick={() => void askRestore()}>Restore previous</Button>}
        <IconButton icon={X} size="sm" label="Dismiss" tooltip="Dismiss" onClick={dismiss} />
      </div>
    </div>
  );
}
