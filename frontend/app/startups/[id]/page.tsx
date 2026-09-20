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

type StartupDetail = {
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

async function fetchStartup(id: string): Promise<StartupDetail | null> {
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

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await fetchStartup(id);
  const name = data?.profile.company_name ?? "Startup";
  return {
    title: `${name} — metatron`,
    description: data?.profile.one_liner ?? `${name} on metatron.`,
  };
}

const TIER_LABEL: Record<string, string> = {
  platform: "Platform member",
  reviewer: "Reviewer",
  anonymous: "Community reviewer",
};

export default async function StartupDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await fetchStartup(id);
  if (!data) notFound();

  const { profile, angel_score, community_score, reviews } = data;

  return (
    <main className="min-w-0">
      <section className="p-6 md:p-10 max-w-4xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--text)]">
            {profile.company_name || "Unnamed company"}
          </h1>
          <p className="mt-1 font-sans text-xs uppercase tracking-wide text-[var(--text-muted)]">
            {(profile.stage || "—") +
              " · " +
              (profile.sector || "—") +
              (profile.country ? ` · ${profile.country}` : "")}
          </p>
          <p className="mt-3 text-sm text-[var(--text-muted)]">{profile.one_liner}</p>
          <div className="mt-3 flex flex-wrap gap-3">
            {profile.website && (
              <a
                href={profile.website}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-metatron-accent hover:underline"
              >
                Website
              </a>
            )}
            {profile.pitch_deck_url && (
              <TrackedDeckLink
                startupUserId={profile.user_id}
                href={profile.pitch_deck_url}
                className="text-xs text-metatron-accent hover:underline"
              >
                Pitch deck
              </TrackedDeckLink>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5">
            <h2 className="text-sm font-semibold text-[var(--text)]">Angel Score</h2>
            {angel_score ? (
              <>
                <p className="mt-2 text-3xl font-semibold text-[var(--text)]">{angel_score.score}</p>
                {angel_score.reasoning && (
                  <p className="mt-2 text-xs text-[var(--text-muted)]">{angel_score.reasoning}</p>
                )}
              </>
            ) : (
              <p className="mt-2 text-xs text-[var(--text-muted)]">Not yet generated.</p>
            )}
          </div>
          <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5">
            <h2 className="text-sm font-semibold text-[var(--text)]">Community Score</h2>
            {community_score?.community_score != null ? (
              <>
                <p className="mt-2 text-3xl font-semibold text-[var(--text)]">
                  {community_score.community_score.toFixed(1)} ★
                </p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {community_score.rating_count} rating{community_score.rating_count === 1 ? "" : "s"}
                </p>
              </>
            ) : (
              <p className="mt-2 text-xs text-[var(--text-muted)]">No ratings yet.</p>
            )}
          </div>
        </div>

        <RatingForm startupUserId={profile.user_id} />

        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-[var(--text)]">Reviews</h2>
          {reviews.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">No reviews yet — be the first.</p>
          ) : (
            reviews.map((r) => (
              <div
                key={r.id}
                className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-[var(--text)]">{"★".repeat(r.overall_stars)}</p>
                  <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                    {TIER_LABEL[r.tier] ?? r.tier}
                  </p>
                </div>
                {r.comment && (
                  <p className="mt-2 text-xs text-[var(--text-muted)]">{r.comment}</p>
                )}
              </div>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
