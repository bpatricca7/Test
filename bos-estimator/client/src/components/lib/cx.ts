/** Join class names, skipping falsy parts. */
export function cx(...parts: (string | false | null | undefined | 0)[]): string {
  let s = '';
  for (const p of parts) if (p) s = s ? `${s} ${p}` : p;
  return s;
}
