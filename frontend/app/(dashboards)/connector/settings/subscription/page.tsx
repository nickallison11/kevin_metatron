"use client";

import { useCallback, useEffect, useState } from "react";
import { API_BASE, authJsonHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const TIERS = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    period: "",
    features: [
      "Up to 100 staged contacts",
      "5 enrichments per batch",
      "Basic network management",
      "Manual import only",
    ],
    cta: null,
  },
  {
    id: "basic",
    name: "Basic",
    price: "$49.99",
    period: "/month",
    features: [
      "Unlimited staged contacts",
      "Full AI enrichment (all contacts)",
      "Spreadsheet export (XLSX)",
      "IPFS network snapshots",
      "Email notification on enrichment complete",
      "Priority support",
    ],
    cta: "Upgrade to Basic",
  },
  {
    id: "pro",
    name: "Pro",
    price: "$99.99",
    period: "/month",
    features: [
      "Everything in Basic",
      "Custom subdomain (yourname.metatron.id)",
      "White-label network portal",
      "Unlimited IPFS snapshots — linked to your NFT",
      "API access for CRM integration",
      "Dedicated onboarding",
    ],
    cta: "Upgrade to Pro",
  },
];

export default function ConnectorSubscriptionPage() {
  const { token, loading } = useAuth("INTERMEDIARY");
  const [profile, setProfile] = useState<{ connector_tier?: string; ipfs_cid?: string } | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const res = await fetch(`${API_BASE}/connector-profile`, { headers: authJsonHeaders(token) });
    if (res.ok) setProfile(await res.json());
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading)
    return (
      <div className="flex min-h-[calc(100vh-72px)] items-center justify-center">
        <p className="text-sm text-[#8888a0]">Loading…</p>
      </div>
    );
  if (!token) return null;

  const currentTier = profile?.connector_tier ?? "free";

  return (
    <div className="flex-1 px-6 py-8 max-w-4xl">
      <h1 className="text-xl font-semibold text-[#e8e8ed] mb-1">Subscription</h1>
      <p className="text-sm text-[#8888a0] mb-8">
        Current plan: <span className="text-[#6c5ce7] font-medium capitalize">{currentTier}</span>
        {profile?.ipfs_cid && (
          <span className="ml-4 text-xs font-mono text-[#8888a0]">
            IPFS:{" "}
            <a
              href={`https://ipfs.io/ipfs/${profile.ipfs_cid}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#6c5ce7] hover:underline"
            >
              {profile.ipfs_cid.slice(0, 20)}…
            </a>
          </span>
        )}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {TIERS.map((tier) => {
          const isCurrent = tier.id === currentTier;
          return (
            <div
              key={tier.id}
              className={[
                "rounded-xl p-5 border flex flex-col gap-4",
                isCurrent
                  ? "border-[#6c5ce7] bg-[rgba(108,92,231,0.08)]"
                  : "border-[rgba(255,255,255,0.06)] bg-[#16161f]",
              ].join(" ")}
            >
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-semibold text-[#e8e8ed]">{tier.name}</p>
                  {isCurrent && (
                    <span className="text-[10px] font-mono uppercase tracking-wide text-[#6c5ce7] bg-[rgba(108,92,231,0.15)] px-2 py-0.5 rounded-full">
                      Current
                    </span>
                  )}
                </div>
                <p className="text-2xl font-bold text-[#e8e8ed]">
                  {tier.price}
                  <span className="text-sm font-normal text-[#8888a0]">{tier.period}</span>
                </p>
              </div>
              <ul className="space-y-2 flex-1">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-xs text-[#8888a0]">
                    <span className="text-[#6c5ce7] mt-0.5">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              {tier.cta && !isCurrent && (
                <a
                  href={`mailto:contact@metatron.id?subject=Connector ${tier.name} subscription request`}
                  className="block w-full text-center px-4 py-2 bg-[#6c5ce7] hover:bg-[#7d6ff0] text-white rounded-xl text-sm font-medium"
                >
                  {tier.cta}
                </a>
              )}
              {tier.cta && isCurrent && (
                <a
                  href="mailto:contact@metatron.id?subject=Manage my connector subscription"
                  className="block w-full text-center px-4 py-2 bg-[rgba(255,255,255,0.04)] text-[#8888a0] rounded-xl text-sm"
                >
                  Manage subscription
                </a>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-6 text-xs text-[#8888a0]">
        Subscriptions are billed in USDC via Sphere Pay. To upgrade, email{" "}
        <a href="mailto:contact@metatron.id" className="text-[#6c5ce7]">
          contact@metatron.id
        </a>{" "}
        — payment links will be sent directly. Automated billing coming soon.
      </p>
    </div>
  );
}
