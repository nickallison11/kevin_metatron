"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import { TelegramLogo, WhatsAppLogo } from "@/components/kevin/AppLogos";
import { ConnectRow, RowPanel, listCard, rowBtn, rowBtnPrimary, sectionTitle } from "@/components/kevin/ConnectRow";
import { API_BASE, authHeaders } from "@/lib/api";
import { KEVIN_TELEGRAM, KEVIN_WHATSAPP } from "@/lib/kevinChannels";
import type { MeResponse } from "@/lib/me";

type Channel = "whatsapp" | "telegram";
const LABEL: Record<Channel, string> = { whatsapp: "WhatsApp", telegram: "Telegram" };
const LOGO: Record<Channel, ReactNode> = { whatsapp: <WhatsAppLogo />, telegram: <TelegramLogo /> };

/** The message WhatsApp opens with; Kevin links the number that sends it. */
export const whatsappLinkText = (code: string) => `Link my metatron account: ${code}`;

const btn =
  "inline-flex min-h-9 items-center justify-center rounded-[10px] border border-[var(--overlay-12)] px-3 text-[13px] font-medium text-[var(--text)] hover:bg-[var(--overlay-4)] disabled:opacity-50";
const btnPrimary =
  "inline-flex min-h-9 items-center justify-center rounded-[10px] bg-metatron-accent px-3 text-[13px] font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-50";

/**
 * "Kevin on your messaging app": an account uses WhatsApp OR Telegram, never both.
 * Both link with a one-time code sent from the app itself, so nobody can claim
 * a number or account they don't hold. Picking the other app asks first,
 * because linking it disconnects the current one (the backend enforces it).
 */
export function KevinChannelPicker({ token }: { token: string }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [pending, setPending] = useState<Channel | null>(null);
  const [setup, setSetup] = useState<Channel | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const loadMe = useCallback(async () => {
    const res = await fetch(`${API_BASE}/auth/me`, { headers: authHeaders(token) }).catch(() => null);
    if (res?.ok) setMe((await res.json()) as MeResponse);
  }, [token]);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  // While a link code is showing, watch for the link to land.
  useEffect(() => {
    if (!code || !setup) return;
    const t = setInterval(async () => {
      const res = await fetch(`${API_BASE}/auth/me`, { headers: authHeaders(token) }).catch(() => null);
      if (!res?.ok) return;
      const d = (await res.json()) as MeResponse;
      if (setup === "telegram" ? d.telegram_id : d.whatsapp_number) {
        setMe(d);
        setCode(null);
        setSetup(null);
      }
    }, 3000);
    return () => clearInterval(t);
  }, [code, setup, token]);

  const current: Channel | null = me?.whatsapp_number ? "whatsapp" : me?.telegram_id ? "telegram" : null;

  async function startLink(c: Channel) {
    setBusy(true);
    setMsg(null);
    try {
      const path = c === "telegram" ? "/auth/telegram/link-token" : "/auth/whatsapp/link-code";
      const res = await fetch(`${API_BASE}${path}`, { method: "POST", headers: authHeaders(token) });
      const txt = await res.text();
      if (!res.ok) throw new Error(txt.trim() || "Could not get a link code");
      setCode((JSON.parse(txt) as { code?: string }).code ?? null);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not get a link code");
    } finally {
      setBusy(false);
    }
  }

  function begin(c: Channel) {
    setPending(null);
    setSetup(c);
    setCode(null);
    setMsg(null);
    void startLink(c);
  }

  function choose(c: Channel) {
    if (current) setPending(c);
    else begin(c);
  }


  return (
    <section className="flex flex-col gap-3">
      <h2 className={sectionTitle}>Kevin on your messaging app</h2>
      <div className={listCard}>
        {(["whatsapp", "telegram"] as const).map((c) => {
          const on = current === c;
          return (
            <div key={c}>
              <ConnectRow
                logo={LOGO[c]}
                name={LABEL[c]}
                status={on ? (c === "whatsapp" ? `Connected · +${me?.whatsapp_number}` : "Connected") : current ? undefined : "Not connected"}
                good={on}
                action={
                  on ? (
                    <a href={c === "whatsapp" ? KEVIN_WHATSAPP : KEVIN_TELEGRAM} target="_blank" rel="noopener noreferrer" className={rowBtnPrimary}>
                      Message Kevin
                    </a>
                  ) : setup === c || pending === c ? (
                    <button
                      type="button"
                      className={rowBtn}
                      onClick={() => {
                        setPending(null);
                        setSetup(null);
                        setCode(null);
                      }}
                    >
                      Close
                    </button>
                  ) : (
                    <button type="button" className={current ? rowBtn : rowBtnPrimary} onClick={() => choose(c)}>
                      {current ? "Switch" : "Connect"}
                    </button>
                  )
                }
              />

              {pending === c && current && (
                <RowPanel>
                  <div role="alert" className="flex flex-col gap-2.5 rounded-[10px] border border-[var(--warn)] bg-[var(--warn-bg)] p-3 text-sm">
                    <span>
                      Switch to {LABEL[c]}? This disconnects {LABEL[current]} from your account.
                    </span>
                    <div className="flex gap-2">
                      <button type="button" className={btn} onClick={() => setPending(null)}>
                        Cancel
                      </button>
                      <button type="button" className={btnPrimary} onClick={() => begin(c)}>
                        Switch
                      </button>
                    </div>
                  </div>
                </RowPanel>
              )}

              {c === "telegram" && setup === "telegram" && current !== "telegram" && (
                <RowPanel>
                  <div className="flex flex-col gap-2.5 rounded-[10px] bg-[var(--overlay-4)] p-3 text-sm">
                    {!code ? (
                      <span className="text-[var(--text-muted)]">{busy ? "Getting your link…" : "Preparing your link…"}</span>
                    ) : (
                      <>
                        <span className="text-[var(--text-muted)]">Open Kevin on Telegram and press Start.</span>
                        <a href={`${KEVIN_TELEGRAM}?start=${code}`} target="_blank" rel="noopener noreferrer" className={`${btnPrimary} w-fit`}>
                          Open Telegram →
                        </a>
                        <span className="text-xs text-[var(--text-muted)]">Waiting for you to connect… The code expires in 15 minutes.</span>
                      </>
                    )}
                  </div>
                </RowPanel>
              )}

              {c === "whatsapp" && setup === "whatsapp" && current !== "whatsapp" && (
                <RowPanel>
                  <div className="flex flex-col gap-2.5 rounded-[10px] bg-[var(--overlay-4)] p-3 text-sm">
                    {!code ? (
                      <span className="text-[var(--text-muted)]">{busy ? "Getting your code…" : "Preparing your code…"}</span>
                    ) : (
                      <>
                        <span className="text-[var(--text-muted)]">Open WhatsApp on your phone and send the message as it is.</span>
                        <a
                          href={`${KEVIN_WHATSAPP}?text=${encodeURIComponent(whatsappLinkText(code))}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`${btnPrimary} w-fit`}
                        >
                          Open WhatsApp →
                        </a>
                        <span className="text-xs text-[var(--text-muted)]">Waiting for your message… The code expires in 15 minutes.</span>
                      </>
                    )}
                  </div>
                </RowPanel>
              )}
            </div>
          );
        })}
      </div>

      {/* Errors only; the rows show what's connected. */}
      {msg && (
        <p role="alert" className="text-[13px] text-[var(--text-muted)]">
          {msg}
        </p>
      )}
    </section>
  );
}
