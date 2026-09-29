/** Placeholder mark: four rising bars, a nod to the "Amplified" rising-lines identity.
 *  To use the official Amentum logo, drop the approved SVG into public/brand/ and replace
 *  this component's contents with <img src="/brand/logo.svg" alt="Amentum" />. */
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="brand-mark" aria-hidden>
      <path d="M2.5 21 L6.5 21 L8.5 14 L4.5 14 Z" />
      <path d="M7.5 21 L11.5 21 L14 11 L10 11 Z" />
      <path d="M12.5 21 L16.5 21 L19.5 7 L15.5 7 Z" />
      <path d="M17.5 21 L21.5 21 L24 3 L20 3 Z" transform="translate(-1.5 0)" />
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
