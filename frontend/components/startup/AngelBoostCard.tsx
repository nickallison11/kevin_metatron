"use client";

import { type FormEvent, useEffect, useState } from "react";
import { IconX } from "@tabler/icons-react";
import { API_BASE, authJsonHeaders } from "@/lib/api";

export type FounderExtras = {
  founder_name: string | null;
  founder_linkedin: string | null;
  company_linkedin: string | null;
  company_x: string | null;
  company_github: string | null;
  missing: { id: string; points: number }[];
  deck_cover_url: string | null;
  deck_pages: number | null;
  deck_uploaded_at: string | null;
  angel_score: number | null;
  angel_potential: number | null;
};

const FIELDS: Record<string, { label: string; type: "text" | "url"; placeholder: string }> = {
  name: { label: "Your name", type: "text", placeholder: "Alex Mokoena" },
  linkedin: { label: "Your LinkedIn", type: "url", placeholder: "linkedin.com/in/…" },
  company_linkedin: { label: "Company LinkedIn", type: "url", placeholder: "linkedin.com/company/…" },
  x: { label: "X", type: "url", placeholder: "x.com/…" },
  github: { label: "GitHub", type: "url", placeholder: "github.com/…" },
};

/**
 * Angel Score with the links still missing as "+" chips. Each opens a
 * one-field sheet; saving adds that link's points straight away.
 */
export default function AngelBoostCard({
  token,
  extras,
  onChange,
}: {
  token: string;
  extras: FounderExtras;
  onChange: (e: FounderExtras) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setEditing(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing]);

  const score = extras.angel_score;
  const potential = extras.angel_potential;
  const missing = extras.missing.filter((m) => FIELDS[m.id]);
  if (score == null && missing.length === 0) return null;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editing || !value.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/founder-extras`, {
        method: "PATCH",
        headers: authJsonHeaders(token),
        body: JSON.stringify({ field: editing, value }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text.trim() || "Couldn't save that.");
      onChange(JSON.parse(text) as FounderExtras);
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that.");
    } finally {
      setBusy(false);
    }
  }

  const field = editing ? FIELDS[editing] : null;
  const points = missing.find((m) => m.id === editing)?.points ?? 0;

  return (
    <section aria-label="Angel Score" className="flex flex-col gap-3.5 rounded-[16px] border border-[var(--overlay-12)] bg-[var(--bg-card)] p-4 sm:p-5 md:flex-row md:flex-wrap md:items-center md:gap-x-7">
      <div className="flex flex-col gap-2.5 md:flex-[1_1_260px]">
        <div className="flex items-baseline justify-between gap-3 md:justify-start">
          <span className="text-base font-semibold">Angel Score</span>
          <span className="flex items-baseline gap-2">
            <span className="text-[28px] font-bold leading-none tracking-tight">{score ?? "—"}</span>
            {missing.length > 0 && potential != null && score != null && potential > score && (
              <span className="text-[13px] text-[var(--accent-fg)]">↑ {potential}</span>
            )}
          </span>
        </div>
        {score != null && (
          <div aria-hidden className="relative h-2 overflow-hidden rounded-full bg-[var(--overlay-8)]">
            {potential != null && <div className="absolute inset-y-0 left-0 rounded-full bg-metatron-accent/30" style={{ width: `${potential}%` }} />}
            <div className="absolute inset-y-0 left-0 rounded-full bg-metatron-accent" style={{ width: `${score}%` }} />
          </div>
        )}
      </div>

      {missing.length > 0 && (
        <div className="flex flex-wrap gap-2 md:flex-[999_1_420px]">
          {missing.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                setEditing(m.id);
                setValue("");
                setError(null);
              }}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-dashed border-metatron-accent/60 bg-metatron-accent/[0.08] px-3 text-sm font-medium hover:bg-metatron-accent/[0.14]"
            >
              <span aria-hidden className="text-base leading-none text-[var(--accent-fg)]">+</span>
              {FIELDS[m.id]!.label}
              <span className="text-xs text-[var(--accent-fg)]">+{m.points}</span>
            </button>
          ))}
        </div>
      )}

      {field && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-black/60 sm:items-center sm:justify-center sm:p-6">
          <button type="button" aria-label="Close" onClick={() => setEditing(null)} className="flex-1 cursor-default sm:absolute sm:inset-0" />
          <form
            onSubmit={save}
            role="dialog"
            aria-label={field.label}
            className="relative flex flex-col gap-3 rounded-t-[22px] border-t border-[var(--overlay-12)] bg-[var(--bg-card)] px-4 pb-[max(24px,env(safe-area-inset-bottom))] pt-2.5 sm:w-full sm:max-w-[400px] sm:rounded-[18px] sm:border sm:p-5"
          >
            <span aria-hidden className="mx-auto mb-1 h-1 w-10 rounded-full bg-[var(--overlay-12)] sm:hidden" />
            <div className="flex items-center justify-between">
              <label htmlFor="boost-field" className="text-base font-semibold">
                {field.label}
              </label>
              <button type="button" aria-label="Close" onClick={() => setEditing(null)} className="-mr-2 hidden h-10 w-10 items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)] sm:flex">
                <IconX size={18} />
              </button>
            </div>
            <input
              id="boost-field"
              type="text"
              inputMode={field.type === "url" ? "url" : "text"}
              autoComplete={field.type === "url" ? "url" : "name"}
              autoCapitalize={field.type === "url" ? "none" : "words"}
              placeholder={field.placeholder}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="min-h-[52px] w-full rounded-xl border border-[var(--overlay-12)] bg-[var(--bg)] px-3.5 text-base text-[var(--text)] outline-none placeholder:text-[var(--text-muted)] focus:border-metatron-accent"
            />
            {error && (
              <p role="alert" className="text-sm text-[var(--warn)]">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={busy || !value.trim()}
              className="min-h-[52px] rounded-[14px] bg-metatron-accent text-base font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-50"
            >
              {busy ? "Saving…" : `Save · +${points}`}
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
