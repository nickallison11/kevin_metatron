/** Plan names and feature lists per role, shown in the upgrade popup and on the billing page. */
export type PlanRole = "STARTUP" | "INVESTOR" | "INTERMEDIARY";

export const PLAN_COPY: Record<PlanRole, { basicName: string; basicFeatures: string[]; proName: string; proFeatures: string[]; hasPro: boolean }> = {
  STARTUP: {
    basicName: "Basic for Founders",
    basicFeatures: [
      "Everything in Free",
      "Kevin AI chat (200 msg/day)",
      "Call recording + AI analysis",
      "10 investor matches/week",
      "Permanent IPFS deck storage",
      "Kevin extracts pitch data from deck",
    ],
    proName: "Pro for Founders",
    proFeatures: [
      "Everything in Basic",
      "Unlimited Kevin messages + matches",
      "Private encrypted IPFS deck",
      "Full Virtual Data Room",
      "Custom AI backend",
      "Custom subdomain (startup.metatron.id)",
      "Embeddable widget",
    ],
    hasPro: true,
  },
  INVESTOR: {
    basicName: "Basic for Investors",
    basicFeatures: [
      "Full deal-flow visibility",
      "Kevin match feed (unlimited)",
      "Pipeline stage management",
      "Investment memo generation",
      "Investor profile on metatron",
    ],
    proName: "Pro for Investors",
    proFeatures: [
      "Everything in Basic",
      "Advanced portfolio analytics",
      "Custom deal-flow workflows",
      "White-label investor profile",
      "Priority Kevin AI access",
    ],
    hasPro: true,
  },
  INTERMEDIARY: {
    basicName: "Basic for Connectors",
    basicFeatures: [
      "Unlimited contacts",
      "50 enrichment credits/month",
      "IPFS network storage",
      "Introductions tracker",
      "Referral programme",
    ],
    proName: "Pro for Connectors",
    proFeatures: [
      "Everything in Basic",
      "Custom enrichment data sources",
      "White-label network exports",
      "Team seats",
      "Priority enrichment queue",
    ],
    // The backend has no connector Pro tier yet.
    hasPro: false,
  },
};
