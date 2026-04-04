"use client";

import SubscriptionInvoiceView from "@/components/SubscriptionInvoiceView";
import { useAuth } from "@/lib/auth";
import { useParams } from "next/navigation";

export default function ConnectorInvoicePage() {
  const { token, loading } = useAuth("INTERMEDIARY");
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : "";

  if (loading) {
    return (
      <div className="flex min-h-[calc(100vh-72px)] items-center justify-center">
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      </div>
    );
  }

  if (!token) return null;

  return (
    <SubscriptionInvoiceView
      token={token}
      invoiceId={id}
      settingsHref="/connector/settings/subscription"
    />
  );
}
