"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { API_BASE, authJsonHeaders } from "@/lib/api";
import {
  checkoutFootnote,
  paymentOptions,
  planPrice,
  useRegionalCurrency,
  type Billing,
  type Currency,
  type PaymentOption,
} from "@/lib/pricing";
import { usePaymentsEnabled } from "@/lib/payments";

const CURRENCY_LABELS: Record<Currency, string> = {
  ZAR: "ZAR (R)",
  USD: "USD ($)",
  EUR: "EUR (€)",
};

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
    <div className="mt-4 flex flex-wrap gap-3">
      {plans.map((plan) => {
        const label = plan === "basic" ? "Basic" : "Pro";
        return joined.includes(plan) ? (
          <span key={plan} className="rounded-[12px] border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-muted)]">
            ✓ We&apos;ll tell you when {label} launches
          </span>
        ) : (
          <button
            key={plan}
            type="button"
            disabled={busy}
            onClick={() => void join(plan)}
            className="rounded-[12px] bg-metatron-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-metatron-accent-hover disabled:opacity-60"
          >
            Notify me when {label} launches
          </button>
        );
      })}
    </div>
  );
}

function PlanCard({
  label,
  billingLabel,
  price,
  unit,
  features,
  options,
  submitting,
  onSubscribe,
  actionLabel,
  actionNote,
  featured = false,
  status = "available",
}: {
  label: string;
  billingLabel: string;
  price: string;
  unit: string;
  features: string[];
  options: PaymentOption[];
  submitting: boolean;
  onSubscribe: () => void;
  /** Overrides the button text and note, e.g. "Upgrade to Pro" for Basic subscribers. */
  actionLabel?: string;
  actionNote?: string;
  /** Highlighted border and "Most popular" badge, as on /pricing. */
  featured?: boolean;
  /** "current" and "coming-soon" cards show a badge instead of pay buttons. */
  status?: "available" | "current" | "coming-soon";
}) {
  const badge =
    status === "current" ? (
      <span className="rounded-full bg-[var(--good-bg)] px-2.5 py-1 text-[10px] font-semibold text-[var(--good)]">
        Current plan
      </span>
    ) : status === "coming-soon" ? (
      <span className="rounded-full bg-[var(--border)] px-2.5 py-1 text-[10px] font-semibold text-[var(--text-muted)]">
        Coming Soon
      </span>
    ) : featured ? (
      <span className="rounded-full bg-metatron-accent/15 px-2.5 py-1 text-[10px] font-semibold text-metatron-accent">
        Most popular
      </span>
    ) : null;

  return (
    <section
      className={`flex flex-col rounded-[12px] border bg-[var(--bg-card)] p-6 text-left ${
        featured
          ? "border-metatron-accent/40 shadow-[0_0_40px_rgba(var(--accent-rgb),0.12)]"
          : "border-[var(--border)]"
      } ${status === "coming-soon" ? "cursor-not-allowed opacity-50" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-sans text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
          {label}
        </p>
        {badge}
      </div>
      <p className="mt-1 text-sm text-[var(--text-muted)]">{billingLabel}</p>
      <p className="mt-4 text-4xl font-bold tracking-tight text-[var(--text)]">
        {price}{" "}
        <span className="text-lg font-semibold text-[var(--text-muted)]">
          {unit}
        </span>
      </p>
      <div className="mt-6 flex flex-col gap-3">
        {status === "available" && options.map((opt, i) => (
          <div key={opt.method}>
            <button
              type="button"
              onClick={onSubscribe}
              disabled={submitting}
              className={`inline-flex w-full items-center justify-center rounded-[12px] px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-60 ${
                i === 0
                  ? "bg-metatron-accent text-white hover:bg-metatron-accent-hover"
                  : "border border-[var(--border)] text-[var(--text)] hover:border-metatron-accent/30"
              }`}
            >
              {submitting ? "Redirecting…" : actionLabel ?? opt.label}
            </button>
            <p className="mt-1.5 text-center text-[10px] text-[var(--text-muted)]">
              {actionNote ?? opt.note}
            </p>
          </div>
        ))}
      </div>
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
    basePath,
    invoices,
    extraPaidInfo,
    onVerifySuccess,
    subMeta,
  } = props;

  const { currency, currencies, setCurrency } = useRegionalCurrency();
  const paymentsEnabled = usePaymentsEnabled();
  const [billing, setBilling] = useState<Billing>("monthly");
  const [submitting, setSubmitting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !token) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("success") !== "1") return;

    // Back from Stripe Checkout: the webhook activates the plan within a few
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

  // New subscriptions go through Stripe Checkout; Stripe redirects back here.
  const handleStripeSubscribe = useCallback(
    async (plan: "basic" | "pro") => {
      if (!currency) return;
      setSubmitting(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/commerce/stripe/checkout`, {
          method: "POST",
          headers: authJsonHeaders(token),
          body: JSON.stringify({ plan, billing, currency }),
        });
        const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
        if (!res.ok || !data.url) throw new Error(data.error || "Could not start checkout.");
        window.location.href = data.url;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not start checkout.");
        setSubmitting(false);
      }
    },
    [token, billing, currency],
  );

  // Plan changes, card updates, invoices and cancellation live in Stripe's portal.
  const openPortal = async (change?: { plan: "basic" | "pro"; billing: Billing }) => {
    setActionBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/commerce/stripe/portal`, {
        method: "POST",
        headers: authJsonHeaders(token),
        body: JSON.stringify(change ?? {}),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error || "Could not open billing.");
      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open billing.");
      setActionBusy(false);
    }
  };

  const card =
    "rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-6 shadow-[var(--card-shadow)]";

  // Price and payment options for one plan card; only called once the
  // visitor's currency is known.
  const offer = (plan: "basic" | "pro", bill: Billing, cur: Currency) => ({
    ...planPrice(plan, bill, cur),
    options: paymentOptions(plan, bill, cur),
  });

  const billingPeriod = (subMeta?.subscriptionTier ?? "free").toLowerCase();

  // Connector has no real Pro tier on the backend (always basic when paid) --
  // only founder and investor can see the Pro upgrade card.
  const roleHasProTier = role === "STARTUP" || role === "INVESTOR";

  // Show the plans for: free users, or basic subscribers (founder/investor) who can upgrade to Pro
  const showUpgradeSection = !isPaid || (roleHasProTier && planLevel === "basic");
  const billingLabel =
    billing === "monthly" ? "Billed monthly" : "Billed annually · save vs monthly";

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6 md:p-10">
      <header className="flex flex-col gap-1.5">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">Subscription</span>
        <h1 className="text-[28px] font-semibold tracking-tight text-[var(--text)]">{isPaid ? planName : "Free plan"}</h1>
        <p className="text-sm text-[var(--text-muted)]">Your plan, upgrades and payment history.</p>
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
              <span className="rounded-full bg-[var(--good-bg)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--good)]">
                Active
              </span>
            </div>
            {extraPaidInfo && <div className="mt-2">{extraPaidInfo}</div>}
            {subMeta && (
              <p className="mt-2 text-sm text-[var(--text-muted)]">
                Active until: {formatDate(subMeta.periodEnd)}
              </p>
            )}
            {subMeta?.cancelAtPeriodEnd && (
              <p className="mt-2 text-sm text-[var(--text-muted)]">
                Cancellation scheduled — access ends {formatDate(subMeta.periodEnd)}
              </p>
            )}
            <div className="mt-4">
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => void openPortal()}
                className="rounded-[12px] border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--text)] transition-colors hover:border-metatron-accent/30 disabled:opacity-60"
              >
                {actionBusy ? "Opening…" : "Manage billing"}
              </button>
              <p className="mt-1.5 text-xs text-[var(--text-muted)]">
                Change plan, update your card, download invoices or cancel.
              </p>
            </div>
          </>
        ) : (
          <p className="mt-3 text-lg font-semibold text-[var(--text)]">
            Free plan
          </p>
        )}
      </section>

      {showUpgradeSection && !paymentsEnabled && (
        <section className={card}>
          <h2 className="font-sans text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
            Basic and Pro
          </h2>
          <p className="mt-3 text-lg font-semibold text-[var(--text)]">Coming soon</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Paid plans aren&apos;t available yet. On Free you get 20 Kevin messages a day and 1 match a week.
          </p>
          <NotifyMeButtons
            token={token}
            plans={planLevel === "basic" ? ["pro"] : roleHasProTier ? ["basic", "pro"] : ["basic"]}
          />
        </section>
      )}

      {showUpgradeSection && paymentsEnabled && currency && (
        <div className="space-y-6">
          <h2 className="font-sans text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
            {planLevel === "basic" ? "Upgrade to Pro" : "Upgrade"}
          </h2>

          <div>
            <div className="mb-4 flex justify-center gap-2">
              {currencies.map((c) => (
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
                  {CURRENCY_LABELS[c]}
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
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <PlanCard
              label={planName}
              billingLabel={billingLabel}
              {...offer("basic", billing, currency)}
              features={planFeatures}
              submitting={submitting}
              featured
              status={planLevel === "basic" ? "current" : "available"}
              onSubscribe={() => void handleStripeSubscribe("basic")}
            />
            <PlanCard
              label={proName}
              billingLabel={billingLabel}
              {...offer("pro", billing, currency)}
              features={proFeatures}
              submitting={submitting}
              status={roleHasProTier ? "available" : "coming-soon"}
              onSubscribe={() =>
                planLevel === "basic"
                  ? void openPortal({ plan: "pro", billing })
                  : void handleStripeSubscribe("pro")
              }
              actionLabel={planLevel === "basic" ? "Upgrade to Pro" : undefined}
              actionNote={
                planLevel === "basic"
                  ? "Confirm in Stripe · you pay only the difference for this period"
                  : undefined
              }
            />
          </div>

          <p className="text-center text-sm text-[var(--text-muted)]">
            {checkoutFootnote(currency)}
          </p>
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
                      className="text-[13px] text-[var(--accent-fg)] hover:underline"
                    >
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
