// File types the server can read (a .zip package is expanded on the server). Shared by the Documents tab,
// the empty-state card and the drop overlay, which all add to store.pendingFiles.

export const ACCEPT = ['.pdf', '.docx', '.xlsx', '.xlsm', '.csv', '.tsv', '.txt', '.md', '.zip'];
export const ACCEPT_LABELS = ['PDF', 'DOCX', 'XLSX', 'CSV', 'TSV', 'TXT', 'MD', 'ZIP'];
export const isAccepted = (f: { name: string }) => ACCEPT.some((ext) => f.name.toLowerCase().endsWith(ext));
export const skipReason = (name: string) => (/\.(doc|xls|ppt|pptx|rtf|wpd)$/i.test(name) ? 'save as .docx / .xlsx / .pdf' : /\.(dwg|dxf|dgn|rvt)$/i.test(name) ? 'CAD drawing, print to PDF' : name ? 'unsupported type' : 'folder (drop the files or a .zip)');
export const fileExt = (name: string) => (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();
export const fmtBytes = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
