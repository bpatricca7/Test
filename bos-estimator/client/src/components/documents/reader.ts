// Shared by the Documents tab, the empty-state card and the run strip: the reader line, file-type icons and the
// Analyze wrapper that also caches the uploaded files in this browser (docsCache, P1).
import { FileArchive, FileSpreadsheet, FileText, FileType } from 'lucide-react';
import { AI_MODEL_PRESETS, type DocumentInfo } from '@shared/types';
import { useStore } from '../../store';
import { fileExt } from '../lib/files';
import { cacheFiles } from '../lib/docsCache';
import type { IconType } from '../ui';

/** "with Claude Opus 5.5 · high" / "with the rule-based reader" */
export function readerLine(): string {
  const s = useStore.getState();
  const ai = s.project?.ai; const aiOk = Boolean(s.health?.aiAvailable);
  if (s.reader.provider === 'heuristic' || (s.reader.provider === 'auto' && !aiOk)) return 'with the rule-based reader';
  const label = AI_MODEL_PRESETS.find((p) => p.id === ai?.model)?.label ?? ai?.model ?? 'Claude';
  return `with ${label} · ${ai?.effort ?? 'high'}`;
}

/** True when the read will use the rule-based parser (no key on the server, or the user chose it). */
export function usesRuleBased(): boolean {
  const s = useStore.getState();
  return s.reader.provider === 'heuristic' || (s.reader.provider === 'auto' && !s.health?.aiAvailable);
}

const ICONS: Record<string, IconType> = { pdf: FileText, docx: FileType, xlsx: FileSpreadsheet, xlsm: FileSpreadsheet, csv: FileSpreadsheet, tsv: FileSpreadsheet, zip: FileArchive, txt: FileText, md: FileText, text: FileText };
export function fileIcon(nameOrKind: string): IconType { return ICONS[nameOrKind] ?? ICONS[fileExt(nameOrKind)] ?? FileText; }

export function roleLabel(d: Pick<DocumentInfo, 'role' | 'amendment'>): string | null {
  switch (d.role) {
    case 'pws': return 'PWS';
    case 'solicitation': return 'Solicitation';
    case 'attachment': return 'Attachment';
    case 'qa': return 'Q&A';
    case 'amendment': return d.amendment != null ? `Amendment ${String(d.amendment).padStart(4, '0')}` : 'Amendment';
    default: return null;
  }
}

/** Analyze the pending files (or the sample). Caches the uploaded files first so the source stays viewable here. */
export function analyzeNow(opts: { sample?: boolean } = {}) {
  const s = useStore.getState();
  if (!opts.sample && s.pendingFiles.length) void cacheFiles(s.projectId, s.pendingFiles);
  return s.analyze(opts);
}
