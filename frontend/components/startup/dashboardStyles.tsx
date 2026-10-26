// Shared classes for the founder dashboard cards.
export const card =
  "flex flex-col gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-[var(--card-shadow)] min-w-0";
export const eyebrow = "font-mono text-[11px] uppercase tracking-[0.14em]";
export const btn =
  "inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--overlay-12)] px-5 text-sm font-medium text-[var(--text)] hover:bg-[var(--overlay-4)] disabled:opacity-50";
export const btnSm =
  "inline-flex min-h-9 items-center justify-center rounded-lg border border-[var(--overlay-12)] px-3 text-xs font-medium text-[var(--text)] hover:bg-[var(--overlay-4)] disabled:opacity-50";
export const btnPrimary =
  "inline-flex min-h-11 items-center justify-center rounded-xl bg-metatron-accent px-5 text-sm font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-50";

export function ago(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}

/** A labelled 0–max bar, used by the Angel Score and Community score cards. */
export function ScoreBar({
  label,
  value,
  max,
  tone = "accent",
  digits = 0,
}: {
  label: string;
  value: number | null;
  max: number;
  tone?: "accent" | "warn" | "star";
  digits?: number;
}) {
  const pct = value != null ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const fill = tone === "warn" ? "bg-[var(--warn)]" : tone === "star" ? "bg-[var(--star)]" : "bg-metatron-accent";
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-16 shrink-0 font-mono text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--overlay-8)]">
        <div className={`h-1.5 rounded-full ${fill}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="mono-num w-9 text-right text-xs text-[var(--text)]">{value == null ? "—" : value.toFixed(digits)}</span>
    </div>
  );
}

/** Pre-filled email asking someone to review the startup's public page. */
export function reviewRequestMailto(link: string, company: string | null): string {
  const subject = `Would you review ${company || "my startup"} on metatron?`;
  const body = `Hi,\n\nI'd really value your honest take on ${company || "my startup"}. It takes two minutes: rate our team, market, traction and product here:\n\n${link}\n\nThank you!`;
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
