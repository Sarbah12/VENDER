/**
 * A placeholder mark, deliberately abstract.
 *
 * The idea document is explicit that the name is unchosen, and a logo built
 * around a letterform would have to be thrown away with it. Three bars locking
 * into one column reads as "separate operations, one system" — which is the
 * positioning statement — and survives any name.
 */
export function Brandmark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      role="presentation"
    >
      <rect width="32" height="32" rx="8" fill="var(--brand)" />
      <rect x="8" y="8" width="5" height="16" rx="2.5" fill="white" fillOpacity="0.55" />
      <rect x="13.5" y="12" width="5" height="12" rx="2.5" fill="white" fillOpacity="0.78" />
      <rect x="19" y="15" width="5" height="9" rx="2.5" fill="white" />
    </svg>
  );
}

export function Wordmark({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <Brandmark size={size} />
      <span className="text-[1.0625rem] font-bold tracking-tight text-ink">{name}</span>
    </span>
  );
}
