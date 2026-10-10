import Link from "next/link";

export type StartupPublicSummary = {
  user_id: string;
  company_name?: string | null;
  one_liner?: string | null;
  stage?: string | null;
  sector?: string | null;
  country?: string | null;
  pitch_deck_url?: string | null;
  angel_score?: number | null;
  community_score?: number | null;
  rating_count: number;
};

function initials(name: string): string {
  return (
    name
      .replace(/[^A-Za-z ]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "·"
  );
}

/**
 * Startup card for Browse Startups. `href` defaults to the public profile;
 * in-app directories pass their own route so the left nav stays in place.
 */
export function StartupPublicCard({ startup, href }: { startup: StartupPublicSummary; href?: string }) {
  const name = startup.company_name || "Unnamed company";
  const chips = [startup.sector, startup.stage, startup.country].filter(Boolean) as string[];
  return (
    <Link
      href={href ?? `/startups/${startup.user_id}`}
      className="flex flex-col gap-3.5 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-[var(--card-shadow)] transition-colors hover:border-metatron-accent/40"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--overlay-6)] text-sm font-semibold text-[var(--text-muted)]"
        >
          {initials(name)}
        </span>
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-[var(--text)]">{name}</h3>
          <p className="line-clamp-2 text-sm leading-snug text-[var(--text-muted)]">
            {startup.one_liner || "No one-liner yet."}
          </p>
        </div>
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span key={c} className="rounded-full bg-[var(--overlay-6)] px-2.5 py-1 text-xs text-[var(--text-muted)]">
              {c}
            </span>
          ))}
        </div>
      )}
      <div className="mt-auto grid grid-cols-2 gap-2">
        <div className="rounded-[10px] bg-metatron-accent/10 px-3 py-2.5">
          <p className="text-[11px] text-[var(--text-muted)]">Angel Score</p>
          <p className="text-lg font-semibold text-metatron-accent">
            {startup.angel_score != null ? startup.angel_score : "—"}
          </p>
        </div>
        <div className="rounded-[10px] bg-[rgba(220,160,40,0.10)] px-3 py-2.5">
          <p className="text-[11px] text-[var(--text-muted)]">Community</p>
          <p className="text-lg font-semibold text-[var(--star)]">
            {startup.community_score != null ? `★ ${startup.community_score.toFixed(1)}` : "—"}
            {startup.community_score != null && (
              <span className="ml-1 text-xs font-normal text-[var(--text-muted)]">({startup.rating_count})</span>
            )}
          </p>
        </div>
      </div>
    </Link>
  );
}
