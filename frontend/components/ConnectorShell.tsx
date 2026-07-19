"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  IconCreditCard,
  IconLayoutDashboard,
  IconNetwork,
  IconRobot,
  IconSettings,
  IconUserCircle,
  IconUsersPlus,
} from "@tabler/icons-react";
import { API_BASE, authJsonHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import DashboardChrome, { type ChromeNavItem } from "@/components/DashboardChrome";

const FREE_NAV = [
  { href: "/connector", label: "Dashboard", icon: IconLayoutDashboard },
  { href: "/connector/kevin", label: "Chat with Kevin", icon: IconRobot },
  { href: "/connector/profile", label: "Profile Settings", icon: IconUserCircle },
  { href: "/connector/network", label: "My Network", icon: IconNetwork },
];

export default function ConnectorShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
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
        if (!cancelled) setIsPaid(data.connector_tier === "paid");
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

  const navItems: ChromeNavItem[] = FREE_NAV.map((item) => ({
    key: item.href,
    href: item.href,
    label: item.label,
    icon: item.icon,
    kind: "link",
  }));

  navItems.push(
    isPaid
      ? {
          key: "/connector/introductions",
          href: "/connector/introductions",
          label: "Introductions",
          icon: IconUsersPlus,
          kind: "link",
        }
      : {
          key: "introductions-locked",
          label: "Introductions",
          icon: IconUsersPlus,
          kind: "locked",
          onClick: () => router.push("/connector/settings/subscription"),
        },
  );

  const footerItems: ChromeNavItem[] = [
    {
      key: "/connector/settings/subscription",
      href: "/connector/settings/subscription",
      label: "Subscription",
      icon: IconCreditCard,
      kind: "link",
    },
    {
      key: "/connector/settings",
      href: "/connector/settings",
      label: "Account Settings",
      icon: IconSettings,
      kind: "link",
    },
  ];

  return (
    <DashboardChrome
      roleLabel="Connector"
      pathname={pathname}
      navItems={navItems}
      footerItems={footerItems}
    >
      {children}
    </DashboardChrome>
  );
}
