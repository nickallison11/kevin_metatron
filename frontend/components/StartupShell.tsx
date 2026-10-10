"use client";

import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import {
  IconArrowsExchange,
  IconCreditCard,
  IconHeadset,
  IconLayoutDashboard,
  IconRobot,
  IconSettings,
  IconUserCircle,
  IconUsers,
} from "@tabler/icons-react";
import { useAuth } from "@/lib/auth";
import { useIntroRequestCount } from "@/lib/useIntroRequestCount";
import DashboardChrome, { type ChromeNavGroup, type ChromeNavItem } from "@/components/DashboardChrome";

export default function StartupShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { token, isPro, loading } = useAuth();
  const requests = useIntroRequestCount(token);

  if (loading) {
    return (
      <div className="flex min-h-[calc(100vh-72px)] items-center justify-center">
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      </div>
    );
  }

  if (!token) return null;

  // Call Intelligence needs a paid plan (Basic or Pro).
  const calls: ChromeNavItem = isPro
    ? { key: "/startup/calls", href: "/startup/calls", label: "Call Intelligence", icon: IconHeadset, kind: "link" }
    : { key: "calls-locked", label: "Call Intelligence", icon: IconHeadset, kind: "locked", onClick: () => router.push("/pricing") };

  const groups: ChromeNavGroup[] = [
    {
      title: "Home",
      items: [
        { key: "/startup", href: "/startup", label: "Dashboard", icon: IconLayoutDashboard, kind: "link" },
        { key: "/startup/kevin", href: "/startup/kevin", label: "Chat with Kevin", icon: IconRobot, kind: "link" },
        { key: "/startup/profile", href: "/startup/profile", label: "Startup Profile", icon: IconUserCircle, kind: "link" },
      ],
    },
    {
      title: "Fundraise",
      items: [
        { key: "/startup/matches", href: "/startup/matches", label: "Matches", icon: IconArrowsExchange, kind: "link", badge: requests },
        { key: "/startup/investors", href: "/startup/investors", label: "Browse Investors", icon: IconUsers, kind: "link", matchPrefix: true },
        calls,
      ],
    },
    {
      title: "Account",
      items: [
        { key: "/startup/settings/subscription", href: "/startup/settings/subscription", label: "Subscription", icon: IconCreditCard, kind: "link", matchPrefix: true },
        { key: "/startup/settings", href: "/startup/settings", label: "Settings", icon: IconSettings, kind: "link" },
      ],
    },
  ];

  return (
    <DashboardChrome roleLabel="Founder" pathname={pathname} groups={groups}>
      {children}
    </DashboardChrome>
  );
}
