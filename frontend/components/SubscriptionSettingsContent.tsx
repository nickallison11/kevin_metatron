"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { API_BASE, authJsonHeaders } from "@/lib/api";

type SubStatus = {
  subscription_tier: string;
  subscription_status: string;
  subscription_period_end: string | null;
  cancel_at_period_end: boolean;
};

type InvoiceRow = {
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

export default function SubscriptionSettingsContent({
  token,
  pricingPath = "/pricing",
  basePath = "/startup/settings/subscription",
}: {
  token: string;
  pricingPath?: string;
  basePath?: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<SubStatus | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [sRes, iRes] = await Promise.all([
        fetch(`${API_BASE}/subscriptions/status`, {
          headers: authJsonHeaders(token),
        }),
        fetch(`${API_BASE}/subscriptions/invoices`, {
          headers: authJsonHeaders(token),
        }),
      ]);
      if (sRes.ok) {
        setStatus((await sRes.json()) as SubStatus);
      }
      if (iRes.ok) {
        setInvoices((await iRes.json()) as InvoiceRow[]);
      }
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const onCancel = async () => {
    if (!confirm("Cancel your Pro subscription at the end of this billing period?")) return;
    setActionBusy(true);
    try {
      const res = await fetch(`${API_BASE}/subscriptions/cancel`, {
        method: "POST",
        headers: authJsonHeaders(token),
      });
      if (res.ok) await load();
    } finally {
      setActionBusy(false);
    }
  };

  const onUndo = async () => {
    if (!confirm("Keep your Pro subscription and remove the scheduled cancellation?")) return;
    setActionBusy(true);
    try {
      const res = await fetch(`${API_BASE}/subscriptions/cancel`, {
        method: "DELETE",
        headers: authJsonHeaders(token),
      });
      if (res.ok) await load();
    } finally {
      setActionBusy(false);
    }
  };

  const card =
    "rounded-[12px] border border-[var(--border)] bg-[var(--bg-card)] p-6";

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-3xl px-5 py-10">
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      </div>
    );
  }

  const active = status?.subscription_status === "active";
  const tier = (status?.subscription_tier ?? "free").toLowerCase();
  const periodEnd = status?.subscription_period_end ?? null;
  const cancelScheduled = status?.cancel_at_period_end ?? false;

  const proLabel =
    tier === "annual" ? "Pro · Annual" : tier === "monthly" ? "Pro · Monthly" : "Pro";

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-10 space-y-6">
      <h1 className="text-xl font-semibold text-[var(--text)]">Subscription</h1>

      <section className={card}>
        <h2 className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
          Current plan
        </h2>
        {active ? (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-lg font-semibold text-[var(--text)]">{proLabel}</span>
              <span className="rounded-full bg-metatron-accent/15 px-2.5 py-0.5 text-[10px] font-semibold text-metatron-accent">
                active
              </span>
            </div>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              Active until: {formatDate(periodEnd)}
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              {!cancelScheduled ? (
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={onCancel}
                  className="rounded-[12px] border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--text)] transition-colors hover:border-metatron-accent/30 disabled:opacity-60"
                >
                  Cancel at end of term
                </button>
              ) : (
                <>
                  <p className="text-sm text-[var(--text-muted)]">
                    Cancellation scheduled — access ends {formatDate(periodEnd)}
                  </p>
                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={onUndo}
                    className="rounded-[12px] bg-metatron-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-metatron-accent-hover disabled:opacity-60"
                  >
                    Undo cancellation
                  </button>
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="mt-3 text-lg font-semibold text-[var(--text)]">Free plan</p>
            <Link
              href={pricingPath}
              className="mt-4 inline-flex rounded-[12px] bg-metatron-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-metatron-accent-hover"
            >
              Upgrade Plan →
            </Link>
          </>
        )}
      </section>

      {active && (
        <section className={card}>
          <h2 className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
            Extend subscription
          </h2>
          <p className="mt-3 text-sm text-[var(--text-muted)]">
            Your current plan runs until {formatDate(periodEnd)}. Any new payment will extend
            from that date.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => router.push(`${pricingPath}?extend=monthly`)}
              className="rounded-[12px] border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--text)] transition-colors hover:border-metatron-accent/30"
            >
              Add 1 month
            </button>
            <button
              type="button"
              onClick={() => router.push(`${pricingPath}?extend=annual`)}
              className="rounded-[12px] border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--text)] transition-colors hover:border-metatron-accent/30"
            >
              Add 12 months
            </button>
          </div>
        </section>
      )}

      <section className={card}>
        <h2 className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
          Payment history
        </h2>
        {invoices.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--text-muted)]">No payments recorded yet.</p>
        ) : (
          <table className="mt-4 w-full text-xs">
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
                  <td className="py-2 capitalize text-[var(--text-muted)]">
                    {inv.payment_method}
                  </td>
                  <td className="py-2 text-[var(--text-muted)]">
                    {formatDate(inv.period_start)} → {formatDate(inv.period_end)}
                  </td>
                  <td className="py-2">
                    <Link
                      href={`${basePath}/invoice/${inv.id}`}
                      className="text-xs text-metatron-accent hover:underline"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
