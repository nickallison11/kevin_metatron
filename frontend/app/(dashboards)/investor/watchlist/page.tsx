"use client";

import { FounderCard } from "@/components/FounderCard";
import { API_BASE, authHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { FounderPublic } from "@/components/FounderCard";
import { useCallback, useEffect, useState } from "react";

export default function InvestorWatchlistPage() {
  const { token, loading } = useAuth("INVESTOR");
  const [rows, setRows] = useState<FounderPublic[]>([]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/connections/following`, {
        headers: authHeaders(token),
      });
      if (res.ok) {
        setRows((await res.json()) as FounderPublic[]);
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
      <section className="max-w-5xl mx-auto space-y-6 p-6 md:p-10">
        <h1 className="text-2xl font-semibold text-[var(--text)]">Followed founders</h1>
        <p className="max-w-2xl text-xs leading-relaxed text-[var(--text-muted)]">
          Founders you follow via the Follow action on deal flow or discovery.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {rows.map((f) => (
            <FounderCard key={f.user_id} founder={f} token={token} />
          ))}
          {rows.length === 0 && (
            <p className="text-sm text-[var(--text-muted)] sm:col-span-2">
              You are not following any founders yet.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
