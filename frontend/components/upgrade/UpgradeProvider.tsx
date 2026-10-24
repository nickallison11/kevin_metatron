"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { IconCheck, IconX } from "@tabler/icons-react";
import { API_BASE, authJsonHeaders } from "@/lib/api";
import { usePaymentsEnabled } from "@/lib/payments";
import { PLAN_COPY, type PlanRole } from "@/lib/plans";
import { checkoutFootnote, planPrice, useRegionalCurrency, type Billing, type Currency } from "@/lib/pricing";
import { getAccessToken } from "@/lib/tokenStore";

const CURRENCY_LABELS: Record<Currency, string> = { ZAR: "ZAR (R)", USD: "USD ($)", EUR: "EUR (€)" };

type PlanLevel = "free" | "basic" | "pro";

const UpgradeContext = createContext<{ openUpgrade: () => void }>({ openUpgrade: () => {} });

/** Opens the upgrade popup from anywhere inside `UpgradeProvider`. */
export function useUpgrade() {
  return useContext(UpgradeContext);
}

/** A button that opens the upgrade popup; styled by the caller like the link it replaces. */
export function UpgradeButton({ className, children }: { className?: string; children: ReactNode }) {
  const { openUpgrade } = useUpgrade();
  return (
    <button type="button" onClick={openUpgrade} className={className}>
      {children}
    </button>
  );
}

function roleFromToken(token: string): PlanRole {
  try {
    const b64 = token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const p = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))) as { role?: string };
    if (p.role === "INVESTOR" || p.role === "INTERMEDIARY") return p.role;
  } catch {
    /* fall through */
  }
  return "STARTUP";
}

async function fetchPlan(token: string): Promise<PlanLevel> {
  const res = await fetch(`${API_BASE}/subscriptions/status`, { headers: authJsonHeaders(token) }).catch(() => null);
  if (!res?.ok) return "free";
  const s = (await res.json()) as { subscription_status?: string; subscription_tier?: string };
  if (s.subscription_status !== "active") return "free";
  return (s.subscription_tier ?? "").toLowerCase() === "pro" ? "pro" : "basic";
}

/**
 * Upgrade popup for the whole app. Any button calls `useUpgrade().openUpgrade()`;
 * checkout goes to Stripe and comes back to the page the user was on with
 * `?upgraded=1`, where this waits for the plan to switch on and reloads.
 */
export default function UpgradeProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [activating, setActivating] = useState<"waiting" | "slow" | null>(null);

  const openUpgrade = useCallback(() => setOpen(true), []);

  // Links to /pricing (e.g. in Kevin's daily-limit message) open the popup
  // for signed-in users instead of leaving the app.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || !getAccessToken()) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      const url = new URL(a.href, window.location.href);
      const ours = url.host === window.location.host || /(^|\.)metatron\.id$/.test(url.hostname);
      if (ours && url.pathname.replace(/\/$/, "") === "/pricing") {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // Back from Stripe: wait for the webhook to switch the plan on, then reload.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("upgraded") !== "1") return;
    url.searchParams.delete("upgraded");
    const clean = url.pathname + (url.search ? url.search : "") + url.hash;
    const token = getAccessToken();
    if (!token) return;
    setActivating("waiting");
    let tries = 0;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      tries += 1;
      if ((await fetchPlan(token)) !== "free") {
        window.location.replace(clean);
        return;
      }
      if (tries >= 10) {
        window.history.replaceState({}, "", clean);
        setActivating("slow");
        return;
      }
      setTimeout(() => void tick(), 2000);
    };
    void tick();
    return () => {
      stopped = true;
    };
  }, []);

  return (
    <UpgradeContext.Provider value={{ openUpgrade }}>
      {children}
      {open && <UpgradeModal onClose={() => setOpen(false)} />}
      {activating && (
        <div role="status" className="fixed inset-x-4 bottom-4 z-[80] mx-auto flex max-w-sm items-center gap-3 rounded-2xl border border-[var(--overlay-12)] bg-[var(--bg-card)] px-4 py-3 text-sm shadow-[0_16px_40px_rgba(0,0,0,0.45)]">
          {activating === "waiting" ? (
            <span aria-hidden className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[var(--overlay-12)] border-t-metatron-accent" />
          ) : (
            <IconCheck size={18} className="shrink-0 text-[var(--accent-fg)]" />
          )}
          <span className="flex-1">{activating === "waiting" ? "Activating your plan…" : "Payment received. Your plan switches on in a moment."}</span>
          {activating === "slow" && (
            <button type="button" aria-label="Dismiss" onClick={() => setActivating(null)} className="-mr-1 flex h-8 w-8 items-center justify-center text-[var(--text-muted)]">
              <IconX size={16} />
            </button>
          )}
        </div>
      )}
    </UpgradeContext.Provider>
  );
}

function UpgradeModal({ onClose }: { onClose: () => void }) {
  const token = getAccessToken();
  const role: PlanRole = token ? roleFromToken(token) : "STARTUP";
  const copy = PLAN_COPY[role];
  const paymentsEnabled = usePaymentsEnabled();
  const { currency, currencies, setCurrency } = useRegionalCurrency();
  const [billing, setBilling] = useState<Billing>("monthly");
  const [plan, setPlan] = useState<PlanLevel | null>(null);
  const [busy, setBusy] = useState<"basic" | "pro" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (token) void fetchPlan(token).then(setPlan);
  }, [token]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  async function choose(level: "basic" | "pro") {
    if (!token || !currency) return;
    setBusy(level);
    setError(null);
    try {
      // Basic subscribers move to Pro in Stripe's portal; new plans go through checkout.
      const switching = plan === "basic" && level === "pro";
      const res = await fetch(`${API_BASE}/commerce/stripe/${switching ? "portal" : "checkout"}`, {
        method: "POST",
        headers: authJsonHeaders(token),
        body: JSON.stringify(
          switching
            ? { plan: "pro", billing }
            : { plan: level, billing, currency, return_to: window.location.pathname },
        ),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error || "Could not start checkout.");
      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start checkout.");
      setBusy(null);
    }
  }

  const toggle = (on: boolean) =>
    `min-h-10 rounded-[10px] border px-3.5 text-sm font-semibold ${on ? "border-metatron-accent bg-metatron-accent/10 text-[var(--accent-fg)]" : "border-[var(--overlay-12)] text-[var(--text-muted)] hover:bg-[var(--overlay-4)]"}`;

  const cards: { level: "basic" | "pro"; name: string; features: string[]; featured: boolean }[] = [
    { level: "basic", name: copy.basicName, features: copy.basicFeatures, featured: true },
    { level: "pro", name: copy.proName, features: copy.proFeatures, featured: false },
  ];

  return (
    <div className="fixed inset-0 z-[75] flex bg-[var(--bg)] sm:items-center sm:justify-center sm:bg-black/70 sm:p-6 sm:backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Upgrade"
        className="flex h-full w-full flex-col bg-[var(--bg)] sm:h-auto sm:max-h-[calc(100vh-48px)] sm:max-w-3xl sm:rounded-[20px] sm:border sm:border-[var(--overlay-12)] sm:bg-[var(--bg-card)]"
      >
        <div className="flex h-14 shrink-0 items-center justify-between pl-5 pr-2 pt-[env(safe-area-inset-top)] sm:h-16 sm:pl-6">
          <h2 className="text-xl font-semibold">Upgrade</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="flex h-11 w-11 items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)]">
            <IconX size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[max(20px,env(safe-area-inset-bottom))] sm:px-6 sm:pb-6">
          {!paymentsEnabled ? (
            <div className="flex flex-col gap-4 py-2">
              <p className="text-[15px] text-[var(--text-muted)]">Basic and Pro are coming soon.</p>
              {token && <NotifyMeButtons token={token} plans={copy.hasPro ? ["basic", "pro"] : ["basic"]} />}
            </div>
          ) : !currency || plan === null ? (
            <div className="flex justify-center py-10">
              <span aria-label="Loading" className="h-7 w-7 animate-spin rounded-full border-2 border-[var(--overlay-12)] border-t-metatron-accent" />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                {(["monthly", "annual"] as const).map((b) => (
                  <button key={b} type="button" aria-pressed={billing === b} onClick={() => setBilling(b)} className={toggle(billing === b)}>
                    {b === "monthly" ? "Monthly" : "Annual · save 17%"}
                  </button>
                ))}
                {currencies.length > 1 && (
                  <span className="ml-auto flex gap-2">
                    {currencies.map((c) => (
                      <button key={c} type="button" aria-pressed={currency === c} onClick={() => setCurrency(c)} className={toggle(currency === c)}>
                        {CURRENCY_LABELS[c]}
                      </button>
                    ))}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {cards.map((c) => {
                  const { price, unit } = planPrice(c.level, billing, currency);
                  const current = plan === c.level;
                  const unavailable = c.level === "pro" && !copy.hasPro;
                  const below = plan === "pro" && c.level === "basic";
                  return (
                    <section
                      key={c.level}
                      className={`flex flex-col gap-4 rounded-[16px] border p-5 ${c.featured ? "border-metatron-accent/45 bg-metatron-accent/[0.05]" : "border-[var(--overlay-12)]"} ${unavailable ? "opacity-60" : ""}`}
                    >
                      <div className="flex flex-col gap-1">
                        <span className="text-sm font-semibold text-[var(--text-muted)]">{c.name}</span>
                        <span className="text-3xl font-bold tracking-tight">
                          {price} <span className="text-base font-semibold text-[var(--text-muted)]">{unit}</span>
                        </span>
                      </div>
                      {current ? (
                        <span className="inline-flex min-h-12 items-center justify-center rounded-xl border border-[var(--overlay-12)] text-sm font-semibold text-[var(--text-muted)]">Current plan</span>
                      ) : unavailable ? (
                        <span className="inline-flex min-h-12 items-center justify-center rounded-xl border border-[var(--overlay-12)] text-sm font-semibold text-[var(--text-muted)]">Coming soon</span>
                      ) : below ? null : (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => void choose(c.level)}
                          className={`inline-flex min-h-12 items-center justify-center rounded-xl text-[15px] font-semibold disabled:opacity-60 ${c.featured ? "bg-metatron-accent text-white hover:bg-metatron-accent-hover" : "border border-[var(--overlay-12)] text-[var(--text)] hover:bg-[var(--overlay-4)]"}`}
                        >
                          {busy === c.level ? "Opening Stripe…" : `Choose ${c.level === "basic" ? "Basic" : "Pro"}`}
                        </button>
                      )}
                      <ul className="flex flex-col gap-2">
                        {c.features.map((f) => (
                          <li key={f} className="flex gap-2 text-[13px] text-[var(--text-muted)]">
                            <IconCheck size={15} stroke={2.2} className="mt-0.5 shrink-0 text-[var(--accent-fg)]" />
                            {f}
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </div>

              {error && (
                <p role="alert" className="text-sm text-[var(--danger)]">
                  {error}
                </p>
              )}
              <p className="text-center text-xs text-[var(--text-muted)]">{checkoutFootnote(currency)}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** "Notify me" buttons shown while paid plans are switched off. */
function NotifyMeButtons({ token, plans }: { token: string; plans: ("basic" | "pro")[] }) {
  const [joined, setJoined] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/subscriptions/notify-me`, { headers: authJsonHeaders(token) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { plans?: string[] } | null) => setJoined(d?.plans ?? []))
      .catch(() => {});
  }, [token]);

  const join = async (plan: "basic" | "pro") => {
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/subscriptions/notify-me`, {
        method: "POST",
        headers: authJsonHeaders(token),
        body: JSON.stringify({ plan, source: "web" }),
      });
      if (res.ok) setJoined((j) => (j.includes(plan) ? j : [...j, plan]));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2.5 sm:flex-row">
      {plans.map((plan) => {
        const label = plan === "basic" ? "Basic" : "Pro";
        return joined.includes(plan) ? (
          <span key={plan} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-[var(--overlay-12)] px-4 text-sm text-[var(--text-muted)]">
            <IconCheck size={16} /> We&apos;ll tell you when {label} launches
          </span>
        ) : (
          <button
            key={plan}
            type="button"
            disabled={busy}
            onClick={() => void join(plan)}
            className="inline-flex min-h-12 items-center justify-center rounded-xl bg-metatron-accent px-4 text-sm font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-60"
          >
            Notify me when {label} launches
          </button>
        );
      })}
    </div>
  );
}
