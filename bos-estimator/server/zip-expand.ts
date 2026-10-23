// Expand a solicitation package (.zip from SAM.gov "Download all", nested zips, __MACOSX junk) into individual
// files, safely. Pure JS (fflate).
//
// Zip-bomb safety: every entry is inflated into a buffer of its DECLARED uncompressed size, which is never grown,
// so checking the declared size bounds memory: a lying header can only truncate its own entry, not blow up.
// A 4 GB declaration, however, would be allocated as-is - hence the per-entry and total caps below, applied before
// anything is inflated, and the check that the compressed data is not larger than the declared output (a forged
// header).
//
// Entries are inflated one at a time, so one corrupt or password-protected entry is reported and skipped instead of
// losing the whole package.
import { inflateSync, unzipSync, type UnzipFileInfo } from 'fflate';

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
const u8 = (b: Uint8Array) => (b instanceof Buffer ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : b);

// ---------- central directory ----------
/** One central-directory record. `dataOffset` is where the entry's compressed bytes start (from its local header). */
export interface ZipEntry {
  index: number; name: string; flags: number; method: number; size: number; originalSize: number;
  localOffset: number; dataOffset: number;
  /** general-purpose flag bit 0: the entry is encrypted (password-protected) */
  encrypted: boolean;
}

const utf8 = (b: Uint8Array): string | null => { try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return null; } };
/** Entry names: UTF-8 when flagged; otherwise UTF-8 if the bytes are valid UTF-8 (Linux / macOS zips rarely set the
 *  flag), else Latin-1. */
function decodeName(b: Uint8Array, flagged: boolean): string {
  if (flagged || b.some((c) => c > 0x7f)) { const u = utf8(b); if (u != null) return u; }
  return Array.from(b, (c) => String.fromCharCode(c)).join('');
}

/** Read the central directory (ZIP64 aware). Throws on an archive whose directory cannot be found or parsed. */
export function zipEntries(data: Uint8Array): ZipEntry[] {
  const d = u8(data);
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const b2 = (o: number) => dv.getUint16(o, true), b4 = (o: number) => dv.getUint32(o, true);
  const b8 = (o: number) => b4(o) + b4(o + 4) * 2 ** 32;
  let e = d.length - 22;
  if (e < 0) throw new Error('not a zip archive (too short)');
  for (; b4(e) !== 0x06054b50; --e) if (!e || d.length - e > 65558) throw new Error('no zip end-of-central-directory record');
  let count = b2(e + 10), off = b4(e + 16);
  if (e >= 20 && b4(e - 20) === 0x07064b50) { // ZIP64 locator -> ZIP64 end of central directory
    const ze = b8(e - 12);
    if (ze + 56 <= d.length && b4(ze) === 0x06064b50) { count = b8(ze + 32); off = b8(ze + 48); }
  }
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (off + 46 > d.length || b4(off) !== 0x02014b50) throw new Error('corrupt zip central directory');
    const flags = b2(off + 8), method = b2(off + 10);
    let size = b4(off + 20), originalSize = b4(off + 24), localOffset = b4(off + 42);
    const nl = b2(off + 28), xl = b2(off + 30), cl = b2(off + 32);
    const nameBytes = d.subarray(off + 46, off + 46 + nl);
    let name = decodeName(nameBytes, (flags & 0x800) !== 0);
    // extra fields: ZIP64 sizes (0x0001), Info-ZIP Unicode path (0x7075, what `zip` writes for UTF-8 names)
    for (let x = off + 46 + nl, end = x + xl; x + 4 <= end && x + 4 <= d.length;) {
      const id = b2(x), len = b2(x + 2); let p = x + 4;
      if (id === 0x0001) {
        if (originalSize === 0xffffffff && p + 8 <= x + 4 + len) { originalSize = b8(p); p += 8; }
        if (size === 0xffffffff && p + 8 <= x + 4 + len) { size = b8(p); p += 8; }
        if (localOffset === 0xffffffff && p + 8 <= x + 4 + len) { localOffset = b8(p); p += 8; }
      } else if (id === 0x7075 && len > 5 && d[p] === 1 && x + 4 + len <= d.length) {
        const u = utf8(d.subarray(p + 5, x + 4 + len));
        if (u) name = u;
      }
      x += 4 + len;
    }
    let dataOffset = -1;
    if (localOffset + 30 <= d.length && b4(localOffset) === 0x04034b50) dataOffset = localOffset + 30 + b2(localOffset + 26) + b2(localOffset + 28);
    out.push({ index: i, name, flags, method, size, originalSize, localOffset, dataOffset, encrypted: (flags & 1) === 1 });
    off += 46 + nl + xl + cl;
  }
  return out;
}

/** The names fflate sees (its own name decoding), in central-directory order; [] when the archive is unreadable. */
export function zipNames(data: Uint8Array): string[] {
  const names: string[] = [];
  try { unzipSync(u8(data), { filter: (f: UnzipFileInfo) => { names.push(f.name); return false; } }); } catch { return []; }
  return names;
}

/** Inflate one entry on its own. Throws for an encrypted, truncated or corrupt entry. */
export function inflateEntry(data: Uint8Array, e: ZipEntry): Uint8Array {
  const d = u8(data);
  if (e.encrypted) throw new Error('password-protected (encrypted) entry');
  if (e.dataOffset < 0 || e.dataOffset + e.size > d.length) throw new Error('entry data is missing (truncated archive?)');
  const raw = d.subarray(e.dataOffset, e.dataOffset + e.size);
  if (e.method === 0) return raw.slice();
  if (e.method !== 8) throw new Error(`unsupported compression method ${e.method}`);
  const out = inflateSync(raw, { out: new Uint8Array(e.originalSize) });
  if (out.length !== e.originalSize) throw new Error(`entry inflated to ${out.length} of its declared ${e.originalSize} bytes (corrupt?)`);
  return out;
}

function skipReason(name: string): string {
  if (LEGACY.test(name)) return 'legacy or unsupported Office format - save it as .docx / .xlsx / .pdf and upload it separately';
  if (DRAWING.test(name)) return 'CAD drawing - no workload text to read; print the sheets you need to PDF';
  return 'unsupported file type';
}

/** Expand `buf` (a zip archive called `name`) into readable files plus the entries that were skipped and why. */
export function expandZip(buf: Buffer, name = 'package.zip', limits: Partial<ZipLimits> = {}, depth = 0, total = { bytes: 0, entries: 0 }): ZipResult {
  const opt: ZipLimits = { ...ZIP_LIMITS, ...limits };
  const files: ZipFile[] = []; const skipped: ZipSkip[] = [];
  let entries: ZipEntry[];
  try { entries = zipEntries(buf); }
  catch (err) { return { files, skipped: [{ name, reason: `unreadable zip (${(err as Error).message}; encrypted or corrupt?)` }] }; }
  for (const f of entries) {
    const full = `${name}/${f.name}`;
    if (JUNK(f.name)) continue;
    if (!ZIP_SUPPORTED.test(f.name)) { skipped.push({ name: full, reason: skipReason(f.name) }); continue; }
    if (++total.entries > opt.maxEntries) { skipped.push({ name: full, reason: `more than ${opt.maxEntries} files in the package` }); continue; }
    if (f.encrypted) { skipped.push({ name: full, reason: 'password-protected (encrypted) entry - extract it with the password and upload the file itself' }); continue; }
    if (f.originalSize > opt.maxEntryBytes) { skipped.push({ name: full, reason: `declared ${mb(f.originalSize)} is over the ${mb(opt.maxEntryBytes)} per-file cap` }); continue; }
    if (f.method === 8 && f.size > 0 && f.originalSize / f.size > 1000 && f.originalSize > 20 * 2 ** 20) { skipped.push({ name: full, reason: `compression ratio ${Math.round(f.originalSize / f.size)}:1 (zip bomb?)` }); continue; }
    if (f.method === 8 && f.size > f.originalSize * 1.1 + 1024) { skipped.push({ name: full, reason: 'declared size is smaller than its compressed data (corrupt or forged header)' }); continue; }
    if (f.method !== 0 && f.method !== 8) { skipped.push({ name: full, reason: `unsupported compression method ${f.method}` }); continue; }
    if (total.bytes + f.originalSize > opt.maxTotalBytes) { skipped.push({ name: full, reason: `package exceeds the ${mb(opt.maxTotalBytes)} total size cap` }); continue; }
    let data: Uint8Array;
    try { data = inflateEntry(buf, f); }
    catch (err) { skipped.push({ name: full, reason: `could not be extracted (${(err as Error).message}); corrupt entry?` }); continue; }
    total.bytes += f.originalSize;
    if (/\.zip$/i.test(f.name)) {
      if (depth + 1 > opt.maxDepth) { skipped.push({ name: full, reason: 'zip nested too deep' }); continue; }
      const inner = expandZip(toBuffer(data), full.replace(/\.zip$/i, ''), opt, depth + 1, total);
      files.push(...inner.files); skipped.push(...inner.skipped); continue;
    }
    files.push({ name: full, buffer: toBuffer(data) });
  }
  files.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  return { files, skipped };
}
