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
};

const basicFeatures = [
  "Everything in Free",
  "Kevin AI chat (200 msg/day)",
  "Call recording + AI analysis",
  "10 investor matches/week",
  "Permanent IPFS deck storage",
  "Kevin extracts pitch data from deck",
];

const proFeatures = [
  "Everything in Basic",
  "Unlimited Kevin messages + matches",
  "Private encrypted IPFS deck",
  "Angel Score + VDR",
  "Custom AI backend",
  "Custom subdomain (startup.metatron.id)",
  "Embeddable widget",
];

export default function StartupSubscriptionPage() {
  const { token, loading } = useAuth();
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

  return (
    <SubscriptionPricingContent
      token={token}
      role="STARTUP"
      isPaid={isPaid}
      planName="Founder Basic"
      planFeatures={basicFeatures}
      proName="Founder Pro"
      proFeatures={proFeatures}
      zarSubscribeEndpoint="/commerce/subscribe"
      zarVerifyEndpoint="/commerce/verify"
      zarTier="founder_basic"
      basePath="/startup/settings/subscription"
      invoices={invoices}
      onVerifySuccess={loadData}
      startupMeta={
        isPaid && status
          ? {
              periodEnd: status.subscription_period_end,
              cancelAtPeriodEnd: status.cancel_at_period_end,
              subscriptionTier: status.subscription_tier,
            }
          : undefined
      }
    />
  );
}
