"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { API_BASE, authJsonHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { acceptedPeerUserIds, type ConnectListsResponse } from "@/lib/connectionsHandshake";
import { LogoTile } from "@/components/LogoTile";

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
  logo_url?: string | null;
};

/** Rows from GET /kevin-matches/received-intros (an investor asked to connect with this founder). */
type ReceivedConnect = {
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
  founder_email: string;
  intro_accepted_at: string | null;
  intro_passed_at: string | null;
  logo_url?: string | null;
};

type IntroSuggestion = {
  id: string;
  matched_user_id: string;
  fit_score: number;
  fit_reason: string;
  draft_message: string;
  firm_name: string | null;
  investor_email: string;
};

type ReviewSummary = { investor_user_id: string; review_count: number; avg_stars: number | null };

type Tab = "foryou" | "requests" | "sent";
const PAGE_SIZE = 10;

const card = "rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] shadow-[var(--card-shadow)]";
const btn =
  "inline-flex min-h-10 items-center justify-center rounded-[10px] border border-[var(--overlay-12)] px-4 text-[13px] font-medium text-[var(--text)] hover:bg-[var(--overlay-4)] disabled:cursor-not-allowed disabled:opacity-50";
const btnPrimary =
  "inline-flex min-h-10 items-center justify-center rounded-[10px] bg-metatron-accent px-4 text-[13px] font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-50";

function requesterName(r: ReceivedConnect) {
  return r.firm_name?.trim() || r.company_name?.trim() || r.founder_email;
}

function Fit({ score }: { score: number }) {
  return <span className="rounded-lg bg-[var(--good-bg)] px-2 py-0.5 font-mono text-xs text-[var(--good)]">{score}% fit</span>;
}

function StartupMatchesPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { token, loading } = useAuth("STARTUP");
  const initialTab = (["foryou", "requests", "sent"] as const).find((t) => t === searchParams.get("tab")) ?? "foryou";
  const [tab, setTabRaw] = useState<Tab>(initialTab);
  const [matches, setMatches] = useState<KevinMatch[]>([]);
  const [fetching, setFetching] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE_SIZE);
  // Weekly match emails link to ?focus=<match id>: open that match and scroll to it.
  const focus = searchParams.get("focus");
  const [open, setOpen] = useState<string | null>(focus);
  const focused = useRef(false);
  const [received, setReceived] = useState<ReceivedConnect[]>([]);
  const [suggestions, setSuggestions] = useState<IntroSuggestion[]>([]);
  const [expandedSuggestion, setExpandedSuggestion] = useState<string | null>(null);
  const [acceptedPeerIds, setAcceptedPeerIds] = useState<Set<string>>(new Set());
  const [ratings, setRatings] = useState<Record<string, ReviewSummary>>({});

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

  const loadReceived = useCallback(async () => {
    if (!token) return;
    const res = await fetch(`${API_BASE}/kevin-matches/received-intros`, { headers: authJsonHeaders(token) }).catch(() => null);
    if (res?.ok) setReceived((await res.json()) as ReceivedConnect[]);
  }, [token]);

  const load = useCallback(async () => {
    if (!token) return;
    setFetching(true);
    try {
      // POST returns the cached batch, or generates a fresh one when it's due.
      const res = await fetch(`${API_BASE}/kevin-matches`, { method: "POST", headers: authJsonHeaders(token) });
      if (res.ok) setMatches((await res.json()) as KevinMatch[]);
      else setMsg("Could not load matches.");
    } catch {
      setMsg("Could not load matches.");
    } finally {
      setFetching(false);
    }
  }, [token]);

  useEffect(() => {
    if (loading || !token) return;
    void load();
    void loadConnections();
    void loadReceived();
    fetch(`${API_BASE}/kevin-matches/suggestions`, { headers: authJsonHeaders(token) })
      .then((r) => (r.ok ? (r.json() as Promise<IntroSuggestion[]>) : []))
      .then(setSuggestions)
      .catch(() => {});
    fetch(`${API_BASE}/investor-profile/review-summaries`, { headers: authJsonHeaders(token) })
      .then((r) => (r.ok ? (r.json() as Promise<ReviewSummary[]>) : []))
      .then((list) => setRatings(Object.fromEntries(list.map((x) => [x.investor_user_id, x]))))
      .catch(() => {});
  }, [loading, token, load, loadConnections, loadReceived]);

  useEffect(() => {
    if (!focus || focused.current || matches.length === 0) return;
    const m = matches.find((x) => x.id === focus);
    if (!m) return;
    focused.current = true;
    if (m.intro_requested_at) setTabRaw("sent");
    const i = (m.intro_requested_at ? matches.filter((x) => x.intro_requested_at) : matches.filter((x) => !x.intro_requested_at)).indexOf(m);
    if (i >= PAGE_SIZE) setShown(i + 1);
    requestAnimationFrame(() => document.getElementById(`match-${focus}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }, [focus, matches]);

  const forYou = useMemo(() => matches.filter((m) => !m.intro_requested_at), [matches]);
  const sent = useMemo(() => matches.filter((m) => m.intro_requested_at), [matches]);
  const openRequests = useMemo(() => received.filter((r) => !r.intro_accepted_at && !r.intro_passed_at), [received]);
  const answeredRequests = useMemo(() => received.filter((r) => r.intro_accepted_at || r.intro_passed_at), [received]);

  async function post(path: string, key: string): Promise<Response | null> {
    if (!token) return null;
    setBusy(key);
    setMsg(null);
    try {
      return await fetch(`${API_BASE}${path}`, { method: "POST", headers: authJsonHeaders(token) });
    } catch {
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function requestIntro(m: KevinMatch) {
    const res = await post(`/kevin-matches/${m.id}/request-intro`, m.id);
    if (!res?.ok) {
      setMsg((await res?.text())?.trim() || "Request failed.");
      return;
    }
    setMsg(`Connect request sent to ${m.firm_name ?? "the investor"}.`);
    setMatches((prev) => prev.map((x) => (x.id === m.id ? { ...x, intro_requested_at: new Date().toISOString() } : x)));
    void loadConnections();
  }

  async function answer(r: ReceivedConnect, accept: boolean) {
    const res = await post(`/kevin-matches/${r.id}/${accept ? "accept-intro" : "pass-intro"}`, r.id);
    if (!res?.ok) return;
    const ts = new Date().toISOString();
    setReceived((prev) => prev.map((x) => (x.id === r.id ? (accept ? { ...x, intro_accepted_at: ts } : { ...x, intro_passed_at: ts }) : x)));
    void loadConnections();
    if (accept) void load();
  }

  async function suggestion(s: IntroSuggestion, approve: boolean) {
    const res = await post(`/kevin-matches/suggestions/${s.id}/${approve ? "approve" : "decline"}`, s.id);
    if (!res?.ok) {
      if (approve) setMsg(`Could not send intro: ${(await res?.text()) ?? ""}`.trim());
      return;
    }
    setSuggestions((prev) => prev.filter((x) => x.id !== s.id));
    if (approve) setMsg("Intro sent. The investor will hear from Kevin.");
  }

  function message(userId: string, name: string) {
    window.dispatchEvent(new CustomEvent("metatron:open-chat", { detail: { userId, name } }));
  }

  if (loading || !token) return null;

  function matchRow(m: KevinMatch) {
    const firm = m.firm_name ?? "Independent investor";
    const connected = Boolean(m.matched_user_id && acceptedPeerIds.has(m.matched_user_id));
    const rating = m.matched_user_id ? ratings[m.matched_user_id] : undefined;
    const meta = [m.sector, m.stage, m.country].filter(Boolean).join(" · ");
    const expanded = open === m.id;
    return (
      <article key={m.id} id={`match-${m.id}`} className={`${card} flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center ${focus === m.id ? "border-metatron-accent/50" : ""}`}>
        <LogoTile name={firm} url={m.logo_url} />
        <div className="flex min-w-0 flex-1 basis-72 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2.5">
            {m.matched_user_id ? (
              <Link href={`/startup/investors/${m.matched_user_id}`} className="text-base font-semibold text-[var(--text)] hover:underline">
                {firm}
              </Link>
            ) : (
              <span className="text-base font-semibold">{firm}</span>
            )}
            <Fit score={m.score} />
            <span className="text-[13px] text-[var(--text-muted)]">
              {rating?.avg_stars != null ? (
                <>
                  <span className="text-[var(--star)]">★</span> {rating.avg_stars.toFixed(1)} · {rating.review_count} founder review{rating.review_count === 1 ? "" : "s"}
                </>
              ) : m.matched_user_id ? (
                "No reviews yet"
              ) : (
                "From a connector's network"
              )}
            </span>
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
          {connected ? (
            <button type="button" className={btnPrimary} onClick={() => message(m.matched_user_id!, firm)}>
              Message
            </button>
          ) : m.intro_requested_at ? (
            <span className="inline-flex min-h-10 items-center rounded-[10px] bg-[var(--warn-bg)] px-3 text-[13px] text-[var(--warn)]">Requested</span>
          ) : (
            <button type="button" className={btnPrimary} disabled={busy === m.id} onClick={() => void requestIntro(m)}>
              {busy === m.id ? "Sending…" : "Connect"}
            </button>
          )}
        </div>
      </article>
    );
  }

  const tabs: [Tab, string, number, boolean][] = [
    ["foryou", "For you", forYou.length, false],
    ["requests", "Requests", openRequests.length, openRequests.length > 0],
    ["sent", "Sent", sent.length, false],
  ];

  const list = tab === "foryou" ? forYou : sent;

  return (
    <main className="min-w-0 flex-1 text-[var(--text)]">
      <section className="mx-auto flex max-w-5xl flex-col gap-5 p-6 md:p-10">
        <header className="flex flex-col gap-1.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">Matches</span>
          <h1 className="text-[28px] font-semibold tracking-tight">Investors Kevin picked for you</h1>
          <p className="text-sm text-[var(--text-muted)]">Ranked by fit with your pitch. To search every investor, use Browse Investors.</p>
        </header>

        {suggestions.length > 0 && (
          <section className={`${card} flex flex-col gap-3 border-metatron-accent/40 bg-metatron-accent/[0.06] p-5`}>
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--accent-fg)]">
              Kevin suggests {suggestions.length === 1 ? "an intro" : `${suggestions.length} intros`}
            </span>
            {suggestions.map((s) => {
              const expanded = expandedSuggestion === s.id;
              return (
                <div key={s.id} className="flex flex-col gap-2 border-t border-[var(--border)] pt-3 first:border-t-0 first:pt-0">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong>{s.firm_name || s.investor_email}</strong>
                        <Fit score={s.fit_score} />
                      </div>
                      <p className="mt-1 text-sm text-[var(--text-muted)]">{s.fit_reason}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button type="button" className={btn} aria-expanded={expanded} onClick={() => setExpandedSuggestion(expanded ? null : s.id)}>
                        {expanded ? "Hide message" : "Preview message"}
                      </button>
                      <button type="button" className={btn} disabled={busy === s.id} onClick={() => void suggestion(s, false)}>
                        Pass
                      </button>
                      <button type="button" className={btnPrimary} disabled={busy === s.id} onClick={() => void suggestion(s, true)}>
                        {busy === s.id ? "Sending…" : "Send intro"}
                      </button>
                    </div>
                  </div>
                  {expanded && <p className="whitespace-pre-wrap rounded-[10px] bg-[var(--overlay-4)] p-3 text-sm leading-relaxed">{s.draft_message}</p>}
                </div>
              );
            })}
          </section>
        )}

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

        {tab === "requests" ? (
          <div className="flex flex-col gap-3">
            {openRequests.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No requests waiting. When an investor wants to connect, it shows here.</p>
            ) : (
              openRequests.map((r) => {
                const name = requesterName(r);
                const meta = [r.sector, r.stage, r.country].filter(Boolean).join(" · ");
                return (
                  <article key={r.id} className={`${card} flex flex-col gap-3 border-metatron-accent/40 p-4 sm:flex-row sm:flex-wrap sm:items-center`}>
                    <LogoTile name={name} url={r.logo_url} accent />
                    <div className="flex min-w-0 flex-1 basis-72 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <Link href={`/startup/investors/${r.for_user_id}`} className="text-base font-semibold text-[var(--text)] hover:underline">
                          {name} wants to connect
                        </Link>
                        <Fit score={r.score} />
                      </div>
                      {meta && <span className="text-[13px] text-[var(--text-muted)]">{meta}</span>}
                      {r.reasoning && <span className="text-sm text-[var(--text-muted)]">{r.reasoning}</span>}
                    </div>
                    <div className="flex flex-wrap gap-2">
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
            {answeredRequests.length > 0 && (
              <section className={`${card} flex flex-col p-4`}>
                <h2 className="mb-1 text-sm font-semibold">Answered</h2>
                {answeredRequests.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] py-2.5 text-sm first:border-t-0">
                    <span>{requesterName(r)}</span>
                    {r.intro_accepted_at ? (
                      <button type="button" className="text-[13px] text-[var(--accent-fg)] hover:underline" onClick={() => message(r.for_user_id, requesterName(r))}>
                        Accepted · Message
                      </button>
                    ) : (
                      <span className="text-[13px] text-[var(--text-muted)]">Declined</span>
                    )}
                  </div>
                ))}
              </section>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {fetching && matches.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">Kevin is finding your matches…</p>
            ) : list.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">
                {tab === "sent"
                  ? "You haven't sent any connect requests yet. Connect with a match on the For you tab."
                  : matches.length === 0
                    ? "No matches yet. Complete your Startup Profile (sector and stage) so Kevin can match you."
                    : "You've reached out to every match. Kevin sends new ones as your batch refreshes."}
              </p>
            ) : (
              <>
                {list.slice(0, shown).map(matchRow)}
                {list.length > shown && (
                  <button type="button" className={`${btn} self-center`} onClick={() => setShown((n) => n + PAGE_SIZE)}>
                    Show more ({list.length - shown} left)
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

export default function StartupMatchesPage() {
  return (
    <Suspense fallback={null}>
      <StartupMatchesPageInner />
    </Suspense>
  );
}
