"use client";

import { ProBlurOverlay } from "@/components/FounderCard";
import { API_BASE, authHeaders, authJsonHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useCallback, useEffect, useState } from "react";

type InvestorPublic = {
  user_id: string;
  firm_name?: string | null;
  bio?: string | null;
  sectors?: string[] | null;
  stages?: string[] | null;
  ticket_size_min?: number | null;
  ticket_size_max?: number | null;
  country?: string | null;
};

export default function InvestorsDiscoveryPage() {
  const { token, loading, isPro } = useAuth();
  const [rows, setRows] = useState<InvestorPublic[]>([]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/investor-profile/all`, {
        headers: authHeaders(token),
      });
      if (res.ok) {
        setRows((await res.json()) as InvestorPublic[]);
      }
    } catch {
      /* ignore */
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function connect(
    toUserId: string,
    connectionType: "follow" | "intro_request",
  ) {
    if (!token) return;
    await fetch(`${API_BASE}/connections`, {
      method: "POST",
      headers: authJsonHeaders(token),
      body: JSON.stringify({ to_user_id: toUserId, connection_type: connectionType }),
    });
  }

  if (loading || !token) return null;

  return (
    <main className="min-h-[calc(100vh-72px)] text-[var(--text)]">
      <header className="border-b border-[var(--border)] px-6 py-4 md:px-10">
        <p className="mb-1 font-sans text-[11px] font-medium uppercase tracking-[2px] text-[var(--text-muted)]">
          Discovery
        </p>
        <h1 className="text-lg font-semibold">Investors</h1>
      </header>
      <section className="max-w-5xl p-6 md:p-10">
        <div className="grid gap-4 sm:grid-cols-2">
          {rows.map((inv, i) => {
            const bio = inv.bio?.trim() ?? "";
            const snippet =
              bio.length > 180 ? `${bio.slice(0, 180)}…` : bio || "—";
            const ticket =
              inv.ticket_size_min != null || inv.ticket_size_max != null
                ? `$${inv.ticket_size_min ?? "?"} – $${inv.ticket_size_max ?? "?"}`
                : "—";
            return (
              <div key={inv.user_id} className="relative">
                <div className="flex flex-col gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-4">
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--text)]">
                      {inv.firm_name || "Independent investor"}
                    </h3>
                    <p className="mt-2 text-xs leading-relaxed text-[var(--text-muted)]">
                      {snippet}
                    </p>
                    <p className="mt-2 font-sans text-[10px] text-[var(--text-muted)]">
                      {(inv.sectors ?? []).join(", ") || "—"} ·{" "}
                      {(inv.stages ?? []).join(", ") || "—"} · {ticket} ·{" "}
                      {inv.country ?? "—"}
                    </p>
                  </div>
                  <div className="mt-auto flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void connect(inv.user_id, "follow")}
                      className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] hover:border-metatron-accent/30"
                    >
                      Follow
                    </button>
                    <button
                      type="button"
                      onClick={() => void connect(inv.user_id, "intro_request")}
                      className="rounded-lg bg-metatron-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-metatron-accent-hover"
                    >
                      Request intro
                    </button>
                  </div>
                </div>
                {!isPro && i >= 2 ? (
                  <ProBlurOverlay label="Upgrade to Pro to see all investors" />
                ) : null}
              </div>
            );
          })}
          {rows.length === 0 && (
            <p className="text-sm text-[var(--text-muted)] sm:col-span-2">
              No investor profiles yet.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
