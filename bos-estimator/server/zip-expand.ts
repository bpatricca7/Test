// Expand a solicitation package (.zip from SAM.gov "Download all", nested zips, __MACOSX junk) into individual
// files, safely. Pure JS (fflate).
//
// Zip-bomb safety: fflate's unzipSync allocates the output buffer from the DECLARED uncompressed size in the
// central directory and never grows it, so checking originalSize in `filter` bounds memory: a lying header can only
// truncate its own entry, not blow up. A 4 GB declaration, however, would be allocated as-is - hence the per-entry
// and total caps below, applied before anything is inflated, and the check that the compressed data is not larger
// than the declared output (a forged header).
import { unzipSync, type UnzipFileInfo } from 'fflate';

export const ZIP_SUPPORTED = /\.(pdf|docx|xlsx|xlsm|csv|tsv|txt|md|json|zip)$/i;
const LEGACY = /\.(doc|xls|ppt|pptx|rtf|wpd)$/i; // need conversion - report, don't drop silently
const DRAWING = /\.(dwg|dxf|dgn|rvt|ifc)$/i;
const JUNK = (n: string) => /(^|\/)__MACOSX\//.test(n) || /(^|\/)\.[^/]*$/.test(n) || /(^|\/)(Thumbs\.db|desktop\.ini)$/i.test(n) || n.endsWith('/');

export interface ZipLimits { maxEntries: number; maxEntryBytes: number; maxTotalBytes: number; maxDepth: number }
export const ZIP_LIMITS: ZipLimits = { maxEntries: 400, maxEntryBytes: 120 * 2 ** 20, maxTotalBytes: 600 * 2 ** 20, maxDepth: 2 };
export interface ZipFile { name: string; buffer: Buffer }
export interface ZipSkip { name: string; reason: string }
export interface ZipResult { files: ZipFile[]; skipped: ZipSkip[] }

const mb = (n: number) => `${(n / 2 ** 20).toFixed(0)} MB`;
const toBuffer = (u: Uint8Array) => Buffer.from(u.buffer, u.byteOffset, u.byteLength);

function skipReason(name: string): string {
  if (LEGACY.test(name)) return 'legacy or unsupported Office format - save it as .docx / .xlsx / .pdf and upload it separately';
  if (DRAWING.test(name)) return 'CAD drawing - no workload text to read; print the sheets you need to PDF';
  return 'unsupported file type';
}

/** Expand `buf` (a zip archive called `name`) into readable files plus the entries that were skipped and why. */
export function expandZip(buf: Buffer, name = 'package.zip', limits: Partial<ZipLimits> = {}, depth = 0, total = { bytes: 0, entries: 0 }): ZipResult {
  const opt: ZipLimits = { ...ZIP_LIMITS, ...limits };
  const files: ZipFile[] = []; const skipped: ZipSkip[] = [];
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), {
      filter: (f: UnzipFileInfo) => {
        const full = `${name}/${f.name}`;
        if (JUNK(f.name)) return false;
        if (!ZIP_SUPPORTED.test(f.name)) { skipped.push({ name: full, reason: skipReason(f.name) }); return false; }
        if (++total.entries > opt.maxEntries) { skipped.push({ name: full, reason: `more than ${opt.maxEntries} files in the package` }); return false; }
        if (f.originalSize > opt.maxEntryBytes) { skipped.push({ name: full, reason: `declared ${mb(f.originalSize)} is over the ${mb(opt.maxEntryBytes)} per-file cap` }); return false; }
        if (f.compression === 8 && f.size > 0 && f.originalSize / f.size > 1000 && f.originalSize > 20 * 2 ** 20) { skipped.push({ name: full, reason: `compression ratio ${Math.round(f.originalSize / f.size)}:1 (zip bomb?)` }); return false; }
        if (f.compression === 8 && f.size > f.originalSize * 1.1 + 1024) { skipped.push({ name: full, reason: 'declared size is smaller than its compressed data (corrupt or forged header)' }); return false; }
        if (f.compression !== 0 && f.compression !== 8) { skipped.push({ name: full, reason: `unsupported compression method ${f.compression}` }); return false; }
        if (total.bytes + f.originalSize > opt.maxTotalBytes) { skipped.push({ name: full, reason: `package exceeds the ${mb(opt.maxTotalBytes)} total size cap` }); return false; }
        total.bytes += f.originalSize;
        return true;
      },
    });
  } catch (err) {
    return { files, skipped: [...skipped, { name, reason: `unreadable zip (${(err as Error).message}; encrypted or corrupt?)` }] };
  }
  for (const [entry, data] of Object.entries(raw)) {
    const full = `${name}/${entry}`;
    if (/\.zip$/i.test(entry)) {
      if (depth + 1 > opt.maxDepth) { skipped.push({ name: full, reason: 'zip nested too deep' }); continue; }
      const inner = expandZip(toBuffer(data), full.replace(/\.zip$/i, ''), opt, depth + 1, total);
      files.push(...inner.files); skipped.push(...inner.skipped); continue;
    }
    files.push({ name: full, buffer: toBuffer(data) });
  }
  files.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  return { files, skipped };
}
