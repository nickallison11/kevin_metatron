"use client";

import { ago, btn, card, reviewRequestMailto } from "@/components/startup/dashboardStyles";

export type MyReview = {
  id: string;
  tier: string;
  overall_stars: number;
  team_score: number | null;
  market_score: number | null;
  traction_score: number | null;
  product_score: number | null;
  comment: string | null;
  is_flagged: boolean;
  created_at: string;
  reviewer_name: string | null;
  reviewer_email: string | null;
  reviewer_role: string | null;
};

/** Who left the review: platform accounts by role, then reviewer accounts and guests. */
export function reviewerKind(r: Pick<MyReview, "tier" | "reviewer_role">): "Investor" | "Connector" | "Founder" | "Reviewer" | "Guest" {
  if (r.tier === "platform") {
    if (r.reviewer_role === "INVESTOR") return "Investor";
    if (r.reviewer_role === "INTERMEDIARY") return "Connector";
    return "Founder";
  }
  return r.tier === "reviewer" ? "Reviewer" : "Guest";
}

const SHOWN = 3;

/** "Latest reviews": the founder sees who reviewed them, each reviewer's own
 * scores, and which reviews Kevin flagged off the public page. */
export default function StartupReviewsCard({
  reviews,
  publicLink,
  company,
}: {
  reviews: MyReview[] | null;
  publicLink: string | null;
  company: string | null;
}) {
  return (
    <section className={card}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Latest reviews</h2>
        {reviews && reviews.length > SHOWN && publicLink && (
          <a href={publicLink} className="text-sm text-[var(--accent-fg)] hover:underline">
            All {reviews.length} on your public page
          </a>
        )}
      </div>
      {reviews === null ? (
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      ) : reviews.length === 0 ? (
        <>
          <p className="text-sm leading-relaxed text-[var(--text-muted)]">
            No reviews yet. Investors, connectors and people who know your work rate your team, market, traction and product
            on your public page.
          </p>
          {publicLink && (
            <div>
              <a href={reviewRequestMailto(publicLink, company)} className={btn}>
                Ask for a review
              </a>
            </div>
          )}
        </>
      ) : (
        reviews.slice(0, SHOWN).map((r) => {
          const kind = reviewerKind(r);
          const weighty = kind === "Investor" || kind === "Connector";
          const dims = [
            ["Team", r.team_score],
            ["Market", r.market_score],
            ["Traction", r.traction_score],
            ["Product", r.product_score],
          ]
            .filter(([, v]) => v != null)
            .map(([l, v]) => `${l} ${v}`);
          const meta = [r.reviewer_name || r.reviewer_email || "Reviewer", ...dims, ago(r.created_at)].join(" · ");
          return (
            <div key={r.id} className="flex flex-col gap-1.5 border-t border-[var(--border)] pt-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--star)]" aria-label={`${r.overall_stars} out of 5 stars`}>
                  {"★".repeat(r.overall_stars)}
                </span>
                <span
                  className={`rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${
                    weighty ? "border-metatron-accent/45 text-[var(--accent-fg)]" : "border-[var(--overlay-12)] text-[var(--text-muted)]"
                  }`}
                >
                  {kind}
                </span>
              </div>
              {r.is_flagged ? (
                <p className="text-[var(--text-muted)]">Flagged by Kevin, hidden from your public page.</p>
              ) : (
                r.comment && <p>{r.comment}</p>
              )}
              <span className="text-xs text-[var(--text-muted)]">{meta}</span>
            </div>
          );
        })
      )}
    </section>
  );
}
