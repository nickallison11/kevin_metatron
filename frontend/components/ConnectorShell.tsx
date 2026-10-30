"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  IconBuilding,
  IconGift,
  IconLayoutDashboard,
  IconNetwork,
  IconRobot,
  IconUserCircle,
  IconUsers,
  IconUsersPlus,
} from "@tabler/icons-react";
import { API_BASE, authJsonHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import DashboardChrome, { type ChromeNavGroup, type ChromeNavItem } from "@/components/DashboardChrome";
import { useUpgrade } from "@/components/upgrade/UpgradeProvider";

export default function ConnectorShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { openUpgrade } = useUpgrade();
  const { token, loading } = useAuth("INTERMEDIARY");
  const [isPaid, setIsPaid] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/connector-profile`, {
          headers: authJsonHeaders(token),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { connector_tier?: string | null };
        if (!cancelled) setIsPaid(data.connector_tier === "paid" || data.connector_tier === "connector_basic");
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading) {
    return (
      <div className="flex min-h-[calc(100vh-72px)] items-center justify-center">
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      </div>
    );
  }

  if (!token) return null;

  // Introductions needs a paid connector plan.
  const introductions: ChromeNavItem = isPaid
    ? { key: "/connector/introductions", href: "/connector/introductions", label: "Introductions", icon: IconUsersPlus, kind: "link" }
    : {
        key: "introductions-locked",
        label: "Introductions",
        icon: IconUsersPlus,
        kind: "locked",
        onClick: openUpgrade,
      };

  const groups: ChromeNavGroup[] = [
    {
      title: "Home",
      items: [
        { key: "/connector", href: "/connector", label: "Dashboard", icon: IconLayoutDashboard, kind: "link" },
        { key: "/connector/kevin", href: "/connector/kevin", label: "Connect Kevin", icon: IconRobot, kind: "link" },
        { key: "/connector/profile", href: "/connector/profile", label: "Connector Profile", icon: IconUserCircle, kind: "link" },
      ],
    },
    {
      title: "Network",
      items: [
        { key: "/connector/network", href: "/connector/network", label: "My Network", icon: IconNetwork, kind: "link" },
        introductions,
        { key: "/connector/referrals", href: "/connector/referrals", label: "Referrals", icon: IconGift, kind: "link" },
        { key: "/connector/startups", href: "/connector/startups", label: "Browse Startups", icon: IconBuilding, kind: "link", matchPrefix: true },
        { key: "/connector/investors", href: "/connector/investors", label: "Browse Investors", icon: IconUsers, kind: "link", matchPrefix: true },
      ],
    },
  ];

  return (
    <DashboardChrome roleLabel="Connector" pathname={pathname} groups={groups}>
      {children}
    </DashboardChrome>
  );
}
