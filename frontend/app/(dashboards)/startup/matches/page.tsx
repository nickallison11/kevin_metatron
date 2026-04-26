"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
};

const PAGE_SIZE = 10;

export default function StartupMatchesPage() {
  const { token, loading } = useAuth();
  const [matches, setMatches] = useState<KevinMatch[]>([]);
  const [fetching, setFetching] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [introBusy, setIntroBusy] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "card">("list");
  const [page, setPage] = useState(1);
  const [viewingMatch, setViewingMatch] = useState<KevinMatch | null>(null);
  const [tab, setTab] = useState<"pending" | "sent">("pending");

  const load = useCallback(async () => {
    if (!token) return;
    setFetching(true);
    try {
      const res = await fetch(`${API_BASE}/kevin-matches`, {
        method: "POST",
        headers: authJsonHeaders(token),
      });
      if (!res.ok) {
        setMsg("Could not load matches.");
        return;
      }
      setMatches(await res.json());
    } catch {
      setMsg("Could not load matches.");
    } finally {
      setFetching(false);
    }
  }, [token]);

  useEffect(() => {
    if (!loading && token) void load();
  }, [loading, token, load]);

  const pending = useMemo(() => matches.filter((m) => !m.intro_requested_at), [matches]);
  const requested = useMemo(() => matches.filter((m) => m.intro_requested_at), [matches]);
  const allMatches = useMemo(() => [...pending, ...requested], [pending, requested]);
  const activeMatches = useMemo(() => (tab === "pending" ? pending : requested), [tab, pending, requested]);
  const totalPages = Math.max(1, Math.ceil(activeMatches.length / PAGE_SIZE));
  const paginated = activeMatches.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  async function requestIntro(matchId: string) {
    if (!token) return;
    setIntroBusy(matchId);
    setMsg(null);
    try {
      const res = await fetch(`${API_BASE}/kevin-matches/${matchId}/request-intro`, {
        method: "POST",
        headers: authJsonHeaders(token),
      });
      if (!res.ok) {
        const t = await res.text();
        setMsg(t.trim() || "Request failed.");
        return;
      }
      setMsg("Intro request sent!");
      setMatches((prev) =>
        prev.map((m) =>
          m.id === matchId ? { ...m, intro_requested_at: new Date().toISOString() } : m
        )
      );
      if (viewingMatch?.id === matchId) {
        setViewingMatch((v) => (v ? { ...v, intro_requested_at: new Date().toISOString() } : v));
      }
    } catch {
      setMsg("Request failed.");
    } finally {
      setIntroBusy(null);
    }
  }

  if (loading) return null;
  if (!token) return null;

  const scoreBadgeColor = (score: number) => {
    if (score >= 85) return "bg-[rgba(0,200,100,0.12)] text-green-400";
    if (score >= 70) return "bg-[rgba(108,92,231,0.15)] text-[#6c5ce7]";
    return "bg-[rgba(255,255,255,0.06)] text-[var(--text-muted)]";
  };

  return (
    <main className="flex-1 text-[var(--text)]">
      <div className="space-y-6 px-6 py-6 md:px-10">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--text)]">Kevin's Investor Matches</h1>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              {pending.length} pending · {requested.length} intro{requested.length !== 1 ? "s" : ""} sent
              · refreshes weekly
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex gap-1">
              {(["pending", "sent"] as const).map((t) => (
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
                  {t === "pending" ? "Pending" : "Sent"}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              {(["list", "card"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => {
                    setView(v);
                    setPage(1);
                  }}
                  className={`px-3 py-1 rounded-lg text-xs ${
                    view === v
                      ? "bg-[rgba(108,92,231,0.2)] text-[#6c5ce7]"
                      : "text-[var(--text-muted)] hover:text-[var(--text)]"
                  }`}
                >
                  {v === "card" ? "Cards" : "List"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {msg && (
          <p className="text-xs border border-[var(--border)] rounded-xl px-3 py-2 text-[var(--text-muted)]">
            {msg}
          </p>
        )}

        {fetching && allMatches.length === 0 && (
          <p className="text-sm text-[var(--text-muted)]">Kevin is finding your matches…</p>
        )}

        {!fetching && allMatches.length === 0 && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-6 text-center">
            <p className="text-sm text-[var(--text-muted)]">
              No matches yet. Complete your profile (sector and stage) to get your first weekly batch.
            </p>
          </div>
        )}

        {activeMatches.length > 0 && (
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5">
            {view === "card" ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {paginated.map((m) => (
                  <div
                    key={m.id}
                    onClick={() => setViewingMatch(m)}
                    className={`rounded-xl p-4 cursor-pointer transition-colors border ${
                      m.intro_requested_at
                        ? "border-[var(--border)] bg-[var(--bg)] opacity-60"
                        : "border-[var(--border)] bg-[var(--bg)] hover:bg-[var(--bg-card)] hover:border-[rgba(108,92,231,0.2)]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[var(--text)] truncate">
                          {m.firm_name ?? "Independent investor"}
                        </p>
                        {m.country && (
                          <p className="text-xs text-[var(--text-muted)]">{m.country}</p>
                        )}
                      </div>
                      <span
                        className={`shrink-0 px-2 py-0.5 rounded text-xs font-medium ${scoreBadgeColor(
                          m.score
                        )}`}
                      >
                        {m.score}%
                      </span>
                    </div>
                    {m.one_liner && (
                      <p className="text-xs text-[var(--text-muted)] line-clamp-2 mb-2">{m.one_liner}</p>
                    )}
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs mb-3">
                      {m.sector && (
                        <div>
                          <dt className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                            Sector
                          </dt>
                          <dd className="text-[var(--text)] truncate">{m.sector}</dd>
                        </div>
                      )}
                      {m.stage && (
                        <div>
                          <dt className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                            Stage
                          </dt>
                          <dd className="text-[var(--text)]">{m.stage}</dd>
                        </div>
                      )}
                    </dl>
                    {m.intro_requested_at ? (
                      <span className="text-xs text-[var(--text-muted)]">Intro sent</span>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void requestIntro(m.id);
                        }}
                        disabled={introBusy === m.id}
                        className="w-full rounded-lg bg-[#6c5ce7] py-2 text-sm font-semibold text-white hover:bg-[#7d6ff0] disabled:opacity-50"
                      >
                        {introBusy === m.id ? "Sending…" : "Request intro"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[var(--text-muted)] text-xs border-b border-[var(--border)]">
                      <th className="text-left pb-2 pr-3">Investor</th>
                      <th className="text-left pb-2 pr-3">Sector</th>
                      <th className="text-left pb-2 pr-3">Stage</th>
                      <th className="text-left pb-2 pr-3">Location</th>
                      <th className="text-left pb-2 pr-3">Fit</th>
                      <th className="text-left pb-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map((m) => (
                      <tr
                        key={m.id}
                        onClick={() => setViewingMatch(m)}
                        className={`border-b border-[rgba(255,255,255,0.03)] cursor-pointer transition-colors ${
                          m.intro_requested_at ? "opacity-50" : "bg-[var(--bg)] hover:bg-[var(--bg-card)]"
                        }`}
                      >
                        <td className="py-2 pr-3">
                          <p className="text-[var(--text)] font-medium">
                            {m.firm_name ?? "Independent investor"}
                          </p>
                          {m.one_liner && (
                            <p className="text-[var(--text-muted)] text-xs truncate max-w-[200px]">
                              {m.one_liner}
                            </p>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-[var(--text-muted)] text-xs max-w-[120px] truncate">
                          {m.sector ?? "—"}
                        </td>
                        <td className="py-2 pr-3 text-[var(--text-muted)] text-xs">{m.stage ?? "—"}</td>
                        <td className="py-2 pr-3 text-[var(--text-muted)] text-xs">
                          {m.country ?? "—"}
                        </td>
                        <td className="py-2 pr-3">
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-medium ${scoreBadgeColor(m.score)}`}
                          >
                            {m.score}%
                          </span>
                        </td>
                        <td className="py-2 pr-4">
                          {m.intro_requested_at ? (
                            <span className="text-xs text-[var(--text-muted)]">Sent</span>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void requestIntro(m.id);
                              }}
                              disabled={introBusy === m.id}
                              className="px-3 py-1.5 bg-[#6c5ce7] text-white rounded-lg text-xs font-medium hover:bg-[#7d6ff0] disabled:opacity-50 whitespace-nowrap"
                            >
                              {introBusy === m.id ? "…" : "Request intro"}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 text-xs text-[var(--text-muted)]">
                <span>
                  Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, activeMatches.length)} of{" "}
                  {activeMatches.length}
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

        {tab === "pending" && pending.length === 0 && requested.length > 0 && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 text-center">
            <p className="text-sm font-semibold text-[var(--text)] mb-1">
              You've reached out to all your matches this week
            </p>
            <p className="text-xs text-[var(--text-muted)]">Your next batch of matches drops in 7 days.</p>
          </div>
        )}

        {tab === "sent" && requested.length === 0 && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-6 text-center">
            <p className="text-sm text-[var(--text-muted)]">
              No introductions sent yet. Request your first intro from the Pending tab.
            </p>
          </div>
        )}
      </div>

      {viewingMatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setViewingMatch(null)} />
          <div className="relative z-10 w-full max-w-lg max-h-[90vh] flex flex-col rounded-xl border border-[var(--border)] bg-[var(--bg-card)]">
            <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
              <div className="min-w-0">
                <h2 className="text-xl font-semibold text-[var(--text)]">
                  {viewingMatch.firm_name ?? "Independent investor"}
                </h2>
                {viewingMatch.country && (
                  <p className="text-sm text-[var(--text-muted)] mt-0.5">{viewingMatch.country}</p>
                )}
                <span
                  className={`mt-2 inline-block px-2 py-0.5 rounded text-xs font-medium ${scoreBadgeColor(
                    viewingMatch.score
                  )}`}
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

            <div className="shrink-0 border-t border-[var(--border)] px-5 py-3">
              {viewingMatch.intro_requested_at ? (
                <p className="text-sm text-[var(--text-muted)]">Intro already sent</p>
              ) : (
                <button
                  type="button"
                  onClick={() => void requestIntro(viewingMatch.id)}
                  disabled={introBusy === viewingMatch.id}
                  className="w-full rounded-xl bg-[#6c5ce7] py-2.5 text-sm font-semibold text-white hover:bg-[#7d6ff0] disabled:opacity-50"
                >
                  {introBusy === viewingMatch.id ? "Sending…" : "Request intro →"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
