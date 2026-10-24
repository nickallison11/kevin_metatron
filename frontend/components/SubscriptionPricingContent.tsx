"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { API_BASE, authJsonHeaders } from "@/lib/api";
import { usePaymentsEnabled } from "@/lib/payments";
import { useUpgrade } from "@/components/upgrade/UpgradeProvider";

export type InvoiceRow = {
  id: string;
  amount: number;
  currency: string;
  payment_method: string;
  tier: string;
  period_start: string;
  period_end: string;
  reference: string | null;
  created_at: string;
};

type Role = "STARTUP" | "INVESTOR" | "INTERMEDIARY";

export type SubscriptionPricingContentProps = {
  token: string;
  role: Role;
  isPaid: boolean;
  /** Current plan level — "free" | "basic" | "pro". Defaults to "free". */
  planLevel?: "free" | "basic" | "pro";
  planName: string;
  basePath: string;
  invoices: InvoiceRow[];
  extraPaidInfo?: React.ReactNode;
  onVerifySuccess: () => void;
  /** Subscription status (cancel / downgrade / period end); used whenever isPaid, for any role. */
  subMeta?: {
    periodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    subscriptionTier: string;
    pendingDowngradeTo: string | null;
  };
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Billing & invoices: the current plan and payment history. Upgrading
 * happens in the upgrade popup (`useUpgrade`), opened from here or anywhere
 * else in the app.
 */
export default function SubscriptionPricingContent(props: SubscriptionPricingContentProps) {
  const { token, role, isPaid, planLevel = "free", planName, basePath, invoices, extraPaidInfo, onVerifySuccess, subMeta } = props;

  const paymentsEnabled = usePaymentsEnabled();
  const { openUpgrade } = useUpgrade();
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !token) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("success") !== "1") return;

    // Back from Stripe: the webhook activates the plan within a few
    // seconds, so reload the status a few times.
    let cancelled = false;
    setVerifying(true);
    setError(null);
    window.history.replaceState({}, "", basePath);
    onVerifySuccess();
    const timers = [2000, 5000, 10000].map((ms, i, all) =>
      setTimeout(() => {
        if (cancelled) return;
        onVerifySuccess();
        if (i === all.length - 1) setVerifying(false);
      }, ms),
    );
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [token, basePath, onVerifySuccess]);

  // Card updates, invoices, plan changes and cancellation live in Stripe's portal.
  const openPortal = async () => {
    setActionBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/commerce/stripe/portal`, {
        method: "POST",
        headers: authJsonHeaders(token),
        body: JSON.stringify({}),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error || "Could not open billing.");
      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open billing.");
      setActionBusy(false);
    }
  };

  const card = "rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-6 shadow-[var(--card-shadow)]";
  const btnPrimary =
    "inline-flex min-h-11 items-center justify-center rounded-[12px] bg-metatron-accent px-5 text-sm font-semibold text-white transition-colors hover:bg-metatron-accent-hover";
  const btn =
    "inline-flex min-h-11 items-center justify-center rounded-[12px] border border-[var(--border)] px-5 text-sm font-semibold text-[var(--text)] transition-colors hover:border-metatron-accent/30 disabled:opacity-60";

  const billingPeriod = (subMeta?.subscriptionTier ?? "free").toLowerCase();
  // Connectors have no Pro tier on the backend yet.
  const canGoPro = (role === "STARTUP" || role === "INVESTOR") && planLevel === "basic" && paymentsEnabled;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6 md:p-10">
      <header className="flex flex-col gap-1.5">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">Billing</span>
        <h1 className="text-[28px] font-semibold tracking-tight text-[var(--text)]">{isPaid ? planName : "Free plan"}</h1>
      </header>

      {verifying && (
        <div className="rounded-[12px] border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 text-sm text-[var(--text-muted)]">
          Verifying payment…
        </div>
      )}
      {error && (
        <div role="alert" className="rounded-[12px] border border-[var(--danger)] px-4 py-3 text-sm text-[var(--danger)]">
          {error}
        </div>
      )}

      <section className={card}>
        <h2 className="font-sans text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Subscription</h2>
        {isPaid ? (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-lg font-semibold text-[var(--text)]">
                {planName}
                {subMeta && (billingPeriod === "monthly" || billingPeriod === "annual") && (
                  <span className="text-[var(--text-muted)]"> · {billingPeriod === "annual" ? "Annual" : "Monthly"}</span>
                )}
              </span>
              <span className="rounded-full bg-[var(--good-bg)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--good)]">Active</span>
            </div>
            {extraPaidInfo && <div className="mt-2">{extraPaidInfo}</div>}
            {subMeta && <p className="mt-2 text-sm text-[var(--text-muted)]">Active until: {formatDate(subMeta.periodEnd)}</p>}
            {subMeta?.cancelAtPeriodEnd && (
              <p className="mt-2 text-sm text-[var(--text-muted)]">Cancellation scheduled — access ends {formatDate(subMeta.periodEnd)}</p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {canGoPro && (
                <button type="button" onClick={openUpgrade} className={btnPrimary}>
                  Upgrade to Pro
                </button>
              )}
              <button type="button" disabled={actionBusy} onClick={() => void openPortal()} className={btn}>
                {actionBusy ? "Opening…" : "Manage billing"}
              </button>
            </div>
          </>
        ) : (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-lg font-semibold text-[var(--text)]">Free plan</p>
            <button type="button" onClick={openUpgrade} className={btnPrimary}>
              Upgrade
            </button>
          </div>
        )}
      </section>

      <section className={card}>
        <h2 className="font-sans text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Invoices</h2>
        {invoices.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--text-muted)]">No payments yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[520px] text-[13px]">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                  <th className="py-2 text-left">Date</th>
                  <th className="py-2 text-left">Amount</th>
                  <th className="py-2 text-left">Method</th>
                  <th className="py-2 text-left">Period</th>
                  <th className="py-2 text-left">Invoice</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-[var(--border)]">
                    <td className="py-2 text-[var(--text-muted)]">{formatDate(inv.created_at)}</td>
                    <td className="py-2">
                      {inv.currency} {inv.amount.toFixed(2)}
                    </td>
                    <td className="py-2 capitalize text-[var(--text-muted)]">{inv.payment_method}</td>
                    <td className="py-2 text-[var(--text-muted)]">
                      {formatDate(inv.period_start)} → {formatDate(inv.period_end)}
                    </td>
                    <td className="py-2">
                      <Link href={`${basePath}/invoice/${inv.id}`} className="text-[13px] text-[var(--accent-fg)] hover:underline">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
