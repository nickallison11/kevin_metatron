"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import KevinMatchFeed from "@/components/KevinMatchFeed";
import { API_BASE, authHeaders, authJsonHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { MeResponse } from "@/lib/me";
import { LogoTile } from "@/components/LogoTile";

const PIPELINE_STAGES = ["watching", "considering", "due_diligence", "invested", "passed"];
const STAGE_LABELS: Record<string, string> = {
  watching: "Watching",
  considering: "Considering",
  due_diligence: "Due diligence",
  passed: "Passed",
  invested: "Invested",
};

type PipelineRow = {
  id: string;
  founder_user_id: string;
  stage: string;
  company_name: string | null;
  one_liner: string | null;
  angel_score: number | null;
};

type Request = {
  id: string;
  for_user_id: string;
  score: number;
  intro_requested_at: string;
  company_name: string | null;
  one_liner: string | null;
  stage: string | null;
  sector: string | null;
  country: string | null;
  angel_score: number | null;
  deck_url: string | null;
  intro_accepted_at: string | null;
  intro_passed_at: string | null;
  logo_url?: string | null;
};

type InvestorProfile = {
  firm_name?: string | null;
  investment_thesis?: string | null;
  bio?: string | null;
  sectors?: string[] | null;
  stages?: string[] | null;
  ticket_size_min?: number | null;
  ticket_size_max?: number | null;
  country?: string | null;
};

const card = "flex flex-col gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-[var(--card-shadow)]";
const eyebrow = "font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]";
const btn =
  "inline-flex min-h-10 items-center justify-center rounded-[10px] border border-[var(--overlay-12)] px-4 text-[13px] font-medium text-[var(--text)] hover:bg-[var(--overlay-4)] disabled:opacity-50";
const btnPrimary =
  "inline-flex min-h-10 items-center justify-center rounded-[10px] bg-metatron-accent px-4 text-[13px] font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-50";

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function ago(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-[var(--card-shadow)]">
      <span className="text-[13px] text-[var(--text-muted)]">{label}</span>
      <b className="text-2xl font-semibold">{value}</b>
    </div>
  );
}

export default function InvestorDashboardPage() {
  const { token, loading } = useAuth("INVESTOR");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [profile, setProfile] = useState<InvestorProfile | null>(null);
  const [logo, setLogo] = useState<string | null>(null);
  const [pipeline, setPipeline] = useState<PipelineRow[]>([]);
  const [pipelineLoaded, setPipelineLoaded] = useState(false);
  const [requests, setRequests] = useState<Request[] | null>(null);
  const [newMatches, setNewMatches] = useState<number | null>(null);
  const [rating, setRating] = useState<{ avg: number; n: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loadPipeline = useCallback(async () => {
    if (!token) return;
    const res = await fetch(`${API_BASE}/investor-pipeline`, { headers: authJsonHeaders(token) }).catch(() => null);
    setPipeline(res?.ok ? ((await res.json()) as PipelineRow[]) : []);
    setPipelineLoaded(true);
  }, [token]);

  const load = useCallback(async () => {
    if (!token) return;
    const get = (path: string) => fetch(`${API_BASE}${path}`, { headers: authHeaders(token) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const [m, ip, prof, reqs, ms] = await Promise.all([
      get("/auth/me"),
      get("/investor-profile"),
      get("/profile"),
      get("/kevin-matches/received-intros"),
      get("/kevin-matches"),
    ]);
    const meRow = m as MeResponse | null;
    setMe(meRow);
    setProfile(ip as InvestorProfile | null);
    setLogo((prof as { logo_url?: string | null } | null)?.logo_url ?? null);
    setRequests(((reqs as Request[] | null) ?? []).filter((r) => !r.intro_accepted_at && !r.intro_passed_at));
    const weekAgo = Date.now() - 7 * 86400000;
    setNewMatches(((ms as { generated_at: string }[] | null) ?? []).filter((x) => new Date(x.generated_at).getTime() >= weekAgo).length);
    if (meRow?.id) {
      const sums = (await get("/investor-profile/review-summaries")) as { investor_user_id: string; review_count: number; avg_stars: number | null }[] | null;
      const mine = (sums ?? []).find((s) => s.investor_user_id === meRow.id);
      setRating(mine && mine.avg_stars != null ? { avg: mine.avg_stars, n: mine.review_count } : null);
    }
  }, [token]);

  useEffect(() => {
    void load();
    void loadPipeline();
  }, [load, loadPipeline]);

  const addToPipeline = useCallback(
    async (founderId: string) => {
      if (!token) return;
      await fetch(`${API_BASE}/investor-pipeline`, {
        method: "POST",
        headers: authJsonHeaders(token),
        body: JSON.stringify({ founder_user_id: founderId, stage: "watching" }),
      });
      await loadPipeline();
    },
    [token, loadPipeline],
  );

  async function updateStage(id: string, stage: string) {
    if (!token) return;
    await fetch(`${API_BASE}/investor-pipeline/${id}`, { method: "PATCH", headers: authJsonHeaders(token), body: JSON.stringify({ stage }) });
    await loadPipeline();
  }

  async function removeFromPipeline(id: string) {
    if (!token) return;
    await fetch(`${API_BASE}/investor-pipeline/${id}`, { method: "DELETE", headers: authJsonHeaders(token) });
    await loadPipeline();
  }

  async function answer(r: Request, accept: boolean) {
    if (!token) return;
    setBusy(r.id);
    try {
      const res = await fetch(`${API_BASE}/kevin-matches/${r.id}/${accept ? "accept-intro" : "pass-intro"}`, {
        method: "POST",
        headers: authJsonHeaders(token),
      });
      if (res.ok) setRequests((prev) => (prev ?? []).filter((x) => x.id !== r.id));
    } finally {
      setBusy(null);
    }
  }

  function viewDeck(r: Request) {
    if (!token || !r.deck_url) return;
    // Open first so the browser doesn't block the tab, then log the view.
    window.open(r.deck_url, "_blank", "noopener");
    void fetch(`${API_BASE}/kevin-matches/${r.id}/view-deck`, { method: "POST", headers: authJsonHeaders(token) }).catch(() => {});
  }

  if (loading || !token) return null;

  const p = profile ?? {};
  const items: [string, boolean][] = [
    ["Logo", Boolean(logo)],
    ["Firm name", Boolean(p.firm_name?.trim())],
    ["Thesis", Boolean((p.investment_thesis || p.bio)?.trim())],
    ["Stages and sectors", Boolean(p.stages?.length && p.sectors?.length)],
    ["Cheque size", p.ticket_size_min != null || p.ticket_size_max != null],
    ["Country", Boolean(p.country)],
  ];
  const done = items.filter((i) => i[1]).length;
  const name = p.firm_name?.trim() || me?.first_name?.trim() || "";
  const active = pipeline.filter((r) => r.stage !== "passed").length;

  return (
    <main className="min-w-0 flex-1">
      <section className="mx-auto flex max-w-5xl flex-col gap-5 p-6 md:p-10">
        <header className="flex flex-col gap-1.5">
          <span className={eyebrow}>Dashboard</span>
          <h1 className="text-[28px] font-semibold tracking-tight">
            {greeting()}
            {name ? `, ${name}` : ""}
          </h1>
        </header>

        {profile && done < items.length && (
          <section className={`${card} md:flex-row md:flex-wrap md:items-center`}>
            <div className="flex min-w-0 flex-1 basis-72 flex-col gap-1.5">
              <div className="flex justify-between gap-2">
                <strong>Complete your profile</strong>
                <span className="text-sm text-[var(--text-muted)]">
                  {done} of {items.length}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded bg-[var(--overlay-8)]">
                <div className="h-full rounded bg-metatron-accent" style={{ width: `${Math.round((done / items.length) * 100)}%` }} />
              </div>
              <span className="text-[13px] text-[var(--text-muted)]">
                Missing:{" "}
                {items
                  .filter((i) => !i[1])
                  .map((i) => i[0].toLowerCase())
                  .join(", ")}
                . Complete profiles get better matches.
              </span>
            </div>
            <Link href="/investor/profile" className={btnPrimary}>
              Finish profile
            </Link>
          </section>
        )}

        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              Waiting on you
              {requests && requests.length > 0 && (
                <span className="rounded-full bg-metatron-accent px-2 py-0.5 text-[11px] font-semibold text-white">{requests.length}</span>
              )}
            </h2>
            <Link href="/investor/matches?tab=requests" className="text-sm text-[var(--accent-fg)] hover:underline">
              All requests
            </Link>
          </div>
          {requests === null ? (
            <p className="text-sm text-[var(--text-muted)]">Loading…</p>
          ) : requests.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">Nothing waiting. Kevin will tell you when a founder requests an intro.</p>
          ) : (
            requests.slice(0, 3).map((r) => {
              const company = r.company_name || "A founder";
              return (
                <article key={r.id} className={`${card} border-metatron-accent/40 md:flex-row md:flex-wrap md:items-center`}>
                  <LogoTile name={company} url={r.logo_url} />
                  <div className="flex min-w-0 flex-1 basis-72 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <Link href={`/investor/startups/${r.for_user_id}`} className="text-base font-semibold text-[var(--text)] hover:underline">
                        {company}
                      </Link>
                      <span className="rounded-lg bg-[var(--good-bg)] px-2 py-0.5 font-mono text-xs text-[var(--good)]">{r.score}% fit</span>
                      {r.angel_score != null && <span className="text-[13px] text-[var(--text-muted)]">Angel Score {r.angel_score}</span>}
                    </div>
                    <span className="text-[13px] text-[var(--text-muted)]">
                      {[r.sector, r.stage, r.country, `requested ${ago(r.intro_requested_at)}`].filter(Boolean).join(" · ")}
                    </span>
                    {r.one_liner && <span className="text-sm text-[var(--text-muted)]">{r.one_liner}</span>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {r.deck_url && (
                      <button type="button" onClick={() => viewDeck(r)} className={btn}>
                        View deck
                      </button>
                    )}
                    <button type="button" disabled={busy === r.id} onClick={() => void answer(r, false)} className={btn}>
                      Decline
                    </button>
                    <button type="button" disabled={busy === r.id} onClick={() => void answer(r, true)} className={btnPrimary}>
                      Accept
                    </button>
                  </div>
                </article>
              );
            })
          )}
        </section>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat label="New matches this week" value={newMatches === null ? "…" : String(newMatches)} />
          <Stat label="In your pipeline" value={pipelineLoaded ? String(active) : "…"} />
          <Stat label="Your founder rating" value={rating ? `★ ${rating.avg.toFixed(1)}` : "—"} />
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">Pipeline</h2>
          {!pipelineLoaded ? (
            <p className="text-sm text-[var(--text-muted)]">Loading…</p>
          ) : pipeline.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No startups in your pipeline yet. Add them from your matches below.</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {PIPELINE_STAGES.map((stage) => {
                const rows = pipeline.filter((r) => r.stage === stage);
                return (
                  <div key={stage} className="flex flex-col gap-2 rounded-[var(--radius)] bg-[var(--overlay-3)] p-3">
                    <span className={eyebrow}>
                      {STAGE_LABELS[stage]} · {rows.length}
                    </span>
                    {rows.map((row) => (
                      <div key={row.id} className="flex flex-col gap-1.5 rounded-[10px] border border-[var(--border)] bg-[var(--bg-card)] p-2.5">
                        <Link href={`/investor/startups/${row.founder_user_id}`} className="truncate text-sm font-semibold text-[var(--text)] hover:underline">
                          {row.company_name ?? "Founder"}
                        </Link>
                        {row.angel_score != null && <span className="text-xs text-[var(--text-muted)]">Angel Score {row.angel_score}</span>}
                        <div className="flex items-center gap-2">
                          <label className="sr-only" htmlFor={`stage-${row.id}`}>
                            Stage for {row.company_name ?? "founder"}
                          </label>
                          <select
                            id={`stage-${row.id}`}
                            value={row.stage}
                            onChange={(e) => void updateStage(row.id, e.target.value)}
                            className="min-w-0 flex-1 rounded-lg border border-[var(--overlay-12)] bg-[var(--bg)] px-1.5 py-1 text-xs text-[var(--text)]"
                          >
                            {PIPELINE_STAGES.map((s) => (
                              <option key={s} value={s}>
                                {STAGE_LABELS[s]}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => void removeFromPipeline(row.id)}
                            aria-label={`Remove ${row.company_name ?? "founder"} from pipeline`}
                            className="text-xs text-[var(--text-muted)] hover:text-[var(--danger)]"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <KevinMatchFeed token={token} role="investor" onAddToPipeline={(id) => void addToPipeline(id)} />
      </section>
    </main>
  );
}
