/** A company's logo, or its initials when there's no logo yet. */
export function LogoTile({ name, url, size = 44, accent = false }: { name: string; url?: string | null; size?: number; accent?: boolean }) {
  const radius = Math.round(size * 0.27);
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size, borderRadius: radius }}
        className="shrink-0 border border-[var(--border)] bg-white object-contain p-1"
      />
    );
  }
  const initials =
    name
      .replace(/[^A-Za-z ]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "·";
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, borderRadius: radius, fontSize: Math.round(size * 0.32) }}
      className={`flex shrink-0 items-center justify-center font-semibold ${accent ? "bg-metatron-accent text-white" : "bg-metatron-accent/15 text-[var(--accent-fg)]"}`}
    >
      {initials}
    </span>
  );
}
