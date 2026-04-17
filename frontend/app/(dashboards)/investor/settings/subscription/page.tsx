"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { API_BASE, authJsonHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type InvestorProfile = {
  investor_tier?: string | null;
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
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export default function InvestorSubscriptionPage() {
  const { token, loading } = useAuth("INVESTOR");
  const searchParams = useSearchParams();
  const [profile, setProfile] = useState<InvestorProfile | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [submitting, setSubmitting] = useState<"monthly" | "annual" | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!token) return;
    try {
      const [pRes, iRes] = await Promise.all([
        fetch(`${API_BASE}/investor-profile`, { headers: authJsonHeaders(token) }),
        fetch(`${API_BASE}/subscriptions/invoices`, { headers: authJsonHeaders(token) }),
      ]);
      if (pRes.ok) setProfile((await pRes.json()) as InvestorProfile);
      if (iRes.ok) setInvoices((await iRes.json()) as InvoiceRow[]);
    } finally {
      setDataLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!token) return;
    if (searchParams.get("success") !== "1") return;
    const reference = searchParams.get("reference");
    if (!reference) return;
    let cancelled = false;
    const run = async () => {
      setVerifying(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/commerce/investor/verify`, {
          method: "POST",
          headers: authJsonHeaders(token),
          body: JSON.stringify({ reference }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || "Could not verify payment.");
        }
        if (!cancelled) {
          await loadData();
          window.history.replaceState({}, "", "/investor/settings/subscription");
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not verify payment.");
      } finally {
        if (!cancelled) setVerifying(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [searchParams, token, loadData]);

  const onSubscribe = useCallback(
    async (billing: "monthly" | "annual") => {
      if (!token) return;
      setSubmitting(billing);
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/commerce/investor/subscribe`, {
          method: "POST",
          headers: authJsonHeaders(token),
          body: JSON.stringify({ billing }),
        });
        const data = (await res.json().catch(() => ({}))) as { hosted_url?: string; error?: string };
        if (!res.ok) throw new Error(data.error || "Could not start checkout.");
        if (!data.hosted_url) throw new Error("Missing checkout URL.");
        window.location.href = data.hosted_url;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not start checkout.");
      } finally {
        setSubmitting(null);
      }
    },
    [token],
  );

  if (loading || dataLoading) {
    return (
      <div className="flex min-h-[calc(100vh-72px)] items-center justify-center">
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      </div>
    );
  }
  if (!token) return null;

  const isPaid = profile?.investor_tier === "basic";
  const card = "rounded-[12px] border border-[var(--border)] bg-[var(--bg-card)] p-6";

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-10 space-y-6">
      <h1 className="text-xl font-semibold text-[var(--text)]">Investor Basic</h1>

      {verifying && (
        <div className="rounded-[12px] border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 text-sm text-[var(--text-muted)]">
          Verifying payment...
        </div>
      )}
      {error && (
        <div className="rounded-[12px] border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <section className={card}>
        <h2 className="font-sans text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
          Current plan
        </h2>
        {isPaid ? (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-lg font-semibold text-[var(--text)]">Investor Basic</span>
              <span className="rounded-full bg-metatron-accent/15 px-2.5 py-0.5 text-[10px] font-semibold text-metatron-accent">
                active
              </span>
            </div>
            <p className="mt-4 text-xs text-[var(--text-muted)]">
              To manage or cancel your subscription, use your payment provider billing settings or contact support.
            </p>
          </>
        ) : (
          <>
            <p className="mt-3 text-lg font-semibold text-[var(--text)]">Free plan</p>
            {!showUpgrade ? (
              <button
                type="button"
                onClick={() => setShowUpgrade(true)}
                className="mt-4 inline-flex rounded-[12px] bg-metatron-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-metatron-accent-hover"
              >
                Upgrade to Investor Basic →
              </button>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-[12px] border border-[var(--border)] p-4">
                  <p className="text-sm font-semibold text-[var(--text)]">Monthly</p>
                  <p className="mt-1 text-xl font-semibold text-[var(--text)]">
                    R169.99<span className="text-sm font-normal text-[var(--text-muted)]">/month</span>
                  </p>
                  <ul className="mt-3 space-y-1 text-xs text-[var(--text-muted)]">
                    <li>Full deal-flow visibility</li>
                    <li>Pipeline stage controls</li>
                    <li>Investment memo generation</li>
                  </ul>
                  <button
                    type="button"
                    onClick={() => void onSubscribe("monthly")}
                    disabled={submitting !== null}
                    className="mt-4 w-full rounded-[12px] bg-metatron-accent px-4 py-2 text-sm font-medium text-white hover:bg-metatron-accent-hover disabled:opacity-60"
                  >
                    {submitting === "monthly" ? "Redirecting..." : "Subscribe monthly"}
                  </button>
                </div>
                <div className="rounded-[12px] border border-metatron-accent/30 p-4">
                  <p className="text-sm font-semibold text-[var(--text)]">Annual</p>
                  <p className="mt-1 text-xl font-semibold text-[var(--text)]">
                    R1,699.99<span className="text-sm font-normal text-[var(--text-muted)]">/year</span>
                  </p>
                  <ul className="mt-3 space-y-1 text-xs text-[var(--text-muted)]">
                    <li>Full deal-flow visibility</li>
                    <li>Pipeline stage controls</li>
                    <li>Investment memo generation</li>
                  </ul>
                  <button
                    type="button"
                    onClick={() => void onSubscribe("annual")}
                    disabled={submitting !== null}
                    className="mt-4 w-full rounded-[12px] bg-metatron-accent px-4 py-2 text-sm font-medium text-white hover:bg-metatron-accent-hover disabled:opacity-60"
                  >
                    {submitting === "annual" ? "Redirecting..." : "Subscribe annually"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      <section className={card}>
        <h2 className="font-sans text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
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
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
