"use client";

import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import {
  IconArrowsExchange,
  IconCreditCard,
  IconFileText,
  IconHeadset,
  IconLayoutDashboard,
  IconRobot,
  IconSettings,
  IconUserCircle,
} from "@tabler/icons-react";
import { useAuth } from "@/lib/auth";
import DashboardChrome, { type ChromeNavItem } from "@/components/DashboardChrome";

const FREE_NAV = [
  { href: "/startup", label: "Dashboard", icon: IconLayoutDashboard },
  { href: "/startup/kevin", label: "Chat with Kevin", icon: IconRobot },
  { href: "/startup/pitches", label: "Pitch data", icon: IconFileText },
  { href: "/startup/matches", label: "Investor Matches", icon: IconArrowsExchange },
];

const PRO_NAV = [
  { href: "/startup", label: "Dashboard", icon: IconLayoutDashboard },
  { href: "/startup/kevin", label: "Chat with Kevin", icon: IconRobot },
  { href: "/startup/pitches", label: "Pitch data", icon: IconFileText },
  { href: "/startup/matches", label: "Investor Matches", icon: IconArrowsExchange },
  { href: "/startup/calls", label: "Call Intelligence", icon: IconHeadset },
  { href: "/startup/profile", label: "Profile Settings", icon: IconUserCircle },
];

export default function StartupShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { token, isPro, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-[calc(100vh-72px)] items-center justify-center">
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      </div>
    );
  }

  if (!token) return null;

  const navSource = isPro ? PRO_NAV : FREE_NAV;
  const navItems: ChromeNavItem[] = navSource.map((item) => ({
    key: item.href,
    href: item.href,
    label: item.label,
    icon: item.icon,
    kind: "link",
  }));

  if (!isPro) {
    navItems.push({
      key: "call-intelligence-locked",
      label: "Call Intelligence",
      icon: IconHeadset,
      kind: "locked",
      onClick: () => router.push("/pricing"),
    });
    navItems.push({
      key: "/startup/profile",
      href: "/startup/profile",
      label: "Profile Settings",
      icon: IconUserCircle,
      kind: "link",
    });
  }

  const footerItems: ChromeNavItem[] = [
    {
      key: "/startup/settings/subscription",
      href: "/startup/settings/subscription",
      label: "Subscription",
      icon: IconCreditCard,
      kind: "link",
    },
    {
      key: "/startup/settings",
      href: "/startup/settings",
      label: "Account Settings",
      icon: IconSettings,
      kind: "link",
    },
  ];

  return (
    <DashboardChrome
      roleLabel="Founder"
      pathname={pathname}
      navItems={navItems}
      footerItems={footerItems}
    >
      {children}
    </DashboardChrome>
  );
}
