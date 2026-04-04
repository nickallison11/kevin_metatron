"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth";

const NAV = [
  { href: "/investor", label: "Dashboard" },
  { href: "/investor/profile", label: "Profile" },
  { href: "/investor/deal-flow", label: "Deal Flow" },
  { href: "/investor/watchlist", label: "Watchlist" },
];

export default function InvestorShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { token, isPro, loading } = useAuth("INVESTOR");

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
      href === "/investor"
        ? pathname === "/investor"
        : pathname.startsWith(href);
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
        <p className="font-mono text-[10px] uppercase tracking-[2px] text-[var(--text-muted)] px-3 mb-3">
          Investor
        </p>
        {NAV.map((item) => (
          <NavLink key={item.href} href={item.href} label={item.label} />
        ))}
        {!isPro && (
          <button
            type="button"
            onClick={() => router.push("/pricing")}
            className="cursor-pointer rounded-[var(--radius)] px-3 py-2.5 text-sm font-medium text-left text-[var(--text-muted)] opacity-50 bg-transparent hover:opacity-50 hover:bg-transparent flex items-center justify-between"
          >
            Portfolio
            <span className="font-mono text-[9px] uppercase tracking-wider border border-metatron-accent/40 text-metatron-accent px-1.5 py-0.5 rounded">
              Pro
            </span>
          </button>
        )}
        {!isPro && (
          <Link
            href="/pricing"
            className="mx-1 mt-4 rounded-[var(--radius)] border border-metatron-accent/20 bg-metatron-accent/10 px-3 py-2 text-center text-xs font-semibold text-metatron-accent transition-colors hover:bg-metatron-accent/20"
          >
            Upgrade to Pro →
          </Link>
        )}

        <div className="mt-2 border-t border-[var(--border)] pt-2 space-y-1">
          <NavLink href="/investor/settings/subscription" label="Subscription" />
          <NavLink href="/investor/settings" label="Settings" />
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
          {!isPro && (
            <Link
              href="/pricing"
              className="shrink-0 rounded-lg border border-metatron-accent/30 px-3 py-1.5 text-xs text-metatron-accent"
            >
              Upgrade →
            </Link>
          )}
          <Link
            href="/investor/settings/subscription"
            className="shrink-0 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)]"
          >
            Subscription
          </Link>
          <Link
            href="/investor/settings"
            className="shrink-0 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)]"
          >
            Settings
          </Link>
        </div>
        {children}
      </div>
    </div>
  );
}
