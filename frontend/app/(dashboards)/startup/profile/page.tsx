"use client";

import Link from "next/link";
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
  deck_expires_at?: string | null;
  deck_upload_count?: number;
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
  deck_expires_at?: string | null;
  deck_upload_count?: number;
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
    deck_expires_at: api.deck_expires_at ?? null,
    deck_upload_count:
      typeof api.deck_upload_count === "number" ? api.deck_upload_count : 0,
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

function deckExpiryLabel(iso: string): string {
  const end = new Date(iso).getTime();
  const now = Date.now();
  const ms = end - now;
  if (ms <= 0) return "Deck storage expired";
  const days = Math.ceil(ms / 86400000);
  if (days <= 0) return "Deck expires today";
  if (days === 1) return "Deck expires in 1 day";
  return `Deck expires in ${days} days`;
}

export default function StartupProfilePage() {
  const { token, isPro, loading: authLoading } = useAuth();
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<Profile>({ sectors: [] });
  const [sectorDraft, setSectorDraft] = useState("");
  const [primaryDeckUploadBusy, setPrimaryDeckUploadBusy] = useState(false);
  const [deckUploadedShowPitchLink, setDeckUploadedShowPitchLink] =
    useState(false);

  const primaryDeckPdfRef = useRef<HTMLInputElement | null>(null);

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

  const deckCount = profile.deck_upload_count ?? 0;
  const freeDeckUsed = !isPro && deckCount >= 1;

  async function reloadProfileFromApi() {
    if (!token) return;
    const res = await fetch(`${API_BASE}/profile`, {
      headers: authJsonHeaders(token),
    });
    if (res.ok) {
      const data = await res.json();
      setProfile(transformFromApi(data as ApiProfile));
    }
  }

  async function onPrimaryPitchDeckPdf(
    e: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = e.target.files?.[0];
    if (!file || !token) {
      e.target.value = "";
      return;
    }
    setMsg(null);
    setDeckUploadedShowPitchLink(false);
    setPrimaryDeckUploadBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${API_BASE}/uploads/pitch-deck`, {
        method: "POST",
        headers: authHeaders(token),
        body: fd,
      });
      const data = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;

      if (res.status === 403) {
        const err =
          typeof data.error === "string"
            ? data.error
            : "You cannot upload another deck on the free plan.";
        setMsg(err);
        return;
      }
      if (!res.ok) {
        setMsg(
          typeof data.error === "string"
            ? data.error
            : "Deck upload failed.",
        );
        return;
      }

      await reloadProfileFromApi();

      const extractionErr = data.extraction_error;
      if (typeof extractionErr === "string" && extractionErr.trim()) {
        setMsg(
          `Deck uploaded. Kevin could not auto-fill all fields (${extractionErr}). You can edit your pitch on the Pitch data page.`,
        );
      } else {
        setMsg(
          "Deck uploaded. Kevin extracted fields and created a pitch — open Pitch data to review.",
        );
      }
      setDeckUploadedShowPitchLink(true);
    } catch {
      setMsg("Deck upload failed.");
    } finally {
      setPrimaryDeckUploadBusy(false);
      e.target.value = "";
    }
  }

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

  return (
    <main className="flex-1">
      <section className="p-6 md:p-10 max-w-5xl mx-auto">
        <div className="space-y-6">
            <h1 className="text-2xl font-semibold text-[var(--text)]">Company & pitch deck</h1>
            {loading ? (
              <p className="text-sm text-[var(--text-muted)]">Loading…</p>
            ) : (
              <form onSubmit={onSave} className="space-y-4 text-sm">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-4">
                <label className="block space-y-1">
                  <span className="font-sans text-[11px] uppercase text-[var(--text-muted)]">
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
                  <span className="font-sans text-[11px] uppercase text-[var(--text-muted)]">
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
              <label className="flex h-full flex-col space-y-1">
                <span className="font-sans text-[11px] uppercase text-[var(--text-muted)]">
                  Sector
                </span>
                <div className="flex-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-3 space-y-2">
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
                <span className="font-sans text-[11px] uppercase text-[var(--text-muted)]">
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
                <span className="font-sans text-[11px] uppercase text-[var(--text-muted)]">
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
            </div>
            <label className="block space-y-1">
              <span className="font-sans text-[11px] uppercase text-[var(--text-muted)]">
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
            <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-4 space-y-4">
              <p className="text-xs font-semibold text-[var(--text)]">Pitch deck</p>

              <div className="rounded-lg border border-[var(--border)] bg-[var(--overlay-2)] p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[var(--text)]">Upload PDF</p>
                    <p className="text-xs text-[var(--text-muted)] leading-relaxed mt-1">
                      Kevin extracts your pitch data automatically and shares it with matched investors.
                    </p>
                  </div>
                  {!isPro && profile.deck_expires_at ? (
                    <span className="shrink-0 rounded-lg border border-[var(--border)] bg-[rgba(108,92,231,0.12)] px-2.5 py-1 font-sans text-[10px] text-[var(--text)]">
                      {deckExpiryLabel(profile.deck_expires_at)}
                    </span>
                  ) : null}
                </div>

                {freeDeckUsed ? (
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--overlay-2)] px-4 py-3 text-sm text-[var(--text-muted)]">
                    <p>Free accounts include one deck upload. Upgrade to Founder Basic to replace your deck.</p>
                    <Link href="/pricing" className="mt-2 inline-block text-xs font-semibold text-metatron-accent hover:underline">
                      Upgrade to Founder Basic — view plans
                    </Link>
                  </div>
                ) : (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <input
                      ref={primaryDeckPdfRef}
                      type="file"
                      accept="application/pdf,.pdf"
                      className="hidden"
                      onChange={onPrimaryPitchDeckPdf}
                    />
                    <button
                      type="button"
                      disabled={primaryDeckUploadBusy}
                      onClick={() => primaryDeckPdfRef.current?.click()}
                      className="rounded-lg bg-metatron-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-50"
                    >
                      {primaryDeckUploadBusy ? "Uploading…" : "Upload PDF deck"}
                    </button>
                    <p className="text-[11px] text-[var(--text-muted)]">PDF · max ~52MB</p>
                  </div>
                )}

                {deckUploadedShowPitchLink ? (
                  <Link href="/startup/pitches" className="inline-block text-xs font-semibold text-metatron-accent hover:underline">
                    Your deck has been uploaded — view your pitch data →
                  </Link>
                ) : null}
              </div>
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
          </div>
      </section>
    </main>
  );
}
