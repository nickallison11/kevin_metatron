"use client";

import { useEffect, useState } from "react";
import { API_BASE, authHeaders } from "@/lib/api";

type MyReview = {
  id: string;
  tier: string;
  overall_stars: number;
  comment: string | null;
  is_flagged: boolean;
  created_at: string;
  reviewer_name: string | null;
  reviewer_email: string | null;
};

/** "Reviews of your startup" — founder dashboard. */
export default function StartupReviewsCard({ token }: { token: string }) {
  const [reviews, setReviews] = useState<MyReview[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/ratings/mine`, { headers: authHeaders(token) })
      .then((r) => (r.ok ? (r.json() as Promise<MyReview[]>) : []))
      .then((d) => !cancelled && setReviews(d))
      .catch(() => !cancelled && setReviews([]));
    return () => {
      cancelled = true;
    };
  }, [token]);

  const avg = reviews && reviews.length ? reviews.reduce((a, r) => a + r.overall_stars, 0) / reviews.length : null;

  return (
    <section className="flex flex-col gap-2.5 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-[var(--card-shadow)]">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Reviews of your startup</h2>
        {avg != null && <span className="text-sm text-[var(--star)]">★ {avg.toFixed(1)}</span>}
      </div>
      {reviews === null ? (
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      ) : reviews.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">No reviews yet. Share your public profile to collect your first ones.</p>
      ) : (
        reviews.slice(0, 4).map((r) => (
          <div key={r.id} className="flex flex-col gap-1 border-t border-[var(--border)] py-2.5 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[var(--star)]">{"★".repeat(r.overall_stars)}</span>
              <span className="text-xs text-[var(--text-muted)]">{r.reviewer_name || r.reviewer_email || "Reviewer"}</span>
            </div>
            {r.comment && <p className="text-[var(--text-muted)]">{r.comment}</p>}
          </div>
        ))
      )}
    </section>
  );
}
