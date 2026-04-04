"use client";

import { FormEvent, useEffect, useState } from "react";
import { API_BASE, authHeaders, authJsonHeaders } from "@/lib/api";
import { COUNTRIES } from "@/lib/countries";
import { useAuth } from "@/lib/auth";

const SPECIALITIES = [
  "VC Network",
  "Angel Network",
  "Accelerator",
  "Corporate VC",
  "Ecosystem Partner",
  "Family Office",
  "Other",
] as const;

type Me = {
  first_name: string | null;
  last_name: string | null;
};

type ConnectorProfile = {
  organisation?: string | null;
  bio?: string | null;
  speciality?: string | null;
  country?: string | null;
};

export default function ConnectorProfilePage() {
  const { token, loading: authLoading } = useAuth("INTERMEDIARY");
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [p, setP] = useState<ConnectorProfile>({});

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    (async () => {
      try {
        const [rMe, rP] = await Promise.all([
          fetch(`${API_BASE}/auth/me`, { headers: authHeaders(token) }),
          fetch(`${API_BASE}/connector-profile`, {
            headers: authJsonHeaders(token),
          }),
        ]);
        if (rMe.ok) {
          const m = (await rMe.json()) as Me;
          setMe(m);
        }
        if (rP.ok) {
          setP((await rP.json()) as ConnectorProfile);
        }
      } catch {
        setMsg("Could not load profile.");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  if (authLoading || !token) return null;

  const displayName = [me?.first_name, me?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`${API_BASE}/connector-profile`, {
        method: "PUT",
        headers: authJsonHeaders(token),
        body: JSON.stringify({
          organisation: p.organisation ?? null,
          bio: p.bio ?? null,
          speciality: p.speciality ?? null,
          country: p.country ?? null,
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
        <h1 className="text-lg font-semibold">Connector profile</h1>
      </header>
      <section className="max-w-2xl p-6 md:p-10">
        {loading ? (
          <p className="text-sm text-[var(--text-muted)]">Loading…</p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-5">
            <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[#0a0a0f] px-4 py-3 text-sm text-[var(--text-muted)]">
              <span className="font-mono text-[10px] uppercase tracking-wider">
                Name (from account)
              </span>
              <p className="mt-1 text-[var(--text)]">
                {displayName || "—"}
              </p>
            </div>

            <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
              Organisation
              <input
                className="input-metatron py-2.5 text-sm"
                value={p.organisation ?? ""}
                onChange={(e) =>
                  setP((x) => ({ ...x, organisation: e.target.value }))
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
              Speciality
              <select
                className="input-metatron py-2.5 text-sm"
                value={p.speciality ?? ""}
                onChange={(e) =>
                  setP((x) => ({ ...x, speciality: e.target.value || null }))
                }
              >
                <option value="">Select…</option>
                {SPECIALITIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
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
