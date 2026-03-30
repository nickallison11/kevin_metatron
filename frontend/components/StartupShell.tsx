"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const NAV = [
  { href: "/startup", label: "Dashboard" },
  { href: "/startup/profile", label: "Profile" },
  { href: "/startup/pitches", label: "Pitches" },
  { href: "/startup/calls", label: "Calls" }
];

export default function StartupShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-[calc(100vh-72px)] text-[var(--text)]">
      <aside className="hidden md:flex w-52 shrink-0 flex-col border-r border-[var(--border)] bg-[color-mix(in_srgb,var(--bg-card)_92%,transparent)] px-3 py-6 gap-1">
        <p className="font-mono text-[10px] uppercase tracking-[2px] text-[var(--text-muted)] px-3 mb-3">
          Founder
        </p>
        {NAV.map((item) => {
          const active =
            item.href === "/startup"
              ? pathname === "/startup"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                "rounded-[var(--radius)] px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-metatron-accent/15 text-metatron-accent border border-metatron-accent/25"
                  : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--border)]"
              ].join(" ")}
            >
              {item.label}
            </Link>
          );
        })}
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
        </div>
        {children}
      </div>
    </div>
  );
}
