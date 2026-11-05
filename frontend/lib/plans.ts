/** Plan names and feature lists per role, shown in the upgrade popup and on the billing page. */
export type PlanRole = "STARTUP" | "INVESTOR" | "INTERMEDIARY";

export const PLAN_COPY: Record<PlanRole, { basicName: string; basicFeatures: string[]; proName: string; proFeatures: string[]; hasPro: boolean }> = {
  STARTUP: {
    basicName: "Basic for Founders",
    // Only what's built and enforced today; same lists as app/pricing/page.tsx.
    basicFeatures: [
      "Everything in Free",
      "200 Kevin messages/day",
      "10 investor matches/week",
      "Kevin fills in your profile from your deck",
      "Full Angel Score breakdown",
    ],
    proName: "Pro for Founders",
    proFeatures: [
      "Everything in Basic",
      "Unlimited Kevin messages",
      "25 investor matches/week",
      "Call recording + AI analysis",
    ],
    hasPro: true,
  },
  INVESTOR: {
    basicName: "Basic for Investors",
    basicFeatures: [
      "Everything in Free",
      "200 Kevin messages/day",
      "10 founder matches/week",
    ],
    proName: "Pro for Investors",
    proFeatures: [
      "Everything in Basic",
      "Unlimited Kevin messages",
      "25 founder matches/week",
      "Call recording + AI analysis",
    ],
    hasPro: true,
  },
  INTERMEDIARY: {
    basicName: "Basic for Connectors",
    basicFeatures: [
      "Unlimited contacts",
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
