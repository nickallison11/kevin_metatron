"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { API_BASE, authJsonHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { acceptedPeerUserIds, type ConnectListsResponse } from "@/lib/connectionsHandshake";

type KevinMatch = {
  id: string;
  matched_user_id: string | null;
  match_type: string;
  score: number;
  reasoning: string | null;
  generated_at: string;
  firm_name: string | null;
  company_name: string | null;
  one_liner: string | null;
  stage: string | null;
  sector: string | null;
  country: string | null;
  angel_score: number | null;
  intro_requested_at: string | null;
  deck_url: string | null;
};

type ReceivedIntro = {
  id: string;
  for_user_id: string;
  score: number;
  reasoning: string | null;
  intro_requested_at: string;
  company_name: string | null;
  firm_name: string | null;
  one_liner: string | null;
  stage: string | null;
  sector: string | null;
  country: string | null;
  angel_score: number | null;
  founder_email: string;
  deck_url: string | null;
  deck_viewed_at: string | null;
  intro_accepted_at: string | null;
  intro_passed_at: string | null;
};

type Followed = {
  user_id: string;
  company_name?: string | null;
  one_liner?: string | null;
  stage?: string | null;
  sector?: string | null;
  country?: string | null;
  pitch_deck_url?: string | null;
};

type Tab = "foryou" | "requests" | "following";
const PAGE_SIZE = 10;

const card = "rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] shadow-[var(--card-shadow)]";
const btn =
  "inline-flex min-h-10 items-center justify-center rounded-[10px] border border-[var(--overlay-12)] px-4 text-[13px] font-medium text-[var(--text)] hover:bg-[var(--overlay-4)] disabled:cursor-not-allowed disabled:opacity-50";
const btnPrimary =
  "inline-flex min-h-10 items-center justify-center rounded-[10px] bg-metatron-accent px-4 text-[13px] font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-50";

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

function ago(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

function Fit({ score }: { score: number }) {
  return <span className="rounded-lg bg-[var(--good-bg)] px-2 py-0.5 font-mono text-xs text-[var(--good)]">{score}% fit</span>;
}

function Tile({ name }: { name: string }) {
  return (
    <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-metatron-accent/15 text-sm font-semibold text-[var(--accent-fg)]">
      {initials(name)}
    </span>
  );
}

function InvestorMatchesPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { token, loading } = useAuth("INVESTOR");
  const initialTab = (["foryou", "requests", "following"] as const).find((t) => t === searchParams.get("tab")) ??
    // Old links used ?tab=intros for requests and ?tab=matches for matches.
    (searchParams.get("tab") === "intros" ? "requests" : "foryou");
  const [tab, setTabRaw] = useState<Tab>(initialTab);
  const [matches, setMatches] = useState<KevinMatch[]>([]);
  const [intros, setIntros] = useState<ReceivedIntro[]>([]);
  const [following, setFollowing] = useState<Followed[] | null>(null);
  const [fetching, setFetching] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [open, setOpen] = useState<string | null>(null);
  const [acceptedPeerIds, setAcceptedPeerIds] = useState<Set<string>>(new Set());

  function setTab(t: Tab) {
    setTabRaw(t);
    setShown(PAGE_SIZE);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", t);
    params.delete("page");
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  const loadConnections = useCallback(async () => {
    if (!token) return;
    const res = await fetch(`${API_BASE}/connections`, { headers: authJsonHeaders(token) }).catch(() => null);
    if (res?.ok) setAcceptedPeerIds(acceptedPeerUserIds((await res.json()) as ConnectListsResponse));
  }, [token]);

  const loadFollowing = useCallback(async () => {
    if (!token) return;
    const res = await fetch(`${API_BASE}/connections/following`, { headers: authJsonHeaders(token) }).catch(() => null);
    setFollowing(res?.ok ? ((await res.json()) as Followed[]) : []);
  }, [token]);

  useEffect(() => {
    if (loading || !token) return;
    void (async () => {
      try {
        const [m, i] = await Promise.all([
          fetch(`${API_BASE}/kevin-matches`, { method: "POST", headers: authJsonHeaders(token) }),
          fetch(`${API_BASE}/kevin-matches/received-intros`, { headers: authJsonHeaders(token) }),
        ]);
        if (m.ok) setMatches((await m.json()) as KevinMatch[]);
        if (i.ok) setIntros((await i.json()) as ReceivedIntro[]);
      } catch {
        setMsg("Could not load matches.");
      } finally {
        setFetching(false);
      }
    })();
    void loadConnections();
    void loadFollowing();
  }, [loading, token, loadConnections, loadFollowing]);

  const openRequests = useMemo(() => intros.filter((r) => !r.intro_accepted_at && !r.intro_passed_at), [intros]);
  const answered = useMemo(() => intros.filter((r) => r.intro_accepted_at || r.intro_passed_at), [intros]);
  const followedIds = useMemo(() => new Set((following ?? []).map((f) => f.user_id)), [following]);

  async function post(path: string, key: string, body?: unknown): Promise<Response | null> {
    if (!token) return null;
    setBusy(key);
    setMsg(null);
    try {
      return await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: authJsonHeaders(token),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      return null;
    } finally {
      setBusy(null);
    }
  }

  function viewDeck(r: ReceivedIntro) {
    if (!token || !r.deck_url) return;
    // Open first so the browser doesn't block the tab, then log the view for the founder.
    window.open(r.deck_url, "_blank", "noopener");
    void fetch(`${API_BASE}/kevin-matches/${r.id}/view-deck`, { method: "POST", headers: authJsonHeaders(token) }).catch(() => {});
    setIntros((prev) => prev.map((x) => (x.id === r.id ? { ...x, deck_viewed_at: new Date().toISOString() } : x)));
  }

  async function answer(r: ReceivedIntro, accept: boolean) {
    const res = await post(`/kevin-matches/${r.id}/${accept ? "accept-intro" : "pass-intro"}`, r.id);
    if (!res?.ok) return;
    const ts = new Date().toISOString();
    setIntros((prev) => prev.map((x) => (x.id === r.id ? (accept ? { ...x, intro_accepted_at: ts } : { ...x, intro_passed_at: ts }) : x)));
    void loadConnections();
  }

  async function connect(m: KevinMatch) {
    const res = await post(`/kevin-matches/${m.id}/request-intro`, m.id);
    if (!res?.ok) {
      setMsg((await res?.text())?.trim() || "Request failed.");
      return;
    }
    setMatches((prev) => prev.map((x) => (x.id === m.id ? { ...x, intro_requested_at: new Date().toISOString() } : x)));
    setMsg(`Connect request sent to ${m.company_name ?? "the founder"}.`);
    void loadConnections();
  }

  async function follow(m: KevinMatch) {
    if (!m.matched_user_id) return;
    const res = await post("/connections", m.id + "follow", { connection_type: "follow", to_user_id: m.matched_user_id });
    if (res?.ok) void loadFollowing();
  }

  function message(userId: string, name: string) {
    window.dispatchEvent(new CustomEvent("metatron:open-chat", { detail: { userId, name } }));
  }

  if (loading || !token) return null;

  function matchRow(m: KevinMatch) {
    const company = m.company_name ?? "Startup";
    const connected = Boolean(m.matched_user_id && acceptedPeerIds.has(m.matched_user_id));
    const isFollowing = Boolean(m.matched_user_id && followedIds.has(m.matched_user_id));
    const meta = [m.sector, m.stage, m.country].filter(Boolean).join(" · ");
    const expanded = open === m.id;
    return (
      <article key={m.id} className={`${card} flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center`}>
        <Tile name={company} />
        <div className="flex min-w-0 flex-1 basis-72 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2.5">
            {m.matched_user_id ? (
              <Link href={`/investor/startups/${m.matched_user_id}`} className="text-base font-semibold text-[var(--text)] hover:underline">
                {company}
              </Link>
            ) : (
              <span className="text-base font-semibold">{company}</span>
            )}
            <Fit score={m.score} />
            {m.angel_score != null && <span className="text-[13px] text-[var(--text-muted)]">Angel Score {m.angel_score}</span>}
          </div>
          {meta && <span className="text-[13px] text-[var(--text-muted)]">{meta}</span>}
          {m.one_liner && <span className="text-sm text-[var(--text-muted)]">{m.one_liner}</span>}
          {expanded && m.reasoning && (
            <div className="mt-1 rounded-[10px] bg-metatron-accent/[0.07] p-3">
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--accent-fg)]">Why Kevin matched you</span>
              <p className="mt-1 text-sm leading-relaxed">{m.reasoning}</p>
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {m.reasoning && (
            <button type="button" className={btn} aria-expanded={expanded} onClick={() => setOpen(expanded ? null : m.id)}>
              {expanded ? "Hide why" : "Why this match"}
            </button>
          )}
          {m.deck_url && (
            <a href={m.deck_url} target="_blank" rel="noopener noreferrer" className={btn}>
              View deck
            </a>
          )}
          {m.matched_user_id && !connected && (
            <button type="button" className={btn} disabled={isFollowing || busy === m.id + "follow"} onClick={() => void follow(m)}>
              {isFollowing ? "Following" : "Follow"}
            </button>
          )}
          {connected ? (
            <button type="button" className={btnPrimary} onClick={() => message(m.matched_user_id!, company)}>
              Message
            </button>
          ) : m.intro_requested_at ? (
            <span className="inline-flex min-h-10 items-center rounded-[10px] bg-[var(--warn-bg)] px-3 text-[13px] text-[var(--warn)]">Requested</span>
          ) : (
            <button type="button" className={btnPrimary} disabled={busy === m.id} onClick={() => void connect(m)}>
              {busy === m.id ? "Sending…" : "Connect"}
            </button>
          )}
        </div>
      </article>
    );
  }

  const tabs: [Tab, string, number, boolean][] = [
    ["foryou", "For you", matches.length, false],
    ["requests", "Requests", openRequests.length, openRequests.length > 0],
    ["following", "Following", following?.length ?? 0, false],
  ];

  return (
    <main className="min-w-0 flex-1 text-[var(--text)]">
      <section className="mx-auto flex max-w-5xl flex-col gap-5 p-6 md:p-10">
        <header className="flex flex-col gap-1.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">Matches</span>
          <h1 className="text-[28px] font-semibold tracking-tight">Startups Kevin picked for you</h1>
          <p className="text-sm text-[var(--text-muted)]">Ranked by fit with your thesis, stage and cheque size. To search every startup, use Browse Startups.</p>
        </header>

        <div role="tablist" aria-label="Matches" className="flex gap-1 overflow-x-auto border-b border-[var(--border)]">
          {tabs.map(([id, label, n, badge]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`-mb-px flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3.5 text-sm font-medium ${
                tab === id ? "border-metatron-accent text-[var(--text)]" : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              {label}
              <span className={badge ? "rounded-full bg-metatron-accent px-1.5 text-[11px] font-semibold text-white" : "text-[12px] text-[var(--text-muted)]"}>{n}</span>
            </button>
          ))}
        </div>

        {msg && (
          <p role="status" className="rounded-[10px] border border-[var(--border)] px-3.5 py-2.5 text-sm text-[var(--text-muted)]">
            {msg}
          </p>
        )}

        {tab === "foryou" && (
          <div className="flex flex-col gap-3">
            {fetching && matches.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">Kevin is finding your matches…</p>
            ) : matches.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No matches yet. Add your stages, sectors and cheque size on Investor Profile so Kevin can match you.</p>
            ) : (
              <>
                {matches.slice(0, shown).map(matchRow)}
                {matches.length > shown && (
                  <button type="button" className={`${btn} self-center`} onClick={() => setShown((n) => n + PAGE_SIZE)}>
                    Show more ({matches.length - shown} left)
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {tab === "requests" && (
          <div className="flex flex-col gap-3">
            {openRequests.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No requests waiting. Kevin will tell you when a founder asks for an intro.</p>
            ) : (
              openRequests.map((r) => {
                const company = r.company_name || r.founder_email;
                const meta = [r.sector, r.stage, r.country, `requested ${ago(r.intro_requested_at)}`].filter(Boolean).join(" · ");
                return (
                  <article key={r.id} className={`${card} flex flex-col gap-3 border-metatron-accent/40 p-4 sm:flex-row sm:flex-wrap sm:items-center`}>
                    <Tile name={company} />
                    <div className="flex min-w-0 flex-1 basis-72 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <Link href={`/investor/startups/${r.for_user_id}`} className="text-base font-semibold text-[var(--text)] hover:underline">
                          {company}
                        </Link>
                        <Fit score={r.score} />
                        {r.angel_score != null && <span className="text-[13px] text-[var(--text-muted)]">Angel Score {r.angel_score}</span>}
                      </div>
                      <span className="text-[13px] text-[var(--text-muted)]">{meta}</span>
                      {r.one_liner && <span className="text-sm text-[var(--text-muted)]">{r.one_liner}</span>}
                      {r.reasoning && <span className="text-sm text-[var(--text-muted)]">{r.reasoning}</span>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {r.deck_url && (
                        <button type="button" className={btn} onClick={() => viewDeck(r)}>
                          {r.deck_viewed_at ? "View deck again" : "View deck"}
                        </button>
                      )}
                      <button type="button" className={btn} disabled={busy === r.id} onClick={() => void answer(r, false)}>
                        Decline
                      </button>
                      <button type="button" className={btnPrimary} disabled={busy === r.id} onClick={() => void answer(r, true)}>
                        Accept
                      </button>
                    </div>
                  </article>
                );
              })
            )}
            {answered.length > 0 && (
              <section className={`${card} flex flex-col p-4`}>
                <h2 className="mb-1 text-sm font-semibold">Answered</h2>
                {answered.map((r) => {
                  const company = r.company_name || r.founder_email;
                  return (
                    <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] py-2.5 text-sm first:border-t-0">
                      <Link href={`/investor/startups/${r.for_user_id}`} className="hover:underline">
                        {company}
                      </Link>
                      {r.intro_accepted_at ? (
                        <button type="button" className="text-[13px] text-[var(--accent-fg)] hover:underline" onClick={() => message(r.for_user_id, company)}>
                          Accepted · Message
                        </button>
                      ) : (
                        <span className="text-[13px] text-[var(--text-muted)]">Declined</span>
                      )}
                    </div>
                  );
                })}
              </section>
            )}
          </div>
        )}

        {tab === "following" && (
          <div className="flex flex-col gap-3">
            {following === null ? (
              <p className="text-sm text-[var(--text-muted)]">Loading…</p>
            ) : following.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">
                Follow startups from your matches or{" "}
                <Link href="/investor/startups" className="text-[var(--accent-fg)] hover:underline">
                  Browse Startups
                </Link>{" "}
                to keep an eye on them here.
              </p>
            ) : (
              following.map((f) => {
                const company = f.company_name ?? "Startup";
                const meta = [f.sector, f.stage, f.country].filter(Boolean).join(" · ");
                const connected = acceptedPeerIds.has(f.user_id);
                return (
                  <article key={f.user_id} className={`${card} flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center`}>
                    <Tile name={company} />
                    <div className="flex min-w-0 flex-1 basis-72 flex-col gap-1">
                      <Link href={`/investor/startups/${f.user_id}`} className="text-base font-semibold text-[var(--text)] hover:underline">
                        {company}
                      </Link>
                      {meta && <span className="text-[13px] text-[var(--text-muted)]">{meta}</span>}
                      {f.one_liner && <span className="text-sm text-[var(--text-muted)]">{f.one_liner}</span>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {f.pitch_deck_url && (
                        <a href={f.pitch_deck_url} target="_blank" rel="noopener noreferrer" className={btn}>
                          View deck
                        </a>
                      )}
                      {connected ? (
                        <button type="button" className={btnPrimary} onClick={() => message(f.user_id, company)}>
                          Message
                        </button>
                      ) : (
                        <Link href={`/investor/startups/${f.user_id}`} className={btnPrimary}>
                          View
                        </Link>
                      )}
                    </div>
                  </article>
                );
              })
            )}
          </div>
        )}
      </section>
    </main>
  );
}

export default function InvestorMatchesPage() {
  return (
    <Suspense fallback={null}>
      <InvestorMatchesPageInner />
    </Suspense>
  );
}
