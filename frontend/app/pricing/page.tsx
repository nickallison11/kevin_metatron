"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { API_BASE, authJsonHeaders } from "@/lib/api";
import {
  checkoutFootnote,
  formatAmount,
  paymentOptions,
  planPrice,
  useRegionalCurrency,
  type Billing,
  type Currency,
  type PaymentOption,
} from "@/lib/pricing";
import { getAccessToken } from "@/lib/tokenStore";

const CURRENCY_LABELS: Record<Currency, string> = {
  ZAR: "ZAR (R)",
  USD: "USD ($)",
  EUR: "EUR (€)",
};

const freeFeatures = [
  "Kevin AI chat (20 msg/day)",
  "Kevin on Telegram & WhatsApp",
  "Founder profile + cloud deck link",
  "1 investor match/week",
];

const basicFeatures = [
  "Everything in Free",
  "Kevin AI chat (200 msg/day)",
  "Call recording + AI analysis",
  "10 investor matches/week",
  "Permanent IPFS deck storage",
  "Kevin extracts pitch data from deck",
];

const founderProFeatures = [
  "Everything in Basic",
  "Unlimited Kevin messages + matches",
  "Private encrypted IPFS deck",
  "Full Virtual Data Room",
  "Custom AI backend",
  "Custom subdomain (startup.metatron.id)",
  "Embeddable widget",
];

const investorFreeFeatures = [
  "Browse public founder profiles",
  "Short follow list",
  "Kevin on Telegram & WhatsApp",
];

const investorBasicFeatures = [
  "Full deal-flow visibility",
  "Kevin match feed (unlimited)",
  "Pipeline stage management",
  "Investment memo generation",
];

const investorProFeatures = [
  "Everything in Basic",
  "Advanced portfolio analytics",
  "Custom deal-flow workflows",
  "White-label investor profile",
  "Priority Kevin AI access",
];

const connectorFreeFeatures = [
  "Upload 50 contacts",
  "No enrichment",
];

const connectorBasicFeatures = [
  "Unlimited contacts",
  "50 enrichment credits/month",
  "IPFS network storage",
  "Connect tracker",
];

const connectorProFeatures = [
  "Everything in Basic",
  "Custom enrichment data sources",
  "White-label network exports",
  "Team seats",
  "Priority enrichment queue",
];

/** Only allow same-origin paths (prevents open redirects via ?redirect=). */
function safeInternalPath(path: string | null): string | null {
  if (path == null || path === "") return null;
  if (!path.startsWith("/")) return null;
  if (path.startsWith("//")) return null;
  return path;
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

export default function PricingPage() {
  return (
    <Suspense fallback={null}>
      <PricingPageInner />
    </Suspense>
  );
}

/**
 * One button per payment option available in the visitor's currency. The
 * first option is the primary button. Paystack either starts checkout here
 * (`onPaystack`) or links to the role's subscription settings (`paystackHref`).
 */
function PayButtons({
  options,
  loading,
  onPaystack,
  paystackHref,
  onNowpayments,
  primaryId,
}: {
  options: PaymentOption[];
  loading: boolean;
  onPaystack?: () => void;
  paystackHref?: string;
  onNowpayments: () => void;
  primaryId?: string;
}) {
  return (
    <div className="mt-6 flex flex-col gap-3">
      {options.map((opt, i) => {
        const className = `inline-flex w-full items-center justify-center rounded-[12px] px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-60 ${
          i === 0
            ? "bg-metatron-accent text-white hover:bg-metatron-accent-hover"
            : "border border-[var(--border)] text-[var(--text)] hover:border-metatron-accent/30"
        }`;
        return (
          <div key={opt.method}>
            {opt.method === "paystack" && paystackHref ? (
              <Link href={paystackHref} className={className}>
                {opt.label}
              </Link>
            ) : (
              <button
                id={i === 0 ? primaryId : undefined}
                type="button"
                onClick={opt.method === "paystack" ? onPaystack : onNowpayments}
                disabled={loading}
                className={className}
              >
                {loading ? "Redirecting..." : opt.label}
              </button>
            )}
            <p className="mt-1.5 text-center text-[10px] text-[var(--text-muted)]">
              {opt.note}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function PricingPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currency, currencies, setCurrency } = useRegionalCurrency();
  const [billing, setBilling] = useState<Billing>("monthly");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);

  const decodeRoleFromJwt = useCallback((t: string): string | null => {
    try {
      const parts = t.split(".");
      if (parts.length < 2) return null;
      const payload = parts[1];
      const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
      const padLen = (4 - (base64.length % 4)) % 4;
      const normalized = base64 + "=".repeat(padLen);
      const json = atob(normalized);
      const parsed = JSON.parse(json) as { role?: unknown };
      return typeof parsed.role === "string" ? parsed.role : null;
    } catch {
      return null;
    }
  }, []);

  const dashboardPathForRole = useCallback(
    (role: string | null | undefined): string => {
      switch (role) {
        case "INVESTOR":
          return "/investor";
        case "INTERMEDIARY":
          return "/connector";
        default:
          return "/startup";
      }
    },
    [],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const t = getAccessToken();
    if (!t) {
      setUserRole(null);
      return;
    }
    setUserRole(decodeRoleFromJwt(t));
  }, [decodeRoleFromJwt]);

  useEffect(() => {
    if (searchParams.get("success") !== "1") return;
    const token = getAccessToken();
    if (!token) return;

    let cancelled = false;
    const intervalRef: {
      current: ReturnType<typeof setInterval> | undefined;
    } = { current: undefined };

    const run = async () => {
      const reference = searchParams.get("reference");
      if (reference && token) {
        try {
          await fetch(`${API_BASE}/commerce/verify`, {
            method: "POST",
            headers: authJsonHeaders(token),
            body: JSON.stringify({ reference }),
          });
        } catch {
          /* continue to poll */
        }
      }
      if (cancelled) return;

      const tryRedirectIfActive = async (): Promise<boolean> => {
        try {
          const res = await fetch(`${API_BASE}/subscriptions/status`, {
            headers: authJsonHeaders(token),
          });
          const data = await res.json();
          if (data?.subscription_status === "active") {
            const role = decodeRoleFromJwt(token);
            const redirectRaw = searchParams.get("redirect");
            const target =
              safeInternalPath(redirectRaw) ?? dashboardPathForRole(role);
            router.replace(target);
            return true;
          }
        } catch {
          /* fall through to polling */
        }
        return false;
      };

      if (await tryRedirectIfActive()) return;

      let attempts = 0;
      intervalRef.current = setInterval(async () => {
        attempts++;
        if (await tryRedirectIfActive()) {
          if (intervalRef.current !== undefined) {
            clearInterval(intervalRef.current);
          }
          return;
        }
        if (attempts >= 10 && intervalRef.current !== undefined) {
          clearInterval(intervalRef.current);
        }
      }, 2000);
    };

    void run();

    return () => {
      cancelled = true;
      if (intervalRef.current !== undefined) {
        clearInterval(intervalRef.current);
      }
    };
  }, [searchParams, router, decodeRoleFromJwt, dashboardPathForRole]);

  const handleNowpaymentsSubscribe = useCallback(
    async (
      role: "founder" | "investor" | "connector",
      bill: Billing,
      plan: "basic" | "pro" = "basic",
    ) => {
      const authToken = getAccessToken();
      if (!authToken) {
        router.push("/login");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/commerce/nowpayments/subscribe`, {
          method: "POST",
          headers: authJsonHeaders(authToken),
          body: JSON.stringify({
            billing: bill,
            role,
            plan,
            currency: currency === "EUR" ? "EUR" : "USD",
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          invoice_url?: string;
          error?: string;
        };
        if (data.invoice_url) {
          window.location.href = data.invoice_url;
        } else {
          throw new Error(data.error || "Could not start checkout.");
        }
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Could not start checkout.",
        );
      } finally {
        setLoading(false);
      }
    },
    [router, currency],
  );

  const handleZarSubscribe = useCallback(
    async (zarTier: "founder_basic" | "founder_pro" = "founder_basic") => {
      const authToken = getAccessToken();
      if (!authToken) {
        router.push("/login");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/commerce/subscribe`, {
          method: "POST",
          headers: authJsonHeaders(authToken),
          body: JSON.stringify({
            tier: zarTier,
            billing,
            currency: "ZAR",
          }),
        });
        const data = (await res.json()) as {
          hosted_url?: string;
          error?: string;
        };
        if (!res.ok) {
          throw new Error(data?.error || "Payment failed");
        }
        if (!data.hosted_url) {
          throw new Error("Payment failed");
        }
        window.location.href = data.hosted_url;
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : "Payment failed. Please try again.",
        );
      } finally {
        setLoading(false);
      }
    },
    [router, billing],
  );

  if (
    searchParams.get("success") === "1" &&
    typeof window !== "undefined" &&
    getAccessToken()
  ) {
    return (
      <main className="flex min-h-[calc(100vh-72px)] items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-semibold text-[var(--text)]">
            Activating your subscription…
          </p>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            You&apos;ll be redirected shortly.
          </p>
        </div>
      </main>
    );
  }

  // Wait until the visitor's currency is known so prices never flash in the
  // wrong one.
  if (!currency) {
    return <main className="min-h-[calc(100vh-72px)]" />;
  }

  const cardBase =
    "flex flex-col rounded-[12px] border bg-[var(--bg-card)] p-6 text-left";

  const basicDisplay = planPrice("basic", billing, currency);
  const proDisplay = planPrice("pro", billing, currency);
  const proOptions = paymentOptions("pro", billing, currency);
  const basicOptions = paymentOptions("basic", billing, currency);
  const freePrice = formatAmount(0, currency);

  const showFounder = !userRole || userRole === "STARTUP";
  const showConnector = !userRole || userRole === "INTERMEDIARY";
  const showInvestor = !userRole || userRole === "INVESTOR";

  return (
    <main className="min-h-[calc(100vh-72px)] px-5 py-10">
      <div className="mx-auto w-full max-w-5xl">
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

        <div className="mb-8 flex flex-wrap justify-center gap-2">
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

        {showFounder && (
        <section>
          <h2 className="mb-4 text-xl font-semibold text-[var(--text)]">
            For Founders
          </h2>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {/* Free */}
          <section className={`${cardBase} border-[var(--border)]`}>
            <p className="font-sans text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
              Free
            </p>
            <p className="mt-1 text-sm text-[var(--text-muted)]">Forever free</p>
            <p className="mt-4 text-4xl font-bold tracking-tight text-[var(--text)]">
              {freePrice}
            </p>
            <Link
              href="/login"
              className="mt-6 inline-flex w-full items-center justify-center rounded-[12px] border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] transition-colors hover:border-metatron-accent/30"
            >
              Sign in
            </Link>
            <div className="my-6 border-t border-[var(--border)]" />
            <ul className="flex flex-col gap-3">
              {freeFeatures.map((f) => (
                <FeatureCheck key={f}>{f}</FeatureCheck>
              ))}
            </ul>
          </section>

          {/* Kevin AI Basic for Founders */}
          <section
            className={`${cardBase} border-metatron-accent/40 shadow-[0_0_40px_rgba(var(--accent-rgb),0.12)]`}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="font-sans text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                Kevin AI Basic for Founders
              </p>
              <span className="rounded-full bg-metatron-accent/15 px-2.5 py-1 text-[10px] font-semibold text-metatron-accent">
                Most popular
              </span>
            </div>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              {billing === "monthly"
                ? "Billed monthly"
                : "Billed annually · save vs monthly"}
            </p>
            <p className="mt-4 text-4xl font-bold tracking-tight text-[var(--text)]">
              {basicDisplay.price}{" "}
              <span className="text-lg font-semibold text-[var(--text-muted)]">
                {basicDisplay.unit}
              </span>
            </p>
            <PayButtons
              options={basicOptions}
              loading={loading}
              primaryId="btn-subscribe-founder-basic"
              onPaystack={() => void handleZarSubscribe()}
              onNowpayments={() =>
                void handleNowpaymentsSubscribe("founder", billing)
              }
            />
            <div className="my-6 border-t border-[var(--border)]" />
            <ul className="flex flex-col gap-3">
              {basicFeatures.map((f) => (
                <FeatureCheck key={f}>{f}</FeatureCheck>
              ))}
            </ul>
          </section>

          {/* Kevin AI Pro for Founders */}
          <section className={`${cardBase} border-[var(--border)]`}>
            <p className="font-sans text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
              Kevin AI Pro for Founders
            </p>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              {billing === "monthly"
                ? "Billed monthly"
                : "Billed annually · save vs monthly"}
            </p>
            <p className="mt-4 text-4xl font-bold tracking-tight text-[var(--text)]">
              {proDisplay.price}{" "}
              <span className="text-lg font-semibold text-[var(--text-muted)]">
                {proDisplay.unit}
              </span>
            </p>
            <PayButtons
              options={proOptions}
              loading={loading}
              onPaystack={() => void handleZarSubscribe("founder_pro")}
              onNowpayments={() =>
                void handleNowpaymentsSubscribe("founder", billing, "pro")
              }
            />
            <div className="my-6 border-t border-[var(--border)]" />
            <ul className="flex flex-col gap-3">
              {founderProFeatures.map((f) => (
                <FeatureCheck key={f}>{f}</FeatureCheck>
              ))}
            </ul>
          </section>
        </div>
        </section>
        )}

        {showConnector && (
        <section className="mt-10">
          <h2 className="text-xl font-semibold text-[var(--text)]">
            For Connectors & Ecosystem Partners
          </h2>
          <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-3">
            <section className={`${cardBase} border-[var(--border)]`}>
              <p className="font-sans text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                Free
              </p>
              <p className="mt-1 text-sm text-[var(--text-muted)]">Forever free</p>
              <p className="mt-4 text-4xl font-bold tracking-tight text-[var(--text)]">
                {freePrice}
                <span className="text-lg font-semibold text-[var(--text-muted)]">
                  {" "}
                  / mo
                </span>
              </p>
              <Link
                href="/login"
                className="mt-6 inline-flex w-full items-center justify-center rounded-[12px] border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] transition-colors hover:border-metatron-accent/30"
              >
                Sign in
              </Link>
              <div className="my-6 border-t border-[var(--border)]" />
              <ul className="flex flex-col gap-3">
                {connectorFreeFeatures.map((f) => (
                  <FeatureCheck key={f}>{f}</FeatureCheck>
                ))}
              </ul>
            </section>

            <section
              className={`${cardBase} border-metatron-accent/40 shadow-[0_0_40px_rgba(var(--accent-rgb),0.12)]`}
            >
              <p className="font-sans text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                Kevin AI Basic for Connectors
              </p>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                {billing === "monthly"
                  ? "Billed monthly"
                  : "Billed annually · save vs monthly"}
              </p>
              <p className="mt-4 text-4xl font-bold tracking-tight text-[var(--text)]">
                {basicDisplay.price}{" "}
                <span className="text-lg font-semibold text-[var(--text-muted)]">
                  {basicDisplay.unit}
                </span>
              </p>
              <PayButtons
                options={basicOptions}
                loading={loading}
                paystackHref="/connector/settings/subscription"
                onNowpayments={() =>
                  void handleNowpaymentsSubscribe("connector", billing)
                }
              />
              <div className="my-6 border-t border-[var(--border)]" />
              <ul className="flex flex-col gap-3">
                {connectorBasicFeatures.map((f) => (
                  <FeatureCheck key={f}>{f}</FeatureCheck>
                ))}
              </ul>
            </section>

            <section
              className={`${cardBase} border-[var(--border)] opacity-50 cursor-not-allowed`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-sans text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                  Kevin AI Pro for Connectors
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
                {proDisplay.price}{" "}
                <span className="text-lg font-semibold text-[var(--text-muted)]">
                  {proDisplay.unit}
                </span>
              </p>
              <div className="my-6 border-t border-[var(--border)]" />
              <ul className="flex flex-col gap-3">
                {connectorProFeatures.map((f) => (
                  <FeatureCheck key={f}>{f}</FeatureCheck>
                ))}
              </ul>
            </section>
          </div>

          <div className="mt-4 rounded-[12px] border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <p className="text-sm text-[var(--text-muted)]">
              Need more enrichments? Buy credit packs from R10 for 100 credits. Available in your dashboard after upgrading.
            </p>
          </div>
        </section>
        )}

        {showInvestor && (
        <section className="mt-10">
          <h2 className="text-xl font-semibold text-[var(--text)]">
            For Investors
          </h2>
          <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-3">
            <section className={`${cardBase} border-[var(--border)]`}>
              <p className="font-sans text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                Free
              </p>
              <p className="mt-1 text-sm text-[var(--text-muted)]">Forever free</p>
              <p className="mt-4 text-4xl font-bold tracking-tight text-[var(--text)]">
                {freePrice}
                <span className="text-lg font-semibold text-[var(--text-muted)]">
                  {" "}
                  / mo
                </span>
              </p>
              <Link
                href="/login"
                className="mt-6 inline-flex w-full items-center justify-center rounded-[12px] border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] transition-colors hover:border-metatron-accent/30"
              >
                Sign in
              </Link>
              <div className="my-6 border-t border-[var(--border)]" />
              <ul className="flex flex-col gap-3">
                {investorFreeFeatures.map((f) => (
                  <FeatureCheck key={f}>{f}</FeatureCheck>
                ))}
              </ul>
            </section>

            <section
              className={`${cardBase} border-metatron-accent/40 shadow-[0_0_40px_rgba(var(--accent-rgb),0.12)]`}
            >
              <p className="font-sans text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                Kevin AI Basic for Investors
              </p>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                {billing === "monthly"
                  ? "Billed monthly"
                  : "Billed annually · save vs monthly"}
              </p>
              <p className="mt-4 text-4xl font-bold tracking-tight text-[var(--text)]">
                {basicDisplay.price}{" "}
                <span className="text-lg font-semibold text-[var(--text-muted)]">
                  {basicDisplay.unit}
                </span>
              </p>
              <PayButtons
                options={basicOptions}
                loading={loading}
                paystackHref="/investor/settings/subscription"
                onNowpayments={() =>
                  void handleNowpaymentsSubscribe("investor", billing)
                }
              />
              <div className="my-6 border-t border-[var(--border)]" />
              <ul className="flex flex-col gap-3">
                {investorBasicFeatures.map((f) => (
                  <FeatureCheck key={f}>{f}</FeatureCheck>
                ))}
              </ul>
            </section>

            <section className={`${cardBase} border-[var(--border)]`}>
              <p className="font-sans text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                Kevin AI Pro for Investors
              </p>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                {billing === "monthly"
                  ? "Billed monthly"
                  : "Billed annually · save vs monthly"}
              </p>
              <p className="mt-4 text-4xl font-bold tracking-tight text-[var(--text)]">
                {proDisplay.price}{" "}
                <span className="text-lg font-semibold text-[var(--text-muted)]">
                  {proDisplay.unit}
                </span>
              </p>
              <PayButtons
                options={proOptions}
                loading={loading}
                paystackHref="/investor/settings/subscription"
                onNowpayments={() =>
                  void handleNowpaymentsSubscribe("investor", billing, "pro")
                }
              />
              <div className="my-6 border-t border-[var(--border)]" />
              <ul className="flex flex-col gap-3">
                {investorProFeatures.map((f) => (
                  <FeatureCheck key={f}>{f}</FeatureCheck>
                ))}
              </ul>
            </section>
          </div>
        </section>
        )}

        <p className="mt-8 text-center text-sm text-[var(--text-muted)]">
          {checkoutFootnote(currency)}
        </p>
        {error && (
          <p className="mt-3 text-center text-sm text-[var(--text-muted)]">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
