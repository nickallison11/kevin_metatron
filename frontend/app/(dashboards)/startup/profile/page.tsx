"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { API_BASE, authHeaders, authJsonHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { MeResponse } from "@/lib/me";
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

  const [me, setMe] = useState<MeResponse | null>(null);
  const [telegramLinkCode, setTelegramLinkCode] = useState<string | null>(null);
  const [telegramLoading, setTelegramLoading] = useState(false);
  const [telegramMsg, setTelegramMsg] = useState<string | null>(null);
  const [unlinkingTelegram, setUnlinkingTelegram] = useState(false);
  const [whatsappInput, setWhatsappInput] = useState("");
  const [whatsappSaving, setWhatsappSaving] = useState(false);
  const [whatsappMsg, setWhatsappMsg] = useState<string | null>(null);
  const [unlinkingWhatsapp, setUnlinkingWhatsapp] = useState(false);

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

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/me`, {
          headers: authHeaders(token),
        });
        if (!res.ok) return;
        const data = (await res.json()) as MeResponse;
        setMe(data);
        setWhatsappInput(data.whatsapp_number ?? "");
      } catch {
        /* ignore */
      }
    })();
  }, [token]);

  useEffect(() => {
    if (!token || !telegramLinkCode || me?.telegram_id) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/me`, {
          headers: authHeaders(token),
        });
        if (!res.ok) return;
        const data = (await res.json()) as MeResponse;
        if (data.telegram_id) {
          setMe(data);
          setTelegramLinkCode(null);
        }
      } catch {
        /* ignore */
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [token, telegramLinkCode, me?.telegram_id]);

  async function onLinkTelegram() {
    if (!token) return;
    setTelegramLoading(true);
    setTelegramMsg(null);
    setTelegramLinkCode(null);
    try {
      const res = await fetch(`${API_BASE}/auth/telegram/link-token`, {
        method: "POST",
        headers: authHeaders(token),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(txt.trim() || "Could not get link code");
      const data = JSON.parse(txt) as { code?: string };
      if (!data.code) throw new Error("Invalid response");
      setTelegramLinkCode(data.code);
    } catch (err) {
      setTelegramMsg(
        err instanceof Error ? err.message : "Could not get link code",
      );
    } finally {
      setTelegramLoading(false);
    }
  }

  async function onUnlinkTelegram() {
    if (!token) return;
    setUnlinkingTelegram(true);
    setTelegramMsg(null);
    try {
      const res = await fetch(`${API_BASE}/auth/telegram/unlink`, { method: "DELETE", headers: authHeaders(token) });
      if (!res.ok) throw new Error(await res.text());
      setMe((prev) => prev ? { ...prev, telegram_id: null } : prev);
      setTelegramMsg("Telegram unlinked.");
    } catch (err) {
      setTelegramMsg(err instanceof Error ? err.message : "Could not unlink Telegram");
    } finally {
      setUnlinkingTelegram(false);
    }
  }

  async function onUnlinkWhatsapp() {
    if (!token) return;
    setUnlinkingWhatsapp(true);
    setWhatsappMsg(null);
    try {
      const res = await fetch(`${API_BASE}/auth/whatsapp-number`, {
        method: "PUT",
        headers: authJsonHeaders(token),
        body: JSON.stringify({ whatsapp_number: null }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMe((prev) => prev ? { ...prev, whatsapp_number: null } : prev);
      setWhatsappInput("");
      setWhatsappMsg("WhatsApp unlinked.");
    } catch (err) {
      setWhatsappMsg(err instanceof Error ? err.message : "Could not unlink WhatsApp");
    } finally {
      setUnlinkingWhatsapp(false);
    }
  }

  async function onSaveWhatsapp(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setWhatsappSaving(true);
    setWhatsappMsg(null);
    try {
      const res = await fetch(`${API_BASE}/auth/whatsapp-number`, {
        method: "PUT",
        headers: authJsonHeaders(token),
        body: JSON.stringify({
          whatsapp_number: whatsappInput.trim() || null,
        }),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(txt.trim() || "Could not save WhatsApp number");
      const digits = whatsappInput.replace(/\D/g, "");
      setMe((prev) =>
        prev ? { ...prev, whatsapp_number: digits || null } : prev,
      );
      setWhatsappMsg("Saved.");
    } catch (err) {
      setWhatsappMsg(
        err instanceof Error ? err.message : "Could not save WhatsApp number",
      );
    } finally {
      setWhatsappSaving(false);
    }
  }

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
      <header className="border-b border-[var(--border)] px-6 py-4 md:px-10">
        <p className="font-sans text-[11px] font-medium uppercase tracking-[2px] text-[var(--text-muted)] mb-1">
          Profile
        </p>
        <h1 className="text-lg font-semibold">Company & pitch deck</h1>
      </header>
      <section className="p-6 md:p-10">
        <div className="grid gap-8 lg:grid-cols-[1fr_320px] items-start">
          <div className="max-w-2xl space-y-6 lg:max-w-none">
            {loading ? (
              <p className="text-sm text-[var(--text-muted)]">Loading…</p>
            ) : (
              <form onSubmit={onSave} className="space-y-4 text-sm">
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
            <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-4 space-y-4">
              <p className="text-xs font-semibold text-[var(--text)]">Pitch deck</p>

              <div className="rounded-lg border border-[var(--border)] bg-[rgba(255,255,255,0.02)] p-4 space-y-3">
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
                  <div className="rounded-lg border border-[var(--border)] bg-[rgba(255,255,255,0.02)] px-4 py-3 text-sm text-[var(--text-muted)]">
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

              <div className="flex items-center gap-3">
                <div className="flex-1 border-t border-[var(--border)]" />
                <span className="text-xs text-[var(--text-muted)]">or share a link</span>
                <div className="flex-1 border-t border-[var(--border)]" />
              </div>

              <div className="space-y-2">
                <label className="block space-y-1">
                  <span className="font-sans text-[11px] uppercase text-[var(--text-muted)]">
                    Pitch deck link
                  </span>
                  <input
                    className="input-metatron w-full"
                    type="url"
                    placeholder="https://drive.google.com/..."
                    value={
                      profile.pitch_deck_url &&
                      !profile.pitch_deck_url.includes("pinata") &&
                      !profile.pitch_deck_url.startsWith("ipfs://")
                        ? profile.pitch_deck_url
                        : ""
                    }
                    onChange={(e) =>
                      setProfile((p) => ({ ...p, pitch_deck_url: e.target.value }))
                    }
                  />
                </label>
                <p className="text-xs text-[var(--text-muted)]">
                  Your link is stored privately and not shared with investors. Upload a PDF above to enable AI-powered matching.
                </p>
                {profile.pitch_deck_url &&
                  !profile.pitch_deck_url.includes("pinata") &&
                  !profile.pitch_deck_url.startsWith("ipfs://") && (
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

          {!loading && (
            <div className="space-y-4">
              <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-6 space-y-5">
                <h2 className="text-sm font-semibold">WhatsApp</h2>
                <p className="text-xs text-[var(--text-muted)]">
                  Add the phone number you use on WhatsApp (with country code). When you message Kevin from that number, we match it to your account.
                </p>
                <form onSubmit={onSaveWhatsapp} className="space-y-3 text-sm">
                  <label className="block space-y-1">
                    <span className="font-sans text-[11px] uppercase text-[var(--text-muted)]">
                      WhatsApp number
                    </span>
                    <input
                      className="input-metatron w-full"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder="e.g. 2348012345678"
                      value={whatsappInput}
                      onChange={(e) => setWhatsappInput(e.target.value)}
                    />
                  </label>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="submit"
                      disabled={whatsappSaving}
                      className="rounded-lg bg-metatron-accent px-4 py-2 text-xs font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-60"
                    >
                      {whatsappSaving ? "Saving…" : "Save number"}
                    </button>
                    {me?.whatsapp_number ? (
                      <>
                        <span
                          className="inline-flex items-center rounded-full border px-3 py-1 text-xs"
                          style={{
                            borderColor: "rgba(34,197,94,0.35)",
                            backgroundColor: "rgba(34,197,94,0.12)",
                            color: "rgb(134,239,172)",
                          }}
                        >
                          Number on file
                        </span>
                        <button
                          type="button"
                          onClick={onUnlinkWhatsapp}
                          disabled={unlinkingWhatsapp}
                          className="rounded-lg bg-[rgba(239,68,68,0.12)] border border-[rgba(239,68,68,0.3)] px-3 py-1.5 text-xs font-semibold text-[rgb(254,202,202)] hover:bg-[rgba(239,68,68,0.2)] disabled:opacity-60"
                        >
                          {unlinkingWhatsapp ? "Unlinking…" : "Unlink"}
                        </button>
                      </>
                    ) : (
                      <span className="text-xs text-[var(--text-muted)]">
                        Not saved yet
                      </span>
                    )}
                  </div>
                  {whatsappMsg ? (
                    <p className="text-xs text-[var(--text-muted)]">{whatsappMsg}</p>
                  ) : null}
                </form>
              </div>

              <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-6 space-y-5">
                <div className="flex items-center gap-3">
                  <h2 className="text-sm font-semibold">Telegram</h2>
                  {me?.telegram_id && (
                    <span
                      className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-3 py-1 text-xs"
                      style={{
                        borderColor: "rgba(34,197,94,0.35)",
                        backgroundColor: "rgba(34,197,94,0.12)",
                        color: "rgb(134,239,172)",
                      }}
                    >
                      Telegram linked
                    </span>
                  )}
                </div>

                {me?.telegram_id ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <a
                      href="https://t.me/Kevinmetatron_bot"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-4 py-2 text-xs font-semibold text-[var(--text)] transition hover:border-metatron-accent/40"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden>
                        <path
                          fill="#229ED9"
                          d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"
                        />
                      </svg>
                      Open Kevin
                    </a>
                    <button
                      type="button"
                      onClick={onUnlinkTelegram}
                      disabled={unlinkingTelegram}
                      className="rounded-lg bg-[rgba(239,68,68,0.12)] border border-[rgba(239,68,68,0.3)] px-3 py-1.5 text-xs font-semibold text-[rgb(254,202,202)] hover:bg-[rgba(239,68,68,0.2)] disabled:opacity-60"
                    >
                      {unlinkingTelegram ? "Unlinking…" : "Unlink"}
                    </button>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-[var(--text-muted)]">
                      Link your Telegram account to chat with Kevin on Telegram.
                    </p>

                    {!telegramLinkCode ? (
                      <button
                        type="button"
                        onClick={onLinkTelegram}
                        disabled={telegramLoading}
                        className="rounded-lg bg-metatron-accent px-4 py-2 text-xs font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-60"
                      >
                        {telegramLoading ? "Getting code…" : "Link Telegram"}
                      </button>
                    ) : (
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <p className="text-xs text-[var(--text-muted)]">
                            1. Tap the button below to open Telegram — it will link automatically.
                          </p>
                          <a
                            href={`https://t.me/Kevinmetatron_bot?start=${telegramLinkCode}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 rounded-lg bg-metatron-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-metatron-accent-hover"
                          >
                            Open Telegram &rarr;
                          </a>
                        </div>

                        <div className="space-y-1">
                          <p className="text-xs text-[var(--text-muted)]">
                            2. Or open Telegram manually and send this message to{" "}
                            <span className="font-semibold text-[var(--text)]">@Kevinmetatron_bot</span>:
                          </p>
                          <div className="flex items-center gap-2">
                            <code className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 font-sans text-sm text-metatron-accent select-all">
                              /start {telegramLinkCode}
                            </code>
                            <button
                              type="button"
                              onClick={() => navigator.clipboard.writeText(`/start ${telegramLinkCode}`)}
                              className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
                            >
                              Copy
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center justify-between">
                          <p className="text-[11px] text-[var(--text-muted)]">Code expires in 15 minutes.</p>
                          <button
                            type="button"
                            onClick={onLinkTelegram}
                            disabled={telegramLoading}
                            className="text-[11px] text-metatron-accent hover:underline disabled:opacity-60"
                          >
                            {telegramLoading ? "Refreshing…" : "Get new code"}
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {telegramMsg ? (
                  <p className="text-xs text-[var(--text-muted)]">{telegramMsg}</p>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
