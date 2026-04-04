"use client";

import { StartupKevinChatCard } from "@/components/StartupKevinChatCard";
import { API_BASE, authHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useCallback, useEffect, useState } from "react";

const KEVIN_CTX =
  "You are Kevin, an AI connector co-pilot. Help ecosystem connectors broker introductions, track referrals, and grow their network.";

type IntroRow = { id: string; status: string };
type RefRow = { id: string; status: string };

export default function ConnectorDashboardPage() {
  const { token, loading } = useAuth("INTERMEDIARY");
  const [intros, setIntros] = useState<IntroRow[]>([]);
  const [refs, setRefs] = useState<RefRow[]>([]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [ir, rr] = await Promise.all([
        fetch(`${API_BASE}/connector-profile/introductions`, {
          headers: authHeaders(token),
        }),
        fetch(`${API_BASE}/connector-profile/referrals`, {
          headers: authHeaders(token),
        }),
      ]);
      if (ir.ok) {
        setIntros((await ir.json()) as IntroRow[]);
      }
      if (rr.ok) {
        setRefs((await rr.json()) as RefRow[]);
      }
    } catch {
      /* ignore */
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading || !token) return null;

  const pendingIntro = intros.filter(
    (i) => i.status.toUpperCase() === "PENDING",
  ).length;

  return (
    <main className="flex-1">
      <header className="border-b border-[var(--border)] px-6 py-4 md:px-10">
        <p className="mb-1 font-mono text-[11px] font-medium uppercase tracking-[2px] text-[var(--text-muted)]">
          Dashboard
        </p>
        <h1 className="text-lg font-semibold">Connector</h1>
      </header>
      <section className="max-w-5xl space-y-8 p-6 md:p-10">
        <StartupKevinChatCard
          token={token}
          systemContext={KEVIN_CTX}
          emptyHint="Ask Kevin about warm intros, ecosystem partners, or referral tracking."
        />

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5">
            <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              Introductions brokered
            </p>
            <p className="mt-2 text-2xl font-semibold text-metatron-accent">
              {intros.length}
            </p>
          </div>
          <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5">
            <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              Referrals
            </p>
            <p className="mt-2 text-2xl font-semibold text-metatron-accent">
              {refs.length}
            </p>
          </div>
          <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5">
            <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              Pending intro requests
            </p>
            <p className="mt-2 text-2xl font-semibold text-metatron-accent">
              {pendingIntro}
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
