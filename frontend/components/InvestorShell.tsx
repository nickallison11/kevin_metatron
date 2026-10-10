"use client";

import { usePathname } from "next/navigation";
import { type ReactNode } from "react";
import {
  IconArrowsExchange,
  IconBuilding,
  IconCreditCard,
  IconFileText,
  IconHeadset,
  IconLayoutDashboard,
  IconRobot,
  IconSettings,
  IconUserCircle,
} from "@tabler/icons-react";
import { useAuth } from "@/lib/auth";
import { useIntroRequestCount } from "@/lib/useIntroRequestCount";
import DashboardChrome, { type ChromeNavGroup } from "@/components/DashboardChrome";

// Portfolio was a locked placeholder for a page that doesn't exist; it comes
// back to the nav when that page is built.
export default function InvestorShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { token, loading } = useAuth("INVESTOR");
  const requests = useIntroRequestCount(token);

  if (loading) {
    return (
      <div className="flex min-h-[calc(100vh-72px)] items-center justify-center">
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      </div>
    );
  }

  if (!token) return null;

  const groups: ChromeNavGroup[] = [
    {
      title: "Home",
      items: [
        { key: "/investor", href: "/investor", label: "Dashboard", icon: IconLayoutDashboard, kind: "link" },
        { key: "/investor/kevin", href: "/investor/kevin", label: "Chat with Kevin", icon: IconRobot, kind: "link" },
        { key: "/investor/profile", href: "/investor/profile", label: "Investor Profile", icon: IconUserCircle, kind: "link" },
      ],
    },
    {
      title: "Deal flow",
      items: [
        { key: "/investor/matches", href: "/investor/matches", label: "Matches", icon: IconArrowsExchange, kind: "link", badge: requests },
        { key: "/investor/startups", href: "/investor/startups", label: "Browse Startups", icon: IconBuilding, kind: "link", matchPrefix: true },
        { key: "/investor/memos", href: "/investor/memos", label: "Memos", icon: IconFileText, kind: "link" },
        { key: "/investor/calls", href: "/investor/calls", label: "Call Intelligence", icon: IconHeadset, kind: "link" },
      ],
    },
    {
      title: "Account",
      items: [
        { key: "/investor/settings/subscription", href: "/investor/settings/subscription", label: "Subscription", icon: IconCreditCard, kind: "link", matchPrefix: true },
        { key: "/investor/settings", href: "/investor/settings", label: "Settings", icon: IconSettings, kind: "link" },
      ],
    },
  ];

  return (
    <DashboardChrome roleLabel="Investor" pathname={pathname} groups={groups}>
      {children}
    </DashboardChrome>
  );
}
