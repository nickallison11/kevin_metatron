"use client";

import { useEffect, useState } from "react";
import { API_BASE, authHeaders } from "@/lib/api";

type Detail = {
  summary: { review_count: number; avg_stars: number | null };
  reviews: { id: string; overall_stars: number; comment: string | null; reviewer_label: string }[];
};

/** "What founders say about you" — investor profile. */
export default function InvestorReviewsCard({ token, userId }: { token: string; userId: string }) {
  const [data, setData] = useState<Detail | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/investor-profile/public/${userId}`, { headers: authHeaders(token) })
      .then((r) => (r.ok ? (r.json() as Promise<Detail>) : null))
      .then((d) => !cancelled && setData(d))
      .catch(() => {})
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [token, userId]);

  const avg = data?.summary.avg_stars;

  return (
    <section className="flex flex-col gap-2.5 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-[var(--card-shadow)]">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">What founders say about you</h2>
        {avg != null && (
          <span className="text-sm text-[var(--star)]">
            ★ {avg.toFixed(1)} <span className="text-xs text-[var(--text-muted)]">({data!.summary.review_count})</span>
          </span>
        )}
      </div>
      {!loaded ? (
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      ) : !data || data.reviews.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">No reviews yet. Founders you connect with can review you, and their reviews show on your public profile.</p>
      ) : (
        data.reviews.slice(0, 4).map((r) => (
          <div key={r.id} className="flex flex-col gap-1 border-t border-[var(--border)] py-2.5 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[var(--star)]">{"★".repeat(r.overall_stars)}</span>
              <span className="text-xs text-[var(--text-muted)]">{r.reviewer_label}</span>
            </div>
            {r.comment && <p className="text-[var(--text-muted)]">{r.comment}</p>}
          </div>
        ))
      )}
    </section>
  );
}
