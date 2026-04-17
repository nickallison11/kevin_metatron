"use client";

import { FounderCard, ProBlurOverlay } from "@/components/FounderCard";
import { API_BASE, authHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { FounderPublic } from "@/components/FounderCard";
import { STAGES } from "@/lib/stages";
import { useCallback, useEffect, useMemo, useState } from "react";

export default function InvestorDealFlowPage() {
  const { token, loading, isPro } = useAuth("INVESTOR");
  const [founders, setFounders] = useState<FounderPublic[]>([]);
  const [total, setTotal] = useState(0);
  const [tier, setTier] = useState("free");
  const [sectorQ, setSectorQ] = useState("");
  const [stageQ, setStageQ] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/deals/startups`, {
        headers: authHeaders(token),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          startups?: FounderPublic[];
          total?: number;
          tier?: string;
        };
        setFounders(Array.isArray(data.startups) ? data.startups : []);
        setTotal(typeof data.total === "number" ? data.total : 0);
        setTier(typeof data.tier === "string" ? data.tier : "free");
      }
    } catch {
      /* ignore */
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const sq = sectorQ.trim().toLowerCase();
    const stq = stageQ.trim().toLowerCase();
    return founders.filter((f) => {
      const sec = (f.sector ?? "").toLowerCase();
      const st = (f.stage ?? "").toLowerCase();
      const okSec = !sq || sec.includes(sq);
      const okSt = !stq || st === stq;
      return okSec && okSt;
    });
  }, [founders, sectorQ, stageQ]);

  if (loading || !token) return null;

  return (
    <main className="flex-1">
      <header className="border-b border-[var(--border)] px-6 py-4 md:px-10">
        <p className="mb-1 font-sans text-[11px] font-medium uppercase tracking-[2px] text-[var(--text-muted)]">
          Deal flow
        </p>
        <h1 className="text-lg font-semibold">All founders</h1>
      </header>
      <section className="max-w-5xl space-y-6 p-6 md:p-10">
        {tier === "free" && total > 10 && (
          <div style={{ background: "rgba(108,92,231,0.1)", border: "1px solid rgba(108,92,231,0.3)", borderRadius: 8, padding: "12px 16px", marginBottom: 16, color: "var(--muted)", fontSize: 14 }}>
            Showing 10 of {total} founders. <a href="/investor/settings/subscription" style={{ color: "#6c5ce7" }}>Upgrade to see all</a>
          </div>
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
            Sector contains
            <input
              className="input-metatron max-w-xs py-2 text-sm"
              value={sectorQ}
              onChange={(e) => setSectorQ(e.target.value)}
              placeholder="e.g. fintech"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
            Stage
            <select
              className="input-metatron max-w-xs py-2 text-sm"
              value={stageQ}
              onChange={(e) => setStageQ(e.target.value)}
            >
              <option value="">Any</option>
              {STAGES.map((s) => (
                <option key={s.v} value={s.v}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {filtered.map((f, i) => (
            <div key={f.user_id} className="relative">
              <FounderCard founder={f} token={token} />
              {!isPro && i >= 2 ? (
                <ProBlurOverlay label="Upgrade Plan to see all founders" />
              ) : null}
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="text-sm text-[var(--text-muted)] sm:col-span-2">
              No founders match these filters.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
