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

export function StartupPublicCard({ startup }: { startup: StartupPublicSummary }) {
  return (
    <Link
      href={`/startups/${startup.user_id}`}
      className="flex flex-col gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-4 transition-colors hover:border-metatron-accent/30"
    >
      <div>
        <h3 className="text-sm font-semibold text-[var(--text)]">
          {startup.company_name || "Unnamed company"}
        </h3>
        <p className="mt-1 font-sans text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
          {(startup.stage || "—") +
            " · " +
            (startup.sector || "—") +
            (startup.country ? ` · ${startup.country}` : "")}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-[var(--text-muted)]">
          {startup.one_liner || "No one-liner yet."}
        </p>
      </div>
      <div className="mt-auto flex items-center gap-4 pt-1">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Angel Score</p>
          <p className="text-sm font-semibold text-[var(--text)]">
            {startup.angel_score != null ? startup.angel_score : "—"}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Community</p>
          <p className="text-sm font-semibold text-[var(--text)]">
            {startup.community_score != null
              ? `${startup.community_score.toFixed(1)} ★ (${startup.rating_count})`
              : "No ratings yet"}
          </p>
        </div>
      </div>
    </Link>
  );
}
