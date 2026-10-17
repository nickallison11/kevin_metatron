"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { API_BASE, authHeaders, authJsonHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type Profile = {
  user_id: string;
  firm_name: string | null;
  bio: string | null;
  investment_thesis: string | null;
  sectors: string[] | null;
  stages: string[] | null;
  ticket_size_min: number | null;
  ticket_size_max: number | null;
  country: string | null;
  website: string | null;
  logo_url: string | null;
};
type Summary = {
  review_count: number;
  avg_stars: number | null;
  pct_responded_fast: number | null;
  pct_useful_feedback: number | null;
  pct_founder_friendly: number | null;
  pct_would_pitch_again: number | null;
};
type Review = {
  id: string;
  overall_stars: number;
  responded_fast: boolean;
  useful_feedback: boolean;
  founder_friendly: boolean;
  would_pitch_again: boolean;
  comment: string | null;
  created_at: string;
  reviewer_label: string;
  is_mine: boolean;
};
type Detail = { profile: Profile; summary: Summary; reviews: Review[]; can_review: boolean; fit_score: number | null; intro_requested: boolean };

const TAGS = [
  ["responded_fast", "Responded fast", "pct_responded_fast"],
  ["useful_feedback", "Gave useful feedback", "pct_useful_feedback"],
  ["founder_friendly", "Founder-friendly terms", "pct_founder_friendly"],
  ["would_pitch_again", "Would pitch again", "pct_would_pitch_again"],
] as const;
type TagKey = (typeof TAGS)[number][0];

const card = "rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] shadow-[var(--card-shadow)]";

function initials(s: string): string {
  return (
    s
      .replace(/[^A-Za-z ]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "·"
  );
}

function Stars({ n }: { n: number }) {
  const full = Math.max(0, Math.min(5, Math.round(n)));
  return (
    <span aria-label={`${full} out of 5`} className="tracking-[1px] text-[var(--star)]">
      {"★".repeat(full)}
      <span className="text-[var(--overlay-12)]">{"★".repeat(5 - full)}</span>
    </span>
  );
}

/**
 * Investor profile as founders (and connectors) see it: thesis and focus,
 * founder rating with what founders say, and — for founders who've connected
 * with this investor — the review form.
 */
export function InvestorDetailView({ investorId, backHref }: { investorId: string; backHref: string }) {
  const { token, loading } = useAuth();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<Record<TagKey, boolean>>({ responded_fast: false, useful_feedback: false, founder_friendly: false, would_pitch_again: false });
  const [comment, setComment] = useState("");
  const [formMsg, setFormMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [res, me] = await Promise.all([
        fetch(`${API_BASE}/investor-profile/public/${investorId}`, { headers: authHeaders(token) }),
        fetch(`${API_BASE}/auth/me`, { headers: authHeaders(token) }),
      ]);
      if (me.ok) setRole(((await me.json()) as { role: string }).role);
      if (!res.ok) {
        setError(res.status === 404 ? "This investor doesn't exist or has been removed." : "Couldn't load this investor.");
        return;
      }
      const d = (await res.json()) as Detail;
      setData(d);
      const mine = d.reviews.find((r) => r.is_mine);
      if (mine) {
        setStars(mine.overall_stars);
        setTags({ responded_fast: mine.responded_fast, useful_feedback: mine.useful_feedback, founder_friendly: mine.founder_friendly, would_pitch_again: mine.would_pitch_again });
        setComment(mine.comment ?? "");
      }
    } catch {
      setError("Couldn't load this investor.");
    }
  }, [token, investorId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function requestIntro() {
    if (!token || !data) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/connections`, {
        method: "POST",
        headers: authJsonHeaders(token),
        body: JSON.stringify({ to_user_id: data.profile.user_id, connection_type: "intro_request" }),
      });
      if (res.ok) setData({ ...data, intro_requested: true });
    } finally {
      setBusy(false);
    }
  }

  async function postReview() {
    if (!token) return;
    if (!stars) {
      setFormMsg({ ok: false, text: "Pick a star rating first." });
      return;
    }
    setBusy(true);
    setFormMsg(null);
    try {
      const res = await fetch(`${API_BASE}/investor-profile/public/${investorId}/review`, {
        method: "POST",
        headers: authJsonHeaders(token),
        body: JSON.stringify({ overall_stars: stars, ...tags, comment }),
      });
      if (!res.ok) {
        setFormMsg({ ok: false, text: (await res.text()) || "Couldn't post your review. Try again." });
        return;
      }
      setData((await res.json()) as Detail);
      setFormMsg({ ok: true, text: "Review posted. Thanks for helping other founders." });
    } finally {
      setBusy(false);
    }
  }

  if (loading || !token) return null;

  return (
    <main className="min-w-0">
      <section className="mx-auto flex max-w-5xl flex-col gap-6 p-6 md:p-10">
        <Link href={backHref} className="text-sm text-metatron-accent hover:underline">
          ← Browse Investors
        </Link>

        {error && <p className="text-sm text-[var(--text-muted)]">{error}</p>}
        {!data && !error && <p className="text-sm text-[var(--text-muted)]">Loading…</p>}

        {data && (
          <>
            {(() => {
              const p = data.profile;
              const name = p.firm_name || "Independent investor";
              const ticket =
                p.ticket_size_min != null || p.ticket_size_max != null ? `Cheque $${p.ticket_size_min ?? "?"} – $${p.ticket_size_max ?? "?"}` : null;
              const chips = [...(p.stages ?? []), ...(p.sectors ?? []), p.country, ticket].filter(Boolean) as string[];
              const isFounder = role === "STARTUP";
              return (
                <div className={`${card} flex flex-wrap items-center gap-5 p-6`}>
                  {p.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.logo_url} alt={`${name} logo`} className="h-16 w-16 shrink-0 rounded-2xl border border-[var(--border)] bg-white object-contain p-2" />
                  ) : (
                    <span aria-hidden className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-metatron-accent/15 text-xl font-semibold text-metatron-accent">
                      {initials(name)}
                    </span>
                  )}
                  <div className="flex min-w-0 flex-1 basis-72 flex-col gap-1.5">
                    <h1 className="text-[26px] font-semibold tracking-tight">{name}</h1>
                    {(p.investment_thesis || p.bio) && <p className="text-[15px] text-[var(--text-muted)]">{p.investment_thesis || p.bio}</p>}
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
                  <div className="flex flex-wrap items-center gap-2.5">
                    {data.fit_score != null && (
                      <span className="rounded-lg bg-[var(--good-bg)] px-3 py-2 font-mono text-[13px] text-[var(--good)]">{data.fit_score}% fit</span>
                    )}
                    {isFounder && (
                      <button
                        type="button"
                        disabled={busy || data.intro_requested}
                        onClick={() => void requestIntro()}
                        className="inline-flex min-h-11 items-center rounded-xl bg-metatron-accent px-5 text-sm font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-60"
                      >
                        {data.intro_requested ? "Intro requested" : "Request intro"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}

            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
              <section className={`${card} flex flex-col gap-4 p-5`}>
                <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">Founder rating</span>
                {data.summary.review_count > 0 && data.summary.avg_stars != null ? (
                  <>
                    <div className="flex items-baseline gap-2.5">
                      <span className="text-[34px] font-semibold">{data.summary.avg_stars.toFixed(1)}</span>
                      <Stars n={data.summary.avg_stars} />
                    </div>
                    <span className="text-[13px] text-[var(--text-muted)]">
                      From {data.summary.review_count} founder{data.summary.review_count === 1 ? "" : "s"} who connected with them on metatron
                    </span>
                    {TAGS.map(([, label, pct]) => {
                      const v = Math.round(data.summary[pct] ?? 0);
                      return (
                        <div key={label} className="flex flex-col gap-1.5">
                          <div className="flex justify-between text-[13px]">
                            <span>{label}</span>
                            <span className="text-[var(--text-muted)]">{v}%</span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded bg-[var(--overlay-8)]">
                            <div className="h-full rounded bg-metatron-accent" style={{ width: `${v}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </>
                ) : (
                  <p className="text-sm text-[var(--text-muted)]">No founder has reviewed this investor yet. Founders who connect with them can leave the first review.</p>
                )}
              </section>

              {data.can_review ? (
                <section className={`${card} flex flex-col gap-4 border-metatron-accent/40 p-5`}>
                  <div className="flex flex-col gap-1">
                    <h2 className="text-base font-semibold">{data.reviews.some((r) => r.is_mine) ? "Update your review" : `Review ${data.profile.firm_name || "this investor"}`}</h2>
                    <span className="text-[13px] text-[var(--text-muted)]">Your name isn&apos;t shown. Your review appears as &ldquo;Verified founder&rdquo;.</span>
                  </div>
                  <fieldset className="flex flex-col gap-1.5">
                    <legend className="mb-1.5 text-[13px] font-semibold">Overall</legend>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          type="button"
                          aria-label={`${n} star${n > 1 ? "s" : ""}`}
                          aria-pressed={stars === n}
                          onClick={() => setStars(n)}
                          className={`h-10 w-10 rounded-[10px] border border-[var(--overlay-12)] text-lg ${stars >= n ? "text-[var(--star)]" : "text-[var(--overlay-12)]"}`}
                        >
                          ★
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <div className="flex flex-wrap gap-2">
                    {TAGS.map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={tags[key]}
                        onClick={() => setTags({ ...tags, [key]: !tags[key] })}
                        className={`min-h-8 rounded-full px-3 text-[13px] ${tags[key] ? "bg-metatron-accent/15 text-[var(--text)]" : "bg-[var(--overlay-6)] text-[var(--text-muted)]"}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
                    <span>
                      What was it like? <span className="font-normal text-[var(--text-muted)]">(optional)</span>
                    </span>
                    <textarea
                      rows={3}
                      maxLength={1000}
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="How did the conversation go?"
                      className="w-full resize-y rounded-[10px] border border-[var(--overlay-12)] bg-[var(--bg)] px-3.5 py-2.5 text-sm font-normal text-[var(--text)] outline-none focus:border-metatron-accent"
                    />
                  </label>
                  {formMsg && <p className={`text-[13px] ${formMsg.ok ? "text-metatron-accent" : "text-[var(--danger)]"}`}>{formMsg.text}</p>}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void postReview()}
                    className="inline-flex min-h-11 w-fit items-center rounded-xl bg-metatron-accent px-5 text-sm font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-60"
                  >
                    {data.reviews.some((r) => r.is_mine) ? "Update review" : "Post review"}
                  </button>
                </section>
              ) : (
                <section className={`${card} flex flex-col gap-2 p-5`}>
                  <h2 className="text-base font-semibold">Reviews come from founders</h2>
                  <p className="text-sm text-[var(--text-muted)]">
                    {role === "STARTUP"
                      ? "You can review this investor once you've connected with them."
                      : "Only founders who have connected with an investor can review them."}
                  </p>
                </section>
              )}
            </div>

            <section className="flex flex-col gap-2.5">
              <h2 className="text-lg font-semibold">What founders say</h2>
              {data.reviews.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">No reviews yet.</p>
              ) : (
                data.reviews.map((r) => (
                  <article key={r.id} className={`${card} flex flex-col gap-2 p-4`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-semibold">
                        {r.reviewer_label}
                        {r.is_mine ? " (you)" : ""}
                      </span>
                      <Stars n={r.overall_stars} />
                    </div>
                    {(r.responded_fast || r.useful_feedback || r.founder_friendly || r.would_pitch_again) && (
                      <div className="flex flex-wrap gap-1.5">
                        {TAGS.filter(([k]) => r[k]).map(([k, label]) => (
                          <span key={k} className="rounded-full bg-[var(--overlay-6)] px-2.5 py-0.5 text-xs text-[var(--text-muted)]">
                            {label}
                          </span>
                        ))}
                      </div>
                    )}
                    {r.comment && <p className="text-sm text-[var(--text-muted)]">{r.comment}</p>}
                  </article>
                ))
              )}
            </section>
          </>
        )}
      </section>
    </main>
  );
}
