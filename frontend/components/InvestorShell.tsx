"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { API_BASE, authJsonHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const FREE_NAV = [
  { href: "/investor", label: "Dashboard" },
  { href: "/investor/profile", label: "Profile Settings" },
  { href: "/investor/matches", label: "Startup Matches" },
  { href: "/investor/watchlist", label: "Watchlist" },
];

const LOCKED_NAV = [
  { href: "/investor/deal-flow", label: "Deal Flow" },
  { href: "/investor/calls", label: "Call Intelligence" },
  { href: "/investor/portfolio", label: "Portfolio" },
];

export default function InvestorShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { token, isPro, loading } = useAuth("INVESTOR");
  const [isPaid, setIsPaid] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/investor-profile`, {
          headers: authJsonHeaders(token),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { investor_tier?: string | null };
        if (!cancelled) setIsPaid(data.investor_tier === "basic");
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

  // Portfolio doesn't exist yet, so it's a hard lock for everyone (button, not navigable).
  // Deal Flow is "teased" for free users — still navigable, but shows the Upgrade badge.
  // Call Intelligence is "teased" for non-paid investors (gated by investor_tier basic).
  type LockMode = "none" | "tease" | "hard";
  const lockMode = (href: string): LockMode => {
    if (href === "/investor/portfolio") return "hard";
    if (href === "/investor/deal-flow") return isPro ? "none" : "tease";
    if (href === "/investor/calls") return isPaid ? "none" : "tease";
    return "none";
  };

  function NavLink({ href, label }: { href: string; label: string }) {
    const active =
      href === "/investor"
        ? pathname === "/investor"
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
          Investor
        </p>
        {FREE_NAV.map((item) => (
          <NavLink key={item.href} href={item.href} label={item.label} />
        ))}
        {LOCKED_NAV.map((item) => {
          const mode = lockMode(item.href);
          if (mode === "none") {
            return (
              <NavLink key={item.href} href={item.href} label={item.label} />
            );
          }
          if (mode === "tease") {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  "block w-full rounded-[var(--radius)] px-3 py-2.5 text-left text-sm font-medium transition-colors flex items-center justify-between",
                  active
                    ? "border border-metatron-accent/25 bg-metatron-accent/15 text-metatron-accent"
                    : "text-[var(--text-muted)] hover:bg-[var(--border)] hover:text-[var(--text)]",
                ].join(" ")}
              >
                {item.label}
                <span className="font-sans text-[9px] uppercase tracking-wider border border-metatron-accent/40 text-metatron-accent px-1.5 py-0.5 rounded">
                  Upgrade
                </span>
              </Link>
            );
          }
          return (
            <button
              key={item.href}
              type="button"
              onClick={() => router.push("/investor/settings/subscription")}
              className="cursor-pointer rounded-[var(--radius)] px-3 py-2.5 text-sm font-medium text-left text-[var(--text-muted)] opacity-50 bg-transparent hover:opacity-50 hover:bg-transparent flex items-center justify-between"
            >
              {item.label}
              <span className="font-sans text-[9px] uppercase tracking-wider border border-metatron-accent/40 text-metatron-accent px-1.5 py-0.5 rounded">
                Upgrade
              </span>
            </button>
          );
        })}

        <div className="mt-2 border-t border-[var(--border)] pt-2 space-y-1">
          <NavLink href="/investor/settings/subscription" label="Subscription" />
          <NavLink href="/investor/settings" label="Account Settings" />
        </div>
      </aside>
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="md:hidden flex gap-2 px-4 py-3 border-b border-[var(--border)] overflow-x-auto">
          {FREE_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="shrink-0 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)]"
            >
              {item.label}
            </Link>
          ))}
          {LOCKED_NAV.map((item) => {
            const mode = lockMode(item.href);
            if (mode === "none") {
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="shrink-0 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)]"
                >
                  {item.label}
                </Link>
              );
            }
            if (mode === "tease") {
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="shrink-0 rounded-lg border border-metatron-accent/30 px-3 py-1.5 text-xs text-metatron-accent"
                >
                  {item.label} · Upgrade
                </Link>
              );
            }
            return (
              <button
                key={item.href}
                type="button"
                onClick={() => router.push("/investor/settings/subscription")}
                className="shrink-0 cursor-pointer rounded-lg border border-metatron-accent/30 px-3 py-1.5 text-xs text-metatron-accent opacity-50"
              >
                {item.label} · Upgrade
              </button>
            );
          })}
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
            Account Settings
          </Link>
        </div>
        {children}
      </div>
    </div>
  );
}
