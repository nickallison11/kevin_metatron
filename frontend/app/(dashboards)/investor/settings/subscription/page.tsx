"use client";

import SubscriptionSettingsContent from "@/components/SubscriptionSettingsContent";
import { useAuth } from "@/lib/auth";

export default function InvestorSubscriptionPage() {
  const { token, loading } = useAuth("INVESTOR");

  if (loading) {
    return (
      <div className="flex min-h-[calc(100vh-72px)] items-center justify-center">
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      </div>
    );
  }

  if (!token) return null;

  return <SubscriptionSettingsContent token={token} pricingPath="/pricing" />;
}
