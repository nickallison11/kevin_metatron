"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { API_BASE, authJsonHeaders } from "@/lib/api";
import SubscriptionPricingContent, {
  type InvoiceRow,
} from "@/components/SubscriptionPricingContent";

type InvestorProfile = {
  investor_tier?: string | null;
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
  const [profile, setProfile] = useState<InvestorProfile | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!token) return;
    try {
      const [pRes, iRes] = await Promise.all([
        fetch(`${API_BASE}/investor-profile`, {
          headers: authJsonHeaders(token),
        }),
        fetch(`${API_BASE}/subscriptions/invoices`, {
          headers: authJsonHeaders(token),
        }),
      ]);
      if (pRes.ok) setProfile((await pRes.json()) as InvestorProfile);
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

  const isPaid = profile?.investor_tier === "basic";

  return (
    <SubscriptionPricingContent
      token={token}
      role="INVESTOR"
      isPaid={isPaid}
      planName="Investor Basic"
      planFeatures={basicFeatures}
      proName="Investor Pro"
      proFeatures={proFeatures}
      zarSubscribeEndpoint="/commerce/investor/subscribe"
      zarVerifyEndpoint="/commerce/investor/verify"
      zarTier="investor_basic"
      basePath="/investor/settings/subscription"
      invoices={invoices}
      onVerifySuccess={loadData}
    />
  );
}
