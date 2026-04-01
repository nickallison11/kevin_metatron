"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { API_BASE, authJsonHeaders } from "@/lib/api";
import { getUsdcBalance } from "@/lib/usdc";
import { sendUsdcPayment } from "@/lib/solana";

const proFeatures = [
  "Pitch deck on IPFS via Pinata",
  "Private or public IPFS storage toggle",
  "Custom AI provider (bring your own API key)",
  "Auto-renews monthly — cancel any time",
];

export default function PricingPage() {
  const router = useRouter();
  const { connection } = useConnection();
  const { connected, publicKey, sendTransaction } = useWallet();
  const [loading, setLoading] = useState(false);
  const [activeTier, setActiveTier] = useState<"monthly" | "annual" | null>(null);
  const [insufficientBalance, setInsufficientBalance] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const walletAddress = publicKey?.toString() ?? "";
  const shortAddress =
    walletAddress.length > 8
      ? `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`
      : walletAddress;

  const decodeRoleFromJwt = useCallback((token: string): string | null => {
    try {
      const parts = token.split(".");
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

  const dashboardPathForRole = useCallback((role: string | null | undefined): string => {
    switch (role) {
      case "INVESTOR":
        return "/investor";
      case "INTERMEDIARY":
        return "/connector";
      default:
        return "/startup";
    }
  }, []);

  const handleSubscribe = useCallback(
    async (tier: "monthly" | "annual") => {
      if (!connected || !publicKey) return;
      setError(null);
      setLoading(true);
      setActiveTier(tier);

      try {
        const requiredAmount = tier === "monthly" ? 9.99 : 99;
        const balance = await getUsdcBalance(connection, publicKey);
        if (balance < requiredAmount) {
          setInsufficientBalance(true);
          return;
        }
        setInsufficientBalance(false);

        const token = window.localStorage.getItem("metatron_token");
        if (!token) {
          throw new Error("Please log in before subscribing.");
        }

        const nonceRes = await fetch(`${API_BASE}/subscriptions/nonce`, {
          method: "GET",
          headers: authJsonHeaders(token),
        });
        const nonceJson = await nonceRes.json().catch(() => ({}));
        if (!nonceRes.ok || !nonceJson?.nonce) {
          throw new Error(
            nonceJson?.error || "Could not start payment. Please try again.",
          );
        }

        const signature = await sendUsdcPayment({
          connection,
          senderPublicKey: publicKey,
          amountUsdc: requiredAmount,
          memo: String(nonceJson.nonce),
          sendTransaction,
        });

        const confirmRes = await fetch(`${API_BASE}/subscriptions/confirm`, {
          method: "POST",
          headers: authJsonHeaders(token),
          body: JSON.stringify({ signature, tier }),
        });
        const confirmJson = await confirmRes.json().catch(() => ({}));
        if (!confirmRes.ok) {
          throw new Error(
            confirmJson?.error || "Subscription confirmation failed.",
          );
        }

        const role = decodeRoleFromJwt(token);
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
      API_BASE,
      connected,
      publicKey,
      connection,
      sendTransaction,
      decodeRoleFromJwt,
      dashboardPathForRole,
      router,
    ],
  );

  return (
    <main className="min-h-[calc(100vh-72px)] px-5 py-10">
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-6 flex flex-col items-center justify-center gap-3 rounded-metatron border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 text-sm md:flex-row md:justify-between">
          {connected ? (
            <p className="text-sm text-[var(--text-muted)]">
              <span className="mr-2 inline-block h-2 w-2 rounded-full bg-green-400" />
              Wallet connected: {shortAddress}
            </p>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">
              Connect your Phantom wallet to subscribe.
            </p>
          )}
          <div className="flex items-center justify-center">
            <WalletMultiButton />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <section className="rounded-metatron border border-[var(--border)] bg-[var(--bg-card)] p-6">
            <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
              FREE
            </p>
            <p className="mt-2 text-3xl font-bold text-[var(--text)]">$0</p>
            <ul className="mt-5 space-y-2 text-sm text-[var(--text-muted)]">
              <li>Kevin AI copilot (powered by Gemini)</li>
              <li>Founder profile</li>
              <li>External pitch deck link</li>
              <li>Pitch management</li>
              <li>Call recording + AI analysis</li>
              <li>Investor deal flow</li>
            </ul>
            <Link
              href="/auth/signup"
              className="mt-6 inline-flex w-full items-center justify-center rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] hover:border-metatron-accent/30"
            >
              Get Started
            </Link>
          </section>

          <section className="rounded-metatron border border-[var(--accent)] bg-[var(--bg-card)] p-6">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                PRO
              </p>
              <span className="rounded-full bg-metatron-accent/15 px-2.5 py-1 text-[10px] font-semibold text-metatron-accent">
                Most Popular
              </span>
            </div>
            <p className="mt-2 text-3xl font-bold text-[var(--text)]">$9.99 USDC / month</p>
            <ul className="mt-5 space-y-2 text-sm text-[var(--text-muted)]">
              <li>Everything in Free</li>
              {proFeatures.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <button
              id="btn-subscribe-monthly"
              type="button"
              onClick={() => handleSubscribe("monthly")}
              disabled={!connected || loading}
              className="mt-6 inline-flex w-full items-center justify-center rounded-lg bg-metatron-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-60"
            >
              {loading && activeTier === "monthly" ? "Processing..." : "Subscribe Monthly"}
            </button>
          </section>

          <section className="rounded-metatron border border-[var(--border)] bg-[var(--bg-card)] p-6">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                PRO ANNUAL
              </p>
              <span className="rounded-full bg-metatron-accent/15 px-2.5 py-1 text-[10px] font-semibold text-metatron-accent">
                Save 2 months
              </span>
            </div>
            <p className="mt-2 text-3xl font-bold text-[var(--text)]">$99 USDC / year</p>
            <ul className="mt-5 space-y-2 text-sm text-[var(--text-muted)]">
              <li>Everything in Free</li>
              {proFeatures.map((f) => (
                <li key={f}>{f}</li>
              ))}
              <li>Pay once, covered for 12 months</li>
            </ul>
            <button
              id="btn-subscribe-annual"
              type="button"
              onClick={() => handleSubscribe("annual")}
              disabled={!connected || loading}
              className="mt-6 inline-flex w-full items-center justify-center rounded-lg bg-metatron-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-60"
            >
              {loading && activeTier === "annual" ? "Processing..." : "Subscribe Annual"}
            </button>
          </section>
        </div>
        {insufficientBalance && (
          <div className="text-center p-4 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] mb-6">
            <p className="text-sm text-[var(--text-muted)] mb-3">
              You don&apos;t have enough USDC in your wallet. Use Phantom&apos;s built-in Buy
              feature to purchase USDC with a card.
            </p>
            <a
              href="https://phantom.app/buy"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium"
            >
              Buy USDC in Phantom
            </a>
            <p className="text-xs text-[var(--text-muted)] mt-2">
              After purchasing, return here and click Subscribe again.
            </p>
          </div>
        )}

        <p className="mt-6 text-center text-sm text-[var(--text-muted)]">
          Payments are made in USDC on the Solana network via your Phantom wallet.
          Don&apos;t have USDC? You can buy it with a card during checkout.
        </p>
        {error && (
          <p className="mt-3 text-center text-sm text-[var(--text-muted)]">{error}</p>
        )}
      </div>
    </main>
  );
}
