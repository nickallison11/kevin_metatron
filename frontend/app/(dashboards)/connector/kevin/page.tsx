"use client";

import { StartupKevinChatCard } from "@/components/StartupKevinChatCard";
import { API_BASE, authHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useEffect, useState } from "react";

type MeResponse = {
  telegram_id: string | null;
  whatsapp_number: string | null;
};

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

function EmailIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

export default function ConnectorKevinPage() {
  const { token, loading: authLoading } = useAuth();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [telegramLinkCode, setTelegramLinkCode] = useState<string | null>(null);
  const [telegramLoading, setTelegramLoading] = useState(false);
  const [telegramMsg, setTelegramMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [telegramPopupOpen, setTelegramPopupOpen] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE}/auth/me`, { headers: authHeaders(token) })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => d && setMe(d as MeResponse))
      .catch(() => null);
  }, [token]);

  useEffect(() => {
    if (!token || !telegramLinkCode || me?.telegram_id) return;
    const interval = setInterval(async () => {
      const r = await fetch(`${API_BASE}/auth/me`, { headers: authHeaders(token) }).catch(() => null);
      if (!r?.ok) return;
      const d = (await r.json()) as MeResponse;
      if (d.telegram_id) { setMe(d); setTelegramLinkCode(null); }
    }, 3000);
    return () => clearInterval(interval);
  }, [token, telegramLinkCode, me?.telegram_id]);

  async function onLinkTelegram() {
    if (!token) return;
    setTelegramLoading(true);
    setTelegramMsg(null);
    setTelegramLinkCode(null);
    try {
      const r = await fetch(`${API_BASE}/auth/telegram/link-token`, {
        method: "POST",
        headers: authHeaders(token),
      });
      const d = (await r.json()) as { code?: string; message?: string };
      if (!r.ok) throw new Error(d.message ?? "Failed");
      setTelegramLinkCode(d.code ?? null);
    } catch (e) {
      setTelegramMsg(e instanceof Error ? e.message : "Could not generate link");
    } finally {
      setTelegramLoading(false);
    }
  }

  function copyCode() {
    if (!telegramLinkCode) return;
    navigator.clipboard.writeText(`/start ${telegramLinkCode}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (authLoading || !token) return null;

  const telegramConnected = Boolean(me?.telegram_id);
  const whatsappConnected = Boolean(me?.whatsapp_number);

  return (
    <main className="min-w-0">
      <section className="p-6 md:p-10 max-w-5xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--text)]">Chat with Kevin</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Your AI co-pilot. Ask about your network, manage introductions, or explore the ecosystem.
          </p>
        </div>

        {/* Chat card */}
        <StartupKevinChatCard
          token={token}
          emptyHint="Ask Kevin anything about your network, introductions, or the ecosystem."
        />

        {/* Channel connections */}
        <div>
          <h2 className="text-sm font-semibold mb-1">Connect Kevin on other channels</h2>
          <p className="text-sm text-[var(--text-muted)] mb-5">
            Kevin lives everywhere. Connect him on Telegram, WhatsApp, or email to reach him without opening the platform.
          </p>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">

            {/* WhatsApp */}
            <a
              href="https://wa.me/27818621473"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-4 flex items-center gap-3 transition-colors hover:border-metatron-accent/30"
            >
              <span className="shrink-0 text-[#25D366]"><WhatsAppIcon /></span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--text)]">WhatsApp</p>
                {whatsappConnected ? (
                  <p className="text-xs text-green-400 mt-0.5 truncate">Connected — {me?.whatsapp_number}</p>
                ) : (
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">Send &quot;Hi Kevin&quot; to get started</p>
                )}
              </div>
            </a>

            {/* Telegram */}
            <button
              type="button"
              onClick={() => {
                if (telegramConnected) {
                  window.open("https://t.me/Kevinmetatron_bot", "_blank", "noopener,noreferrer");
                } else {
                  setTelegramPopupOpen(true);
                  if (!telegramLinkCode) void onLinkTelegram();
                }
              }}
              className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-4 flex items-center gap-3 text-left transition-colors hover:border-metatron-accent/30"
            >
              <span className="shrink-0 text-[#29A9EB]"><TelegramIcon /></span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--text)]">Telegram</p>
                {telegramConnected ? (
                  <p className="text-xs text-green-400 mt-0.5">Connected</p>
                ) : (
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">Not connected</p>
                )}
              </div>
            </button>

            {/* Email */}
            <a
              href="mailto:kevin@metatron.id"
              className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-4 flex items-center gap-3 transition-colors hover:border-metatron-accent/30"
            >
              <span className="shrink-0 text-[var(--text-muted)]"><EmailIcon /></span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--text)]">Email</p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">Always available — no setup needed</p>
              </div>
            </a>

          </div>
        </div>

        {telegramPopupOpen && !telegramConnected && (
          <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto py-8 px-4">
            <div className="absolute inset-0 bg-black/60" onClick={() => setTelegramPopupOpen(false)} />
            <div className="relative z-10 w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-[#29A9EB]"><TelegramIcon /></span>
                  <p className="text-sm font-medium text-[var(--text)]">Connect Telegram</p>
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

              {telegramMsg && <p className="mb-2 text-xs text-[rgb(254,202,202)]">{telegramMsg}</p>}

              {telegramLinkCode ? (
                <div className="space-y-2">
                  <p className="text-xs text-[var(--text-muted)]">
                    Open Kevin on Telegram, then send this code:
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 font-mono text-xs bg-[var(--border)] rounded px-2 py-1 text-[var(--text)]">
                      /start {telegramLinkCode}
                    </code>
                    <button type="button" onClick={copyCode} className="text-xs text-metatron-accent hover:underline shrink-0">
                      {copied ? "Copied!" : "Copy"}
                    </button>
                  </div>
                  <a
                    href={`https://t.me/Kevinmetatron_bot?start=${telegramLinkCode}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block text-xs text-metatron-accent hover:underline"
                  >
                    Open @Kevinmetatron_bot
                  </a>
                  <p className="text-[11px] text-[var(--text-muted)]">Waiting for you to connect… (auto-detects)</p>
                </div>
              ) : (
                <p className="text-xs text-[var(--text-muted)]">
                  {telegramLoading ? "Generating…" : "Preparing your link…"}
                </p>
              )}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
