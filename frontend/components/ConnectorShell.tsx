"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth";

const NAV = [
  { href: "/connector", label: "Dashboard" },
  { href: "/connector/profile", label: "Profile Settings" },
  { href: "/connector/network", label: "My Network" },
  { href: "/connector/introductions", label: "Introductions" },
  { href: "/connector/referrals", label: "Referrals" },
];

export default function ConnectorShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { token, loading } = useAuth("INTERMEDIARY");

  if (loading) {
    return (
      <div className="flex min-h-[calc(100vh-72px)] items-center justify-center">
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      </div>
    );
  }

  if (!token) return null;

  function NavLink({ href, label }: { href: string; label: string }) {
    const active =
      href === "/connector" || href === "/connector/settings"
        ? pathname === href
        : pathname === href;
    return (
      <Link
        href={href}
        className={[
          "block w-full rounded-[var(--radius)] px-3 py-2.5 text-left text-sm font-medium transition-colors",
          active
            ? "border border-metatron-accent/25 bg-metatron-accent/15 text-metatron-accent"
            : "text-[var(--text-muted)] hover:bg-[var(--border)] hover:text-[var(--text)]",
        ].join(" ")}
      >
        {label}
      </Link>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-72px)] text-[var(--text)]">
      <aside className="hidden md:flex w-52 shrink-0 flex-col border-r border-[var(--border)] bg-[color-mix(in_srgb,var(--bg-card)_92%,transparent)] px-3 py-6 gap-1">
        <p className="font-sans text-[10px] uppercase tracking-[2px] text-[var(--text-muted)] px-3 mb-3">
          Connector
        </p>
        {NAV.map((item) => (
          <NavLink key={item.href} href={item.href} label={item.label} />
        ))}

        <div className="mt-2 border-t border-[var(--border)] pt-2 space-y-1">
          <NavLink href="/connector/settings/subscription" label="Subscription" />
          <NavLink href="/connector/settings" label="Account Settings" />
        </div>
      </aside>
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="md:hidden flex gap-2 px-4 py-3 border-b border-[var(--border)] overflow-x-auto">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="shrink-0 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)]"
            >
              {item.label}
            </Link>
          ))}
          <Link
            href="/connector/settings/subscription"
            className="shrink-0 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)]"
          >
            Subscription
          </Link>
          <Link
            href="/connector/settings"
            className="shrink-0 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)]"
          >
            Account Settings
          </Link>
        </div>
        {children}
      </div>
    </div>
  );
}
