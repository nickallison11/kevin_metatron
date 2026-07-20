"use client";

import { usePathname, useRouter } from "next/navigation";
import { type ReactNode } from "react";
import {
  IconArrowsExchange,
  IconBriefcase,
  IconCreditCard,
  IconLayoutDashboard,
  IconRobot,
  IconSettings,
  IconUserCircle,
} from "@tabler/icons-react";
import { useAuth } from "@/lib/auth";
import DashboardChrome, { type ChromeNavItem } from "@/components/DashboardChrome";

const FREE_NAV = [
  { href: "/investor", label: "Dashboard", icon: IconLayoutDashboard },
  { href: "/investor/kevin", label: "Chat with Kevin", icon: IconRobot },
  { href: "/investor/profile", label: "Profile Settings", icon: IconUserCircle },
  { href: "/investor/matches", label: "Startup Matches", icon: IconArrowsExchange },
];

// Portfolio doesn't exist yet, so it's a hard lock for everyone (button, not
// navigable). Kept as a function (not a constant) so a future "tease" state
// — link is navigable but shows an Upgrade badge — is a one-line change.
type LockMode = "none" | "tease" | "hard";
function portfolioLockMode(): LockMode {
  return "hard";
}

export default function InvestorShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { token, loading } = useAuth("INVESTOR");

  if (loading) {
    return (
      <div className="flex min-h-[calc(100vh-72px)] items-center justify-center">
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      </div>
    );
  }

  if (!token) return null;

  const navItems: ChromeNavItem[] = FREE_NAV.map((item) => ({
    key: item.href,
    href: item.href,
    label: item.label,
    icon: item.icon,
    kind: "link",
  }));

  const mode = portfolioLockMode();
  if (mode === "none") {
    navItems.push({
      key: "/investor/portfolio",
      href: "/investor/portfolio",
      label: "Portfolio",
      icon: IconBriefcase,
      kind: "link",
    });
  } else if (mode === "tease") {
    navItems.push({
      key: "/investor/portfolio",
      href: "/investor/portfolio",
      label: "Portfolio",
      icon: IconBriefcase,
      kind: "tease-link",
    });
  } else {
    navItems.push({
      key: "portfolio-locked",
      label: "Portfolio",
      icon: IconBriefcase,
      kind: "locked",
      onClick: () => router.push("/investor/settings/subscription"),
    });
  }

  const footerItems: ChromeNavItem[] = [
    {
      key: "/investor/settings/subscription",
      href: "/investor/settings/subscription",
      label: "Subscription",
      icon: IconCreditCard,
      kind: "link",
    },
    {
      key: "/investor/settings",
      href: "/investor/settings",
      label: "Account Settings",
      icon: IconSettings,
      kind: "link",
    },
  ];

  return (
    <DashboardChrome
      roleLabel="Investor"
      pathname={pathname}
      navItems={navItems}
      footerItems={footerItems}
    >
      {children}
    </DashboardChrome>
  );
}
