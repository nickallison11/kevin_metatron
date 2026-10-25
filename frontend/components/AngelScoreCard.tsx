"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { API_BASE, authJsonHeaders } from "@/lib/api";
import { useUpgrade } from "@/components/upgrade/UpgradeProvider";
import { ScoreBar, btnSm, card, eyebrow } from "@/components/startup/dashboardStyles";

type AngelScore = {
  score: number;
  team_score: number | null;
  market_score: number | null;
  traction_score: number | null;
  pitch_score: number | null;
  reasoning: string | null;
  generated_at: string;
};

const PARTS = [
  { k: "team_score", label: "Team" },
  { k: "market_score", label: "Market" },
  { k: "traction_score", label: "Traction" },
  { k: "pitch_score", label: "Pitch" },
] as const;

/** Angel Score, top of the dashboard's right-hand column. Free accounts get the
 * number only; the backend leaves the breakdown out for them. */
export default function AngelScoreCard({ token }: { token: string }) {
  const { openUpgrade } = useUpgrade();
  const [score, setScore] = useState<AngelScore | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`${API_BASE}/angel-score`, { headers: authJsonHeaders(token) });
    if (res.ok) setScore((await res.json()) as AngelScore | null);
    setLoading(false);
  }, [token]);

  const generate = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`${API_BASE}/angel-score`, {
        method: "POST",
        headers: authJsonHeaders(token),
      });
      if (res.ok) setScore((await res.json()) as AngelScore);
    } finally {
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    void load().then(() => {
      void generate();
    });
  }, [load, generate]);

  const parts = PARTS.map((p) => ({ ...p, value: score ? score[p.k] : null }));
  const hasBreakdown = parts.some((p) => p.value != null);
  const scored = parts.filter((p) => p.value != null);
  const weakest = scored.length ? scored.reduce((a, b) => ((b.value ?? 0) < (a.value ?? 0) ? b : a)) : null;

  return (
    <section className={`${card} p-[22px]`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`${eyebrow} text-[var(--text-muted)]`}>Angel Score</span>
        {score && (
          <button type="button" onClick={() => void generate()} disabled={refreshing} className={btnSm}>
            {refreshing ? "Updating…" : "Refresh"}
          </button>
        )}
      </div>

      <div className="flex items-baseline gap-1">
        <span className={`mono-num text-5xl font-semibold ${score ? "text-[var(--text)]" : "text-[var(--text-muted)]"}`}>
          {loading ? "…" : (score?.score ?? "—")}
        </span>
        <span className="text-[var(--text-muted)]">/100</span>
      </div>

      {!loading && !score ? (
        <p className="text-sm leading-relaxed text-[var(--text-muted)]">
          Your investor-readiness rating. Kevin scores you once your pitch is in.
        </p>
      ) : hasBreakdown ? (
        <>
          <div className="flex flex-col gap-2">
            {parts.map((p) => (
              <ScoreBar key={p.k} label={p.label} value={p.value} max={25} tone={weakest && p.k === weakest.k ? "warn" : "accent"} />
            ))}
          </div>
          {weakest && (
            <p className="text-[13px] leading-relaxed text-[var(--text-muted)]">
              {weakest.label} is holding you back.{" "}
              <Link href="/startup/profile" className="text-[var(--accent-fg)] hover:underline">
                Improve it
              </Link>
            </p>
          )}
          {score?.reasoning && <p className="text-xs leading-relaxed text-[var(--text-muted)]">{score.reasoning}</p>}
        </>
      ) : score ? (
        <p className="flex items-start gap-2 text-[13px] leading-relaxed text-[var(--text-muted)]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="mt-0.5 shrink-0">
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          <span>
            Team, Market, Traction and Pitch breakdown on Basic and Pro.{" "}
            <button type="button" onClick={openUpgrade} className="text-[var(--accent-fg)] hover:underline">
              Upgrade
            </button>
          </span>
        </p>
      ) : null}
    </section>
  );
}
