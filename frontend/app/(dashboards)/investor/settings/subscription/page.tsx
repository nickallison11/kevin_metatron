"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { API_BASE, authJsonHeaders } from "@/lib/api";
import SubscriptionPricingContent, {
  type InvoiceRow,
} from "@/components/SubscriptionPricingContent";

type SubStatus = {
  subscription_tier: string;
  subscription_status: string;
  subscription_period_end: string | null;
  cancel_at_period_end: boolean;
  pending_downgrade_to: string | null;
};

const basicFeatures = [
  "Full deal-flow visibility",
  "Kevin match feed (unlimited)",
  "Pipeline stage management",
  "Investment memo generation",
  "Investor profile on metatron",
];

const proFeatures = [
  "Everything in Basic",
  "Advanced portfolio analytics",
  "Custom deal-flow workflows",
  "White-label investor profile",
  "Priority Kevin AI access",
];

export default function InvestorSubscriptionPage() {
  const { token, loading } = useAuth("INVESTOR");
  const [status, setStatus] = useState<SubStatus | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!token) return;
    try {
      const [sRes, iRes] = await Promise.all([
        fetch(`${API_BASE}/subscriptions/status`, {
          headers: authJsonHeaders(token),
        }),
        fetch(`${API_BASE}/subscriptions/invoices`, {
          headers: authJsonHeaders(token),
        }),
      ]);
      if (sRes.ok) setStatus((await sRes.json()) as SubStatus);
      if (iRes.ok) setInvoices((await iRes.json()) as InvoiceRow[]);
    } finally {
      setDataLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  if (loading || dataLoading) {
    return (
      <div className="flex min-h-[calc(100vh-72px)] items-center justify-center">
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      </div>
    );
  }

  if (!token) return null;

  const isPaid = status?.subscription_status === "active";
  const planLevel: "free" | "basic" | "pro" = !isPaid
    ? "free"
    : status?.subscription_tier === "pro"
      ? "pro"
      : "basic";
  const planName = planLevel === "pro" ? "Investor Pro" : "Investor Basic";

  return (
    <SubscriptionPricingContent
      token={token}
      role="INVESTOR"
      isPaid={isPaid}
      planLevel={planLevel}
      planName={planName}
      planFeatures={basicFeatures}
      proName="Investor Pro"
      proFeatures={proFeatures}
      zarSubscribeEndpoint="/commerce/investor/subscribe"
      zarVerifyEndpoint="/commerce/investor/verify"
      zarTier="investor_basic"
      basePath="/investor/settings/subscription"
      invoices={invoices}
      subMeta={
        isPaid && status
          ? {
              periodEnd: status.subscription_period_end,
              cancelAtPeriodEnd: status.cancel_at_period_end,
              subscriptionTier: status.subscription_tier,
              pendingDowngradeTo: status.pending_downgrade_to,
            }
          : undefined
      }
      onVerifySuccess={loadData}
    />
  );
}
