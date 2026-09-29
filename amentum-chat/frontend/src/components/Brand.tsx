import { useId } from "react";

/** Placeholder brand mark. To use the official Amentum logo, drop the approved SVG into
 *  public/brand/ and swap this component's contents for an <img src="/brand/logo.svg" />. */
export function BrandMark({ size = 32, animated = false }: { size?: number; animated?: boolean }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={animated ? "brand-mark animated" : "brand-mark"} aria-hidden>
      <defs>
        <linearGradient id={`bm-${id}`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#4a67e6" />
          <stop offset=".55" stopColor="#2a8fd0" />
          <stop offset="1" stopColor="#12c476" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="17" className="brand-mark-bg" />
      <path d="M15 47 L32 15 L49 47" fill="none" stroke={`url(#bm-${id})`} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M23.5 37.5 H40.5" stroke="#12c476" strokeWidth="6" strokeLinecap="round" className="brand-mark-bar" />
    </svg>
  );
}

export function Wordmark({ name }: { name: string }) {
  const [first, ...rest] = name.split(" ");
  return (
    <span className="wordmark">
      <span className="wordmark-main">{first.toUpperCase()}</span>
      {rest.length > 0 && <span className="wordmark-sub">{rest.join(" ")}</span>}
    </span>
  );
}
