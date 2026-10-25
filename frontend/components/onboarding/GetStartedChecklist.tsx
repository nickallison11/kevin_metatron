"use client";

import Link from "next/link";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { API_BASE, authHeaders } from "@/lib/api";
import { KEVIN_TELEGRAM, KEVIN_WHATSAPP } from "@/lib/kevinChannels";
import type { MeResponse } from "@/lib/me";

const HELLO = "Hi Kevin, I just signed up on metatron.";

type Step = { title: string; text: string; href: string; cta: string };

/** True while a new account still has first steps left. Older accounts (no app picked at sign-up) never see it. */
export function showGetStarted(me: MeResponse | null, mainDone: boolean): boolean {
  if (!me?.preferred_channel) return false;
  return !(isConnected(me) && mainDone);
}

function isConnected(me: MeResponse): boolean {
  return Boolean(me.channel_connected_at && (me.whatsapp_number || me.telegram_id));
}

/**
 * First-run checklist for accounts made through the home-page sign-up:
 * 1 say hi to Kevin on the app they picked, 2 the main job (deck or thesis),
 * 3 matches, which unlock after step 2.
 */
export default function GetStartedChecklist({
  token,
  me,
  onMe,
  main,
  mainDone,
  matchesHref,
  matchesTitle,
}: {
  token: string;
  me: MeResponse;
  onMe: (me: MeResponse) => void;
  main: Step;
  mainDone: boolean;
  matchesHref: string;
  matchesTitle: string;
}) {
  const app = me.preferred_channel === "telegram" ? "Telegram" : "WhatsApp";
  const connected = isConnected(me);
  const [tgCode, setTgCode] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [qr, setQr] = useState<string | null>(null);

  const href =
    app === "Telegram"
      ? tgCode
        ? `${KEVIN_TELEGRAM}?start=${tgCode}`
        : null
      : `${KEVIN_WHATSAPP}?text=${encodeURIComponent(HELLO)}`;

  // Telegram links the account through a one-time /start code.
  useEffect(() => {
    if (connected || app !== "Telegram") return;
    void fetch(`${API_BASE}/auth/telegram/link-token`, { method: "POST", headers: authHeaders(token) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { code?: string } | null) => setTgCode(d?.code ?? null))
      .catch(() => {});
  }, [app, connected, token]);

  // On a computer, a QR code lets them open the chat on their phone.
  useEffect(() => {
    if (!href || connected) return;
    void QRCode.toDataURL(href, { width: 160, margin: 1 }).then(setQr).catch(() => setQr(null));
  }, [href, connected]);

  // After they tap the button, watch for the first message to land.
  useEffect(() => {
    if (!waiting || connected) return;
    const started = Date.now();
    const t = setInterval(async () => {
      if (Date.now() - started > 15 * 60 * 1000) return setWaiting(false);
      const res = await fetch(`${API_BASE}/auth/me`, { headers: authHeaders(token) }).catch(() => null);
      if (res?.ok) {
        const d = (await res.json()) as MeResponse;
        if (isConnected(d)) onMe(d);
      }
    }, 4000);
    return () => clearInterval(t);
  }, [waiting, connected, token, onMe]);

  const badge = (n: number, done: boolean, locked = false) => (
    <span
      aria-hidden
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-mono text-[13px] ${
        done ? "bg-metatron-accent/[0.22] text-[var(--accent-fg)]" : locked ? "bg-[var(--overlay-4)] text-[var(--text-muted)]" : "bg-[var(--overlay-6)] text-[var(--text)]"
      }`}
    >
      {done ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      ) : (
        n
      )}
    </span>
  );
  const row = "flex flex-col gap-3.5 rounded-[14px] border p-4 sm:flex-row sm:items-center sm:gap-5 sm:p-5";
  const btnPrimary =
    "inline-flex min-h-12 items-center justify-center rounded-xl bg-metatron-accent px-5 text-[15px] font-semibold text-white hover:bg-metatron-accent-hover";
  const btn =
    "inline-flex min-h-12 items-center justify-center rounded-xl border border-[var(--overlay-12)] px-5 text-[15px] font-semibold text-[var(--text)] hover:bg-[var(--overlay-4)]";

  return (
    <section aria-labelledby="get-started-title" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="get-started-title" className="text-lg font-semibold">
          Get started with Kevin
        </h2>
        <span className="text-sm text-[var(--text-muted)]">Three steps and Kevin starts working for you.</span>
      </div>

      <div className={`${row} ${connected ? "border-metatron-accent/40 bg-[var(--bg-card)]" : "border-[var(--overlay-12)] bg-[var(--bg-card)]"}`}>
        <div className="flex min-w-0 flex-1 gap-3.5">
          {badge(1, connected)}
          <div className="flex min-w-0 flex-col gap-1">
            <strong className="text-base">{connected ? `Kevin is on ${app}` : `Say hi to Kevin on ${app}`}</strong>
            <span className="text-sm leading-relaxed text-[var(--text-muted)]">
              {connected
                ? "Connected. He'll message you there when he finds a match."
                : waiting
                  ? `Waiting for your first message on ${app}…`
                  : `One tap opens ${app} with a message ready. Then Kevin can send you matches and updates there.`}
            </span>
          </div>
        </div>
        {!connected && (
          <div className="flex items-center gap-4">
            {qr && (
              <img src={qr} alt={`QR code to open Kevin on ${app}`} width={88} height={88} className="hidden rounded-lg bg-white p-1 md:block" />
            )}
            {href ? (
              <a href={href} target="_blank" rel="noopener noreferrer" onClick={() => setWaiting(true)} className={`${btnPrimary} w-full sm:w-auto`}>
                Open {app}
              </a>
            ) : (
              <span className="text-sm text-[var(--text-muted)]">Preparing your link…</span>
            )}
          </div>
        )}
      </div>

      <div className={`${row} ${mainDone ? "border-metatron-accent/40" : "border-[var(--overlay-12)]"} bg-[var(--bg-card)]`}>
        <div className="flex min-w-0 flex-1 gap-3.5">
          {badge(2, mainDone)}
          <div className="flex min-w-0 flex-col gap-1">
            <strong className="text-base">{main.title}</strong>
            <span className="text-sm leading-relaxed text-[var(--text-muted)]">{mainDone ? "Done." : main.text}</span>
          </div>
        </div>
        {!mainDone && (
          <Link href={main.href} className={`${btn} w-full sm:w-auto`}>
            {main.cta}
          </Link>
        )}
      </div>

      <div className={`${row} ${mainDone ? "border-[var(--overlay-12)] bg-[var(--bg-card)]" : "border-dashed border-[var(--overlay-12)]"}`}>
        <div className="flex min-w-0 flex-1 gap-3.5">
          {badge(3, false, !mainDone)}
          <div className="flex min-w-0 flex-col gap-1">
            <strong className={`text-base ${mainDone ? "" : "text-[var(--text-muted)]"}`}>{matchesTitle}</strong>
            <span className="text-sm leading-relaxed text-[var(--text-muted)]">
              {mainDone ? "Kevin has started matching. Your list grows as he finds more." : `Unlocks once step 2 is done.`}
            </span>
          </div>
        </div>
        {mainDone && (
          <Link href={matchesHref} className={`${btn} w-full sm:w-auto`}>
            See matches
          </Link>
        )}
      </div>
    </section>
  );
}
