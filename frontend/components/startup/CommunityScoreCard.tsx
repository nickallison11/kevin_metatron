"use client";

import { useEffect, useState } from "react";
import { API_BASE, authHeaders } from "@/lib/api";
import { ScoreBar, card, eyebrow } from "@/components/startup/dashboardStyles";
import { reviewerKind, type MyReview } from "@/components/startup/StartupReviewsCard";

type Summary = {
  rating_count: number;
  community_score: number | null;
  avg_team_score: number | null;
  avg_market_score: number | null;
  avg_traction_score: number | null;
  avg_product_score: number | null;
};

const PLURAL: Record<string, string> = {
  Investor: "investors",
  Connector: "connectors",
  Founder: "founders",
  Reviewer: "reviewers",
  Guest: "guests",
};

/** Weighted Community score (the same one the public page shows), its four
 * dimension averages, and who the reviews came from. */
export default function CommunityScoreCard({ token, reviews }: { token: string; reviews: MyReview[] | null }) {
  const [summary, setSummary] = useState<Summary | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/ratings/mine/summary`, { headers: authHeaders(token) })
      .then((r) => (r.ok ? (r.json() as Promise<Summary | null>) : null))
      .then((d) => !cancelled && setSummary(d))
      .catch(() => !cancelled && setSummary(null));
    return () => {
      cancelled = true;
    };
  }, [token]);

  const counts = new Map<string, number>();
  for (const r of reviews ?? []) {
    if (r.is_flagged) continue;
    const k = reviewerKind(r);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const from = Object.keys(PLURAL)
    .filter((k) => counts.has(k))
    .map((k) => {
      const n = counts.get(k)!;
      return `${n} ${n === 1 ? k.toLowerCase() : PLURAL[k]}`;
    })
    .join(" · ");

  const n = summary?.rating_count ?? 0;
  const score = summary?.community_score ?? null;

  return (
    <section className={`${card} p-[22px]`}>
      <span className={`${eyebrow} text-[var(--text-muted)]`}>Community score</span>
      <div className="flex items-baseline gap-2">
        <span className={`text-3xl font-semibold ${score != null ? "text-[var(--star)]" : "text-[var(--text-muted)]"}`}>
          ★ {summary === undefined ? "…" : score != null ? score.toFixed(1) : "—"}
        </span>
        <span className="text-[13px] text-[var(--text-muted)]">
          {n} {n === 1 ? "review" : "reviews"}
        </span>
      </div>
      {n > 0 && (
        <>
          <div className="flex flex-col gap-2">
            <ScoreBar label="Team" value={summary?.avg_team_score ?? null} max={5} tone="star" digits={1} />
            <ScoreBar label="Market" value={summary?.avg_market_score ?? null} max={5} tone="star" digits={1} />
            <ScoreBar label="Traction" value={summary?.avg_traction_score ?? null} max={5} tone="star" digits={1} />
            <ScoreBar label="Product" value={summary?.avg_product_score ?? null} max={5} tone="star" digits={1} />
          </div>
          {from && <span className="text-[13px] text-[var(--text-muted)]">{from}</span>}
        </>
      )}
    </section>
  );
}
