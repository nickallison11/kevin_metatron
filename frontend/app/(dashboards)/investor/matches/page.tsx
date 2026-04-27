"use client";

import { useCallback, useEffect, useState } from "react";
import { API_BASE, authJsonHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";

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

const PAGE_SIZE = 10;

const scoreBadgeColor = (score: number) => {
  if (score >= 85) return "bg-[rgba(0,200,100,0.12)] text-green-400";
  if (score >= 70) return "bg-[rgba(108,92,231,0.15)] text-[#6c5ce7]";
  return "bg-[rgba(255,255,255,0.06)] text-[var(--text-muted)]";
};

export default function InvestorMatchesPage() {
  const { token, loading } = useAuth();
  const [tab, setTab] = useState<"matches" | "intros">("intros");
  const [matches, setMatches] = useState<KevinMatch[]>([]);
  const [intros, setIntros] = useState<ReceivedIntro[]>([]);
  const [fetching, setFetching] = useState(false);
  const [page, setPage] = useState(1);
  const [viewingMatch, setViewingMatch] = useState<KevinMatch | null>(null);
  const [viewingIntro, setViewingIntro] = useState<ReceivedIntro | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [matchView, setMatchView] = useState<"list" | "card">("list");
  const [followedIds, setFollowedIds] = useState<Set<string>>(new Set());
  const [requestedIntroIds, setRequestedIntroIds] = useState<Set<string>>(new Set());

  const loadMatches = useCallback(async () => {
    if (!token) return;
    setFetching(true);
    try {
      const res = await fetch(`${API_BASE}/kevin-matches`, {
        method: "POST",
        headers: authJsonHeaders(token),
      });
      if (res.ok) setMatches(await res.json());
    } catch {
      /* ignore */
    } finally {
      setFetching(false);
    }
  }, [token]);

  const loadIntros = useCallback(async () => {
    if (!token) return;
    setFetching(true);
    try {
      const res = await fetch(`${API_BASE}/kevin-matches/received-intros`, {
        headers: authJsonHeaders(token),
      });
      if (res.ok) setIntros(await res.json());
    } catch {
      /* ignore */
    } finally {
      setFetching(false);
    }
  }, [token]);

  useEffect(() => {
    if (loading || !token) return;
    void loadIntros();
    void loadMatches();
  }, [loading, token, loadIntros, loadMatches]);

  async function viewDeck(r: ReceivedIntro) {
    if (!token || !r.deck_url) return;
    setActionBusy(r.id + "deck");
    try {
      const res = await fetch(`${API_BASE}/kevin-matches/${r.id}/view-deck`, {
        method: "POST",
        headers: authJsonHeaders(token),
      });
      if (res.ok) {
        const ts = new Date().toISOString();
        setIntros((prev) => prev.map((i) => (i.id === r.id ? { ...i, deck_viewed_at: ts } : i)));
        setViewingIntro((prev) => (prev?.id === r.id ? { ...prev, deck_viewed_at: ts } : prev));
      }
    } finally {
      setActionBusy(null);
    }
    window.open(r.deck_url, "_blank");
  }

  async function acceptIntro(r: ReceivedIntro) {
    if (!token) return;
    setActionBusy(r.id + "accept");
    try {
      const res = await fetch(`${API_BASE}/kevin-matches/${r.id}/accept-intro`, {
        method: "POST",
        headers: authJsonHeaders(token),
      });
      if (res.ok) {
        const ts = new Date().toISOString();
        setIntros((prev) => prev.map((i) => (i.id === r.id ? { ...i, intro_accepted_at: ts } : i)));
        setViewingIntro((prev) => (prev?.id === r.id ? { ...prev, intro_accepted_at: ts } : prev));
      }
    } finally {
      setActionBusy(null);
    }
  }

  async function passIntro(r: ReceivedIntro) {
    if (!token) return;
    setActionBusy(r.id + "pass");
    try {
      const res = await fetch(`${API_BASE}/kevin-matches/${r.id}/pass-intro`, {
        method: "POST",
        headers: authJsonHeaders(token),
      });
      if (res.ok) {
        const ts = new Date().toISOString();
        setIntros((prev) => prev.map((i) => (i.id === r.id ? { ...i, intro_passed_at: ts } : i)));
        setViewingIntro((prev) => (prev?.id === r.id ? { ...prev, intro_passed_at: ts } : prev));
      }
    } finally {
      setActionBusy(null);
    }
  }

  async function followFounder(m: KevinMatch) {
    if (!token || !m.matched_user_id) return;
    setActionBusy(m.id + "follow");
    try {
      const res = await fetch(`${API_BASE}/connections`, {
        method: "POST",
        headers: authJsonHeaders(token),
        body: JSON.stringify({ connection_type: "follow", to_user_id: m.matched_user_id }),
      });
      if (res.ok) {
        setFollowedIds((prev) => new Set([...prev, m.id]));
      }
    } finally {
      setActionBusy(null);
    }
  }

  async function requestMatchIntro(m: KevinMatch) {
    if (!token) return;
    setActionBusy(m.id + "intro");
    try {
      const res = await fetch(`${API_BASE}/kevin-matches/${m.id}/request-intro`, {
        method: "POST",
        headers: authJsonHeaders(token),
      });
      if (res.ok) {
        setRequestedIntroIds((prev) => new Set([...prev, m.id]));
        setMatches((prev) =>
          prev.map((x) =>
            x.id === m.id ? { ...x, intro_requested_at: new Date().toISOString() } : x
          )
        );
      }
    } finally {
      setActionBusy(null);
    }
  }

  const activeItems = tab === "intros" ? intros : matches;
  const totalPages = Math.max(1, Math.ceil(activeItems.length / PAGE_SIZE));
  const paginated = activeItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (loading || !token) return null;

  return (
    <main className="flex-1 text-[var(--text)]">
      <div className="space-y-6 px-6 py-6 md:px-10">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--text)]">Startup Matches</h1>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              {intros.length} intro request{intros.length !== 1 ? "s" : ""} · {matches.length} Kevin match
              {matches.length !== 1 ? "es" : ""}
            </p>
          </div>
          <div className="flex gap-1">
            {(["intros", "matches"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTab(t);
                  setPage(1);
                }}
                className={`px-3 py-1 rounded-lg text-xs font-medium ${
                  tab === t
                    ? "bg-[rgba(108,92,231,0.2)] text-[#6c5ce7]"
                    : "text-[var(--text-muted)] hover:text-[var(--text)]"
                }`}
              >
                {t === "intros"
                  ? `Intro Requests${intros.length > 0 ? ` (${intros.length})` : ""}`
                  : "Kevin's Matches"}
              </button>
            ))}
          </div>
        </div>

        {fetching && activeItems.length === 0 && (
          <p className="text-sm text-[var(--text-muted)]">Loading…</p>
        )}

        {!fetching && tab === "intros" && intros.length === 0 && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-6 text-center">
            <p className="text-sm text-[var(--text-muted)]">
              No intro requests yet. When founders request introductions through Kevin, they&apos;ll appear here.
            </p>
          </div>
        )}

        {!fetching && tab === "matches" && matches.length === 0 && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-6 text-center">
            <p className="text-sm text-[var(--text-muted)]">
              No matches yet. Complete your investor profile (sectors and stages) to get your first batch.
            </p>
          </div>
        )}

        {tab === "intros" && intros.length > 0 && (
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[var(--text-muted)] text-xs border-b border-[var(--border)]">
                    <th className="text-left pb-2 pr-3">Founder / Company</th>
                    <th className="text-left pb-2 pr-3">Sector</th>
                    <th className="text-left pb-2 pr-3">Stage</th>
                    <th className="text-left pb-2 pr-3">Fit</th>
                    <th className="text-left pb-2 pr-3">Requested</th>
                    <th className="text-left pb-2" />
                  </tr>
                </thead>
                <tbody>
                  {(paginated as ReceivedIntro[]).map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => setViewingIntro(r)}
                      className="border-b border-[rgba(255,255,255,0.03)] cursor-pointer transition-colors hover:bg-[rgba(108,92,231,0.04)]"
                    >
                      <td className="py-2.5 pr-3">
                        <p className="text-[var(--text)] font-medium">{r.company_name ?? r.founder_email}</p>
                        {r.one_liner && (
                          <p className="text-[var(--text-muted)] text-xs truncate max-w-[220px]">{r.one_liner}</p>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-[var(--text-muted)] text-xs">{r.sector ?? "—"}</td>
                      <td className="py-2.5 pr-3 text-[var(--text-muted)] text-xs">{r.stage ?? "—"}</td>
                      <td className="py-2.5 pr-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${scoreBadgeColor(r.score)}`}>
                          {r.score}%
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-[var(--text-muted)] text-xs whitespace-nowrap">
                        {new Date(r.intro_requested_at).toLocaleDateString()}
                      </td>
                      <td className="py-2.5">
                        {r.intro_accepted_at ? (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-[rgba(0,200,100,0.12)] text-green-400">
                            Connected
                          </span>
                        ) : r.intro_passed_at ? (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-[rgba(255,255,255,0.06)] text-[var(--text-muted)]">
                            Passed
                          </span>
                        ) : (
                          <div className="flex items-center gap-1.5 whitespace-nowrap">
                            {r.deck_url && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void viewDeck(r);
                                }}
                                disabled={actionBusy === r.id + "deck"}
                                className="px-2.5 py-1.5 border border-[var(--border)] text-[var(--text-muted)] rounded-lg text-xs hover:border-[rgba(108,92,231,0.4)] hover:text-[#6c5ce7] transition-colors disabled:opacity-50"
                              >
                                {r.deck_viewed_at ? "Deck ✓" : "View deck"}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void acceptIntro(r);
                              }}
                              disabled={actionBusy === r.id + "accept"}
                              className="px-2.5 py-1.5 bg-[#6c5ce7] text-white rounded-lg text-xs font-medium hover:bg-[#7d6ff0] disabled:opacity-50"
                            >
                              {actionBusy === r.id + "accept" ? "…" : "I'm interested"}
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void passIntro(r);
                              }}
                              disabled={actionBusy === r.id + "pass"}
                              className="px-2.5 py-1.5 border border-[rgba(239,68,68,0.3)] text-[rgba(254,202,202,0.7)] rounded-lg text-xs hover:border-[rgba(239,68,68,0.5)] transition-colors disabled:opacity-50"
                            >
                              {actionBusy === r.id + "pass" ? "…" : "Pass"}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 text-xs text-[var(--text-muted)]">
                <span>
                  Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, activeItems.length)} of{" "}
                  {activeItems.length}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1 bg-[rgba(255,255,255,0.06)] rounded-lg disabled:opacity-30"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-3 py-1 bg-[rgba(255,255,255,0.06)] rounded-lg disabled:opacity-30"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "matches" && matches.length > 0 && (
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs text-[var(--text-muted)]">
                {matches.length} match{matches.length !== 1 ? "es" : ""}
              </p>
              <div className="flex gap-1 bg-[rgba(255,255,255,0.04)] rounded-lg p-0.5">
                {(["list", "card"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setMatchView(v)}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                      matchView === v
                        ? "bg-[rgba(108,92,231,0.2)] text-[#6c5ce7]"
                        : "text-[var(--text-muted)] hover:text-[var(--text)]"
                    }`}
                  >
                    {v === "list" ? "List" : "Card"}
                  </button>
                ))}
              </div>
            </div>

            {matchView === "list" && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[var(--text-muted)] text-xs border-b border-[var(--border)]">
                      <th className="text-left pb-2 pr-3">Company</th>
                      <th className="text-left pb-2 pr-3">Sector</th>
                      <th className="text-left pb-2 pr-3">Stage</th>
                      <th className="text-left pb-2 pr-3">Location</th>
                      <th className="text-left pb-2 pr-3">Fit</th>
                      <th className="text-left pb-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {(paginated as KevinMatch[]).map((m) => (
                      <tr
                        key={m.id}
                        onClick={() => setViewingMatch(m)}
                        className="border-b border-[rgba(255,255,255,0.03)] cursor-pointer transition-colors hover:bg-[rgba(108,92,231,0.04)]"
                      >
                        <td className="py-2.5 pr-3">
                          <p className="text-[var(--text)] font-medium">{m.company_name ?? m.firm_name ?? "Unknown"}</p>
                          {m.one_liner && (
                            <p className="text-[var(--text-muted)] text-xs truncate max-w-[220px]">{m.one_liner}</p>
                          )}
                        </td>
                        <td className="py-2.5 pr-3 text-[var(--text-muted)] text-xs">{m.sector ?? "—"}</td>
                        <td className="py-2.5 pr-3 text-[var(--text-muted)] text-xs">{m.stage ?? "—"}</td>
                        <td className="py-2.5 pr-3 text-[var(--text-muted)] text-xs">{m.country ?? "—"}</td>
                        <td className="py-2.5 pr-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${scoreBadgeColor(m.score)}`}>
                            {m.score}%
                          </span>
                        </td>
                        <td className="py-2.5">
                          <div className="flex items-center gap-1.5 whitespace-nowrap">
                            {m.matched_user_id && !followedIds.has(m.id) && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void followFounder(m);
                                }}
                                disabled={actionBusy === m.id + "follow"}
                                className="px-2.5 py-1.5 border border-[var(--border)] text-[var(--text-muted)] rounded-lg text-xs hover:border-[rgba(108,92,231,0.4)] hover:text-[#6c5ce7] transition-colors disabled:opacity-50"
                              >
                                {actionBusy === m.id + "follow" ? "…" : "Follow"}
                              </button>
                            )}
                            {followedIds.has(m.id) && (
                              <span className="px-2.5 py-1.5 text-xs text-green-400">Following ✓</span>
                            )}
                            {m.matched_user_id && !m.intro_requested_at && !requestedIntroIds.has(m.id) && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void requestMatchIntro(m);
                                }}
                                disabled={actionBusy === m.id + "intro"}
                                className="px-2.5 py-1.5 bg-[#6c5ce7] text-white rounded-lg text-xs font-medium hover:bg-[#7d6ff0] disabled:opacity-50"
                              >
                                {actionBusy === m.id + "intro" ? "…" : "Request intro"}
                              </button>
                            )}
                            {(m.intro_requested_at || requestedIntroIds.has(m.id)) && (
                              <span className="px-2 py-0.5 rounded text-xs font-medium bg-[rgba(108,92,231,0.15)] text-[#6c5ce7]">
                                Intro sent
                              </span>
                            )}
                            {m.matched_user_id && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  window.dispatchEvent(
                                    new CustomEvent("metatron:open-chat", {
                                      detail: {
                                        userId: m.matched_user_id!,
                                        name: m.company_name ?? m.firm_name ?? "Founder",
                                      },
                                    })
                                  );
                                }}
                                className="px-2.5 py-1.5 border border-[var(--border)] text-[var(--text-muted)] rounded-lg text-xs hover:border-[rgba(108,92,231,0.4)] hover:text-[#6c5ce7] transition-colors"
                              >
                                Message
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {matchView === "card" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {(paginated as KevinMatch[]).map((m) => (
                  <div
                    key={m.id}
                    onClick={() => setViewingMatch(m)}
                    className="cursor-pointer rounded-xl border border-[var(--border)] bg-[rgba(255,255,255,0.02)] p-4 hover:border-[rgba(108,92,231,0.3)] transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <p className="text-[var(--text)] font-semibold truncate">
                          {m.company_name ?? m.firm_name ?? "Unknown"}
                        </p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {m.stage && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[rgba(255,255,255,0.06)] text-[var(--text-muted)]">
                              {m.stage}
                            </span>
                          )}
                          {m.sector && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[rgba(108,92,231,0.12)] text-[#6c5ce7]">
                              {m.sector}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className={`shrink-0 px-2 py-0.5 rounded text-xs font-medium ${scoreBadgeColor(m.score)}`}>
                        {m.score}%
                      </span>
                    </div>
                    {m.one_liner && (
                      <p className="text-[var(--text-muted)] text-xs leading-relaxed mb-3 line-clamp-2">{m.one_liner}</p>
                    )}
                    <p className="text-[var(--text-muted)] text-xs mb-3">
                      {m.deck_url ? (
                        <span className="text-[#6c5ce7]">Deck available</span>
                      ) : (
                        <span>No deck on file</span>
                      )}
                    </p>
                    <div className="flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
                      {m.matched_user_id && !followedIds.has(m.id) && (
                        <button
                          type="button"
                          onClick={() => void followFounder(m)}
                          disabled={actionBusy === m.id + "follow"}
                          className="px-2.5 py-1.5 border border-[var(--border)] text-[var(--text-muted)] rounded-lg text-xs hover:border-[rgba(108,92,231,0.4)] hover:text-[#6c5ce7] transition-colors disabled:opacity-50"
                        >
                          {actionBusy === m.id + "follow" ? "…" : "Follow"}
                        </button>
                      )}
                      {followedIds.has(m.id) && (
                        <span className="px-2.5 py-1.5 text-xs text-green-400">Following ✓</span>
                      )}
                      {m.matched_user_id && !m.intro_requested_at && !requestedIntroIds.has(m.id) && (
                        <button
                          type="button"
                          onClick={() => void requestMatchIntro(m)}
                          disabled={actionBusy === m.id + "intro"}
                          className="px-2.5 py-1.5 bg-[#6c5ce7] text-white rounded-lg text-xs font-medium hover:bg-[#7d6ff0] disabled:opacity-50"
                        >
                          {actionBusy === m.id + "intro" ? "…" : "Request intro"}
                        </button>
                      )}
                      {(m.intro_requested_at || requestedIntroIds.has(m.id)) && (
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-[rgba(108,92,231,0.15)] text-[#6c5ce7]">
                          Intro sent
                        </span>
                      )}
                      {m.matched_user_id && (
                        <button
                          type="button"
                          onClick={() => {
                            window.dispatchEvent(
                              new CustomEvent("metatron:open-chat", {
                                detail: {
                                  userId: m.matched_user_id!,
                                  name: m.company_name ?? m.firm_name ?? "Founder",
                                },
                              })
                            );
                          }}
                          className="px-2.5 py-1.5 border border-[var(--border)] text-[var(--text-muted)] rounded-lg text-xs hover:border-[rgba(108,92,231,0.4)] hover:text-[#6c5ce7] transition-colors"
                        >
                          Message
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 text-xs text-[var(--text-muted)]">
                <span>
                  Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, activeItems.length)} of{" "}
                  {activeItems.length}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1 bg-[rgba(255,255,255,0.06)] rounded-lg disabled:opacity-30"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-3 py-1 bg-[rgba(255,255,255,0.06)] rounded-lg disabled:opacity-30"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {viewingIntro && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setViewingIntro(null)} />
          <div className="relative z-10 w-full max-w-lg max-h-[90vh] flex flex-col rounded-xl border border-[var(--border)] bg-[var(--bg-card)]">
            <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
              <div className="min-w-0">
                <h2 className="text-xl font-semibold text-[var(--text)]">
                  {viewingIntro.company_name ?? viewingIntro.founder_email}
                </h2>
                {viewingIntro.country && (
                  <p className="text-sm text-[var(--text-muted)] mt-0.5">{viewingIntro.country}</p>
                )}
                <span
                  className={`mt-2 inline-block px-2 py-0.5 rounded text-xs font-medium ${scoreBadgeColor(viewingIntro.score)}`}
                >
                  {viewingIntro.score}% fit
                </span>
              </div>
              <button
                type="button"
                onClick={() => setViewingIntro(null)}
                className="shrink-0 rounded-lg p-2 text-[var(--text-muted)] hover:bg-[rgba(255,255,255,0.06)] hover:text-[var(--text)]"
              >
                <span className="block text-xl leading-none">×</span>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {viewingIntro.one_liner && (
                <p className="text-sm italic text-[var(--text-muted)]">{viewingIntro.one_liner}</p>
              )}
              {viewingIntro.reasoning && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1">
                    Why Kevin matched you
                  </p>
                  <p className="text-sm text-[var(--text)] leading-relaxed">{viewingIntro.reasoning}</p>
                </div>
              )}
              <div className="space-y-3 border-t border-[var(--border)] pt-4">
                {(
                  [
                    ["Sector", viewingIntro.sector],
                    ["Stage", viewingIntro.stage],
                    ["Location", viewingIntro.country],
                    ["Contact", viewingIntro.founder_email],
                  ] as const
                ).map(([label, val]) =>
                  val ? (
                    <div key={label}>
                      <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{label}</p>
                      <p className="mt-0.5 text-sm text-[var(--text)]">{val}</p>
                    </div>
                  ) : null
                )}
              </div>
            </div>
            <div className="shrink-0 border-t border-[var(--border)] px-5 py-3">
              {viewingIntro.intro_accepted_at ? (
                <span className="inline-flex w-full justify-center px-2 py-2 rounded-lg text-xs font-medium bg-[rgba(0,200,100,0.12)] text-green-400">
                  Connected
                </span>
              ) : viewingIntro.intro_passed_at ? (
                <span className="inline-flex w-full justify-center px-2 py-2 rounded-lg text-xs font-medium bg-[rgba(255,255,255,0.06)] text-[var(--text-muted)]">
                  Passed
                </span>
              ) : (
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  {viewingIntro.deck_url && (
                    <button
                      type="button"
                      onClick={() => void viewDeck(viewingIntro)}
                      disabled={actionBusy === viewingIntro.id + "deck"}
                      className="flex-1 min-w-[120px] px-2.5 py-2 border border-[var(--border)] text-[var(--text-muted)] rounded-lg text-xs hover:border-[rgba(108,92,231,0.4)] hover:text-[#6c5ce7] transition-colors disabled:opacity-50"
                    >
                      {viewingIntro.deck_viewed_at ? "Deck ✓" : "View deck"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void acceptIntro(viewingIntro)}
                    disabled={actionBusy === viewingIntro.id + "accept"}
                    className="flex-1 min-w-[120px] px-2.5 py-2 bg-[#6c5ce7] text-white rounded-lg text-xs font-medium hover:bg-[#7d6ff0] disabled:opacity-50"
                  >
                    {actionBusy === viewingIntro.id + "accept" ? "…" : "I'm interested"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void passIntro(viewingIntro)}
                    disabled={actionBusy === viewingIntro.id + "pass"}
                    className="flex-1 min-w-[120px] px-2.5 py-2 border border-[rgba(239,68,68,0.3)] text-[rgba(254,202,202,0.7)] rounded-lg text-xs hover:border-[rgba(239,68,68,0.5)] transition-colors disabled:opacity-50"
                  >
                    {actionBusy === viewingIntro.id + "pass" ? "…" : "Pass"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {viewingMatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setViewingMatch(null)} />
          <div className="relative z-10 w-full max-w-lg max-h-[90vh] flex flex-col rounded-xl border border-[var(--border)] bg-[var(--bg-card)]">
            <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
              <div className="min-w-0">
                <h2 className="text-xl font-semibold text-[var(--text)]">
                  {viewingMatch.company_name ?? viewingMatch.firm_name ?? "Founder"}
                </h2>
                {viewingMatch.country && (
                  <p className="text-sm text-[var(--text-muted)] mt-0.5">{viewingMatch.country}</p>
                )}
                <span
                  className={`mt-2 inline-block px-2 py-0.5 rounded text-xs font-medium ${scoreBadgeColor(viewingMatch.score)}`}
                >
                  {viewingMatch.score}% fit
                </span>
              </div>
              <button
                type="button"
                onClick={() => setViewingMatch(null)}
                className="shrink-0 rounded-lg p-2 text-[var(--text-muted)] hover:bg-[rgba(255,255,255,0.06)] hover:text-[var(--text)]"
              >
                <span className="block text-xl leading-none">×</span>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {viewingMatch.one_liner && (
                <p className="text-sm italic text-[var(--text-muted)]">{viewingMatch.one_liner}</p>
              )}
              {viewingMatch.reasoning && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1">
                    Why Kevin matched you
                  </p>
                  <p className="text-sm text-[var(--text)] leading-relaxed">{viewingMatch.reasoning}</p>
                </div>
              )}
              <div className="space-y-3 border-t border-[var(--border)] pt-4">
                {(
                  [
                    ["Sector", viewingMatch.sector],
                    ["Stage", viewingMatch.stage],
                    ["Location", viewingMatch.country],
                  ] as const
                ).map(([label, val]) =>
                  val ? (
                    <div key={label}>
                      <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{label}</p>
                      <p className="mt-0.5 text-sm text-[var(--text)]">{val}</p>
                    </div>
                  ) : null
                )}
              </div>
            </div>
            <div className="shrink-0 border-t border-[var(--border)] px-5 py-3 flex flex-wrap gap-2">
              {viewingMatch.matched_user_id && !followedIds.has(viewingMatch.id) && (
                <button
                  type="button"
                  onClick={() => void followFounder(viewingMatch)}
                  disabled={actionBusy === viewingMatch.id + "follow"}
                  className="flex-1 min-w-[100px] rounded-xl border border-[var(--border)] py-2.5 text-sm text-[var(--text-muted)] hover:border-[rgba(108,92,231,0.4)] hover:text-[#6c5ce7] disabled:opacity-50"
                >
                  {actionBusy === viewingMatch.id + "follow" ? "…" : "Follow"}
                </button>
              )}
              {followedIds.has(viewingMatch.id) && (
                <span className="flex-1 min-w-[100px] flex items-center justify-center text-sm text-green-400">
                  Following ✓
                </span>
              )}
              {viewingMatch.matched_user_id &&
                !viewingMatch.intro_requested_at &&
                !requestedIntroIds.has(viewingMatch.id) && (
                  <button
                    type="button"
                    onClick={() => void requestMatchIntro(viewingMatch)}
                    disabled={actionBusy === viewingMatch.id + "intro"}
                    className="flex-1 min-w-[100px] rounded-xl bg-[#6c5ce7] py-2.5 text-sm font-semibold text-white hover:bg-[#7d6ff0] disabled:opacity-50"
                  >
                    {actionBusy === viewingMatch.id + "intro" ? "…" : "Request intro"}
                  </button>
                )}
              {(viewingMatch.intro_requested_at || requestedIntroIds.has(viewingMatch.id)) && (
                <span className="flex-1 min-w-[100px] flex items-center justify-center px-2 py-2 rounded-lg text-sm font-medium bg-[rgba(108,92,231,0.15)] text-[#6c5ce7]">
                  Intro sent
                </span>
              )}
              {viewingMatch.matched_user_id && (
                <button
                  type="button"
                  onClick={() => {
                    window.dispatchEvent(
                      new CustomEvent("metatron:open-chat", {
                        detail: {
                          userId: viewingMatch.matched_user_id!,
                          name: viewingMatch.company_name ?? viewingMatch.firm_name ?? "Founder",
                        },
                      })
                    );
                    setViewingMatch(null);
                  }}
                  className="flex-1 min-w-[100px] rounded-xl border border-[var(--border)] py-2.5 text-sm text-[var(--text-muted)] hover:border-[rgba(108,92,231,0.4)] hover:text-[#6c5ce7]"
                >
                  Message →
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
