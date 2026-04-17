"use client";

import { FormEvent, useEffect, useState } from "react";
import { API_BASE, authHeaders, authJsonHeaders } from "@/lib/api";
import { COUNTRIES } from "@/lib/countries";
import { useAuth } from "@/lib/auth";
import type { MeResponse } from "@/lib/me";

const SPECIALITIES = [
  "VC Network",
  "Angel Network",
  "Accelerator",
  "Corporate VC",
  "Ecosystem Partner",
  "Family Office",
  "Other",
] as const;

type ConnectorProfile = {
  organisation?: string | null;
  bio?: string | null;
  speciality?: string | null;
  country?: string | null;
};

export default function ConnectorProfilePage() {
  const { token, loading: authLoading } = useAuth("INTERMEDIARY");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [p, setP] = useState<ConnectorProfile>({});
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
        const [rMe, rP] = await Promise.all([
          fetch(`${API_BASE}/auth/me`, { headers: authHeaders(token) }),
          fetch(`${API_BASE}/connector-profile`, {
            headers: authJsonHeaders(token),
          }),
        ]);
        if (rMe.ok) {
          const m = (await rMe.json()) as MeResponse;
          setMe(m);
          setWhatsappInput(m.whatsapp_number ?? "");
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
        <p className="mb-1 font-sans text-[11px] font-medium uppercase tracking-[2px] text-[var(--text-muted)]">
          Profile
        </p>
        <h1 className="text-lg font-semibold">Connector profile</h1>
      </header>
      <section className="p-6 md:p-10">
        <div className="grid gap-8 lg:grid-cols-[1fr_320px] items-start">
          <div className="max-w-2xl space-y-6 lg:max-w-none">
            {loading ? (
              <p className="text-sm text-[var(--text-muted)]">Loading…</p>
            ) : (
              <form onSubmit={onSubmit} className="space-y-5">
            <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[#0a0a0f] px-4 py-3 text-sm text-[var(--text-muted)]">
              <span className="font-sans text-[10px] uppercase tracking-wider">
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
                  <div className="flex flex-wrap items-center gap-3">
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
