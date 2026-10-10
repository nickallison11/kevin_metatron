import Link from "next/link";
import { notFound } from "next/navigation";
import { API_BASE } from "@/lib/api";
import { RatingForm } from "@/components/RatingForm";
import { TrackedDeckLink } from "@/components/TrackedDeckLink";

type AngelScore = {
  score: number;
  team_score: number | null;
  market_score: number | null;
  traction_score: number | null;
  pitch_score: number | null;
  reasoning: string | null;
};

type CommunityScoreSummary = {
  rating_count: number;
  community_score: number | null;
  avg_team_score: number | null;
  avg_market_score: number | null;
  avg_traction_score: number | null;
  avg_product_score: number | null;
};

type ReviewRow = {
  id: string;
  tier: string;
  overall_stars: number;
  team_score: number | null;
  market_score: number | null;
  traction_score: number | null;
  product_score: number | null;
  comment: string | null;
  created_at: string;
};

export type StartupDetail = {
  profile: {
    user_id: string;
    company_name: string | null;
    one_liner: string | null;
    stage: string | null;
    sector: string | null;
    country: string | null;
    website: string | null;
    pitch_deck_url: string | null;
  };
  angel_score: AngelScore | null;
  community_score: CommunityScoreSummary | null;
  reviews: ReviewRow[];
};

export async function fetchStartupDetail(id: string): Promise<StartupDetail | null> {
  try {
    const res = await fetch(`${API_BASE}/ratings/startups/${id}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return (await res.json()) as StartupDetail;
  } catch {
    return null;
  }
}

const TIER_LABEL: Record<string, string> = {
  platform: "Platform member",
  reviewer: "Reviewer",
  anonymous: "Community reviewer",
};

function Stars({ n }: { n: number }) {
  const full = Math.max(0, Math.min(5, Math.round(n)));
  return (
    <span aria-label={`${full} out of 5`} className="tracking-[1px] text-[var(--star)]">
      {"★".repeat(full)}
      <span className="text-[var(--overlay-12)]">{"★".repeat(5 - full)}</span>
    </span>
  );
}

const card = "rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] shadow-[var(--card-shadow)]";

/**
 * Startup profile with Angel Score, community score, reviews and the review
 * form. Used by the public /startups/[id] page and the in-app investor and
 * connector routes (`backHref` returns to whichever directory linked here).
 */
export async function StartupDetailView({ id, backHref }: { id: string; backHref: string }) {
  const data = await fetchStartupDetail(id);
  if (!data) notFound();

  const { profile, angel_score, community_score, reviews } = data;
  const chips = [profile.sector, profile.stage, profile.country].filter(Boolean) as string[];
  const subScores = angel_score
    ? ([
        ["Team", angel_score.team_score],
        ["Market", angel_score.market_score],
        ["Traction", angel_score.traction_score],
        ["Pitch", angel_score.pitch_score],
      ] as const).filter(([, v]) => v != null)
    : [];

  return (
    <main className="min-w-0">
      <section className="mx-auto flex max-w-5xl flex-col gap-6 p-6 md:p-10">
        <Link href={backHref} className="text-sm text-metatron-accent hover:underline">
          ← Browse Startups
        </Link>

        <div className={`${card} flex flex-wrap items-center gap-5 p-6`}>
          <div className="flex min-w-0 flex-1 basis-80 flex-col gap-1.5">
            <h1 className="text-[26px] font-semibold tracking-tight text-[var(--text)]">
              {profile.company_name || "Unnamed company"}
            </h1>
            {profile.one_liner && <p className="text-[15px] text-[var(--text-muted)]">{profile.one_liner}</p>}
            {chips.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {chips.map((c) => (
                  <span key={c} className="rounded-full bg-[var(--overlay-6)] px-2.5 py-1 text-xs text-[var(--text-muted)]">
                    {c}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2.5">
            {profile.website && (
              <a
                href={profile.website}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center rounded-xl border border-[var(--overlay-12)] px-4 text-sm font-medium text-[var(--text)] hover:bg-[var(--overlay-4)]"
              >
                Website
              </a>
            )}
            {profile.pitch_deck_url && (
              <TrackedDeckLink
                startupUserId={profile.user_id}
                href={profile.pitch_deck_url}
                className="inline-flex min-h-11 items-center rounded-xl bg-metatron-accent px-5 text-sm font-semibold text-white hover:bg-metatron-accent-hover"
              >
                View deck
              </TrackedDeckLink>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 rounded-[var(--radius)] border border-metatron-accent/30 bg-metatron-accent/10 p-5">
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-metatron-accent">Angel Score · Kevin</span>
            {angel_score ? (
              <>
                <span className="text-[34px] font-semibold text-[var(--text)]">{angel_score.score}</span>
                {subScores.length > 0 && (
                  <span className="text-[13px] text-[var(--text-muted)]">
                    {subScores.map(([l, v]) => `${l} ${v}`).join(" · ")}
                  </span>
                )}
                {angel_score.reasoning && <p className="mt-1 text-[13px] text-[var(--text-muted)]">{angel_score.reasoning}</p>}
              </>
            ) : (
              <span className="text-sm text-[var(--text-muted)]">Not generated yet.</span>
            )}
          </div>
          <div className="flex flex-col gap-1.5 rounded-[var(--radius)] border border-[rgba(220,160,40,0.28)] bg-[rgba(220,160,40,0.08)] p-5">
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--star)]">Community score</span>
            {community_score?.community_score != null ? (
              <>
                <span className="flex items-baseline gap-2.5">
                  <span className="text-[34px] font-semibold text-[var(--text)]">{community_score.community_score.toFixed(1)}</span>
                  <Stars n={community_score.community_score} />
                </span>
                <span className="text-[13px] text-[var(--text-muted)]">
                  {community_score.rating_count} review{community_score.rating_count === 1 ? "" : "s"} · investors count most
                </span>
              </>
            ) : (
              <span className="text-sm text-[var(--text-muted)]">No reviews yet.</span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <section className="flex flex-col gap-2.5">
            <h2 className="text-lg font-semibold text-[var(--text)]">Reviews</h2>
            {reviews.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No reviews yet. Be the first.</p>
            ) : (
              reviews.map((r) => (
                <article key={r.id} className={`${card} flex flex-col gap-2 p-4`}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-[var(--text)]">{TIER_LABEL[r.tier] ?? r.tier}</span>
                    <Stars n={r.overall_stars} />
                  </div>
                  {r.comment && <p className="text-sm text-[var(--text-muted)]">{r.comment}</p>}
                </article>
              ))
            )}
          </section>
          <RatingForm startupUserId={profile.user_id} />
        </div>
      </section>
    </main>
  );
}
