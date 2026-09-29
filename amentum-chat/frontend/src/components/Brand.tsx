import { MARK_H, MARK_PATH, WORD_H, WORD_PATH } from "../lib/mark";

/** The Amentum four-arch mark, in brand green. `width` sets the size; height follows the artwork. */
export function BrandMark({ width = 26, className }: { width?: number; className?: string }) {
  return (
    <svg width={width} height={(width * MARK_H) / 100} viewBox={`0 0 100 ${MARK_H}`}
      className={className ?? "brand-mark"} aria-hidden>
      <path d={MARK_PATH} fillRule="evenodd" />
    </svg>
  );
}

/** Logotype plus the product suffix (e.g. "AI"). Falls back to text for a non-Amentum app name. */
export function Wordmark({ name }: { name: string }) {
  const [first, ...rest] = name.split(" ");
  const isAmentum = first.toLowerCase() === "amentum";
  return (
    <span className="wordmark">
      {isAmentum ? (
        <svg className="wordmark-main" height={14} width={(14 * 100) / WORD_H} viewBox={`0 0 100 ${WORD_H}`}
          role="img" aria-label="Amentum">
          <path d={WORD_PATH} fillRule="evenodd" />
        </svg>
      ) : (
        <span className="wordmark-text">{first}</span>
      )}
      {rest.length > 0 && <span className="wordmark-sub">{rest.join(" ")}</span>}
    </span>
  );
}
