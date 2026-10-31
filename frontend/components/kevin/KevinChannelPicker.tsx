"use client";

import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";
import { TelegramLogo, WhatsAppLogo } from "@/components/kevin/AppLogos";
import { ConnectRow, RowPanel, listCard, rowBtn, rowBtnPrimary, sectionTitle } from "@/components/kevin/ConnectRow";
import { API_BASE, authHeaders, authJsonHeaders } from "@/lib/api";
import { KEVIN_TELEGRAM, KEVIN_WHATSAPP } from "@/lib/kevinChannels";
import type { MeResponse } from "@/lib/me";

type Channel = "whatsapp" | "telegram";
const LABEL: Record<Channel, string> = { whatsapp: "WhatsApp", telegram: "Telegram" };
const LOGO: Record<Channel, ReactNode> = { whatsapp: <WhatsAppLogo />, telegram: <TelegramLogo /> };

const input =
  "w-full min-h-11 rounded-[10px] border border-[var(--overlay-12)] bg-[var(--bg)] px-3.5 py-2.5 text-sm text-[var(--text)] outline-none focus:border-metatron-accent";
const btn =
  "inline-flex min-h-9 items-center justify-center rounded-[10px] border border-[var(--overlay-12)] px-3 text-[13px] font-medium text-[var(--text)] hover:bg-[var(--overlay-4)] disabled:opacity-50";
const btnPrimary =
  "inline-flex min-h-9 items-center justify-center rounded-[10px] bg-metatron-accent px-3 text-[13px] font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-50";

/**
 * "Kevin on your messaging app": an account uses WhatsApp OR Telegram, never both.
 * Picking the other app asks first, because linking it disconnects the
 * current one (the backend enforces the switch).
 */
export function KevinChannelPicker({ token }: { token: string }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [pending, setPending] = useState<Channel | null>(null);
  const [setup, setSetup] = useState<Channel | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadMe = useCallback(async () => {
    const res = await fetch(`${API_BASE}/auth/me`, { headers: authHeaders(token) }).catch(() => null);
    if (res?.ok) setMe((await res.json()) as MeResponse);
  }, [token]);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  // While a Telegram code is showing, watch for the link to land.
  useEffect(() => {
    if (!code || me?.telegram_id) return;
    const t = setInterval(async () => {
      const res = await fetch(`${API_BASE}/auth/me`, { headers: authHeaders(token) }).catch(() => null);
      if (!res?.ok) return;
      const d = (await res.json()) as MeResponse;
      if (d.telegram_id) {
        setMe(d);
        setCode(null);
        setSetup(null);
      }
    }, 3000);
    return () => clearInterval(t);
  }, [code, me?.telegram_id, token]);

  const current: Channel | null = me?.whatsapp_number ? "whatsapp" : me?.telegram_id ? "telegram" : null;

  async function startTelegram() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`${API_BASE}/auth/telegram/link-token`, { method: "POST", headers: authHeaders(token) });
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
    setMsg(null);
    if (c === "telegram") void startTelegram();
  }

  function choose(c: Channel) {
    if (c === current) {
      setSetup(setup === c ? null : c);
      return;
    }
    if (current) setPending(c);
    else begin(c);
  }

  async function saveNumber(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`${API_BASE}/auth/whatsapp-number`, {
        method: "PUT",
        headers: authJsonHeaders(token),
        body: JSON.stringify({ whatsapp_number: number.trim() || null }),
      });
      if (!res.ok) throw new Error((await res.text()).trim() || "Could not save your number");
      await loadMe();
      setSetup(null);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not save your number");
    } finally {
      setBusy(false);
    }
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
                        <span className="text-[var(--text-muted)]">Open Kevin on Telegram. It links automatically.</span>
                        <a href={`${KEVIN_TELEGRAM}?start=${code}`} target="_blank" rel="noopener noreferrer" className={`${btnPrimary} w-fit`}>
                          Open Telegram →
                        </a>
                        <span className="text-xs text-[var(--text-muted)]">Or send this to @Kevinmetatron_bot:</span>
                        <div className="flex items-center gap-2">
                          <code className="min-w-0 flex-1 select-all truncate rounded-[8px] border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 font-mono text-xs">/start {code}</code>
                          <button
                            type="button"
                            className={btn}
                            onClick={() =>
                              void navigator.clipboard.writeText(`/start ${code}`).then(() => {
                                setCopied(true);
                                setTimeout(() => setCopied(false), 2000);
                              })
                            }
                          >
                            {copied ? "Copied" : "Copy"}
                          </button>
                        </div>
                        <span className="text-xs text-[var(--text-muted)]">Waiting for you to connect… The code expires in 15 minutes.</span>
                      </>
                    )}
                  </div>
                </RowPanel>
              )}

              {c === "whatsapp" && setup === "whatsapp" && current !== "whatsapp" && (
                <RowPanel>
                  <form onSubmit={saveNumber} className="flex flex-col gap-2.5 rounded-[10px] bg-[var(--overlay-4)] p-3 text-sm">
                    <label className="flex flex-col gap-1.5 font-semibold">
                      <span>Your WhatsApp number, with country code</span>
                      <input className={input} type="tel" inputMode="tel" autoComplete="tel" placeholder="e.g. 27821234567" value={number} onChange={(e) => setNumber(e.target.value)} required />
                    </label>
                    <div className="flex gap-2">
                      <button type="button" className={btn} onClick={() => setSetup(null)}>
                        Cancel
                      </button>
                      <button type="submit" className={btnPrimary} disabled={busy}>
                        {busy ? "Saving…" : "Save number"}
                      </button>
                    </div>
                  </form>
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
