"use client";

import { FounderCard, ProBlurOverlay } from "@/components/FounderCard";
import { API_BASE, authHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { FounderPublic } from "@/components/FounderCard";
import { useCallback, useEffect, useState } from "react";

export default function FoundersDiscoveryPage() {
  const { token, loading, isPro } = useAuth();
  const [founders, setFounders] = useState<FounderPublic[]>([]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/profile/founders/all`, {
        headers: authHeaders(token),
      });
      if (res.ok) {
        setFounders((await res.json()) as FounderPublic[]);
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
    <main className="min-h-[calc(100vh-72px)] text-[var(--text)]">
      <header className="border-b border-[var(--border)] px-6 py-4 md:px-10">
        <p className="mb-1 font-mono text-[11px] font-medium uppercase tracking-[2px] text-[var(--text-muted)]">
          Discovery
        </p>
        <h1 className="text-lg font-semibold">Founders</h1>
      </header>
      <section className="max-w-5xl p-6 md:p-10">
        <p className="mb-6 max-w-2xl text-xs leading-relaxed text-[var(--text-muted)]">
          Browse founder profiles on Metatron. Follow teams, request intros, or
          send a message request.
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
              No founders yet.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
