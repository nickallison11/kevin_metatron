"use client";

import { useCallback, useEffect, useState } from "react";
import { API_BASE, authJsonHeaders } from "@/lib/api";

type AngelScore = {
  score: number;
  team_score: number | null;
  market_score: number | null;
  traction_score: number | null;
  pitch_score: number | null;
  reasoning: string | null;
  generated_at: string;
};

function ScoreBar({ label, value, max = 25 }: { label: string; value: number | null; max?: number }) {
  const pct = value != null ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-xs text-[var(--text-muted)]">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-[var(--border)]">
        <div
          className="h-1.5 rounded-full bg-metatron-accent transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-8 text-right text-xs font-mono text-[var(--text)]">
        {value ?? "—"}/{max}
      </span>
    </div>
  );
}

export default function AngelScoreCard({ token }: { token: string }) {
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

  if (loading) {
    return (
      <div className="rounded-[12px] border border-[var(--border)] bg-[var(--bg-card)] p-6">
        <p className="text-sm text-[var(--text-muted)]">Calculating Angel Score…</p>
      </div>
    );
  }

  return (
    <div className="rounded-[12px] border border-[var(--border)] bg-[var(--bg-card)] p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[2px] text-[var(--text-muted)]">Angel Score</p>
          <div className="mt-1 flex items-end gap-1">
            <span className="text-5xl font-bold text-[var(--text)]">{score?.score ?? "—"}</span>
            <span className="mb-1 text-lg text-[var(--text-muted)]">/100</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void generate()}
          disabled={refreshing}
          className="shrink-0 rounded-[8px] border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)] hover:border-metatron-accent/30 disabled:opacity-50"
        >
          {refreshing ? "Updating…" : "Refresh"}
        </button>
      </div>

      {score && (
        <div className="mt-4 space-y-2">
          <ScoreBar label="Team" value={score.team_score} />
          <ScoreBar label="Market" value={score.market_score} />
          <ScoreBar label="Traction" value={score.traction_score} />
          <ScoreBar label="Pitch" value={score.pitch_score} />
        </div>
      )}

      {score?.reasoning && (
        <p className="mt-4 text-xs leading-relaxed text-[var(--text-muted)]">{score.reasoning}</p>
      )}
    </div>
  );
}
