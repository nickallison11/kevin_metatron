"use client";

import KevinMatchFeed from "@/components/KevinMatchFeed";
import { StartupKevinChatCard } from "@/components/StartupKevinChatCard";
import { API_BASE, authJsonHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useCallback, useEffect, useState } from "react";

const KEVIN_CTX =
  "You are Kevin, an AI investment co-pilot. Help investors find great startups, evaluate deals, and manage their portfolio.";

const PIPELINE_STAGES = ["watching", "considering", "due_diligence", "passed", "invested"];
const STAGE_LABELS: Record<string, string> = {
  watching: "Watching",
  considering: "Considering",
  due_diligence: "Due Diligence",
  passed: "Passed",
  invested: "Invested",
};
const STAGE_COLORS: Record<string, string> = {
  watching: "bg-[var(--border)] text-[var(--text-muted)]",
  considering: "bg-metatron-accent/15 text-metatron-accent",
  due_diligence: "bg-blue-500/15 text-blue-400",
  passed: "bg-red-500/15 text-red-400",
  invested: "bg-green-500/15 text-green-400",
};

type PipelineRow = {
  id: string;
  founder_user_id: string;
  stage: string;
  company_name: string | null;
  one_liner: string | null;
  angel_score: number | null;
};

export default function InvestorDashboardPage() {
  const { token, loading } = useAuth("INVESTOR");
  const [pipeline, setPipeline] = useState<PipelineRow[]>([]);
  const [pipelineLoaded, setPipelineLoaded] = useState(false);

  const loadPipeline = useCallback(async () => {
    if (!token) return;
    const res = await fetch(`${API_BASE}/investor-pipeline`, { headers: authJsonHeaders(token) });
    if (res.ok) {
      setPipeline((await res.json()) as PipelineRow[]);
    } else {
      setPipeline([]);
    }
    setPipelineLoaded(true);
  }, [token]);

  const addToPipeline = useCallback(
    async (founderId: string, _companyName: string) => {
      if (!token) return;
      await fetch(`${API_BASE}/investor-pipeline`, {
        method: "POST",
        headers: authJsonHeaders(token),
        body: JSON.stringify({ founder_user_id: founderId, stage: "watching" }),
      });
      await loadPipeline();
    },
    [token, loadPipeline],
  );

  const updateStage = useCallback(
    async (id: string, stage: string) => {
      if (!token) return;
      await fetch(`${API_BASE}/investor-pipeline/${id}`, {
        method: "PATCH",
        headers: authJsonHeaders(token),
        body: JSON.stringify({ stage }),
      });
      await loadPipeline();
    },
    [token, loadPipeline],
  );

  const removeFromPipeline = useCallback(
    async (id: string) => {
      if (!token) return;
      await fetch(`${API_BASE}/investor-pipeline/${id}`, {
        method: "DELETE",
        headers: authJsonHeaders(token),
      });
      await loadPipeline();
    },
    [token, loadPipeline],
  );

  useEffect(() => {
    void loadPipeline();
  }, [loadPipeline]);

  if (loading || !token) return null;

  return (
    <main className="flex-1">
      <header className="border-b border-[var(--border)] px-6 py-4 md:px-10">
        <p className="mb-1 font-sans text-[11px] font-medium uppercase tracking-[2px] text-[var(--text-muted)]">
          Dashboard
        </p>
        <h1 className="text-lg font-semibold">Investor</h1>
      </header>
      <section className="max-w-5xl space-y-6 p-6 md:p-10">
        <KevinMatchFeed token={token} role="investor" onAddToPipeline={addToPipeline} />

        <StartupKevinChatCard
          token={token}
          systemContext={KEVIN_CTX}
          emptyHint="Ask Kevin about deal flow, diligence, or sector trends."
        />

        <div className="rounded-[12px] border border-[var(--border)] bg-[var(--bg-card)] p-6">
          <p className="font-sans text-[11px] uppercase tracking-[2px] text-[var(--text-muted)]">My Pipeline</p>
          {!pipelineLoaded ? (
            <p className="mt-4 text-sm text-[var(--text-muted)]">Loading…</p>
          ) : pipeline.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--text-muted)]">
              No founders in your pipeline yet. Add them from Kevin&apos;s matches above.
            </p>
          ) : (
            <div className="mt-4 space-y-2">
              {pipeline.map((row) => (
                <div key={row.id} className="flex items-center gap-4 rounded-[8px] border border-[var(--border)] p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-[var(--text)]">{row.company_name ?? "Founder"}</p>
                      {row.angel_score != null && (
                        <span className="rounded-full bg-metatron-accent/10 px-2 py-0.5 text-[10px] font-sans text-metatron-accent">
                          AS {row.angel_score}
                        </span>
                      )}
                    </div>
                    {row.one_liner && (
                      <p className="mt-0.5 text-xs text-[var(--text-muted)] line-clamp-1">{row.one_liner}</p>
                    )}
                  </div>
                  <select
                    value={row.stage}
                    onChange={(e) => void updateStage(row.id, e.target.value)}
                    className={`rounded-full border-0 px-2.5 py-1 text-[11px] font-semibold cursor-pointer ${STAGE_COLORS[row.stage] ?? ""}`}
                  >
                    {PIPELINE_STAGES.map((s) => (
                      <option key={s} value={s}>
                        {STAGE_LABELS[s]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => void removeFromPipeline(row.id)}
                    className="text-xs text-[var(--text-muted)] hover:text-red-400"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
