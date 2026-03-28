"use client";

import { useEffect, useState } from "react";

type Pool = {
  id: string;
  name: string;
  description?: string | null;
};

export default function InvestorDashboardPage() {
  const [token, setToken] = useState<string | null>(null);
  const [pools, setPools] = useState<Pool[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setToken(window.localStorage.getItem("metatron_token"));
  }, []);

  async function loadPools() {
    if (!token) {
      setMessage("No token found. Please sign up or log in first.");
      return;
    }
    setMessage(null);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000"}/pools`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );
      if (!res.ok) {
        throw new Error("failed");
      }
      const data: Pool[] = await res.json();
      setPools(data);
    } catch {
      setMessage("Failed to load pools.");
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
      <section className="p-6 md:p-10 space-y-4 max-w-3xl">
        <div className="rounded-metatron border border-[var(--border)] bg-[var(--bg-card)] p-5 space-y-3">
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
                  <p className="text-[var(--text-muted)] mt-0.5">{pool.description}</p>
                )}
              </li>
            ))}
            {pools.length === 0 && !message && (
              <li className="text-[var(--text-muted)]">No pools loaded yet.</li>
            )}
          </ul>
        </div>
        <div className="rounded-metatron border border-[var(--border)] bg-[var(--bg-card)] p-5">
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
