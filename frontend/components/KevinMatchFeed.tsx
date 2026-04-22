"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { API_BASE, authJsonHeaders } from "@/lib/api";

type KevinMatch = {
  id: string;
  matched_user_id: string;
  match_type: string;
  score: number;
  reasoning: string | null;
  firm_name: string | null;
  company_name: string | null;
  one_liner: string | null;
  stage: string | null;
  sector: string | null;
  country: string | null;
  angel_score: number | null;
  intro_requested_at?: string | null;
};

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 85
      ? "bg-green-500/15 text-green-400"
      : score >= 70
        ? "bg-metatron-accent/15 text-metatron-accent"
        : "bg-[var(--border)] text-[var(--text-muted)]";
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${color}`}>{score}% fit</span>
  );
}

export default function KevinMatchFeed({
  token,
  role,
  onAddToPipeline,
}: {
  token: string;
  role: "founder" | "investor";
  onAddToPipeline?: (founderId: string, companyName: string) => void;
}) {
  const [matches, setMatches] = useState<KevinMatch[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const cached = await fetch(`${API_BASE}/kevin-matches`, { headers: authJsonHeaders(token) });
      if (cached.ok) {
        const data = (await cached.json()) as KevinMatch[];
        if (data.length > 0) setMatches(data);
      }
      const fresh = await fetch(`${API_BASE}/kevin-matches`, {
        method: "POST",
        headers: authJsonHeaders(token),
      });
      if (fresh.ok) setMatches((await fresh.json()) as KevinMatch[]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && matches.length === 0) {
    return (
      <div className="rounded-[12px] border border-[var(--border)] bg-[var(--bg-card)] p-6">
        <p className="font-sans text-[11px] uppercase tracking-[2px] text-[var(--text-muted)]">
          Kevin&apos;s Top Matches
        </p>
        <p className="mt-3 text-sm text-[var(--text-muted)]">Kevin is finding your best matches…</p>
      </div>
    );
  }

  if (matches.length === 0) {
    return (
      <div className="rounded-[12px] border border-[var(--border)] bg-[var(--bg-card)] p-6">
        <p className="font-sans text-[11px] uppercase tracking-[2px] text-[var(--text-muted)]">
          Kevin&apos;s Top Matches
        </p>
        <p className="mt-3 text-sm text-[var(--text-muted)]">
          Complete your profile so Kevin can find your best matches.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-[12px] border border-[var(--border)] bg-[var(--bg-card)] p-6">
      <p className="font-sans text-[11px] uppercase tracking-[2px] text-[var(--text-muted)]">
        Kevin&apos;s Top {role === "founder" ? "Investor" : "Founder"} Matches
      </p>
      <div className="mt-4 space-y-3">
        {matches.map((m) => {
          const name = role === "founder" ? m.firm_name : m.company_name;
          const sub = [m.sector, m.stage, m.country].filter(Boolean).join(" · ");
          return (
            <div
              key={m.id}
              className="flex items-start justify-between gap-4 rounded-[8px] border border-[var(--border)] p-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-[var(--text)]">{name ?? "Unknown"}</p>
                  {role === "investor" && m.angel_score != null && (
                    <span className="rounded-full bg-metatron-accent/10 px-2 py-0.5 text-[10px] font-sans text-metatron-accent">
                      AS {m.angel_score}
                    </span>
                  )}
                  <ScoreBadge score={m.score} />
                </div>
                {sub && <p className="mt-0.5 text-xs text-[var(--text-muted)]">{sub}</p>}
                {m.one_liner && <p className="mt-1 text-xs text-[var(--text-muted)] line-clamp-1">{m.one_liner}</p>}
                {m.reasoning && (
                  <p className="mt-1.5 text-xs italic text-[var(--text-muted)]">
                    &ldquo;{m.reasoning}&rdquo;
                  </p>
                )}
                {role === "founder" && (
                  <div className="mt-2">
                    <IntroButton
                      matchId={m.id}
                      alreadyRequested={!!m.intro_requested_at}
                      token={token}
                      profileIncomplete={
                        !m.company_name && !m.one_liner && !m.stage && !m.sector
                      }
                    />
                  </div>
                )}
              </div>
              {role === "investor" && onAddToPipeline && (
                <button
                  type="button"
                  onClick={() => onAddToPipeline(m.matched_user_id, m.company_name ?? "Founder")}
                  className="shrink-0 rounded-[8px] border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text)] hover:border-metatron-accent/30"
                >
                  + Pipeline
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function IntroButton({
  matchId,
  alreadyRequested,
  token,
  profileIncomplete,
}: {
  matchId: string;
  alreadyRequested: boolean;
  token: string;
  profileIncomplete?: boolean;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">(
    alreadyRequested ? "done" : "idle"
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function request() {
    setState("loading");
    setErrorMessage(null);
    try {
      const res = await fetch(`${API_BASE}/kevin-matches/${matchId}/request-intro`, {
        method: "POST",
        headers: authJsonHeaders(token),
      });
      if (res.ok) {
        setState("done");
        return;
      }
      let msg = "Something went wrong. Please try again.";
      try {
        const text = await res.text();
        if (text) {
          try {
            const parsed = JSON.parse(text);
            msg =
              (typeof parsed === "string" && parsed) ||
              parsed?.error ||
              parsed?.message ||
              text;
          } catch {
            msg = text;
          }
        }
      } catch {
        // ignore body-read failure, keep default msg
      }
      setErrorMessage(msg);
      setState("error");
    } catch {
      setErrorMessage("Network error. Please try again.");
      setState("error");
    }
  }

  if (state === "done") {
    return <span className="text-xs text-metatron-accent">Intro Requested ✓</span>;
  }

  if (profileIncomplete) {
    return (
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          disabled
          title="Complete your profile first"
          aria-label="Complete your profile first"
          className="shrink-0 cursor-not-allowed rounded-[8px] border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)] opacity-60"
        >
          Request Intro
        </button>
        <p className="text-[11px] text-[var(--text-muted)]">
          <Link href="/startup/profile" className="text-metatron-accent hover:underline">
            Complete your profile
          </Link>{" "}
          to request an intro.
        </p>
      </div>
    );
  }

  const mentionsProfile = !!errorMessage?.toLowerCase().includes("complete your founder profile");

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => void request()}
        disabled={state === "loading"}
        className="shrink-0 rounded-[8px] border border-metatron-accent/40 px-3 py-1.5 text-xs text-metatron-accent hover:bg-metatron-accent/10 disabled:opacity-50"
      >
        {state === "loading"
          ? "Requesting…"
          : state === "error"
            ? "Try again"
            : "Request Intro"}
      </button>
      {state === "error" && errorMessage && (
        <p className="text-[11px] text-red-400">
          {errorMessage}
          {mentionsProfile && (
            <>
              {" "}
              <Link
                href="/startup/profile"
                className="text-metatron-accent hover:underline"
              >
                Go to profile →
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}
