"use client";

import { FormEvent, useEffect, useState } from "react";
import { API_BASE, authJsonHeaders } from "@/lib/api";
import { COUNTRIES } from "@/lib/countries";
import { STAGES } from "@/lib/stages";
import { SECTOR_OPTIONS } from "@/lib/sectorOptions";
import { useAuth } from "@/lib/auth";

type InvestorProfile = {
  firm_name?: string | null;
  bio?: string | null;
  investment_thesis?: string | null;
  sectors?: string[];
  stages?: string[];
  ticket_size_min?: number | null;
  ticket_size_max?: number | null;
  country?: string | null;
  is_accredited?: boolean;
};

export default function InvestorProfilePage() {
  const { token, loading: authLoading } = useAuth("INVESTOR");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [p, setP] = useState<InvestorProfile>({
    sectors: [],
    stages: [],
    is_accredited: false,
  });

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/investor-profile`, {
          headers: authJsonHeaders(token),
        });
        if (res.ok) {
          const data = (await res.json()) as InvestorProfile;
          setP({
            ...data,
            sectors: data.sectors ?? [],
            stages: data.stages ?? [],
            is_accredited: Boolean(data.is_accredited),
          });
        }
      } catch {
        setMsg("Could not load profile.");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  if (authLoading || !token) return null;

  function toggleSector(s: string) {
    setP((prev) => {
      const cur = prev.sectors ?? [];
      const next = cur.includes(s)
        ? cur.filter((x) => x !== s)
        : [...cur, s];
      return { ...prev, sectors: next };
    });
  }

  function toggleStage(v: string) {
    setP((prev) => {
      const cur = prev.stages ?? [];
      const next = cur.includes(v)
        ? cur.filter((x) => x !== v)
        : [...cur, v];
      return { ...prev, stages: next };
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`${API_BASE}/investor-profile`, {
        method: "PUT",
        headers: authJsonHeaders(token),
        body: JSON.stringify({
          firm_name: p.firm_name ?? null,
          bio: p.bio ?? null,
          investment_thesis: p.investment_thesis ?? null,
          sectors: (p.sectors?.length ?? 0) > 0 ? p.sectors : null,
          stages: (p.stages?.length ?? 0) > 0 ? p.stages : null,
          ticket_size_min: p.ticket_size_min ?? null,
          ticket_size_max: p.ticket_size_max ?? null,
          country: p.country ?? null,
          is_accredited: p.is_accredited ?? false,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMsg("Saved.");
    } catch {
      setMsg("Could not save profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="flex-1">
      <header className="border-b border-[var(--border)] px-6 py-4 md:px-10">
        <p className="mb-1 font-mono text-[11px] font-medium uppercase tracking-[2px] text-[var(--text-muted)]">
          Profile
        </p>
        <h1 className="text-lg font-semibold">Investor profile</h1>
      </header>
      <section className="max-w-2xl p-6 md:p-10">
        {loading ? (
          <p className="text-sm text-[var(--text-muted)]">Loading…</p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-5">
            <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
              Firm name
              <input
                className="input-metatron py-2.5 text-sm"
                value={p.firm_name ?? ""}
                onChange={(e) =>
                  setP((x) => ({ ...x, firm_name: e.target.value }))
                }
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
              Bio
              <textarea
                className="input-metatron min-h-[100px] py-2.5 text-sm"
                value={p.bio ?? ""}
                onChange={(e) => setP((x) => ({ ...x, bio: e.target.value }))}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
              Investment thesis
              <textarea
                className="input-metatron min-h-[100px] py-2.5 text-sm"
                value={p.investment_thesis ?? ""}
                onChange={(e) =>
                  setP((x) => ({ ...x, investment_thesis: e.target.value }))
                }
              />
            </label>

            <div>
              <p className="mb-2 text-xs text-[var(--text-muted)]">Sectors</p>
              <div className="flex flex-wrap gap-2">
                {SECTOR_OPTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleSector(s)}
                    className={[
                      "rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
                      (p.sectors ?? []).includes(s)
                        ? "border-metatron-accent/40 bg-metatron-accent/15 text-metatron-accent"
                        : "border-[var(--border)] text-[var(--text-muted)] hover:border-metatron-accent/25",
                    ].join(" ")}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs text-[var(--text-muted)]">Stages</p>
              <div className="flex flex-wrap gap-2">
                {STAGES.map((s) => (
                  <button
                    key={s.v}
                    type="button"
                    onClick={() => toggleStage(s.v)}
                    className={[
                      "rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
                      (p.stages ?? []).includes(s.v)
                        ? "border-metatron-accent/40 bg-metatron-accent/15 text-metatron-accent"
                        : "border-[var(--border)] text-[var(--text-muted)] hover:border-metatron-accent/25",
                    ].join(" ")}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
                Ticket min (USD)
                <input
                  type="number"
                  min={0}
                  className="input-metatron py-2.5 text-sm"
                  value={p.ticket_size_min ?? ""}
                  onChange={(e) =>
                    setP((x) => ({
                      ...x,
                      ticket_size_min: e.target.value
                        ? Number(e.target.value)
                        : null,
                    }))
                  }
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
                Ticket max (USD)
                <input
                  type="number"
                  min={0}
                  className="input-metatron py-2.5 text-sm"
                  value={p.ticket_size_max ?? ""}
                  onChange={(e) =>
                    setP((x) => ({
                      ...x,
                      ticket_size_max: e.target.value
                        ? Number(e.target.value)
                        : null,
                    }))
                  }
                />
              </label>
            </div>

            <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
              Country
              <select
                className="input-metatron py-2.5 text-sm"
                value={p.country ?? ""}
                onChange={(e) =>
                  setP((x) => ({ ...x, country: e.target.value || null }))
                }
              >
                <option value="">Select…</option>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-2 text-sm text-[var(--text)]">
              <input
                type="checkbox"
                checked={p.is_accredited ?? false}
                onChange={(e) =>
                  setP((x) => ({ ...x, is_accredited: e.target.checked }))
                }
                className="rounded border-[var(--border)]"
              />
              I confirm I am an accredited investor (jurisdiction-dependent)
            </label>

            {msg && (
              <p className="text-xs text-[var(--text-muted)]">{msg}</p>
            )}

            <button
              type="submit"
              disabled={saving}
              className="rounded-[12px] bg-metatron-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save profile"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
