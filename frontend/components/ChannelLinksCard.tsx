"use client";

import { type FormEvent, useEffect, useState } from "react";
import { API_BASE, authHeaders, authJsonHeaders } from "@/lib/api";
import type { MeResponse } from "@/lib/me";

function TelegramIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z" />
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

/**
 * WhatsApp + Telegram account-linking cards. Extracted from the founder
 * profile page so the same UI can render on the dashboard — fully
 * self-contained, only needs a token. Cards are compact, fixed-size tap
 * targets; any configuration (entering a number, pairing code, unlinking)
 * happens in a popup so the cards themselves never resize.
 */
export default function ChannelLinksCard({ token }: { token: string }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [telegramLinkCode, setTelegramLinkCode] = useState<string | null>(null);
  const [telegramLoading, setTelegramLoading] = useState(false);
  const [telegramMsg, setTelegramMsg] = useState<string | null>(null);
  const [unlinkingTelegram, setUnlinkingTelegram] = useState(false);
  const [telegramPopupOpen, setTelegramPopupOpen] = useState(false);
  const [whatsappInput, setWhatsappInput] = useState("");
  const [whatsappSaving, setWhatsappSaving] = useState(false);
  const [whatsappMsg, setWhatsappMsg] = useState<string | null>(null);
  const [whatsappSaved, setWhatsappSaved] = useState(false);
  const [unlinkingWhatsapp, setUnlinkingWhatsapp] = useState(false);
  const [whatsappPopupOpen, setWhatsappPopupOpen] = useState(false);

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
    setWhatsappSaved(false);
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
    setWhatsappSaved(false);
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
      if (digits) {
        setWhatsappMsg("Saved.");
        setWhatsappSaved(true);
      } else {
        setWhatsappMsg("WhatsApp number removed.");
        setWhatsappSaved(false);
      }
    } catch (err) {
      setWhatsappMsg(
        err instanceof Error ? err.message : "Could not save WhatsApp number",
      );
    } finally {
      setWhatsappSaving(false);
    }
  }

  const whatsappConnected = Boolean(me?.whatsapp_number);
  const telegramConnected = Boolean(me?.telegram_id);

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {/* WhatsApp */}
      <button
        type="button"
        onClick={() => setWhatsappPopupOpen(true)}
        className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-4 flex items-center gap-3 text-left transition-colors hover:border-metatron-accent/30"
      >
        <span className="shrink-0 text-[#25D366]"><WhatsAppIcon /></span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--text)]">WhatsApp</p>
          <p className={`text-xs mt-0.5 truncate ${whatsappConnected ? "text-green-400" : "text-[var(--text-muted)]"}`}>
            {whatsappConnected ? `Connected — +${me?.whatsapp_number}` : "Not connected"}
          </p>
        </div>
      </button>

      {/* Telegram */}
      <button
        type="button"
        onClick={() => {
          setTelegramPopupOpen(true);
          if (!telegramConnected && !telegramLinkCode) void onLinkTelegram();
        }}
        className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-4 flex items-center gap-3 text-left transition-colors hover:border-metatron-accent/30"
      >
        <span className="shrink-0 text-[#29A9EB]"><TelegramIcon /></span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--text)]">Telegram</p>
          <p className={`text-xs mt-0.5 ${telegramConnected ? "text-green-400" : "text-[var(--text-muted)]"}`}>
            {telegramConnected ? "Connected" : "Not connected"}
          </p>
        </div>
      </button>

      {whatsappPopupOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto py-8 px-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setWhatsappPopupOpen(false)} />
          <div className="relative z-10 w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-[#25D366]"><WhatsAppIcon /></span>
                <p className="text-sm font-medium text-[var(--text)]">WhatsApp</p>
              </div>
              <button
                type="button"
                onClick={() => setWhatsappPopupOpen(false)}
                aria-label="Close"
                className="rounded-lg p-1 text-[var(--text-muted)] hover:bg-[var(--overlay-2)] hover:text-[var(--text)]"
              >
                ✕
              </button>
            </div>

            {whatsappConnected ? (
              <div className="space-y-3">
                <p className="font-mono text-sm text-[var(--text)] bg-[var(--overlay-4)] rounded-lg px-3 py-2 border border-[var(--border)]">
                  +{me?.whatsapp_number}
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setWhatsappSaved(false);
                      setMe((prev) => prev ? { ...prev, whatsapp_number: null } : prev);
                    }}
                    className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--text)] hover:border-metatron-accent/40"
                  >
                    Change number
                  </button>
                  <button
                    type="button"
                    onClick={onUnlinkWhatsapp}
                    disabled={unlinkingWhatsapp}
                    className="rounded-lg bg-[rgba(239,68,68,0.12)] border border-[rgba(239,68,68,0.3)] px-3 py-1.5 text-xs font-semibold text-[rgb(254,202,202)] hover:bg-[rgba(239,68,68,0.2)] disabled:opacity-60"
                  >
                    {unlinkingWhatsapp ? "Unlinking…" : "Unlink"}
                  </button>
                </div>
                {whatsappMsg && <p className="text-xs text-[var(--text-muted)]">{whatsappMsg}</p>}
              </div>
            ) : (
              <>
                <p className="text-xs text-[var(--text-muted)] mb-3">
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
                  <button
                    type="submit"
                    disabled={whatsappSaving}
                    className="rounded-lg bg-metatron-accent px-4 py-2 text-xs font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-60"
                  >
                    {whatsappSaving ? "Saving…" : "Save number"}
                  </button>
                  {whatsappMsg && <p className="text-xs text-[var(--text-muted)]">{whatsappMsg}</p>}
                </form>
              </>
            )}

            {whatsappSaved && (
              <div className="mt-3 rounded-lg border border-[rgba(108,92,231,0.3)] bg-[rgba(108,92,231,0.08)] p-3">
                <p className="text-xs font-medium text-[#6c5ce7] mb-1">One last step to activate</p>
                <p className="text-xs text-[var(--text-muted)] mb-2">
                  Send any message to Kevin on WhatsApp to open the notification channel.
                </p>
                <a
                  href="https://wa.me/27818621473"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#25D366] text-white rounded-lg text-xs font-medium hover:bg-[#20bd5a] transition-colors"
                >
                  Message Kevin on WhatsApp →
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {telegramPopupOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto py-8 px-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setTelegramPopupOpen(false)} />
          <div className="relative z-10 w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-[#29A9EB]"><TelegramIcon /></span>
                <p className="text-sm font-medium text-[var(--text)]">Telegram</p>
              </div>
              <button
                type="button"
                onClick={() => setTelegramPopupOpen(false)}
                aria-label="Close"
                className="rounded-lg p-1 text-[var(--text-muted)] hover:bg-[var(--overlay-2)] hover:text-[var(--text)]"
              >
                ✕
              </button>
            </div>

            {telegramConnected ? (
              <div className="space-y-3">
                <p className="text-xs text-[var(--text-muted)]">
                  Kevin will send you notifications here.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <a
                    href="https://t.me/Kevinmetatron_bot"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-4 py-2 text-xs font-semibold text-[var(--text)] transition hover:border-metatron-accent/40"
                  >
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
              </div>
            ) : !telegramLinkCode ? (
              <p className="text-xs text-[var(--text-muted)]">
                {telegramLoading ? "Generating your link…" : "Preparing your link…"}
              </p>
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

            {telegramMsg && <p className="mt-3 text-xs text-[var(--text-muted)]">{telegramMsg}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
