"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { API_BASE, authJsonHeaders } from "@/lib/api";
import SubscriptionPricingContent, {
  type InvoiceRow,
} from "@/components/SubscriptionPricingContent";

type ConnectorProfile = {
  connector_tier?: string | null;
  enrichment_credits?: number | null;
};

type SubStatus = {
  subscription_tier: string;
  subscription_status: string;
  subscription_period_end: string | null;
  cancel_at_period_end: boolean;
  pending_downgrade_to: string | null;
};

const basicFeatures = [
  "Unlimited contacts",
  "50 enrichment credits/month",
  "IPFS network storage",
  "Introductions tracker",
  "Referral programme",
];

const proFeatures = [
  "Everything in Basic",
  "Custom enrichment data sources",
  "White-label network exports",
  "Team seats",
  "Priority enrichment queue",
];

export default function ConnectorSubscriptionPage() {
  const { token, loading } = useAuth("INTERMEDIARY");
  const [profile, setProfile] = useState<ConnectorProfile | null>(null);
  const [status, setStatus] = useState<SubStatus | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!token) return;
    try {
      const [pRes, sRes, iRes] = await Promise.all([
        fetch(`${API_BASE}/connector-profile`, {
          headers: authJsonHeaders(token),
        }),
        fetch(`${API_BASE}/subscriptions/status`, {
          headers: authJsonHeaders(token),
        }),
        fetch(`${API_BASE}/subscriptions/invoices`, {
          headers: authJsonHeaders(token),
        }),
      ]);
      if (pRes.ok) setProfile((await pRes.json()) as ConnectorProfile);
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

  const isPaid = profile?.connector_tier === "paid";
  const credits = profile?.enrichment_credits ?? 0;

  return (
    <SubscriptionPricingContent
      token={token}
      role="INTERMEDIARY"
      isPaid={isPaid}
      planName="Connector Basic"
      planFeatures={basicFeatures}
      proName="Connector Pro"
      proFeatures={proFeatures}
      zarSubscribeEndpoint="/commerce/connector/subscribe"
      zarVerifyEndpoint="/commerce/connector/verify"
      zarTier="connector_basic"
      basePath="/connector/settings/subscription"
      invoices={invoices}
      extraPaidInfo={<p className="text-sm text-[var(--text-muted)]">Credits remaining: {credits}</p>}
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
