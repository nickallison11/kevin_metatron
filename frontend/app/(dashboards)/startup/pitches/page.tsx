"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { API_BASE, authHeaders, authJsonHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type Pitch = {
  id: string;
  title: string;
  description?: string | null;
  problem?: string | null;
  solution?: string | null;
  market_size?: string | null;
  business_model?: string | null;
  traction?: string | null;
  funding_ask?: string | null;
  use_of_funds?: string | null;
  stage?: string | null;
};

type FormTab = "overview" | "problem" | "market" | "traction";

const TABS: { id: FormTab; label: string }[] = [
  { id: "overview", label: "Basics" },
  { id: "problem", label: "Problem & solution" },
  { id: "market", label: "Market & model" },
  { id: "traction", label: "Traction & raise" }
];

function tractionHeadline(traction: string | null | undefined): string | null {
  if (!traction?.trim()) return null;
  const line = traction.trim().split(/\n/)[0]?.trim();
  if (!line) return null;
  return line.length > 100 ? `${line.slice(0, 97)}…` : line;
}

function optionalBody(
  fields: Record<string, string>
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(fields)) {
    const t = v.trim();
    out[k] = t.length ? t : null;
  }
  return out;
}

export default function StartupPitchesPage() {
  const { token, loading } = useAuth();
  const [pitches, setPitches] = useState<Pitch[]>([]);
  const [tab, setTab] = useState<FormTab>("overview");
  const [msg, setMsg] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [problem, setProblem] = useState("");
  const [solution, setSolution] = useState("");
  const [marketSize, setMarketSize] = useState("");
  const [businessModel, setBusinessModel] = useState("");
  const [traction, setTraction] = useState("");
  const [fundingAsk, setFundingAsk] = useState("");
  const [useOfFunds, setUseOfFunds] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/pitches`, {
        headers: authHeaders(token)
      });
      if (res.ok) setPitches(await res.json());
      else setMsg("Failed to load pitches.");
    } catch {
      setMsg("Failed to load pitches.");
    }
  }, [token]);

  useEffect(() => {
    if (!loading && token) load();
  }, [loading, token, load]);

  if (loading) return null;
  if (!token) return null;

  function resetForm() {
    setTitle("");
    setDescription("");
    setProblem("");
    setSolution("");
    setMarketSize("");
    setBusinessModel("");
    setTraction("");
    setFundingAsk("");
    setUseOfFunds("");
    setTab("overview");
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!token) {
      setMsg("No token — sign up as founder first.");
      return;
    }
    setMsg(null);
    const opt = optionalBody({
      description,
      problem,
      solution,
      market_size: marketSize,
      business_model: businessModel,
      traction,
      funding_ask: fundingAsk,
      use_of_funds: useOfFunds
    });
    try {
      const res = await fetch(`${API_BASE}/pitches`, {
        method: "POST",
        headers: authJsonHeaders(token),
        body: JSON.stringify({
          title: title.trim(),
          ...opt
        })
      });
      if (!res.ok) throw new Error("failed");
      resetForm();
      setMsg("Pitch saved.");
      load();
    } catch {
      setMsg("Failed to create pitch.");
    }
  }

  return (
    <main className="flex-1">
      <header className="border-b border-[var(--border)] px-6 py-4 md:px-10">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[2px] text-[var(--text-muted)] mb-1">
          Pitches
        </p>
        <h1 className="text-lg font-semibold">Your pitches</h1>
      </header>
      <section className="p-6 md:p-10 max-w-3xl space-y-6">
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5 space-y-4">
          <h2 className="text-sm font-semibold">Create a pitch</h2>
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            Work through each section. Only the title is required; add detail
            where it helps investors understand your story.
          </p>

          <div
            className="flex flex-wrap gap-1.5 border-b border-[var(--border)] pb-3"
            role="tablist"
            aria-label="Pitch sections"
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  tab === t.id
                    ? "bg-metatron-accent text-white"
                    : "bg-[rgba(255,255,255,0.04)] text-[var(--text-muted)] hover:text-[var(--text)]"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <form onSubmit={onCreate} className="space-y-4 text-sm">
            {tab === "overview" && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-[var(--text)]">
                    Title
                  </label>
                  <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                    A clear, memorable name for this pitch (e.g. company or
                    product).
                  </p>
                  <input
                    className="input-metatron"
                    placeholder="e.g. Acme — B2B payments for Africa"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-[var(--text)]">
                    Short description
                  </label>
                  <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                    One or two sentences: what you do and who it is for. This
                    appears in lists and intros.
                  </p>
                  <textarea
                    className="input-metatron min-h-[96px] resize-y"
                    placeholder="What is this pitch about?"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
              </div>
            )}

            {tab === "problem" && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-[var(--text)]">
                    Problem
                  </label>
                  <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                    The pain or gap in the market. Be specific about who suffers
                    and why existing options fall short.
                  </p>
                  <textarea
                    className="input-metatron min-h-[120px] resize-y"
                    placeholder="What problem are you solving?"
                    value={problem}
                    onChange={(e) => setProblem(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-[var(--text)]">
                    Solution
                  </label>
                  <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                    How your product or approach fixes it. Focus on outcomes,
                    not feature lists.
                  </p>
                  <textarea
                    className="input-metatron min-h-[120px] resize-y"
                    placeholder="How do you solve it?"
                    value={solution}
                    onChange={(e) => setSolution(e.target.value)}
                  />
                </div>
              </div>
            )}

            {tab === "market" && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-[var(--text)]">
                    Market size
                  </label>
                  <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                    TAM / SAM / SOM or a reasoned estimate of reachable revenue.
                    Cite sources if you have them.
                  </p>
                  <textarea
                    className="input-metatron min-h-[120px] resize-y"
                    placeholder="How big is the opportunity?"
                    value={marketSize}
                    onChange={(e) => setMarketSize(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-[var(--text)]">
                    Business model
                  </label>
                  <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                    How you make money: pricing motion, who pays, unit economics
                    at a high level.
                  </p>
                  <textarea
                    className="input-metatron min-h-[120px] resize-y"
                    placeholder="How will you monetize?"
                    value={businessModel}
                    onChange={(e) => setBusinessModel(e.target.value)}
                  />
                </div>
              </div>
            )}

            {tab === "traction" && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-[var(--text)]">
                    Traction
                  </label>
                  <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                    Proof points: revenue, users, pilots, logos, growth rates,
                    retention — whatever shows momentum.
                  </p>
                  <textarea
                    className="input-metatron min-h-[120px] resize-y"
                    placeholder="What have you achieved so far?"
                    value={traction}
                    onChange={(e) => setTraction(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-[var(--text)]">
                    Funding ask
                  </label>
                  <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                    Round size, instrument (SAFE, equity), and valuation or cap
                    if relevant.
                  </p>
                  <textarea
                    className="input-metatron min-h-[88px] resize-y"
                    placeholder="e.g. $500k seed on a $4M cap SAFE"
                    value={fundingAsk}
                    onChange={(e) => setFundingAsk(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-[var(--text)]">
                    Use of funds
                  </label>
                  <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                    How you will deploy capital: hiring, product, GTM, runway
                    months — keep it credible and tied to milestones.
                  </p>
                  <textarea
                    className="input-metatron min-h-[120px] resize-y"
                    placeholder="Where will the money go?"
                    value={useOfFunds}
                    onChange={(e) => setUseOfFunds(e.target.value)}
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              className="rounded-lg bg-metatron-accent px-4 py-2 text-xs font-semibold text-white hover:bg-metatron-accent-hover"
            >
              Save pitch
            </button>
          </form>
        </div>

        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5">
          <h2 className="text-sm font-semibold mb-3">All pitches</h2>
          <ul className="space-y-3 text-sm">
            {pitches.map((p) => {
              const th = tractionHeadline(p.traction);
              return (
                <li
                  key={p.id}
                  className="rounded-lg border border-[var(--border)] bg-[rgba(255,255,255,0.02)] px-4 py-3 space-y-2"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="font-medium text-[var(--text)] min-w-0">
                      {p.title}
                    </div>
                    {p.stage ? (
                      <span className="shrink-0 rounded-md border border-[var(--border)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                        {p.stage}
                      </span>
                    ) : null}
                  </div>
                  {p.funding_ask?.trim() ? (
                    <p className="text-xs text-[var(--text)]">
                      <span className="text-[var(--text-muted)]">Funding · </span>
                      {p.funding_ask.trim()}
                    </p>
                  ) : null}
                  {th ? (
                    <p className="text-xs text-[var(--text-muted)] line-clamp-2">
                      <span className="text-[var(--text-muted)]">Traction · </span>
                      {th}
                    </p>
                  ) : null}
                  {!p.funding_ask?.trim() && !th && p.description?.trim() ? (
                    <p className="text-xs text-[var(--text-muted)] line-clamp-2">
                      {p.description.trim()}
                    </p>
                  ) : null}
                </li>
              );
            })}
            {pitches.length === 0 && (
              <li className="text-xs text-[var(--text-muted)]">
                No pitches yet.
              </li>
            )}
          </ul>
        </div>
        {msg && (
          <p className="text-xs text-[var(--text-muted)]">{msg}</p>
        )}
      </section>
    </main>
  );
}
