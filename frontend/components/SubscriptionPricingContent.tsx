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
  /** Current plan level — "free" | "basic" | "pro". Defaults to "free". */
  planLevel?: "free" | "basic" | "pro";
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

function formatProDisplay(
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

function PlanCard({
  label,
  billingLabel,
  price,
  unit,
  features,
  currency,
  submitting,
  onSubscribeUsd,
  onSubscribeZar,
}: {
  label: string;
  billingLabel: string;
  price: string;
  unit: string;
  features: string[];
  currency: "ZAR" | "USD";
  submitting: boolean;
  onSubscribeUsd: () => void;
  onSubscribeZar: () => void;
}) {
  return (
    <section className="flex flex-col rounded-[12px] border border-metatron-accent/40 bg-[var(--bg-card)] p-6 text-left shadow-[0_0_40px_rgba(108,92,231,0.12)]">
      <p className="font-sans text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
        {label}
      </p>
      <p className="mt-1 text-sm text-[var(--text-muted)]">{billingLabel}</p>
      <p className="mt-4 text-4xl font-bold tracking-tight text-[var(--text)]">
        {price}{" "}
        <span className="text-lg font-semibold text-[var(--text-muted)]">
          {unit}
        </span>
      </p>
      {currency === "USD" ? (
        <>
          <button
            type="button"
            onClick={onSubscribeUsd}
            disabled={submitting}
            className="mt-6 inline-flex w-full items-center justify-center rounded-[12px] bg-metatron-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-metatron-accent-hover disabled:opacity-60"
          >
            {submitting ? "Redirecting…" : "Pay with card"}
          </button>
          <p className="mt-1.5 text-center text-[10px] text-[var(--text-muted)]">
            Visa & Mastercard · Powered by NowPayments
          </p>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={onSubscribeZar}
            disabled={submitting}
            className="mt-6 inline-flex w-full items-center justify-center rounded-[12px] border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] transition-colors hover:border-metatron-accent/30 disabled:opacity-60"
          >
            {submitting ? "Redirecting…" : "Pay with card"}
          </button>
          <p className="mt-1.5 text-center text-[10px] text-[var(--text-muted)]">
            Visa & Mastercard · Powered by Paystack
          </p>
        </>
      )}
      <div className="my-6 border-t border-[var(--border)]" />
      <ul className="flex flex-col gap-3">
        {features.map((f) => (
          <FeatureCheck key={f}>{f}</FeatureCheck>
        ))}
      </ul>
    </section>
  );
}

export default function SubscriptionPricingContent(
  props: SubscriptionPricingContentProps,
) {
  const {
    token,
    role,
    isPaid,
    planLevel = "free",
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
    subMeta,
  } = props;

  const [currency, setCurrency] = useState<"ZAR" | "USD">("ZAR");
  const [submitting, setSubmitting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [showDowngradeChoice, setShowDowngradeChoice] = useState(false);

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
      setSubmitting(true);
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
        setSubmitting(false);
      }
    },
    [token, zarSubscribeEndpoint, zarTier],
  );

  const handleZarProSubscribe = useCallback(
    async (bill: "monthly" | "annual") => {
      setSubmitting(true);
      setError(null);
      try {
        const proTier = role === "INVESTOR" ? "pro" : "founder_pro";
        const res = await fetch(`${API_BASE}${zarSubscribeEndpoint}`, {
          method: "POST",
          headers: authJsonHeaders(token),
          body: JSON.stringify({ tier: proTier, billing: bill, currency: "ZAR" }),
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
        setSubmitting(false);
      }
    },
    [token, zarSubscribeEndpoint, role],
  );

  const handleNowpaymentsSubscribe = useCallback(
    async (bill: "monthly" | "annual") => {
      setSubmitting(true);
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
          throw new Error(data.error || "Could not start checkout.");
        }
        if (data.invoice_url) {
          window.location.href = data.invoice_url;
        } else {
          throw new Error("Missing checkout URL.");
        }
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Could not start checkout.",
        );
      } finally {
        setSubmitting(false);
      }
    },
    [token, zarTier],
  );

  const handleNowpaymentsProSubscribe = useCallback(
    async (bill: "monthly" | "annual") => {
      setSubmitting(true);
      setError(null);
      try {
        const nowpaymentsRole = role === "INVESTOR" ? "investor" : "founder";
        const res = await fetch(`${API_BASE}/commerce/nowpayments/subscribe`, {
          method: "POST",
          headers: authJsonHeaders(token),
          body: JSON.stringify({ billing: bill, role: nowpaymentsRole, plan: "pro" }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          invoice_url?: string;
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || "Could not start checkout.");
        if (data.invoice_url) {
          window.location.href = data.invoice_url;
        } else {
          throw new Error("Missing checkout URL.");
        }
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Could not start checkout.",
        );
      } finally {
        setSubmitting(false);
      }
    },
    [token, role],
  );

  const onCancel = async () => {
    if (
      !confirm(
        "Cancel your subscription at the end of this billing period?",
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
        "Keep your subscription and remove the scheduled cancellation?",
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

  const onDowngrade = async () => {
    if (
      !confirm(
        "Move to Basic at the end of this billing period? You'll keep full Pro access until then.",
      )
    )
      return;
    setActionBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/subscriptions/downgrade`, {
        method: "POST",
        headers: authJsonHeaders(token),
      });
      if (res.ok) {
        setShowDowngradeChoice(false);
        onVerifySuccess();
      } else {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error || "Could not schedule downgrade.");
      }
    } finally {
      setActionBusy(false);
    }
  };

  const onUndoDowngrade = async () => {
    if (!confirm("Stay on Pro and remove the scheduled downgrade to Basic?"))
      return;
    setActionBusy(true);
    try {
      const res = await fetch(`${API_BASE}/subscriptions/downgrade`, {
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

  const basicMonthly = formatBasicDisplay(currency, "monthly");
  const basicAnnual = formatBasicDisplay(currency, "annual");
  const proMonthly = formatProDisplay(currency, "monthly");
  const proAnnual = formatProDisplay(currency, "annual");

  const billingPeriod = (subMeta?.subscriptionTier ?? "free").toLowerCase();

  // Connector has no real Pro tier on the backend (always basic when paid) --
  // only founder and investor can see the Pro upgrade card.
  const roleHasProTier = role === "STARTUP" || role === "INVESTOR";

  // Show the upgrade section for: free users, or basic subscribers (founder/investor) who can upgrade to Pro
  const showUpgradeSection = !isPaid || (roleHasProTier && planLevel === "basic");
  const showBasicCard = !isPaid; // only for free users, not basic→pro upgraders
  const showProCard = roleHasProTier && planLevel !== "pro";

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-10 space-y-6">
      <h1 className="text-xl font-semibold text-[var(--text)]">
        Subscription & Billing
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

      <section className={card}>
        <h2 className="font-sans text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
          Current plan
        </h2>
        {isPaid ? (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-lg font-semibold text-[var(--text)]">
                {planName}
                {subMeta &&
                  (billingPeriod === "monthly" || billingPeriod === "annual") && (
                    <span className="text-[var(--text-muted)]">
                      {" "}
                      · {billingPeriod === "annual" ? "Annual" : "Monthly"}
                    </span>
                  )}
              </span>
              <span className="rounded-full bg-metatron-accent/15 px-2.5 py-0.5 text-[10px] font-semibold text-metatron-accent">
                active
              </span>
            </div>
            {extraPaidInfo && <div className="mt-2">{extraPaidInfo}</div>}
            {subMeta && (
              <p className="mt-2 text-sm text-[var(--text-muted)]">
                Active until: {formatDate(subMeta.periodEnd)}
              </p>
            )}
            {subMeta && (
              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                {subMeta.pendingDowngradeTo === "basic" ? (
                  <>
                    <p className="text-sm text-[var(--text-muted)]">
                      Downgrade scheduled — moves to Basic on{" "}
                      {formatDate(subMeta.periodEnd)}
                    </p>
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => void onUndoDowngrade()}
                      className="rounded-[12px] bg-metatron-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-metatron-accent-hover disabled:opacity-60"
                    >
                      Stay on Pro
                    </button>
                  </>
                ) : subMeta.cancelAtPeriodEnd ? (
                  <>
                    <p className="text-sm text-[var(--text-muted)]">
                      Cancellation scheduled — access ends{" "}
                      {formatDate(subMeta.periodEnd)}
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
                ) : planLevel === "pro" && !showDowngradeChoice ? (
                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={() => setShowDowngradeChoice(true)}
                    className="rounded-[12px] border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--text)] transition-colors hover:border-metatron-accent/30 disabled:opacity-60"
                  >
                    Cancel or downgrade
                  </button>
                ) : planLevel === "pro" && showDowngradeChoice ? (
                  <>
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => void onDowngrade()}
                      className="rounded-[12px] bg-metatron-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-metatron-accent-hover disabled:opacity-60"
                    >
                      Downgrade to Basic
                    </button>
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => void onCancel()}
                      className="rounded-[12px] border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--text)] transition-colors hover:border-metatron-accent/30 disabled:opacity-60"
                    >
                      Cancel completely
                    </button>
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => setShowDowngradeChoice(false)}
                      className="text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
                    >
                      Never mind
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={() => void onCancel()}
                    className="rounded-[12px] border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--text)] transition-colors hover:border-metatron-accent/30 disabled:opacity-60"
                  >
                    Cancel at end of term
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <p className="mt-3 text-lg font-semibold text-[var(--text)]">
            Free plan
          </p>
        )}
      </section>

      {showUpgradeSection && (
        <div className="space-y-6">
          <h2 className="font-sans text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
            {planLevel === "basic" ? "Upgrade to Pro" : "Upgrade"}
          </h2>

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

          <div
            className={`grid grid-cols-1 gap-6 sm:grid-cols-2 ${
              showBasicCard && showProCard ? "lg:grid-cols-4" : ""
            }`}
          >
            {showBasicCard && (
              <>
                <PlanCard
                  label={planName}
                  billingLabel="Billed monthly"
                  price={basicMonthly.price}
                  unit={basicMonthly.unit}
                  features={planFeatures}
                  currency={currency}
                  submitting={submitting}
                  onSubscribeUsd={() => void handleNowpaymentsSubscribe("monthly")}
                  onSubscribeZar={() => void handleZarSubscribe("monthly")}
                />
                <PlanCard
                  label={planName}
                  billingLabel="Billed annually · save 17%"
                  price={basicAnnual.price}
                  unit={basicAnnual.unit}
                  features={planFeatures}
                  currency={currency}
                  submitting={submitting}
                  onSubscribeUsd={() => void handleNowpaymentsSubscribe("annual")}
                  onSubscribeZar={() => void handleZarSubscribe("annual")}
                />
              </>
            )}

            {showProCard && (
              <>
                <PlanCard
                  label={`${proName} Monthly`}
                  billingLabel="Billed monthly"
                  price={proMonthly.price}
                  unit={proMonthly.unit}
                  features={proFeatures}
                  currency={currency}
                  submitting={submitting}
                  onSubscribeUsd={() => void handleNowpaymentsProSubscribe("monthly")}
                  onSubscribeZar={() => void handleZarProSubscribe("monthly")}
                />
                <PlanCard
                  label={`${proName} Annual`}
                  billingLabel="Billed annually · save 17%"
                  price={proAnnual.price}
                  unit={proAnnual.unit}
                  features={proFeatures}
                  currency={currency}
                  submitting={submitting}
                  onSubscribeUsd={() => void handleNowpaymentsProSubscribe("annual")}
                  onSubscribeZar={() => void handleZarProSubscribe("annual")}
                />
              </>
            )}
          </div>
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
