"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { API_BASE, authJsonHeaders } from "@/lib/api";

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
  planName: string;
  planFeatures: string[];
  proName: string;
  proFeatures: string[];
  zarSubscribeEndpoint: string;
  zarVerifyEndpoint: string;
  zarTier: string;
  basePath: string;
  invoices: InvoiceRow[];
  extraPaidInfo?: React.ReactNode;
  onVerifySuccess: () => void;
  /** Founder subscription status (cancel / period); only used when role is STARTUP and isPaid. */
  startupMeta?: {
    periodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    subscriptionTier: string;
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

function formatBasicDisplay(
  currency: "USD" | "ZAR",
  billing: "monthly" | "annual",
) {
  if (currency === "USD") {
    if (billing === "monthly")
      return { price: "$9.99", unit: "USD / mo" };
    return { price: "$99.99", unit: "USD / yr" };
  }
  if (billing === "monthly") return { price: "R169.99", unit: "ZAR / mo" };
  return { price: "R1,699.99", unit: "ZAR / yr" };
}

function formatProComingSoonDisplay(
  currency: "USD" | "ZAR",
  billing: "monthly" | "annual",
) {
  if (currency === "USD") {
    if (billing === "monthly")
      return { price: "$19.99", unit: "USD / mo" };
    return { price: "$199.99", unit: "USD / yr" };
  }
  if (billing === "monthly") return { price: "R339.99", unit: "ZAR / mo" };
  return { price: "R3,399.99", unit: "ZAR / yr" };
}

function FeatureCheck({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="shrink-0 text-metatron-accent" aria-hidden>
        ✓
      </span>
      <span className="text-xs leading-relaxed text-[var(--text-muted)]">
        {children}
      </span>
    </li>
  );
}

export default function SubscriptionPricingContent(
  props: SubscriptionPricingContentProps,
) {
  const {
    token,
    role,
    isPaid,
    planName,
    planFeatures,
    proName,
    proFeatures,
    zarSubscribeEndpoint,
    zarVerifyEndpoint,
    zarTier,
    basePath,
    invoices,
    extraPaidInfo,
    onVerifySuccess,
    startupMeta,
  } = props;

  const [currency, setCurrency] = useState<"ZAR" | "USD">("ZAR");
  const [billing, setBilling] = useState<"monthly" | "annual">("monthly");
  const [submitting, setSubmitting] = useState<"monthly" | "annual" | null>(
    null,
  );
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !token) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("success") !== "1") return;
    const reference = params.get("reference")?.trim() ?? "";

    let cancelled = false;

    const runPaystackVerify = async (reference: string) => {
      setVerifying(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE}${zarVerifyEndpoint}`, {
          method: "POST",
          headers: authJsonHeaders(token),
          body: JSON.stringify({ reference }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(data.error || "Could not verify payment.");
        }
        if (!cancelled) {
          onVerifySuccess();
          window.history.replaceState({}, "", basePath);
        }
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : "Could not verify payment.",
          );
        }
      } finally {
        if (!cancelled) setVerifying(false);
      }
    };

    if (reference.length > 0) {
      void runPaystackVerify(reference);
    } else {
      setVerifying(true);
      setError(null);
      void (async () => {
        try {
          if (!cancelled) {
            onVerifySuccess();
            window.history.replaceState({}, "", basePath);
          }
        } finally {
          if (!cancelled) setVerifying(false);
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [token, zarVerifyEndpoint, basePath, onVerifySuccess]);

  const handleZarSubscribe = useCallback(
    async (bill: "monthly" | "annual") => {
      setSubmitting(bill);
      setError(null);
      try {
        const body =
          zarTier === "founder_basic"
            ? { tier: zarTier, billing: bill, currency: "ZAR" }
            : { billing: bill };
        const res = await fetch(`${API_BASE}${zarSubscribeEndpoint}`, {
          method: "POST",
          headers: authJsonHeaders(token),
          body: JSON.stringify(body),
        });
        const data = (await res.json().catch(() => ({}))) as {
          hosted_url?: string;
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || "Could not start checkout.");
        if (!data.hosted_url) throw new Error("Missing checkout URL.");
        window.location.href = data.hosted_url;
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Could not start checkout.",
        );
      } finally {
        setSubmitting(null);
      }
    },
    [token, zarSubscribeEndpoint, zarTier],
  );

  const handleNowpaymentsSubscribe = useCallback(
    async (bill: "monthly" | "annual") => {
      setSubmitting(bill);
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/commerce/nowpayments/subscribe`, {
          method: "POST",
          headers: authJsonHeaders(token),
          body: JSON.stringify({
            billing: bill,
            role: zarTier.replace(/_basic$/, ""),
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          invoice_url?: string;
          error?: string;
        };
        if (!res.ok) {
          throw new Error(data.error || "Could not start crypto checkout.");
        }
        if (data.invoice_url) {
          window.location.href = data.invoice_url;
        } else {
          throw new Error("Missing checkout URL.");
        }
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Could not start crypto checkout.",
        );
      } finally {
        setSubmitting(null);
      }
    },
    [token, zarTier],
  );

  const onCancel = async () => {
    if (
      !confirm(
        "Cancel your Pro subscription at the end of this billing period?",
      )
    )
      return;
    setActionBusy(true);
    try {
      const res = await fetch(`${API_BASE}/subscriptions/cancel`, {
        method: "POST",
        headers: authJsonHeaders(token),
      });
      if (res.ok) onVerifySuccess();
    } finally {
      setActionBusy(false);
    }
  };

  const onUndo = async () => {
    if (
      !confirm(
        "Keep your Pro subscription and remove the scheduled cancellation?",
      )
    )
      return;
    setActionBusy(true);
    try {
      const res = await fetch(`${API_BASE}/subscriptions/cancel`, {
        method: "DELETE",
        headers: authJsonHeaders(token),
      });
      if (res.ok) onVerifySuccess();
    } finally {
      setActionBusy(false);
    }
  };

  const card =
    "rounded-[12px] border border-[var(--border)] bg-[var(--bg-card)] p-6";
  const cardBase =
    "flex flex-col rounded-[12px] border bg-[var(--bg-card)] p-6 text-left";

  const proComingSoonDisplay = formatProComingSoonDisplay(currency, billing);

  const startupTier = (startupMeta?.subscriptionTier ?? "free").toLowerCase();

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-10 space-y-6">
      <h1 className="text-xl font-semibold text-[var(--text)]">
        Subscription
      </h1>

      {verifying && (
        <div className="rounded-[12px] border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 text-sm text-[var(--text-muted)]">
          Verifying payment…
        </div>
      )}
      {error && (
        <div className="rounded-[12px] border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="flex flex-wrap justify-center gap-2">
        {(["ZAR", "USD"] as const).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCurrency(c)}
            className={`rounded-lg border px-4 py-1.5 text-sm font-semibold transition-colors ${
              currency === c
                ? "border-metatron-accent bg-metatron-accent/10 text-metatron-accent"
                : "border-[var(--border)] text-[var(--text-muted)] hover:border-metatron-accent/30"
            }`}
          >
            {c === "USD" ? "USD ($)" : "ZAR (R)"}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        {(["monthly", "annual"] as const).map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => setBilling(b)}
            className={`rounded-lg border px-4 py-1.5 text-sm font-semibold transition-colors ${
              billing === b
                ? "border-metatron-accent bg-metatron-accent/10 text-metatron-accent"
                : "border-[var(--border)] text-[var(--text-muted)] hover:border-metatron-accent/30"
            }`}
          >
            {b === "monthly" ? "Monthly" : "Annual · save 17%"}
          </button>
        ))}
      </div>

      {currency === "USD" && (
        <p className="text-center text-sm text-[var(--text-muted)]">
          USD checkout uses NowPayments (crypto). You can change the asset on
          the NowPayments payment page.
        </p>
      )}

      <section className={card}>
        <h2 className="font-sans text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
          Current plan
        </h2>
        {isPaid ? (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-lg font-semibold text-[var(--text)]">
                {planName}
                {role === "STARTUP" &&
                  startupMeta &&
                  (startupTier === "monthly" || startupTier === "annual") && (
                    <span className="text-[var(--text-muted)]">
                      {" "}
                      · {startupTier === "annual" ? "Annual" : "Monthly"}
                    </span>
                  )}
              </span>
              <span className="rounded-full bg-metatron-accent/15 px-2.5 py-0.5 text-[10px] font-semibold text-metatron-accent">
                active
              </span>
            </div>
            {extraPaidInfo && <div className="mt-2">{extraPaidInfo}</div>}
            {role === "STARTUP" && startupMeta && (
              <p className="mt-2 text-sm text-[var(--text-muted)]">
                Active until: {formatDate(startupMeta.periodEnd)}
              </p>
            )}
            {role === "STARTUP" && startupMeta && (
              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                {!startupMeta.cancelAtPeriodEnd ? (
                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={() => void onCancel()}
                    className="rounded-[12px] border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--text)] transition-colors hover:border-metatron-accent/30 disabled:opacity-60"
                  >
                    Cancel at end of term
                  </button>
                ) : (
                  <>
                    <p className="text-sm text-[var(--text-muted)]">
                      Cancellation scheduled — access ends{" "}
                      {formatDate(startupMeta.periodEnd)}
                    </p>
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => void onUndo()}
                      className="rounded-[12px] bg-metatron-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-metatron-accent-hover disabled:opacity-60"
                    >
                      Undo cancellation
                    </button>
                  </>
                )}
              </div>
            )}
            {(role === "INVESTOR" || role === "INTERMEDIARY") && (
              <p className="mt-4 text-xs text-[var(--text-muted)]">
                To manage or cancel, contact support.
              </p>
            )}
          </>
        ) : (
          <p className="mt-3 text-lg font-semibold text-[var(--text)]">
            Free plan
          </p>
        )}
      </section>

      {!isPaid && (
        <div className="space-y-6">
          <h2 className="font-sans text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
            Upgrade
          </h2>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {(["monthly", "annual"] as const).map((bill) => {
              const display = formatBasicDisplay(currency, bill);
              return (
                <section
                  key={bill}
                  className={`${cardBase} border-metatron-accent/40 shadow-[0_0_40px_rgba(108,92,231,0.12)]`}
                >
                  <p className="font-sans text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                    {planName} · {bill === "monthly" ? "Monthly" : "Annual"}
                  </p>
                  <p className="mt-1 text-sm text-[var(--text-muted)]">
                    {bill === "monthly"
                      ? "Billed monthly"
                      : "Billed annually · save vs monthly"}
                  </p>
                  <p className="mt-4 text-4xl font-bold tracking-tight text-[var(--text)]">
                    {display.price}{" "}
                    <span className="text-lg font-semibold text-[var(--text-muted)]">
                      {display.unit}
                    </span>
                  </p>
                  {currency === "USD" && (
                    <button
                      type="button"
                      onClick={() => void handleNowpaymentsSubscribe(bill)}
                      disabled={submitting !== null}
                      className="mt-6 inline-flex w-full items-center justify-center rounded-[12px] bg-metatron-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-metatron-accent-hover disabled:opacity-60"
                    >
                      {submitting === bill
                        ? "Redirecting…"
                        : "Pay with crypto"}
                    </button>
                  )}
                  {currency === "ZAR" && (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleZarSubscribe(bill)}
                        disabled={submitting !== null}
                        className="mt-6 inline-flex w-full items-center justify-center rounded-[12px] border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] transition-colors hover:border-metatron-accent/30 disabled:opacity-60"
                      >
                        {submitting === bill
                          ? "Redirecting…"
                          : "Pay with card"}
                      </button>
                      <p className="mt-1.5 text-center text-[10px] text-[var(--text-muted)]">
                        Visa & Mastercard · Powered by Paystack
                      </p>
                    </>
                  )}
                  <div className="my-6 border-t border-[var(--border)]" />
                  <ul className="flex flex-col gap-3">
                    {planFeatures.map((f) => (
                      <FeatureCheck key={f}>{f}</FeatureCheck>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>

          <section
            className={`${cardBase} border-[var(--border)] opacity-50 cursor-not-allowed`}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="font-sans text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                {proName}
              </p>
              <span className="rounded-full bg-[var(--border)] px-2.5 py-1 text-[10px] font-semibold text-[var(--text-muted)]">
                Coming Soon
              </span>
            </div>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              {billing === "monthly"
                ? "Billed monthly"
                : "Billed annually · save vs monthly"}
            </p>
            <p className="mt-4 text-4xl font-bold tracking-tight text-[var(--text)]">
              {proComingSoonDisplay.price}{" "}
              <span className="text-lg font-semibold text-[var(--text-muted)]">
                {proComingSoonDisplay.unit}
              </span>
            </p>
            <div className="my-6 border-t border-[var(--border)]" />
            <ul className="flex flex-col gap-3">
              {proFeatures.map((f) => (
                <FeatureCheck key={f}>{f}</FeatureCheck>
              ))}
            </ul>
          </section>
        </div>
      )}

      <section className={card}>
        <h2 className="font-sans text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
          Payment history
        </h2>
        {invoices.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--text-muted)]">
            No payments recorded yet.
          </p>
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
                  <td className="py-2 text-[var(--text-muted)]">
                    {formatDate(inv.created_at)}
                  </td>
                  <td className="py-2">
                    {inv.currency} {inv.amount.toFixed(2)}
                  </td>
                  <td className="py-2 capitalize text-[var(--text-muted)]">
                    {inv.payment_method}
                  </td>
                  <td className="py-2 text-[var(--text-muted)]">
                    {formatDate(inv.period_start)} →{" "}
                    {formatDate(inv.period_end)}
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
