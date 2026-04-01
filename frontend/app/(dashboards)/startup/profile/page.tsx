"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { API_BASE, authHeaders, authJsonHeaders } from "@/lib/api";

type ApiProfile = {
  company_name?: string | null;
  one_liner?: string | null;
  stage?: string | null;
  sector?: string | null;
  country?: string | null;
  website?: string | null;
  pitch_deck_url?: string | null;
  ipfs_visibility?: string | null;
};

type Profile = {
  company_name?: string | null;
  one_liner?: string | null;
  stage?: string | null;
  // Stored as a tag array in the UI; backend expects TEXT (comma-separated).
  sectors?: string[];
  country?: string | null;
  website?: string | null;
  pitch_deck_url?: string | null;
  ipfs_visibility?: "public" | "private";
};

const STAGES = [
  { v: "idea", label: "Idea" },
  { v: "pre-seed", label: "Pre-seed" },
  { v: "seed", label: "Seed" },
  { v: "series-a", label: "Series A" },
  { v: "series-b", label: "Series B" },
  { v: "series-c", label: "Series C" },
  { v: "growth", label: "Growth" },
  { v: "profitable", label: "Profitable" },
];

const COUNTRIES = [
  { code: "US", label: "United States" },
  { code: "GB", label: "United Kingdom" },
  { code: "AU", label: "Australia" },
  { code: "CA", label: "Canada" },
  { code: "ZA", label: "South Africa" },
  { code: "KE", label: "Kenya" },
  { code: "NG", label: "Nigeria" },
  { code: "IN", label: "India" },
  { code: "SG", label: "Singapore" },
  { code: "HK", label: "Hong Kong" },
  { code: "DE", label: "Germany" },
  { code: "FR", label: "France" },
  { code: "NL", label: "Netherlands" },
  { code: "SE", label: "Sweden" },
  { code: "AE", label: "United Arab Emirates" },
  { code: "RW", label: "Rwanda" },
  { code: "PA", label: "Panama" },
];

function transformFromApi(api: ApiProfile): Profile {
  const sectorString = api.sector ?? "";
  const sectors =
    sectorString.trim().length > 0
      ? sectorString
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  return {
    company_name: api.company_name ?? null,
    one_liner: api.one_liner ?? null,
    stage: api.stage ?? null,
    sectors,
    country: api.country ?? null,
    website: api.website ?? null,
    pitch_deck_url: api.pitch_deck_url ?? null,
    ipfs_visibility: api.ipfs_visibility === "public" ? "public" : "private",
  };
}

function transformToApi(profile: Profile): ApiProfile {
  return {
    company_name: profile.company_name ?? null,
    one_liner: profile.one_liner ?? null,
    stage: profile.stage ?? null,
    sector:
      (profile.sectors ?? []).length > 0
        ? (profile.sectors ?? []).join(", ")
        : null,
    country: profile.country ?? null,
    website: profile.website ?? null,
    pitch_deck_url: profile.pitch_deck_url ?? null,
  };
}

function normalizeSectorTag(s: string): string {
  return s.trim();
}

function decodeIsProFromJwt(token: string | null): boolean {
  if (!token) return false;
  try {
    const parts = token.split(".");
    if (parts.length < 2) return false;
    const payload = parts[1];
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padLen = (4 - (base64.length % 4)) % 4;
    const normalized = base64 + "=".repeat(padLen);
    const json = atob(normalized);
    const parsed = JSON.parse(json) as { is_pro?: unknown };
    return parsed.is_pro === true;
  } catch {
    return false;
  }
}

export default function StartupProfilePage() {
  const [token, setToken] = useState<string | null>(null);
  const [isPro, setIsPro] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [profile, setProfile] = useState<Profile>({ sectors: [] });
  const [sectorDraft, setSectorDraft] = useState("");

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const t = window.localStorage.getItem("metatron_token");
    setToken(t);
    setIsPro(decodeIsProFromJwt(t));
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
          setProfile(transformFromApi(data as ApiProfile));
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
        body: JSON.stringify(transformToApi(profile))
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text || "Save failed");
      setProfile(transformFromApi(JSON.parse(text) as ApiProfile));
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
      const visibility =
        typeof data === "object" &&
        data &&
        "visibility" in data &&
        (data as { visibility?: string }).visibility === "public"
          ? "public"
          : "private";
      setProfile((p) => ({ ...p, pitch_deck_url: url, ipfs_visibility: visibility }));
      setMsg("Pitch deck uploaded.");
    } catch {
      setMsg("Upload failed.");
    }
    e.target.value = "";
  }

  function addSectorsFromRaw(raw: string) {
    const parts = raw
      .split(",")
      .map((s) => normalizeSectorTag(s))
      .filter(Boolean);
    if (parts.length === 0) return;

    setProfile((p) => {
      const current = p.sectors ?? [];
      const next: string[] = [...current];
      const existingLower = new Set(next.map((x) => x.toLowerCase()));
      for (const tag of parts) {
        const key = tag.toLowerCase();
        if (!existingLower.has(key)) {
          existingLower.add(key);
          next.push(tag);
        }
      }
      return { ...p, sectors: next };
    });
    setSectorDraft("");
  }

  async function onVisibilityChange(nextVisibility: "public" | "private") {
    if (!token) {
      setMsg("Sign in first.");
      return;
    }
    setSavingVisibility(true);
    setMsg(null);
    try {
      const res = await fetch(`${API_BASE}/uploads/ipfs-visibility`, {
        method: "PUT",
        headers: authJsonHeaders(token),
        body: JSON.stringify({ visibility: nextVisibility }),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(txt || "Could not update visibility");
      setProfile((p) => ({ ...p, ipfs_visibility: nextVisibility }));
    } catch {
      setMsg("Could not update deck visibility.");
    } finally {
      setSavingVisibility(false);
    }
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
                <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-3 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {(profile.sectors ?? []).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => {
                          setProfile((p) => ({
                            ...p,
                            sectors: (p.sectors ?? []).filter(
                              (x) => x.toLowerCase() !== s.toLowerCase()
                            ),
                          }));
                        }}
                        className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-card)] px-3 py-1 text-xs text-[var(--text)] hover:border-metatron-accent/30"
                        aria-label={`Remove sector ${s}`}
                      >
                        {s}
                        <span aria-hidden className="text-[var(--text-muted)]">
                          ×
                        </span>
                      </button>
                    ))}
                    {(profile.sectors ?? []).length === 0 && (
                      <span className="text-xs text-[var(--text-muted)]">
                        Add sectors (press Enter or comma)
                      </span>
                    )}
                  </div>

                  <input
                    className="input-metatron"
                    placeholder="e.g. Fintech"
                    value={sectorDraft}
                    onChange={(e) => setSectorDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        addSectorsFromRaw(sectorDraft);
                      }
                    }}
                  />
                  <div className="text-[11px] text-[var(--text-muted)]">
                    Suggestions won’t be stored — press Enter or comma to add.
                  </div>
                </div>
              </label>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <label className="block space-y-1">
                <span className="font-mono text-[11px] uppercase text-[var(--text-muted)]">
                  Country (ISO-2)
                </span>
                <select
                  className="input-metatron"
                  value={profile.country ?? ""}
                  onChange={(e) =>
                    setProfile((p) => ({
                      ...p,
                      country: e.target.value || null,
                    }))
                  }
                >
                  <option value="">Select country…</option>
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label} ({c.code})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="font-mono text-[11px] uppercase text-[var(--text-muted)]">
                  Website
                </span>
                <input
                  className="input-metatron"
                  type="text"
                  placeholder="yoursite.com"
                  value={profile.website ?? ""}
                  onChange={(e) =>
                    setProfile((p) => ({ ...p, website: e.target.value }))
                  }
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (!v) {
                      setProfile((p) => ({ ...p, website: null }));
                      return;
                    }
                    const startsWithHttp =
                      v.startsWith("http://") || v.startsWith("https://");
                    if (startsWithHttp) return;
                    setProfile((p) => ({ ...p, website: `https://${v}` }));
                  }}
                />
              </label>
            </div>
            <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-4 space-y-2">
              <p className="text-xs font-semibold text-[var(--text)]">
                Pitch deck
              </p>
              {isPro ? (
                <>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    PDF, PPTX, or Key. Upload replaces the stored deck URL on your
                    profile.
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.ppt,.pptx,.key,.zip,application/pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                    onChange={onDeckUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded-lg bg-metatron-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-metatron-accent-hover hover:shadow-[0_4px_20px_rgba(108,92,231,0.3)] transition-all"
                  >
                    Upload deck
                  </button>
                  <div className="mt-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg)] p-3 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-semibold text-[var(--text)]">
                        Pitch Deck Visibility
                      </span>
                      <div className="inline-flex rounded-full border border-[var(--border)] p-1">
                        <button
                          type="button"
                          disabled={savingVisibility}
                          onClick={() => onVisibilityChange("private")}
                          className={`rounded-full px-3 py-1 text-xs transition-colors ${
                            (profile.ipfs_visibility ?? "private") === "private"
                              ? "bg-metatron-accent text-white"
                              : "text-[var(--text-muted)] hover:text-[var(--text)]"
                          }`}
                        >
                          Private
                        </button>
                        <button
                          type="button"
                          disabled={savingVisibility}
                          onClick={() => onVisibilityChange("public")}
                          className={`rounded-full px-3 py-1 text-xs transition-colors ${
                            (profile.ipfs_visibility ?? "private") === "public"
                              ? "bg-metatron-accent text-white"
                              : "text-[var(--text-muted)] hover:text-[var(--text)]"
                          }`}
                        >
                          Public IPFS
                        </button>
                      </div>
                    </div>
                    {(profile.ipfs_visibility ?? "private") === "private" ? (
                      <p className="text-xs text-[var(--text-muted)]">
                        Your deck is stored privately. Only accessible via a secure link. Can
                        be deleted at any time.
                      </p>
                    ) : (
                      <p className="text-xs text-[var(--text-muted)]">
                        Your deck will be published to the public IPFS network. It becomes
                        permanently accessible and cannot be fully erased. Only choose this if
                        you want maximum decentralisation.
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <label className="block space-y-1">
                    <span className="font-mono text-[11px] uppercase text-[var(--text-muted)]">
                      Pitch Deck Link
                    </span>
                    <input
                      className="input-metatron"
                      type="url"
                      placeholder="https://drive.google.com/..."
                      value={profile.pitch_deck_url ?? ""}
                      onChange={(e) =>
                        setProfile((p) => ({ ...p, pitch_deck_url: e.target.value }))
                      }
                    />
                  </label>
                  <p className="text-xs text-[var(--text-muted)]">
                    Paste a link to your deck on Google Drive, Dropbox, or any cloud
                    storage. Make sure sharing is set to &apos;Anyone with the link&apos;.
                  </p>
                </>
              )}
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
