"use client";

import ClientWalletProvider from "@/components/ClientWalletProvider";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { API_BASE, authJsonHeaders } from "@/lib/api";
import { getSplBalance } from "@/lib/usdc";
import { sendSplPayment } from "@/lib/solana";

/** Mainnet USDT (SPL); override via NEXT_PUBLIC_USDT_MINT. */
const NEXT_PUBLIC_USDT_MINT_FALLBACK =
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

const freeFeatures = [
  "Kevin AI copilot (powered by Gemini)",
  "Founder profile",
  "External pitch deck link",
  "Pitch management",
  "Call recording + AI analysis",
  "Investor deal flow",
];

const proFeatures = [
  "Pitch deck on IPFS via Pinata",
  "Private or public IPFS storage toggle",
  "Custom AI provider (bring your own API key)",
  "Auto-renews monthly — cancel any time",
];

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
      <PricingPageInner />
    </ClientWalletProvider>
  );
}

function PricingPageInner() {
  const router = useRouter();
  const { connection } = useConnection();
  const { connected, publicKey, sendTransaction } = useWallet();
  const [token, setToken] = useState<"USDC" | "USDT">("USDC");
  const [currency, setCurrency] = useState<"USD" | "ZAR">("USD");
  const [loading, setLoading] = useState(false);
  const [activeTier, setActiveTier] = useState<"monthly" | "annual" | null>(
    null,
  );
  const [insufficientBalance, setInsufficientBalance] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const handleSubscribe = useCallback(
    async (tier: "monthly" | "annual") => {
      if (!connected || !publicKey) return;
      setError(null);
      setLoading(true);
      setActiveTier(tier);

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
        setActiveTier(null);
      }
    },
    [
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

  const handleCardPayment = useCallback(
    async (tier: "monthly" | "annual") => {
      const authToken = window.localStorage.getItem("metatron_token");
      if (!authToken) {
        router.push("/login");
        return;
      }
      setLoading(true);
      setActiveTier(tier);
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/commerce/create-charge`, {
          method: "POST",
          headers: authJsonHeaders(authToken),
          body: JSON.stringify({ tier, currency }),
        });
        const data = (await res.json()) as { hosted_url?: string; error?: string };
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
        setActiveTier(null);
      }
    },
    [router, currency],
  );

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

  return (
    <main className="min-h-[calc(100vh-72px)] px-5 py-10">
      <div className="mx-auto w-full max-w-5xl">
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

        <div className="mb-6 flex justify-center gap-2">
          {(["USD", "ZAR"] as const).map((c) => (
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

        <div className="mb-6 flex flex-wrap items-center justify-center gap-3">
          <span className="text-xs text-[var(--text-muted)]">Solana pay with:</span>
          <div className="inline-flex rounded-lg border border-[var(--border)] p-0.5">
            {tokenToggleBtn("USDC")}
            {tokenToggleBtn("USDT")}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {/* Free */}
          <section className={`${cardBase} border-[var(--border)]`}>
            <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
              Free
            </p>
            <p className="mt-1 text-sm text-[var(--text-muted)]">Forever free</p>
            <p className="mt-4 text-4xl font-bold tracking-tight text-[var(--text)]">
              $0
            </p>
            <Link
              href="/auth/signup"
              className="mt-6 inline-flex w-full items-center justify-center rounded-[12px] border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] transition-colors hover:border-metatron-accent/30"
            >
              Get started
            </Link>
            <div className="my-6 border-t border-[var(--border)]" />
            <ul className="flex flex-col gap-3">
              {freeFeatures.map((f) => (
                <FeatureCheck key={f}>{f}</FeatureCheck>
              ))}
            </ul>
          </section>

          {/* Pro Monthly — highlighted */}
          <section
            className={`${cardBase} border-metatron-accent/40 shadow-[0_0_40px_rgba(108,92,231,0.12)]`}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                Pro
              </p>
              <span className="rounded-full bg-metatron-accent/15 px-2.5 py-1 text-[10px] font-semibold text-metatron-accent">
                Most popular
              </span>
            </div>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Billed monthly
            </p>
            <p className="mt-4 text-4xl font-bold tracking-tight text-[var(--text)]">
              {currency === "USD" ? "$9.99" : "R169.99"}{" "}
              <span className="text-lg font-semibold text-[var(--text-muted)]">
                {currency} / mo
              </span>
            </p>
            <button
              id="btn-subscribe-monthly"
              type="button"
              onClick={() => handleSubscribe("monthly")}
              disabled={!connected || loading}
              className="mt-6 inline-flex w-full items-center justify-center rounded-[12px] bg-metatron-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-metatron-accent-hover disabled:opacity-60"
            >
              {loading && activeTier === "monthly"
                ? "Processing..."
                : "Subscribe monthly"}
            </button>
            <button
              type="button"
              onClick={() => handleCardPayment("monthly")}
              disabled={loading}
              className="mt-2 inline-flex w-full items-center justify-center rounded-[12px] border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] transition-colors hover:border-metatron-accent/30 disabled:opacity-60"
            >
              {loading && activeTier === "monthly"
                ? "Redirecting..."
                : "Pay with card"}
            </button>
            <p className="mt-1.5 text-center text-[10px] text-[var(--text-muted)]">
              Visa & Mastercard · Powered by Paystack
            </p>
            <div className="my-6 border-t border-[var(--border)]" />
            <ul className="flex flex-col gap-3">
              <FeatureCheck>Everything in Free</FeatureCheck>
              {proFeatures.map((f) => (
                <FeatureCheck key={f}>{f}</FeatureCheck>
              ))}
            </ul>
          </section>

          {/* Pro Annual */}
          <section className={`${cardBase} border-[var(--border)]`}>
            <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
              Pro Annual
            </p>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Billed annually · save vs monthly
            </p>
            <p className="mt-4 text-4xl font-bold tracking-tight text-[var(--text)]">
              {currency === "USD" ? "$99.99" : "R1,699.99"}{" "}
              <span className="text-lg font-semibold text-[var(--text-muted)]">
                {currency} / yr
              </span>
            </p>
            <button
              id="btn-subscribe-annual"
              type="button"
              onClick={() => handleSubscribe("annual")}
              disabled={!connected || loading}
              className="mt-6 inline-flex w-full items-center justify-center rounded-[12px] border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] transition-colors hover:border-metatron-accent/30 disabled:opacity-60"
            >
              {loading && activeTier === "annual"
                ? "Processing..."
                : "Subscribe annually"}
            </button>
            <button
              type="button"
              onClick={() => handleCardPayment("annual")}
              disabled={loading}
              className="mt-2 inline-flex w-full items-center justify-center rounded-[12px] border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] transition-colors hover:border-metatron-accent/30 disabled:opacity-60"
            >
              {loading && activeTier === "annual"
                ? "Redirecting..."
                : "Pay with card"}
            </button>
            <p className="mt-1.5 text-center text-[10px] text-[var(--text-muted)]">
              Visa & Mastercard · Powered by Paystack
            </p>
            <div className="my-6 border-t border-[var(--border)]" />
            <ul className="flex flex-col gap-3">
              <FeatureCheck>Everything in Free</FeatureCheck>
              {proFeatures.map((f) => (
                <FeatureCheck key={`a-${f}`}>{f}</FeatureCheck>
              ))}
              <FeatureCheck>Pay once, covered for 12 months</FeatureCheck>
            </ul>
          </section>
        </div>

        {insufficientBalance && (
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
          Pay with crypto (USDC/USDT via Solana) or card (Visa/Mastercard via
          Paystack). Prices shown in USD and ZAR.
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
