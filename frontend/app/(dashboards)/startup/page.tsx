"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AngelScoreCard from "@/components/AngelScoreCard";
import ShareProfileCard from "@/components/ShareProfileCard";
import DeckActivityCard from "@/components/startup/DeckActivityCard";
import StartupReviewsCard from "@/components/startup/StartupReviewsCard";
import { API_BASE, authHeaders, authJsonHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { MeResponse } from "@/lib/me";
import { SECTIONS, pitchProgress, sectionComplete, type Pitch } from "@/lib/pitchSections";
import { LogoTile } from "@/components/LogoTile";

type Match = {
  id: string;
  matched_user_id: string | null;
  match_type: string;
  score: number;
  firm_name: string | null;
  sector: string | null;
  stage: string | null;
  country: string | null;
  generated_at: string;
  logo_url?: string | null;
};
type Request = {
  id: string;
  firm_name: string | null;
  company_name: string | null;
  intro_requested_at: string;
  intro_accepted_at: string | null;
  intro_passed_at: string | null;
};

const card = "flex flex-col gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-[var(--card-shadow)]";
const eyebrow = "font-mono text-[11px] uppercase tracking-[0.14em]";
const btn =
  "inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--overlay-12)] px-5 text-sm font-medium text-[var(--text)] hover:bg-[var(--overlay-4)] disabled:opacity-50";
const btnPrimary =
  "inline-flex min-h-11 items-center justify-center rounded-xl bg-metatron-accent px-5 text-sm font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-50";

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-[var(--card-shadow)]">
      <span className="text-[13px] text-[var(--text-muted)]">{label}</span>
      <b className="text-2xl font-semibold">{value}</b>
    </div>
  );
}

export default function StartupDashboardPage() {
  const { loading, token } = useAuth();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [company, setCompany] = useState<string | null>(null);
  const [pitch, setPitch] = useState<Pitch | null>(null);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [requests, setRequests] = useState<Request[]>([]);
  const [deckViews30, setDeckViews30] = useState<number | null>(null);
  const [angel, setAngel] = useState<number | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    const get = (path: string) => fetch(`${API_BASE}${path}`, { headers: authHeaders(token) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const [m, prof, pitches, ms, reqs, views, score, reviews] = await Promise.all([
      get("/auth/me"),
      get("/profile"),
      get("/pitches"),
      get("/kevin-matches"),
      get("/kevin-matches/received-intros"),
      get("/deck-views/mine"),
      get("/angel-score"),
      get("/ratings/mine"),
    ]);
    setMe(m as MeResponse | null);
    setCompany((prof as { company_name?: string | null } | null)?.company_name?.trim() || null);
    setPitch(((pitches as Pitch[] | null) ?? [])[0] ?? null);
    setRequests(((reqs as Request[] | null) ?? []).filter((r) => !r.intro_accepted_at && !r.intro_passed_at));
    const since = Date.now() - 30 * 86400000;
    setDeckViews30(((views as { viewed_at: string }[] | null) ?? []).filter((v) => new Date(v.viewed_at).getTime() >= since).length);
    setAngel((score as { score?: number } | null)?.score ?? null);
    const rs = (reviews as { overall_stars: number }[] | null) ?? [];
    setRating(rs.length ? rs.reduce((a, r) => a + r.overall_stars, 0) / rs.length : null);

    let list = (ms as Match[] | null) ?? [];
    setMatches(list);
    if (list.length === 0) {
      // First visit: ask Kevin to generate matches (the Matches page does the same).
      const res = await fetch(`${API_BASE}/kevin-matches`, { method: "POST", headers: authJsonHeaders(token) }).catch(() => null);
      if (res?.ok) list = (await res.json()) as Match[];
      setMatches(list);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function answer(r: Request, accept: boolean) {
    if (!token) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/kevin-matches/${r.id}/${accept ? "accept-intro" : "pass-intro"}`, {
        method: "POST",
        headers: authJsonHeaders(token),
      });
      if (res.ok) setRequests((prev) => prev.filter((x) => x.id !== r.id));
    } finally {
      setBusy(false);
    }
  }

  if (loading || !token) return null;

  const { done, missing } = pitchProgress(pitch);
  const req = requests[0];
  const investorMatches = matches ?? [];
  const weekAgo = Date.now() - 7 * 86400000;
  const newThisWeek = (matches ?? []).filter((m) => new Date(m.generated_at).getTime() >= weekAgo).length;
  const name = me?.first_name?.trim() || company || "";

  return (
    <main className="min-w-0 flex-1">
      <section className="mx-auto flex max-w-5xl flex-col gap-5 p-6 md:p-10">
        <header className="flex flex-col gap-1.5">
          <span className={`${eyebrow} text-[var(--text-muted)]`}>Dashboard</span>
          <h1 className="text-[28px] font-semibold tracking-tight">
            {greeting()}
            {name ? `, ${name}` : ""}
          </h1>
        </header>

        {req ? (
          <section className={`${card} border-metatron-accent/40 bg-metatron-accent/[0.06] md:flex-row md:flex-wrap md:items-center`}>
            <div className="flex min-w-0 flex-1 basis-80 flex-col gap-1.5">
              <span className={`${eyebrow} text-[var(--accent-fg)]`}>Next step from Kevin</span>
              <span className="text-xl font-semibold">{req.firm_name || "An investor"} wants to connect with you</span>
              <span className="text-sm text-[var(--text-muted)]">
                Reply within 48 hours to keep momentum.
                {requests.length > 1 ? ` ${requests.length - 1} more waiting on Matches.` : ""}
              </span>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <button type="button" disabled={busy} onClick={() => void answer(req, false)} className={btn}>
                Decline
              </button>
              <button type="button" disabled={busy} onClick={() => void answer(req, true)} className={btnPrimary}>
                Accept
              </button>
            </div>
          </section>
        ) : missing.length > 0 ? (
          <section className={`${card} border-metatron-accent/40 bg-metatron-accent/[0.06]`}>
            <span className={`${eyebrow} text-[var(--accent-fg)]`}>Next step from Kevin</span>
            <span className="text-xl font-semibold">
              {pitch ? `Add your ${missing[0]!.label.toLowerCase()}` : "Upload your pitch deck"}
            </span>
            <span className="text-sm text-[var(--text-muted)]">
              {pitch
                ? `${missing.length === 1 ? "It's the one section missing from your pitch" : `${missing.length} sections of your pitch are still empty`}, and investors ask about it in almost every first call.`
                : "Kevin reads it, fills in your profile and pitch, and starts matching you with investors."}
            </span>
            <div>
              <Link href="/startup/profile" className={btnPrimary}>
                Open Startup Profile
              </Link>
            </div>
          </section>
        ) : (
          <section className={`${card} border-metatron-accent/40 bg-metatron-accent/[0.06]`}>
            <span className={`${eyebrow} text-[var(--accent-fg)]`}>Next step from Kevin</span>
            <span className="text-xl font-semibold">Your pitch is complete. Reach out to your top matches.</span>
            <div>
              <Link href="/startup/matches" className={btnPrimary}>
                See your matches
              </Link>
            </div>
          </section>
        )}

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="New matches this week" value={matches === null ? "…" : String(newThisWeek)} />
          <Stat label="Deck views · 30 days" value={deckViews30 === null ? "…" : String(deckViews30)} />
          <Stat label="Angel Score" value={angel == null ? "—" : String(angel)} />
          <Stat label="Community rating" value={rating == null ? "—" : `★ ${rating.toFixed(1)}`} />
        </section>

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <section className={card}>
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold">Top investor matches</h2>
              <Link href="/startup/matches" className="text-sm text-[var(--accent-fg)] hover:underline">
                See all
              </Link>
            </div>
            {matches === null ? (
              <p className="text-sm text-[var(--text-muted)]">Kevin is finding your best matches…</p>
            ) : investorMatches.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No matches yet. Complete your Startup Profile so Kevin can match you.</p>
            ) : (
              investorMatches.slice(0, 5).map((m) => {
                const firm = m.firm_name || "Investor";
                const meta = [m.sector, m.stage, m.country].filter(Boolean).join(" · ");
                const title = m.matched_user_id ? (
                  <Link href={`/startup/investors/${m.matched_user_id}`} className="font-semibold text-[var(--text)] hover:underline">
                    {firm}
                  </Link>
                ) : (
                  <span className="font-semibold">{firm}</span>
                );
                return (
                  <div key={m.id} className="flex items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <LogoTile name={firm} url={m.logo_url} size={36} />
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate">{title}</span>
                        {meta && <span className="truncate text-[13px] text-[var(--text-muted)]">{meta}</span>}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-lg bg-[var(--good-bg)] px-2.5 py-1 font-mono text-xs text-[var(--good)]">{m.score}%</span>
                  </div>
                );
              })
            )}
          </section>

          <div className="flex flex-col gap-4">
            <section className={card}>
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-base font-semibold">Your pitch</h2>
                <span className="text-sm text-[var(--text-muted)]">
                  {done.length} of {SECTIONS.length} ready
                </span>
              </div>
              <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${SECTIONS.length}, minmax(0, 1fr))` }} role="img" aria-label={`${done.length} of ${SECTIONS.length} sections complete`}>
                {SECTIONS.map((s) => (
                  <i key={s.k} className={`h-1.5 rounded ${sectionComplete(pitch, s) ? "bg-metatron-accent" : "bg-[var(--overlay-8)]"}`} />
                ))}
              </div>
              {missing.length > 0 ? (
                <span className="text-sm text-[var(--text-muted)]">
                  Missing: <strong className="text-[var(--warn)]">{missing.map((s) => s.label).join(", ")}</strong>.{" "}
                  <Link href="/startup/profile" className="text-[var(--accent-fg)] hover:underline">
                    Add it
                  </Link>
                </span>
              ) : (
                <span className="text-sm text-[var(--text-muted)]">Every section is complete.</span>
              )}
            </section>
            <DeckActivityCard token={token} />
            <StartupReviewsCard token={token} />
          </div>
        </div>

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <AngelScoreCard token={token} />
          <ShareProfileCard token={token} />
        </div>
      </section>
    </main>
  );
}
