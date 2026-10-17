"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { API_BASE, authHeaders, authJsonHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type Memo = { id: string; founder_user_id: string; content: string; generated_at: string; company_name: string | null };
type Option = { id: string; name: string };

const card = "rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] shadow-[var(--card-shadow)]";
const btn =
  "inline-flex min-h-10 items-center justify-center rounded-[10px] border border-[var(--overlay-12)] px-4 text-[13px] font-medium text-[var(--text)] hover:bg-[var(--overlay-4)] disabled:opacity-50";
const btnPrimary =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-metatron-accent px-5 text-sm font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-50";

export default function InvestorMemosPage() {
  const { token, loading } = useAuth("INVESTOR");
  const [tier, setTier] = useState<string | null>(null);
  const [memos, setMemos] = useState<Memo[]>([]);
  const [options, setOptions] = useState<Option[]>([]);
  const [pick, setPick] = useState("");
  const [writing, setWriting] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const get = (path: string) => fetch(`${API_BASE}${path}`, { headers: authHeaders(token) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const [ip, list, pipeline, matches, following] = await Promise.all([
      get("/investor-profile"),
      get("/investment-memos"),
      get("/investor-pipeline"),
      get("/kevin-matches"),
      get("/connections/following"),
    ]);
    setTier((ip as { investor_tier?: string | null } | null)?.investor_tier ?? "free");
    setMemos(Array.isArray(list) ? (list as Memo[]) : []);
    // Startups you can write about: your pipeline, Kevin's matches and the ones you follow.
    const seen = new Map<string, string>();
    for (const r of (pipeline as { founder_user_id: string; company_name: string | null }[] | null) ?? []) seen.set(r.founder_user_id, r.company_name ?? "Startup");
    for (const m of (matches as { matched_user_id: string | null; company_name: string | null }[] | null) ?? [])
      if (m.matched_user_id && m.company_name && !seen.has(m.matched_user_id)) seen.set(m.matched_user_id, m.company_name);
    for (const f of (following as { user_id: string; company_name: string | null }[] | null) ?? [])
      if (!seen.has(f.user_id)) seen.set(f.user_id, f.company_name ?? "Startup");
    const opts = [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
    setOptions(opts);
    setPick((cur) => cur || opts[0]?.id || "");
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const monthCount = useMemo(() => {
    const thisMonth = new Date().toISOString().slice(0, 7);
    return memos.filter((m) => m.generated_at?.startsWith(thisMonth)).length;
  }, [memos]);

  async function draft() {
    if (!token || !pick) return;
    setWriting(true);
    setMsg(null);
    try {
      const res = await fetch(`${API_BASE}/investment-memos`, {
        method: "POST",
        headers: authJsonHeaders(token),
        body: JSON.stringify({ founder_user_id: pick }),
      });
      if (!res.ok) throw new Error((await res.text()).trim() || "Kevin couldn't write that memo. Try again.");
      const memo = (await res.json()) as Memo;
      setMemos((prev) => [memo, ...prev.filter((m) => m.id !== memo.id)]);
      setOpen(memo.id);
      setMsg({ ok: true, text: `Memo for ${memo.company_name ?? "the startup"} is ready.` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Kevin couldn't write that memo." });
    } finally {
      setWriting(false);
    }
  }

  async function remove(m: Memo) {
    if (!token || !window.confirm(`Delete the memo for ${m.company_name ?? "this startup"}?`)) return;
    const res = await fetch(`${API_BASE}/investment-memos/${m.id}`, { method: "DELETE", headers: authHeaders(token) }).catch(() => null);
    if (res?.ok) setMemos((prev) => prev.filter((x) => x.id !== m.id));
  }

  function download(m: Memo) {
    const blob = new Blob([m.content], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${m.company_name ?? "memo"}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (loading || !token) return null;

  return (
    <main className="min-w-0 flex-1">
      <section className="mx-auto flex max-w-5xl flex-col gap-5 p-6 md:p-10">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">Memos</span>
            <h1 className="text-[28px] font-semibold tracking-tight">Investment memos</h1>
            <p className="text-sm text-[var(--text-muted)]">Kevin drafts a first memo from the startup&apos;s pitch, deck and Angel Score.</p>
          </div>
          {tier === "basic" && <span className="text-sm text-[var(--text-muted)]">{monthCount} of 5 memos this month</span>}
        </header>

        {tier === null ? (
          <p className="text-sm text-[var(--text-muted)]">Loading…</p>
        ) : tier === "free" ? (
          <section className={`${card} flex flex-col items-start gap-3 p-6`}>
            <h2 className="text-lg font-semibold">Memos are on Investor Basic and Pro</h2>
            <p className="text-sm text-[var(--text-muted)]">Kevin writes a structured first memo for any startup: market, model, traction, team, risks and a recommendation.</p>
            <Link href="/investor/settings/subscription" className={btnPrimary}>
              Upgrade to Investor Basic
            </Link>
          </section>
        ) : (
          <section className={`${card} flex flex-col gap-3 border-dashed p-5 sm:flex-row sm:items-end`}>
            <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-[13px] font-semibold">
              <span>Write a memo for</span>
              <select
                value={pick}
                onChange={(e) => setPick(e.target.value)}
                disabled={options.length === 0}
                className="min-h-11 rounded-[10px] border border-[var(--overlay-12)] bg-[var(--bg)] px-3 text-sm font-normal text-[var(--text)]"
              >
                {options.length === 0 && <option value="">Add startups to your pipeline or follow some first</option>}
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className={btnPrimary} disabled={writing || !pick} onClick={() => void draft()}>
              {writing ? "Kevin is writing…" : "Draft memo"}
            </button>
          </section>
        )}

        {msg && (
          <p role="status" className={`text-sm ${msg.ok ? "text-[var(--accent-fg)]" : "text-[var(--danger)]"}`}>
            {msg.text}
          </p>
        )}

        {memos.length === 0 ? (
          tier !== "free" && tier !== null && <p className="text-sm text-[var(--text-muted)]">No memos yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {memos.map((m) => {
              const expanded = open === m.id;
              return (
                <article key={m.id} className={`${card} flex flex-col gap-3 p-4`}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-col">
                      <strong className="text-base">{m.company_name ?? "Startup"}</strong>
                      <span className="text-[13px] text-[var(--text-muted)]">{new Date(m.generated_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={btn} aria-expanded={expanded} onClick={() => setOpen(expanded ? null : m.id)}>
                        {expanded ? "Close" : "Open"}
                      </button>
                      <button type="button" className={btn} onClick={() => void remove(m)} aria-label={`Delete memo for ${m.company_name ?? "startup"}`}>
                        Delete
                      </button>
                    </div>
                  </div>
                  {expanded && (
                    <>
                      <div className="whitespace-pre-wrap border-t border-[var(--border)] pt-3 text-sm leading-relaxed">{m.content}</div>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className={btn} onClick={() => void navigator.clipboard.writeText(m.content)}>
                          Copy
                        </button>
                        <button type="button" className={btn} onClick={() => download(m)}>
                          Download .txt
                        </button>
                      </div>
                    </>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
