"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { API_BASE, authHeaders, authJsonHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { COUNTRIES } from "@/lib/countries";
import { STAGES } from "@/lib/stages";

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
  deckStorageOption?: "link" | "public_ipfs" | "private_ipfs";
};

function transformFromApi(api: ApiProfile): Profile {
  const sectorString = api.sector ?? "";
  const sectors =
    sectorString.trim().length > 0
      ? sectorString
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  const pitchUrl = api.pitch_deck_url ?? null;
  const looksLikeIpfs =
    typeof pitchUrl === "string" &&
    (pitchUrl.startsWith("ipfs://") || pitchUrl.includes("gateway.pinata"));
  const ipfsVisibility = api.ipfs_visibility === "public" ? "public" : "private";
  const deckStorageOption: Profile["deckStorageOption"] = looksLikeIpfs
    ? ipfsVisibility === "public"
      ? "public_ipfs"
      : "private_ipfs"
    : "link";

  return {
    company_name: api.company_name ?? null,
    one_liner: api.one_liner ?? null,
    stage: api.stage ?? null,
    sectors,
    country: api.country ?? null,
    website: api.website ?? null,
    pitch_deck_url: pitchUrl,
    ipfs_visibility: ipfsVisibility,
    deckStorageOption,
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

export default function StartupProfilePage() {
  const { token, isPro, loading: authLoading } = useAuth();
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [deckUpgradePrompt, setDeckUpgradePrompt] = useState(false);
  const [profile, setProfile] = useState<Profile>({ sectors: [] });
  const [sectorDraft, setSectorDraft] = useState("");

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
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

  if (authLoading) return null;

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
    if (!isPro) {
      setDeckUpgradePrompt(true);
      setMsg("Upgrade to Pro to use IPFS storage.");
      e.target.value = "";
      return;
    }
    setMsg(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const desiredVisibility =
        (profile.deckStorageOption ?? "link") === "private_ipfs"
          ? "private"
          : "public";
      // Ensure the backend uploads to the correct Pinata network.
      setSavingVisibility(true);
      const visRes = await fetch(`${API_BASE}/uploads/ipfs-visibility`, {
        method: "PUT",
        headers: authJsonHeaders(token),
        body: JSON.stringify({ visibility: desiredVisibility }),
      });
      if (!visRes.ok) {
        const t = await visRes.text();
        throw new Error(t || "Could not set IPFS visibility");
      }
      setProfile((p) => ({ ...p, ipfs_visibility: desiredVisibility as "public" | "private" }));

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
    } finally {
      setSavingVisibility(false);
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
    if (!isPro) {
      setDeckUpgradePrompt(true);
      setMsg("Upgrade to Pro to use IPFS storage.");
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
                  className="input-metatron w-full"
                  value={profile.country ?? ""}
                  onChange={(e) =>
                    setProfile((p) => ({ ...p, country: e.target.value || null }))
                  }
                >
                  <option value="">Select country…</option>
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>{c.name}</option>
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
            <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-4 space-y-3">
              <p className="text-xs font-semibold text-[var(--text)]">Pitch deck</p>

              <div className="grid gap-3 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => {
                    setDeckUpgradePrompt(false);
                    setProfile((p) => ({ ...p, deckStorageOption: "link", ipfs_visibility: "public" }));
                  }}
                  className={[
                    "text-left rounded-[var(--radius)] border border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_55%,transparent)] p-3 transition-all",
                    (profile.deckStorageOption ?? "link") === "link"
                      ? "border-metatron-accent/40 shadow-[0_0_24px_rgba(108,92,231,0.12)]"
                      : "hover:border-metatron-accent/20 hover:shadow-[0_0_24px_rgba(108,92,231,0.08)]",
                  ].join(" ")}
                >
                  <div className="text-lg">🔗</div>
                  <div className="mt-1 text-sm font-semibold text-[var(--text)]">
                    Link to your deck
                  </div>
                  <div className="mt-1 text-xs text-[var(--text-muted)] leading-relaxed">
                    Store your pitch deck on your own cloud (Google Drive, Dropbox, Notion,
                    etc.) and share a link. You control access directly.
                  </div>
                  <div className="mt-2 font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                    Your own cloud
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (!isPro) {
                      setDeckUpgradePrompt(true);
                      return;
                    }
                    setDeckUpgradePrompt(false);
                    setProfile((p) => ({
                      ...p,
                      deckStorageOption: "public_ipfs",
                      ipfs_visibility: "public",
                    }));
                  }}
                  className={[
                    "text-left rounded-[var(--radius)] border border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_55%,transparent)] p-3 transition-all relative",
                    (profile.deckStorageOption ?? "link") === "public_ipfs"
                      ? "border-metatron-accent/40 shadow-[0_0_24px_rgba(108,92,231,0.12)]"
                      : "hover:border-metatron-accent/20 hover:shadow-[0_0_24px_rgba(108,92,231,0.08)]",
                  ].join(" ")}
                >
                  {!isPro && (
                    <span className="absolute top-2 right-2 font-mono text-[9px] uppercase tracking-wider border border-metatron-accent/40 text-metatron-accent px-1.5 py-0.5 rounded">
                      Pro
                    </span>
                  )}
                  <div className="text-lg">🌐</div>
                  <div className="mt-1 text-sm font-semibold text-[var(--text)]">
                    Public IPFS storage
                  </div>
                  <div className="mt-1 text-xs text-[var(--text-muted)] leading-relaxed">
                    Your deck is stored on decentralised IPFS storage. Investors with access
                    to your profile can view it directly through the platform. Best for open
                    fundraising rounds.
                  </div>
                  <div className="mt-2 font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                    Public IPFS
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (!isPro) {
                      setDeckUpgradePrompt(true);
                      return;
                    }
                    setDeckUpgradePrompt(false);
                    setProfile((p) => ({
                      ...p,
                      deckStorageOption: "private_ipfs",
                      ipfs_visibility: "private",
                    }));
                  }}
                  className={[
                    "text-left rounded-[var(--radius)] border border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_55%,transparent)] p-3 transition-all relative",
                    (profile.deckStorageOption ?? "link") === "private_ipfs"
                      ? "border-metatron-accent/40 shadow-[0_0_24px_rgba(108,92,231,0.12)]"
                      : "hover:border-metatron-accent/20 hover:shadow-[0_0_24px_rgba(108,92,231,0.08)]",
                  ].join(" ")}
                >
                  {!isPro && (
                    <span className="absolute top-2 right-2 font-mono text-[9px] uppercase tracking-wider border border-metatron-accent/40 text-metatron-accent px-1.5 py-0.5 rounded">
                      Pro
                    </span>
                  )}
                  <div className="text-lg">🔒</div>
                  <div className="mt-1 text-sm font-semibold text-[var(--text)]">
                    Private IPFS storage
                  </div>
                  <div className="mt-1 text-xs text-[var(--text-muted)] leading-relaxed">
                    Your deck is encrypted and stored privately on IPFS. Investors must send
                    you an access request and you approve it before they can view your deck
                    through their AI instance on the platform. Best for selective raises.
                  </div>
                  <div className="mt-2 font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                    Private IPFS
                  </div>
                </button>
              </div>

              {(profile.deckStorageOption ?? "link") !== "link" && (
                <div className="bg-metatron-accent/5 border border-metatron-accent/20 rounded-[12px] p-3 text-xs text-[var(--text-muted)]">
                  <span className="font-semibold">ℹ️</span> Options 2 and 3 use a secure
                  approval handshake. When an investor requests to view your deck, you will
                  receive a notification and must approve access before they can see it
                  through the platform.
                </div>
              )}

              {!isPro &&
                deckUpgradePrompt &&
                (profile.deckStorageOption === "public_ipfs" ||
                  profile.deckStorageOption === "private_ipfs") && (
                  <div className="rounded-[12px] border border-metatron-accent/20 bg-metatron-accent/5 p-3 text-xs text-[var(--text-muted)]">
                    Upgrade to Pro to use IPFS storage.{" "}
                    <a
                      href="/pricing"
                      className="text-metatron-accent hover:underline font-semibold"
                    >
                      View pricing →
                    </a>
                  </div>
                )}

              {(profile.deckStorageOption ?? "link") === "link" ? (
                <label className="block space-y-1">
                  <span className="font-mono text-[11px] uppercase text-[var(--text-muted)]">
                    Pitch Deck Link
                  </span>
                  <input
                    className="input-metatron w-full"
                    type="url"
                    placeholder="https://drive.google.com/..."
                    value={profile.pitch_deck_url ?? ""}
                    onChange={(e) =>
                      setProfile((p) => ({ ...p, pitch_deck_url: e.target.value }))
                    }
                  />
                </label>
              ) : (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.ppt,.pptx,.key,.zip,application/pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                    onChange={onDeckUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!isPro) {
                        setDeckUpgradePrompt(true);
                        return;
                      }
                      fileInputRef.current?.click();
                    }}
                    disabled={savingVisibility}
                    className="rounded-lg bg-metatron-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-metatron-accent-hover hover:shadow-[0_4px_20px_rgba(108,92,231,0.3)] transition-all disabled:opacity-60"
                  >
                    {savingVisibility ? "Preparing…" : "Upload deck"}
                  </button>
                </>
              )}

              {(profile.deckStorageOption ?? "link") === "link" && (
                <p className="text-xs text-[var(--text-muted)]">
                  Store your deck on Google Drive, Dropbox, Notion, or any cloud storage. Make
                  sure sharing is set appropriately for investors.
                </p>
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
