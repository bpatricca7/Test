// Turns uploaded RFP files (PDF / DOCX / TXT / CSV / MD) into inputs the extractor can read.
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';

export interface DocInput {
  name: string;
  mode: 'native_pdf' | 'text';
  text: string; // always populated (used by heuristic parser and as fallback)
  pdfBase64?: string; // populated when mode === 'native_pdf'
  pages?: number;
  chars: number;
  bytes: number;
}

export type IngestMode = 'auto' | 'native_pdf' | 'text';

const NATIVE_PDF_MAX_PAGES = 100;
const NATIVE_PDF_MAX_BYTES = 28 * 1024 * 1024;

export async function readDocument(name: string, buf: Buffer, ingest: IngestMode = 'auto'): Promise<DocInput> {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) {
    let text = '';
    let pages: number | undefined;
    try {
      const parsed = await pdfParse(buf);
      text = cleanText(parsed.text);
      pages = parsed.numpages;
    } catch (err) {
      text = '';
    }
    const native = ingest === 'native_pdf' || (ingest === 'auto' && (pages ?? 0) <= NATIVE_PDF_MAX_PAGES && buf.length <= NATIVE_PDF_MAX_BYTES);
    // Scanned PDFs have no text layer: native mode is the only way to read them.
    const scanned = text.replace(/\s+/g, '').length < 200 * Math.max(1, pages ?? 1) * 0.05;
    const useNative = (native || scanned) && buf.length <= NATIVE_PDF_MAX_BYTES && ingest !== 'text';
    return { name, mode: useNative ? 'native_pdf' : 'text', text, pdfBase64: useNative ? buf.toString('base64') : undefined, pages, chars: text.length, bytes: buf.length };
  }
  if (lower.endsWith('.docx')) {
    const { value } = await mammoth.extractRawText({ buffer: buf });
    const text = cleanText(value);
    return { name, mode: 'text', text, chars: text.length, bytes: buf.length };
  }
  // txt, md, csv, tsv, json, html → plain text
  const text = cleanText(buf.toString('utf8'));
  return { name, mode: 'text', text, chars: text.length, bytes: buf.length };
}

export function cleanText(t: string): string {
  return t.replace(/\r\n?/g, '\n').replace(/[ \t\f\v]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
}
