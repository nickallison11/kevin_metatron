"use client";

import { FormEvent, useEffect, useState } from "react";
import { API_BASE, authHeaders, authJsonHeaders } from "@/lib/api";

type Profile = {
  company_name?: string | null;
  one_liner?: string | null;
  stage?: string | null;
  sector?: string | null;
  country?: string | null;
  website?: string | null;
  pitch_deck_url?: string | null;
};

const STAGES = [
  { v: "pre-seed", label: "Pre-seed" },
  { v: "seed", label: "Seed" },
  { v: "series-a", label: "Series A" }
];

export default function StartupProfilePage() {
  const [token, setToken] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<Profile>({});

  useEffect(() => {
    setToken(window.localStorage.getItem("metatron_token"));
  }, []);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/profile`, {
          headers: authJsonHeaders(token)
        });
        if (res.ok) {
          const data = await res.json();
          setProfile(data);
        }
      } catch {
        setMsg("Could not load profile.");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!token) {
      setMsg("Sign in first.");
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`${API_BASE}/profile`, {
        method: "PUT",
        headers: authJsonHeaders(token),
        body: JSON.stringify(profile)
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text || "Save failed");
      setProfile(JSON.parse(text));
      setMsg("Saved.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function onDeckUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !token) {
      setMsg("Pick a file and ensure you are signed in.");
      return;
    }
    setMsg(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch(`${API_BASE}/uploads/pitch-deck`, {
        method: "POST",
        headers: authHeaders(token),
        body: fd
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(JSON.stringify(data));
      const url =
        typeof data === "object" && data && "url" in data
          ? String((data as { url: string }).url)
          : "";
      setProfile((p) => ({ ...p, pitch_deck_url: url }));
      setMsg("Pitch deck uploaded.");
    } catch {
      setMsg("Upload failed.");
    }
    e.target.value = "";
  }

  return (
    <main className="flex-1">
      <header className="border-b border-[var(--border)] px-6 py-4 md:px-10">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[2px] text-[var(--text-muted)] mb-1">
          Profile
        </p>
        <h1 className="text-lg font-semibold">Company & pitch deck</h1>
      </header>
      <section className="p-6 md:p-10 max-w-2xl space-y-6">
        {loading ? (
          <p className="text-sm text-[var(--text-muted)]">Loading…</p>
        ) : (
          <form onSubmit={onSave} className="space-y-4 text-sm">
            <label className="block space-y-1">
              <span className="font-mono text-[11px] uppercase text-[var(--text-muted)]">
                Company name
              </span>
              <input
                className="input-metatron"
                value={profile.company_name ?? ""}
                onChange={(e) =>
                  setProfile((p) => ({ ...p, company_name: e.target.value }))
                }
              />
            </label>
            <label className="block space-y-1">
              <span className="font-mono text-[11px] uppercase text-[var(--text-muted)]">
                One-liner
              </span>
              <input
                className="input-metatron"
                value={profile.one_liner ?? ""}
                onChange={(e) =>
                  setProfile((p) => ({ ...p, one_liner: e.target.value }))
                }
              />
            </label>
            <div className="grid sm:grid-cols-2 gap-4">
              <label className="block space-y-1">
                <span className="font-mono text-[11px] uppercase text-[var(--text-muted)]">
                  Stage
                </span>
                <select
                  className="input-metatron"
                  value={profile.stage ?? ""}
                  onChange={(e) =>
                    setProfile((p) => ({ ...p, stage: e.target.value || null }))
                  }
                >
                  <option value="">Select…</option>
                  {STAGES.map((s) => (
                    <option key={s.v} value={s.v}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="font-mono text-[11px] uppercase text-[var(--text-muted)]">
                  Sector
                </span>
                <input
                  className="input-metatron"
                  placeholder="e.g. Fintech"
                  value={profile.sector ?? ""}
                  onChange={(e) =>
                    setProfile((p) => ({ ...p, sector: e.target.value }))
                  }
                />
              </label>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <label className="block space-y-1">
                <span className="font-mono text-[11px] uppercase text-[var(--text-muted)]">
                  Country (ISO-2)
                </span>
                <input
                  className="input-metatron"
                  placeholder="US"
                  maxLength={2}
                  value={profile.country ?? ""}
                  onChange={(e) =>
                    setProfile((p) => ({
                      ...p,
                      country: e.target.value.toUpperCase()
                    }))
                  }
                />
              </label>
              <label className="block space-y-1">
                <span className="font-mono text-[11px] uppercase text-[var(--text-muted)]">
                  Website
                </span>
                <input
                  className="input-metatron"
                  type="url"
                  placeholder="https://"
                  value={profile.website ?? ""}
                  onChange={(e) =>
                    setProfile((p) => ({ ...p, website: e.target.value }))
                  }
                />
              </label>
            </div>
            <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-4 space-y-2">
              <p className="text-xs font-semibold text-[var(--text)]">
                Pitch deck
              </p>
              <p className="text-[11px] text-[var(--text-muted)]">
                PDF, PPTX, or Key. Upload replaces the stored deck URL on your
                profile.
              </p>
              <input
                type="file"
                accept=".pdf,.ppt,.pptx,.key,.zip,application/pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                onChange={onDeckUpload}
                className="text-xs text-[var(--text-muted)] file:mr-3 file:rounded-lg file:border-0 file:bg-metatron-accent file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
              />
              {profile.pitch_deck_url && (
                <a
                  href={profile.pitch_deck_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block text-xs text-metatron-accent hover:underline"
                >
                  Open current deck
                </a>
              )}
            </div>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-metatron-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save profile"}
            </button>
          </form>
        )}
        {msg && (
          <p className="text-xs text-[var(--text-muted)] border-t border-[var(--border)] pt-4">
            {msg}
          </p>
        )}
      </section>
    </main>
  );
}
