"use client";

import { useCallback, useEffect, useState } from "react";
import { API_BASE, authHeaders, authJsonHeaders } from "@/lib/api";

type Pool = {
  id: string;
  name: string;
  description?: string | null;
};

type StartupCard = {
  user_id: string;
  company_name?: string | null;
  one_liner?: string | null;
  stage?: string | null;
  sector?: string | null;
  pitch_deck_url?: string | null;
};

export default function InvestorDashboardPage() {
  const [token, setToken] = useState<string | null>(null);
  const [pools, setPools] = useState<Pool[]>([]);
  const [startups, setStartups] = useState<StartupCard[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [introMsg, setIntroMsg] = useState<string | null>(null);

  useEffect(() => {
    setToken(window.localStorage.getItem("metatron_token"));
  }, []);

  const loadPools = useCallback(async () => {
    if (!token) {
      setMessage("No token found. Please sign up or log in first.");
      return;
    }
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/pools`, {
        headers: authHeaders(token)
      });
      if (!res.ok) throw new Error("failed");
      setPools(await res.json());
    } catch {
      setMessage("Failed to load pools.");
    }
  }, [token]);

  const loadStartups = useCallback(async () => {
    if (!token) {
      setMessage("No token found.");
      return;
    }
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/deals/startups`, {
        headers: authHeaders(token)
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || "failed");
      }
      setStartups(await res.json());
    } catch {
      setMessage("Failed to load deal flow (investor role required).");
    }
  }, [token]);

  useEffect(() => {
    loadStartups();
  }, [loadStartups]);

  async function requestIntro(startupUserId: string) {
    if (!token) return;
    setIntroMsg(null);
    try {
      const res = await fetch(`${API_BASE}/deals/intros`, {
        method: "POST",
        headers: authJsonHeaders(token),
        body: JSON.stringify({
          startup_user_id: startupUserId,
          note: "Request intro via Metatron deal flow."
        })
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text || "failed");
      setIntroMsg("Introduction request queued (pending).");
    } catch {
      setIntroMsg("Could not request intro.");
    }
  }

  return (
    <main className="min-h-[calc(100vh-72px)] text-[var(--text)]">
      <header className="border-b border-[var(--border)] px-6 py-4 md:px-10">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[2px] text-[var(--text-muted)] mb-1">
          Dashboard
        </p>
        <h1 className="text-lg font-semibold">Investor</h1>
      </header>
      <section className="p-6 md:p-10 space-y-8 max-w-5xl">
        <div>
          <h2 className="text-sm font-semibold text-metatron-accent mb-3">
            Deal flow
          </h2>
          <p className="text-xs text-[var(--text-muted)] mb-4 max-w-2xl leading-relaxed">
            Startups are matched to your sector and stage preferences from your
            investor profile. Complete your profile in the database to refine
            matches.
          </p>
          <div className="flex flex-wrap gap-2 mb-4">
            <button
              type="button"
              onClick={loadStartups}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)] hover:border-metatron-accent/30"
            >
              Refresh list
            </button>
          </div>
          {introMsg && (
            <p className="text-xs text-[var(--text-muted)] mb-3">{introMsg}</p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {startups.map((s) => (
              <div
                key={s.user_id}
                className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-4 flex flex-col gap-3"
              >
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text)]">
                    {s.company_name || "Unnamed company"}
                  </h3>
                  <p className="text-[11px] text-[var(--text-muted)] mt-1 font-mono uppercase tracking-wide">
                    {(s.stage || "—") + " · " + (s.sector || "—")}
                  </p>
                  <p className="text-xs text-[var(--text-muted)] mt-2 leading-relaxed">
                    {s.one_liner || "No one-liner yet."}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 mt-auto">
                  {s.pitch_deck_url ? (
                    <a
                      href={s.pitch_deck_url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg bg-metatron-accent/15 border border-metatron-accent/30 px-3 py-1.5 text-xs font-semibold text-metatron-accent hover:bg-metatron-accent/25"
                    >
                      View pitch
                    </a>
                  ) : (
                    <span className="text-[11px] text-[var(--text-muted)]">
                      No deck on file
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => requestIntro(s.user_id)}
                    className="rounded-lg bg-metatron-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-metatron-accent-hover"
                  >
                    Request intro
                  </button>
                </div>
              </div>
            ))}
            {startups.length === 0 && (
              <p className="text-sm text-[var(--text-muted)] sm:col-span-2">
                No startups in the feed yet. Founders need a saved profile to
                appear here.
              </p>
            )}
          </div>
        </div>

        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Funding pools</h2>
            <button
              type="button"
              onClick={loadPools}
              className="rounded-lg bg-metatron-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-metatron-accent-hover transition-all"
            >
              Load pools
            </button>
          </div>
          {message && (
            <p className="text-xs text-[var(--text-muted)]">{message}</p>
          )}
          <ul className="space-y-2 text-xs">
            {pools.map((pool) => (
              <li
                key={pool.id}
                className="rounded-lg border border-[var(--border)] px-3 py-2.5 bg-[color-mix(in_srgb,var(--bg)_88%,transparent)]"
              >
                <div className="font-medium text-[var(--text)]">
                  {pool.name}
                </div>
                {pool.description && (
                  <p className="text-[var(--text-muted)] mt-0.5">
                    {pool.description}
                  </p>
                )}
              </li>
            ))}
            {pools.length === 0 && !message && (
              <li className="text-[var(--text-muted)]">No pools loaded yet.</li>
            )}
          </ul>
        </div>
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5">
          <h2 className="text-sm font-semibold mb-1">Commitments</h2>
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            Fiat and stablecoin commitments and legal documents will appear
            here.
          </p>
        </div>
      </section>
    </main>
  );
}
