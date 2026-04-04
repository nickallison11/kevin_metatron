"use client";

import { FounderCard, ProBlurOverlay } from "@/components/FounderCard";
import { StartupKevinChatCard } from "@/components/StartupKevinChatCard";
import { API_BASE, authHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { FounderPublic } from "@/components/FounderCard";
import { useCallback, useEffect, useState } from "react";

const KEVIN_CTX =
  "You are Kevin, an AI investment co-pilot. Help investors find great startups, evaluate deals, and manage their portfolio.";

export default function InvestorDashboardPage() {
  const { token, loading, isPro } = useAuth("INVESTOR");
  const [founders, setFounders] = useState<FounderPublic[]>([]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/profile/founders/all`, {
        headers: authHeaders(token),
      });
      if (res.ok) {
        const data = (await res.json()) as FounderPublic[];
        setFounders(data);
      }
    } catch {
      /* ignore */
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading || !token) return null;

  return (
    <main className="flex-1">
      <header className="border-b border-[var(--border)] px-6 py-4 md:px-10">
        <p className="mb-1 font-mono text-[11px] font-medium uppercase tracking-[2px] text-[var(--text-muted)]">
          Dashboard
        </p>
        <h1 className="text-lg font-semibold">Investor</h1>
      </header>
      <section className="max-w-5xl space-y-8 p-6 md:p-10">
        <StartupKevinChatCard
          token={token}
          systemContext={KEVIN_CTX}
          emptyHint="Ask Kevin about deal flow, diligence, or sector trends."
        />

        <div>
          <h2 className="mb-3 text-sm font-semibold text-metatron-accent">
            Deal flow
          </h2>
          <p className="mb-4 max-w-2xl text-xs leading-relaxed text-[var(--text-muted)]">
            Founders with a saved profile appear here. Free accounts see the
            first two startups clearly; additional cards are blurred until you
            upgrade to Pro.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {founders.map((f, i) => (
              <div key={f.user_id} className="relative">
                <FounderCard founder={f} token={token} />
                {!isPro && i >= 2 ? (
                  <ProBlurOverlay label="Upgrade to Pro to see all founders" />
                ) : null}
              </div>
            ))}
            {founders.length === 0 && (
              <p className="text-sm text-[var(--text-muted)] sm:col-span-2">
                No founders in the directory yet.
              </p>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
