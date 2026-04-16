"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { API_BASE, authJsonHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type ConnectorProfile = {
  connector_tier?: string | null;
  enrichment_credits?: number | null;
};

export default function ConnectorSubscriptionPage() {
  const { token, loading } = useAuth("INTERMEDIARY");
  const searchParams = useSearchParams();
  const [profile, setProfile] = useState<ConnectorProfile | null>(null);
  const [submitting, setSubmitting] = useState<"monthly" | "annual" | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    if (!token) return;
    const res = await fetch(`${API_BASE}/connector-profile`, { headers: authJsonHeaders(token) });
    if (res.ok) setProfile((await res.json()) as ConnectorProfile);
  }, [token]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

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
        const res = await fetch(`${API_BASE}/commerce/connector/verify`, {
          method: "POST",
          headers: authJsonHeaders(token),
          body: JSON.stringify({ reference }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || "Could not verify payment.");
        }
        if (!cancelled) {
          await loadProfile();
          window.history.replaceState({}, "", "/connector/settings/subscription");
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
  }, [searchParams, token, loadProfile]);

  const onSubscribe = useCallback(
    async (billing: "monthly" | "annual") => {
      if (!token) return;
      setSubmitting(billing);
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/commerce/connector/subscribe`, {
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

  if (loading) {
    return (
      <div className="flex min-h-[calc(100vh-72px)] items-center justify-center">
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      </div>
    );
  }
  if (!token) return null;

  const connectorTier = profile?.connector_tier ?? "free";
  const credits = profile?.enrichment_credits ?? 0;

  return (
    <main className="flex-1 px-6 py-8 md:px-10">
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--text)]">Connector Subscription</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Upgrade to unlock unlimited network capacity, IPFS storage, and monthly enrichment credits.
          </p>
        </div>

        {verifying && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 text-sm text-[var(--text-muted)]">
            Verifying payment...
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {connectorTier === "free" ? (
          <div className="grid gap-4 md:grid-cols-2">
            <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-6">
              <p className="font-mono text-[11px] uppercase tracking-[2px] text-[var(--text-muted)]">Monthly</p>
              <p className="mt-2 text-3xl font-semibold text-[var(--text)]">R169.99/month</p>
              <ul className="mt-4 space-y-2 text-sm text-[var(--text-muted)]">
                <li>50 enrichment credits/month</li>
                <li>IPFS network storage</li>
                <li>Unlimited contacts</li>
              </ul>
              <button
                type="button"
                onClick={() => void onSubscribe("monthly")}
                disabled={submitting !== null}
                className="mt-6 w-full rounded-xl bg-[#6c5ce7] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#7d6ff0] disabled:opacity-60"
              >
                {submitting === "monthly" ? "Redirecting..." : "Subscribe monthly"}
              </button>
            </section>

            <section className="rounded-xl border border-[#6c5ce7]/35 bg-[var(--bg-card)] p-6 shadow-[0_0_32px_rgba(108,92,231,0.1)]">
              <p className="font-mono text-[11px] uppercase tracking-[2px] text-[var(--text-muted)]">Annual</p>
              <p className="mt-2 text-3xl font-semibold text-[var(--text)]">R1,699.99/year</p>
              <ul className="mt-4 space-y-2 text-sm text-[var(--text-muted)]">
                <li>50 enrichment credits/month</li>
                <li>IPFS network storage</li>
                <li>Unlimited contacts</li>
              </ul>
              <button
                type="button"
                onClick={() => void onSubscribe("annual")}
                disabled={submitting !== null}
                className="mt-6 w-full rounded-xl bg-[#6c5ce7] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#7d6ff0] disabled:opacity-60"
              >
                {submitting === "annual" ? "Redirecting..." : "Subscribe annually"}
              </button>
            </section>
          </div>
        ) : (
          <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-lg font-semibold text-[var(--text)]">Connector Basic — Active</p>
              <span className="rounded-full bg-[#6c5ce7]/15 px-3 py-1 text-xs font-medium text-[#6c5ce7]">Active</span>
            </div>
            <p className="mt-2 text-sm text-[var(--text-muted)]">Credits remaining: {credits}</p>
            <p className="mt-4 text-xs text-[var(--text-muted)]">
              To manage or cancel your subscription, use your payment provider billing settings or contact support.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
