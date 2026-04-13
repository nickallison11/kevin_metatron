"use client";

import { FormEvent, useEffect, useState } from "react";
import { API_BASE, authHeaders, authJsonHeaders } from "@/lib/api";
import type { MeResponse } from "@/lib/me";
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

  const [me, setMe] = useState<MeResponse | null>(null);
  const [telegramLinkCode, setTelegramLinkCode] = useState<string | null>(null);
  const [telegramLoading, setTelegramLoading] = useState(false);
  const [telegramMsg, setTelegramMsg] = useState<string | null>(null);
  const [whatsappInput, setWhatsappInput] = useState("");
  const [whatsappSaving, setWhatsappSaving] = useState(false);
  const [whatsappMsg, setWhatsappMsg] = useState<string | null>(null);

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
      <section className="p-6 md:p-10">
        <div className="grid gap-8 lg:grid-cols-[1fr_320px] items-start">
          <div className="max-w-2xl space-y-6 lg:max-w-none">
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
                    <span className="font-mono text-[11px] uppercase text-[var(--text-muted)]">
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
                <h2 className="text-sm font-semibold">Telegram</h2>

                {me?.telegram_id ? (
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-flex items-center rounded-full border px-3 py-1 text-xs"
                      style={{
                        borderColor: "rgba(34,197,94,0.35)",
                        backgroundColor: "rgba(34,197,94,0.12)",
                        color: "rgb(134,239,172)",
                      }}
                    >
                      Telegram linked
                    </span>
                    <a
                      href="https://t.me/Kevinmetatron_bot"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-metatron-accent hover:underline"
                    >
                      Open @Kevinmetatron_bot
                    </a>
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
                            <code className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 font-mono text-sm text-metatron-accent select-all">
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
