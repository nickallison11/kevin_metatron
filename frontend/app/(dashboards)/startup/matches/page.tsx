"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { API_BASE, authHeaders, authJsonHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type MatchItem = {
  investor_user_id: string;
  firm_name?: string | null;
  bio?: string | null;
  investment_thesis?: string | null;
  ticket_size_min?: number | null;
  ticket_size_max?: number | null;
  sectors?: string[] | null;
  stages?: string[] | null;
  week_limit: number;
  matches_used: number;
  week_resets_at: string;
};

function formatResetBadge(isoDate: string) {
  const d = new Date(isoDate + "T12:00:00Z");
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function formatTicketRange(min?: number | null, max?: number | null) {
  if (min == null && max == null) return null;
  const fmt = (n: number) =>
    n >= 1_000_000
      ? `$${(n / 1_000_000).toFixed(1)}M`
      : n >= 1_000
        ? `$${(n / 1_000).toFixed(0)}k`
        : `$${n}`;
  if (min != null && max != null) return `${fmt(min)} – ${fmt(max)}`;
  if (min != null) return `${fmt(min)}+`;
  if (max != null) return `Up to ${fmt(max)}`;
  return null;
}

export default function StartupMatchesPage() {
  const { token, isPro, loading } = useAuth();
  const [matches, setMatches] = useState<MatchItem[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [introBusy, setIntroBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/startup/matches`, {
        headers: authHeaders(token),
      });
      if (!res.ok) {
        setMsg("Could not load matches.");
        return;
      }
      const data = (await res.json()) as { matches: MatchItem[] };
      setMatches(data.matches ?? []);
    } catch {
      setMsg("Could not load matches.");
    }
  }, [token]);

  useEffect(() => {
    if (!loading && token) void load();
  }, [loading, token, load]);

  const meta = matches[0];
  const weekLimit = meta?.week_limit ?? 1;
  const matchesUsed = meta?.matches_used ?? matches.length;
  const weekResetsAt = meta?.week_resets_at ?? "";

  const visibleMatches = useMemo(() => {
    if (isPro) return matches;
    return matches.slice(0, 1);
  }, [matches, isPro]);

  const lockedMatches = useMemo(() => {
    if (isPro) return [];
    return matches.slice(1);
  }, [matches, isPro]);

  async function requestIntro(investorUserId: string) {
    if (!token) return;
    setIntroBusy(investorUserId);
    setMsg(null);
    try {
      const res = await fetch(`${API_BASE}/introductions`, {
        method: "POST",
        headers: authJsonHeaders(token),
        body: JSON.stringify({
          investor_user_id: investorUserId,
          note: "Request intro via Metatron.",
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        setMsg(t.trim() || "Request failed.");
        return;
      }
      setMsg("Intro request sent.");
    } catch {
      setMsg("Request failed.");
    } finally {
      setIntroBusy(null);
    }
  }

  if (loading) return null;
  if (!token) return null;

  return (
    <main className="flex-1">
      <header className="border-b border-[var(--border)] px-6 py-4 md:px-10">
        <p className="font-sans text-[11px] font-medium uppercase tracking-[2px] text-[var(--text-muted)] mb-1">
          Founder
        </p>
        <h1 className="text-lg font-semibold">Investor matches</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Your matched investors refresh weekly
        </p>
      </header>

      <section className="max-w-4xl space-y-6 p-6 md:p-10">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--bg-card)] px-3 py-1 font-sans text-xs text-[var(--text)]">
            {matchesUsed} / {weekLimit} matches this week
          </span>
          {weekResetsAt && (
            <span className="text-xs text-[var(--text-muted)]">
              Resets {formatResetBadge(weekResetsAt)}
            </span>
          )}
        </div>

        {msg && (
          <p className="text-xs text-[var(--text-muted)] border border-[var(--border)] rounded-[12px] px-3 py-2">
            {msg}
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {visibleMatches.map((m) => (
            <article
              key={m.investor_user_id}
              className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-4 flex flex-col gap-3"
            >
              <h2 className="text-sm font-semibold text-[var(--text)]">
                {m.firm_name?.trim() || "Independent investor"}
              </h2>
              {m.investment_thesis && (
                <p className="text-xs text-[var(--text-muted)] line-clamp-2 leading-relaxed">
                  {m.investment_thesis}
                </p>
              )}
              <div className="flex flex-wrap gap-1.5">
                {(m.sectors ?? []).slice(0, 6).map((s) => (
                  <span
                    key={s}
                    className="rounded border border-[var(--border)] px-2 py-0.5 font-sans text-[10px] uppercase tracking-wide text-[var(--text-muted)]"
                  >
                    {s}
                  </span>
                ))}
                {(m.stages ?? []).slice(0, 4).map((s) => (
                  <span
                    key={`st-${s}`}
                    className="rounded border border-metatron-accent/25 bg-metatron-accent/10 px-2 py-0.5 font-sans text-[10px] uppercase tracking-wide text-metatron-accent"
                  >
                    {s}
                  </span>
                ))}
              </div>
              {formatTicketRange(m.ticket_size_min, m.ticket_size_max) && (
                <p className="font-sans text-[11px] text-[var(--text-muted)]">
                  {formatTicketRange(m.ticket_size_min, m.ticket_size_max)}
                </p>
              )}
              <button
                type="button"
                onClick={() => void requestIntro(m.investor_user_id)}
                disabled={introBusy === m.investor_user_id}
                className="mt-auto w-full rounded-lg bg-metatron-accent py-2.5 text-sm font-semibold text-white hover:bg-metatron-accent-hover transition-all disabled:opacity-60"
              >
                {introBusy === m.investor_user_id
                  ? "Sending…"
                  : "Request intro"}
              </button>
            </article>
          ))}
        </div>

        {!isPro && matches.length > 0 && (
          <div className="relative rounded-[var(--radius)] border border-[var(--border)] overflow-hidden min-h-[200px]">
            <div className="grid gap-4 sm:grid-cols-2 p-4 blur-sm pointer-events-none select-none opacity-60">
              {(lockedMatches.length > 0
                ? lockedMatches
                : ([null, null] as const)
              ).map((m, i) =>
                m ? (
                  <article
                    key={m.investor_user_id}
                    className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-4 h-40"
                  />
                ) : (
                  <div
                    key={`ph-${i}`}
                    className="h-40 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)]"
                  />
                ),
              )}
            </div>
            <div className="absolute inset-0 flex items-center justify-center bg-[color-mix(in_srgb,var(--bg)_55%,transparent)] p-6">
              <div className="max-w-sm rounded-[12px] border border-metatron-accent/30 bg-[var(--bg-card)] p-4 text-center">
                <p className="text-sm font-semibold text-[var(--text)]">
                  Upgrade to Founder Basic for 10 matches/week
                </p>
                <Link
                  href="/pricing"
                  className="mt-3 inline-block text-sm text-metatron-accent hover:underline"
                >
                  View pricing →
                </Link>
              </div>
            </div>
          </div>
        )}

        {!isPro && matches.length === 0 && (
          <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-6 text-center">
            <p className="text-sm text-[var(--text-muted)] mb-3">
              No matches yet this week. Complete your profile (sector and
              stage) to get better matches.
            </p>
            <Link
              href="/pricing"
              className="text-sm text-metatron-accent font-semibold"
            >
              Upgrade for more weekly matches →
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
