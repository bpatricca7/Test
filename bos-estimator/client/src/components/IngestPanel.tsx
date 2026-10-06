import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import { AI_MODEL_PRESETS } from '@shared/types';

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

export function IngestPanel() {
  const project = useStore((s) => s.project);
  const health = useStore((s) => s.health);
  const extraction = useStore((s) => s.extraction);
  const start = useStore((s) => s.startExtraction);
  const cancel = useStore((s) => s.cancelExtraction);
  const setAi = useStore((s) => s.setAi);
  const [files, setFiles] = useState<File[]>([]);
  const [drag, setDrag] = useState(false);
  const [provider, setProvider] = useState<'auto' | 'claude' | 'heuristic'>('auto');
  const [ingest, setIngest] = useState<'auto' | 'native_pdf' | 'text'>('auto');
  const [mode, setMode] = useState<'replace' | 'append'>('replace');
  const [custom, setCustom] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [extraction.log.length]);
  useEffect(() => { if (project && !AI_MODEL_PRESETS.some((p) => p.id === project.ai.model)) setCustom(true); }, [project?.ai.model]);

  const addFiles = (list: FileList | null) => { if (!list) return; const next = [...files]; for (const f of Array.from(list)) if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f); setFiles(next); };
  const run = async (sampleText?: string) => {
    if (!project) return;
    await start({ files: sampleText ? [] : files, text: sampleText, textName: sampleText ? 'sample-rfp-pws.txt (built-in sample)' : undefined, provider, ingest, mode });
  };
  const loadSample = async () => { const text = await api.sample(); await run(text); };
  const model = project?.ai.model ?? 'claude-opus-5-5';
  const effort = project?.ai.effort ?? 'xhigh';
  const canRun = !extraction.running && (files.length > 0);

  return (
    <div className="panel-section">
      <h3>1 · RFP documents <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>PDF · DOCX · TXT · CSV</span></h3>
      <div className={`dropzone ${drag ? 'active' : ''}`} onClick={() => fileInput.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}>
        <strong>Drop the solicitation here</strong><br />PWS, technical exhibits, workload tables, facility lists, drawings
        <input ref={fileInput} type="file" multiple hidden accept=".pdf,.docx,.txt,.md,.csv,.tsv,.json" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
      </div>
      {files.length > 0 && (
        <ul className="filelist">
          {files.map((f) => (
            <li key={f.name + f.size}><span className="name" title={f.name}>{f.name}</span><span className="meta">{(f.size / 1024).toFixed(0)} KB</span><button className="btn sm ghost" onClick={() => setFiles(files.filter((x) => x !== f))}>×</button></li>
          ))}
        </ul>
      )}

      <div className="field-row" style={{ marginTop: 10 }}>
        <div className="field">
          <label>AI model</label>
          <select value={custom ? '__custom' : model} onChange={(e) => { if (e.target.value === '__custom') { setCustom(true); } else { setCustom(false); setAi({ model: e.target.value }); } }}>
            {AI_MODEL_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            <option value="__custom">Custom model id…</option>
          </select>
        </div>
        <div className="field">
          <label>Effort</label>
          <select value={effort} onChange={(e) => setAi({ effort: e.target.value as typeof EFFORTS[number] })}>
            {EFFORTS.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>
      </div>
      {custom && <div className="field"><label>Model id (e.g. a newer Sonnet or Opus release)</label><input value={model} onChange={(e) => setAi({ model: e.target.value })} placeholder="claude-…" /></div>}
      <div className="field-row three">
        <div className="field"><label>Reader</label>
          <select value={provider} onChange={(e) => setProvider(e.target.value as typeof provider)}>
            <option value="auto">Auto (AI if key set)</option>
            <option value="claude">Claude only</option>
            <option value="heuristic">Rule-based parser</option>
          </select>
        </div>
        <div className="field"><label>PDF ingest</label>
          <select value={ingest} onChange={(e) => setIngest(e.target.value as typeof ingest)}>
            <option value="auto">Auto</option>
            <option value="native_pdf">Native (tables/drawings)</option>
            <option value="text">Text layer only</option>
          </select>
        </div>
        <div className="field"><label>Inventory</label>
          <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="replace">Replace</option>
            <option value="append">Append</option>
          </select>
        </div>
      </div>
      <div className="btn-row">
        {!extraction.running ? (
          <>
            <button className="btn primary" disabled={!canRun} onClick={() => void run()}>Analyze RFP with {custom ? 'custom model' : AI_MODEL_PRESETS.find((p) => p.id === model)?.label ?? model}</button>
            <button className="btn" onClick={() => void loadSample()} title="Runs the built-in Fort Example PWS excerpt through the selected reader">Try sample RFP</button>
          </>
        ) : (
          <button className="btn danger" onClick={cancel}>Cancel</button>
        )}
      </div>
      {!health?.aiAvailable && <div className="note" style={{ marginTop: 8 }}><b>No API key on the server.</b> Add <code>ANTHROPIC_API_KEY</code> to <code>.env</code> and restart to let Claude read the documents. Until then the rule-based parser handles well-structured workload tables.</div>}
      {extraction.running && <div className="progress"><div /></div>}
      {extraction.log.length > 0 && (
        <div className="ailog" ref={logRef} style={{ marginTop: 8 }}>
          {extraction.log.map((l, i) => <div key={i} className={l.kind}>{l.kind === 'thinking' ? '· ' : ''}{l.text}</div>)}
        </div>
      )}
      {project?.extraction && !extraction.running && (
        <div className="note" style={{ marginTop: 8 }}>
          Last read: {project.extraction.provider === 'claude' ? project.extraction.model : 'rule-based parser'} · {(project.extraction.durationMs / 1000).toFixed(1)}s{project.extraction.usage ? ` · ${project.extraction.usage.input.toLocaleString()} in / ${project.extraction.usage.output.toLocaleString()} out tokens` : ''} · {project.documents.map((d) => d.name).join(', ')}
        </div>
      )}
    </div>
  );
}
