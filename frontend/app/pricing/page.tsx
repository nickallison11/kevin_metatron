"use client";

import ClientWalletProvider from "@/components/ClientWalletProvider";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { API_BASE, authJsonHeaders } from "@/lib/api";
import { getSplBalance } from "@/lib/usdc";
import { sendSplPayment } from "@/lib/solana";

/** Mainnet USDT (SPL); override via NEXT_PUBLIC_USDT_MINT. */
const NEXT_PUBLIC_USDT_MINT_FALLBACK =
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

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
  "Angel Score + VDR",
  "Custom AI backend",
  "Custom subdomain (startup.metatron.id)",
  "Embeddable widget",
];

const investorFreeFeatures = [
  "Browse public founder profiles",
  "Save a short watchlist",
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
  "Introductions tracker",
];

const connectorProFeatures = [
  "Everything in Basic",
  "Custom enrichment data sources",
  "White-label network exports",
  "Team seats",
  "Priority enrichment queue",
];

type SubscriptionStatusLite = {
  subscription_status: string;
  subscription_period_end: string | null;
};

function formatLongDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Only allow same-origin paths (prevents open redirects via ?redirect=). */
function safeInternalPath(path: string | null): string | null {
  if (path == null || path === "") return null;
  if (!path.startsWith("/")) return null;
  if (path.startsWith("//")) return null;
  return path;
}

function computeExtendedEnd(periodEndIso: string | null, tier: "monthly" | "annual") {
  if (!periodEndIso) return "—";
  const d = new Date(periodEndIso);
  if (Number.isNaN(d.getTime())) return "—";
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + (tier === "monthly" ? 30 : 365));
  return out.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
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

export default function PricingPage() {
  return (
    <ClientWalletProvider>
      <Suspense fallback={null}>
        <PricingPageInner />
      </Suspense>
    </ClientWalletProvider>
  );
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

function PricingPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { connection } = useConnection();
  const { connected, publicKey, sendTransaction } = useWallet();
  const [token, setToken] = useState<"USDC" | "USDT">("USDC");
  const [currency, setCurrency] = useState<"USD" | "ZAR">("ZAR");
  const [billing, setBilling] = useState<"monthly" | "annual">("monthly");
  const [loading, setLoading] = useState(false);
  const [loadingBilling, setLoadingBilling] = useState<
    "monthly" | "annual" | null
  >(null);
  const [insufficientBalance, setInsufficientBalance] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subStatus, setSubStatus] = useState<SubscriptionStatusLite | null>(null);
  const [extendModalTier, setExtendModalTier] = useState<"monthly" | "annual" | null>(
    null,
  );
  const walletAddress = publicKey?.toString() ?? "";
  const shortAddress =
    walletAddress.length > 8
      ? `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`
      : walletAddress;

  const selectedMint = useCallback(() => {
    if (token === "USDC") {
      const m = process.env.NEXT_PUBLIC_USDC_MINT;
      if (!m) throw new Error("USDC mint not configured");
      return m;
    }
    return (
      process.env.NEXT_PUBLIC_USDT_MINT ?? NEXT_PUBLIC_USDT_MINT_FALLBACK
    );
  }, [token]);

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
    if (searchParams.get("success") !== "1") return;
    const token = window.localStorage.getItem("metatron_token");
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

  useEffect(() => {
    const t = window.localStorage.getItem("metatron_token");
    if (!t) return;
    fetch(`${API_BASE}/subscriptions/status`, {
      headers: authJsonHeaders(t),
    })
      .then((r) => r.json())
      .then((data) => setSubStatus(data as SubscriptionStatusLite))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const ext = searchParams.get("extend");
    if (ext !== "monthly" && ext !== "annual") return;
    if (!subStatus || subStatus.subscription_status !== "active") return;
    setExtendModalTier(ext === "annual" ? "annual" : "monthly");
  }, [searchParams, subStatus]);

  const closeExtendModal = useCallback(() => {
    setExtendModalTier(null);
    router.replace("/pricing");
  }, [router]);

  const handleUsdSubscribe = useCallback(
    async (
      overrideTier?: "monthly" | "annual",
      skipExtendCheck = false,
    ) => {
      const tier = overrideTier ?? billing;
      if (!skipExtendCheck) {
        const authToken = window.localStorage.getItem("metatron_token");
        if (authToken) {
          try {
            const res = await fetch(`${API_BASE}/subscriptions/status`, {
              headers: authJsonHeaders(authToken),
            });
            const data = (await res.json()) as SubscriptionStatusLite;
            if (data?.subscription_status === "active") {
              setSubStatus(data);
              setExtendModalTier(tier);
              return;
            }
          } catch {
            /* continue to checkout */
          }
        }
      }

      if (!connected || !publicKey) return;
      setError(null);
      setLoading(true);
      setLoadingBilling(tier);

      try {
        const requiredAmount = tier === "monthly" ? 9.99 : 99;
        const mint = selectedMint();
        const balance = await getSplBalance(connection, publicKey, mint);
        if (balance < requiredAmount) {
          setInsufficientBalance(true);
          return;
        }
        setInsufficientBalance(false);

        const authToken = window.localStorage.getItem("metatron_token");
        if (!authToken) {
          throw new Error("Please log in before subscribing.");
        }

        const nonceRes = await fetch(`${API_BASE}/subscriptions/nonce`, {
          method: "GET",
          headers: authJsonHeaders(authToken),
        });
        const nonceJson = await nonceRes.json().catch(() => ({}));
        if (!nonceRes.ok || !nonceJson?.nonce) {
          throw new Error(
            nonceJson?.error || "Could not start payment. Please try again.",
          );
        }

        const signature = await sendSplPayment({
          connection,
          senderPublicKey: publicKey,
          amountUsdc: requiredAmount,
          memo: String(nonceJson.nonce),
          sendTransaction,
          mintAddress: mint,
        });

        const confirmRes = await fetch(`${API_BASE}/subscriptions/confirm`, {
          method: "POST",
          headers: authJsonHeaders(authToken),
          body: JSON.stringify({ signature, tier }),
        });
        const confirmJson = await confirmRes.json().catch(() => ({}));
        if (!confirmRes.ok) {
          throw new Error(
            confirmJson?.error || "Subscription confirmation failed.",
          );
        }

        const role = decodeRoleFromJwt(authToken);
        router.push(dashboardPathForRole(role));
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : "Subscription failed. Please try again.",
        );
      } finally {
        setLoading(false);
        setLoadingBilling(null);
      }
    },
    [
      billing,
      connected,
      publicKey,
      connection,
      sendTransaction,
      decodeRoleFromJwt,
      dashboardPathForRole,
      router,
      selectedMint,
    ],
  );

  const handleZarSubscribe = useCallback(
    async (
      overrideTier?: "monthly" | "annual",
      skipExtendCheck = false,
    ) => {
      const tier = overrideTier ?? billing;
      const authToken = window.localStorage.getItem("metatron_token");
      if (!authToken) {
        router.push("/login");
        return;
      }
      if (!skipExtendCheck) {
        try {
          const res = await fetch(`${API_BASE}/subscriptions/status`, {
            headers: authJsonHeaders(authToken),
          });
          const data = (await res.json()) as SubscriptionStatusLite;
          if (data?.subscription_status === "active") {
            setSubStatus(data);
            setExtendModalTier(tier);
            return;
          }
        } catch {
          /* continue */
        }
      }
      setLoading(true);
      setLoadingBilling(tier);
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/commerce/subscribe`, {
          method: "POST",
          headers: authJsonHeaders(authToken),
          body: JSON.stringify({
            tier: "founder_basic",
            billing: tier,
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
        setLoadingBilling(null);
      }
    },
    [router, billing],
  );

  if (
    searchParams.get("success") === "1" &&
    window.localStorage.getItem("metatron_token")
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

  const tokenToggleBtn = (t: "USDC" | "USDT") => (
    <button
      key={t}
      type="button"
      onClick={() => {
        setToken(t);
        setInsufficientBalance(false);
      }}
      className={[
        "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
        token === t
          ? "bg-metatron-accent text-white"
          : "text-[var(--text-muted)] hover:text-[var(--text)]",
      ].join(" ")}
    >
      {t}
    </button>
  );

  const cardBase =
    "flex flex-col rounded-[12px] border bg-[var(--bg-card)] p-6 text-left";

  const basicDisplay = formatBasicDisplay(currency, billing);
  const proComingSoonDisplay = formatProComingSoonDisplay(currency, billing);

  return (
    <main className="min-h-[calc(100vh-72px)] px-5 py-10">
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-4 flex justify-center gap-2">
          {(["ZAR", "USD"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                setCurrency(c);
                if (c === "ZAR") setInsufficientBalance(false);
              }}
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

        {currency === "USD" && (
          <div className="mb-8 flex flex-col items-stretch justify-between gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 text-sm md:flex-row md:items-center">
            {connected ? (
              <p className="text-sm text-[var(--text-muted)]">
                <span className="mr-2 inline-block h-2 w-2 rounded-full bg-green-400" />
                Wallet connected: {shortAddress}
              </p>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">
                Connect your wallet to subscribe. We accept USDC and USDT on
                Solana.
              </p>
            )}
            <div className="flex justify-center md:justify-end">
              <WalletMultiButton />
            </div>
          </div>
        )}

        {currency === "USD" && (
          <div className="mb-6 flex flex-wrap items-center justify-center gap-3">
            <span className="text-xs text-[var(--text-muted)]">
              Solana pay with:
            </span>
            <div className="inline-flex rounded-lg border border-[var(--border)] p-0.5">
              {tokenToggleBtn("USDC")}
              {tokenToggleBtn("USDT")}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {/* Free */}
          <section className={`${cardBase} border-[var(--border)]`}>
            <p className="font-sans text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
              Free
            </p>
            <p className="mt-1 text-sm text-[var(--text-muted)]">Forever free</p>
            <p className="mt-4 text-4xl font-bold tracking-tight text-[var(--text)]">
              $0
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

          {/* Founder Basic */}
          <section
            className={`${cardBase} border-metatron-accent/40 shadow-[0_0_40px_rgba(108,92,231,0.12)]`}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="font-sans text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                Founder Basic
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
            {currency === "USD" && (
              <button
                id="btn-subscribe-founder-basic"
                type="button"
                onClick={() => void handleUsdSubscribe()}
                disabled={!connected || loading}
                className="mt-6 inline-flex w-full items-center justify-center rounded-[12px] bg-metatron-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-metatron-accent-hover disabled:opacity-60"
              >
                {loading && loadingBilling === billing
                  ? "Processing..."
                  : "Subscribe"}
              </button>
            )}
            {currency === "ZAR" && (
              <>
                <button
                  type="button"
                  onClick={() => void handleZarSubscribe()}
                  disabled={loading}
                  className="mt-6 inline-flex w-full items-center justify-center rounded-[12px] border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] transition-colors hover:border-metatron-accent/30 disabled:opacity-60"
                >
                  {loading && loadingBilling === billing
                    ? "Redirecting..."
                    : "Pay with card"}
                </button>
                <p className="mt-1.5 text-center text-[10px] text-[var(--text-muted)]">
                  Visa & Mastercard · Powered by Paystack
                </p>
              </>
            )}
            <div className="my-6 border-t border-[var(--border)]" />
            <ul className="flex flex-col gap-3">
              {basicFeatures.map((f) => (
                <FeatureCheck key={f}>{f}</FeatureCheck>
              ))}
            </ul>
          </section>

          {/* Founder Pro — coming soon */}
          <section
            className={`${cardBase} border-[var(--border)] opacity-50 cursor-not-allowed`}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="font-sans text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                Founder Pro
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
              {founderProFeatures.map((f) => (
                <FeatureCheck key={f}>{f}</FeatureCheck>
              ))}
            </ul>
          </section>
        </div>

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
                {currency === "USD" ? (
                  <>
                    $0
                    <span className="text-lg font-semibold text-[var(--text-muted)]">
                      {" "}
                      / mo
                    </span>
                  </>
                ) : (
                  <>
                    R0
                    <span className="text-lg font-semibold text-[var(--text-muted)]">
                      {" "}
                      / mo
                    </span>
                  </>
                )}
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
              className={`${cardBase} border-metatron-accent/40 shadow-[0_0_40px_rgba(108,92,231,0.12)]`}
            >
              <p className="font-sans text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                Investor Basic
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
              <Link
                href="/investor/settings/subscription"
                className="mt-6 inline-flex w-full items-center justify-center rounded-[12px] bg-metatron-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-metatron-accent-hover"
              >
                {currency === "USD" ? "Subscribe with wallet" : "Pay with card"}
              </Link>
              {currency === "ZAR" && (
                <p className="mt-1.5 text-center text-[10px] text-[var(--text-muted)]">
                  Visa & Mastercard · Powered by Paystack
                </p>
              )}
              <div className="my-6 border-t border-[var(--border)]" />
              <ul className="flex flex-col gap-3">
                {investorBasicFeatures.map((f) => (
                  <FeatureCheck key={f}>{f}</FeatureCheck>
                ))}
              </ul>
            </section>

            <section
              className={`${cardBase} border-[var(--border)] opacity-50 cursor-not-allowed`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-sans text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                  Investor Pro
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
                {investorProFeatures.map((f) => (
                  <FeatureCheck key={f}>{f}</FeatureCheck>
                ))}
              </ul>
            </section>
          </div>
        </section>

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
                {currency === "USD" ? (
                  <>
                    $0
                    <span className="text-lg font-semibold text-[var(--text-muted)]">
                      {" "}
                      / mo
                    </span>
                  </>
                ) : (
                  <>
                    R0
                    <span className="text-lg font-semibold text-[var(--text-muted)]">
                      {" "}
                      / mo
                    </span>
                  </>
                )}
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
              className={`${cardBase} border-metatron-accent/40 shadow-[0_0_40px_rgba(108,92,231,0.12)]`}
            >
              <p className="font-sans text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                Connector Basic
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
              <Link
                href="/connector/settings/subscription"
                className="mt-6 inline-flex w-full items-center justify-center rounded-[12px] bg-metatron-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-metatron-accent-hover"
              >
                {currency === "USD" ? "Subscribe with wallet" : "Pay with card"}
              </Link>
              {currency === "ZAR" && (
                <p className="mt-1.5 text-center text-[10px] text-[var(--text-muted)]">
                  Visa & Mastercard · Powered by Paystack
                </p>
              )}
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
                  Connector Pro
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

        {currency === "USD" && insufficientBalance && (
          <div className="mb-6 mt-8 rounded-[12px] border border-[var(--border)] bg-[var(--bg-card)] p-4 text-center">
            <p className="mb-3 text-sm text-[var(--text-muted)]">
              You don&apos;t have enough {token} in your wallet. You can
              purchase {token} via any Solana-compatible exchange or wallet
              (e.g. Phantom, Backpack, Solflare).
            </p>
            <p className="mt-2 text-xs text-[var(--text-muted)]">
              After purchasing, return here and click Subscribe again.
            </p>
          </div>
        )}

        <p className="mt-8 text-center text-sm text-[var(--text-muted)]">
          {currency === "USD"
            ? "Pay with USDC or USDT via your Solana wallet."
            : "Pay with Visa or Mastercard via Paystack. Billed in ZAR."}
        </p>
        {error && (
          <p className="mt-3 text-center text-sm text-[var(--text-muted)]">
            {error}
          </p>
        )}
      </div>

      {extendModalTier && subStatus?.subscription_status === "active" && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="extend-modal-title"
        >
          <div className="w-full max-w-md rounded-[12px] border border-[var(--border)] bg-[var(--bg-card)] p-6 shadow-xl">
            <h2
              id="extend-modal-title"
              className="text-lg font-semibold text-[var(--text)]"
            >
              Extend your subscription
            </h2>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              Current plan active until:{" "}
              <span className="text-[var(--text)]">
                {formatLongDate(subStatus.subscription_period_end)}
              </span>
            </p>
            <div className="mt-4 rounded-[12px] border border-[var(--border)] bg-[#0a0a0f]/50 p-4">
              <p className="font-sans text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                {extendModalTier === "monthly" ? "Monthly extension" : "Annual extension"}
              </p>
              <p className="mt-2 text-sm text-[var(--text)]">
                New end date:{" "}
                <strong>
                  {computeExtendedEnd(subStatus.subscription_period_end, extendModalTier)}
                </strong>
              </p>
              <p className="mt-2 text-xs text-[var(--text-muted)]">
                {extendModalTier === "monthly" ? (
                  <>
                    ZAR 169.99 · USD 9.99
                  </>
                ) : (
                  <>
                    ZAR 1,699.99 · USD 99.99
                  </>
                )}
              </p>
            </div>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                onClick={() => {
                  void handleZarSubscribe(extendModalTier, true);
                }}
                disabled={loading}
                className="inline-flex flex-1 items-center justify-center rounded-[12px] border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] transition-colors hover:border-metatron-accent/30 disabled:opacity-60"
              >
                {loading && loadingBilling === extendModalTier
                  ? "Redirecting..."
                  : "Pay with card"}
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleUsdSubscribe(extendModalTier, true);
                }}
                disabled={loading || !connected}
                className="inline-flex flex-1 items-center justify-center rounded-[12px] bg-metatron-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-metatron-accent-hover disabled:opacity-60"
              >
                {loading && loadingBilling === extendModalTier
                  ? "Processing..."
                  : "Pay with USDC/USDT"}
              </button>
            </div>
            <button
              type="button"
              onClick={closeExtendModal}
              className="mt-4 w-full rounded-[12px] border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--text-muted)] transition-colors hover:border-metatron-accent/30"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
