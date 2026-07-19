"use client";

import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { useMode } from "@/lib/mode";

type IconComponent = ComponentType<{ size?: number | string; stroke?: number | string }>;

/**
 * Shared layout shell for the three role dashboards (Startup/Investor/
 * Connector). Each role's Shell component keeps computing its own nav
 * items and lock/paywall logic exactly as before — this component only
 * owns *how* an already-resolved nav item list is laid out, branching on
 * useMode(): Normal keeps today's labelled sidebar (now with icons too),
 * Advanced collapses it to an icon rail. Both share every colour token and
 * font — only structure/density differs.
 */
export type ChromeNavItem =
  | { key: string; href: string; label: string; icon: IconComponent; kind: "link" }
  | {
      key: string;
      href: string;
      label: string;
      icon: IconComponent;
      kind: "tease-link";
    }
  | {
      key: string;
      label: string;
      icon: IconComponent;
      kind: "locked";
      onClick: () => void;
    };

function isActive(item: ChromeNavItem, pathname: string): boolean {
  return item.kind !== "locked" && pathname === item.href;
}

function NormalLink({ item, active }: { item: ChromeNavItem; active: boolean }) {
  const Icon = item.icon;
  const base =
    "flex w-full items-center gap-2.5 rounded-[var(--radius)] px-3 py-2.5 text-left text-sm font-medium transition-colors";
  const activeCls =
    "border border-metatron-accent/25 bg-metatron-accent/15 text-metatron-accent";
  const inactiveCls =
    "text-[var(--text-muted)] hover:bg-[var(--border)] hover:text-[var(--text)]";

  if (item.kind === "locked") {
    return (
      <button
        type="button"
        onClick={item.onClick}
        className={`${base} cursor-pointer justify-between bg-transparent opacity-50 hover:bg-transparent hover:opacity-50`}
      >
        <span className="flex items-center gap-2.5">
          <Icon size={16} stroke={1.75} />
          {item.label}
        </span>
        <span className="font-sans text-[9px] uppercase tracking-wider border border-metatron-accent/40 text-metatron-accent px-1.5 py-0.5 rounded">
          Upgrade
        </span>
      </button>
    );
  }

  return (
    <Link
      href={item.href}
      className={`${base} ${item.kind === "tease-link" ? "justify-between" : ""} ${active ? activeCls : inactiveCls}`}
    >
      <span className="flex items-center gap-2.5">
        <Icon size={16} stroke={1.75} />
        {item.label}
      </span>
      {item.kind === "tease-link" && (
        <span className="font-sans text-[9px] uppercase tracking-wider border border-metatron-accent/40 text-metatron-accent px-1.5 py-0.5 rounded">
          Upgrade
        </span>
      )}
    </Link>
  );
}

function RailLink({ item, active }: { item: ChromeNavItem; active: boolean }) {
  const Icon = item.icon;
  const base =
    "relative flex h-10 w-10 items-center justify-center rounded-[10px] transition-colors";
  const activeCls = "bg-metatron-accent/15 text-metatron-accent border border-metatron-accent/25";
  const inactiveCls = "text-[var(--text-muted)] hover:bg-[var(--border)] hover:text-[var(--text)]";
  const lockedDot = (item.kind === "tease-link" || item.kind === "locked") && (
    <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-metatron-accent" aria-hidden />
  );

  if (item.kind === "locked") {
    return (
      <button
        type="button"
        onClick={item.onClick}
        title={`${item.label} — Upgrade`}
        aria-label={`${item.label} (locked, upgrade required)`}
        className={`${base} ${inactiveCls} opacity-60`}
      >
        <Icon size={18} stroke={1.75} />
        {lockedDot}
      </button>
    );
  }

  return (
    <Link
      href={item.href}
      title={item.kind === "tease-link" ? `${item.label} — Upgrade` : item.label}
      aria-label={item.label}
      className={`${base} ${active ? activeCls : inactiveCls}`}
    >
      <Icon size={18} stroke={1.75} />
      {lockedDot}
    </Link>
  );
}

function MobileLink({ item }: { item: ChromeNavItem }) {
  if (item.kind === "locked") {
    return (
      <button
        type="button"
        onClick={item.onClick}
        className="shrink-0 cursor-pointer rounded-lg border border-metatron-accent/30 px-3 py-1.5 text-xs text-metatron-accent opacity-50"
      >
        {item.label} · Upgrade
      </button>
    );
  }
  return (
    <Link
      href={item.href}
      className={
        item.kind === "tease-link"
          ? "shrink-0 rounded-lg border border-metatron-accent/30 px-3 py-1.5 text-xs text-metatron-accent"
          : "shrink-0 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)]"
      }
    >
      {item.label}
      {item.kind === "tease-link" ? " · Upgrade" : ""}
    </Link>
  );
}

export default function DashboardChrome({
  roleLabel,
  pathname,
  navItems,
  footerItems,
  children,
}: {
  roleLabel: string;
  pathname: string;
  navItems: ChromeNavItem[];
  footerItems: ChromeNavItem[];
  children: ReactNode;
}) {
  const { mode } = useMode();
  const allMobile = [...navItems, ...footerItems];

  if (mode === "advanced") {
    return (
      <div className="flex min-h-[calc(100vh-72px)] text-[var(--text)]">
        <aside className="hidden md:flex w-16 shrink-0 flex-col items-center border-r border-[var(--border)] bg-[color-mix(in_srgb,var(--bg-card)_92%,transparent)] py-6 gap-2">
          <p
            className="mb-1 font-mono text-[9px] uppercase tracking-[1px] text-[var(--text-muted)]"
            title={roleLabel}
          >
            {roleLabel.slice(0, 3)}
          </p>
          {navItems.map((item) => (
            <RailLink key={item.key} item={item} active={isActive(item, pathname)} />
          ))}
          <div className="mt-auto flex flex-col gap-2 border-t border-[var(--border)] pt-3">
            {footerItems.map((item) => (
              <RailLink key={item.key} item={item} active={isActive(item, pathname)} />
            ))}
          </div>
        </aside>
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="md:hidden flex gap-2 px-4 py-3 border-b border-[var(--border)] overflow-x-auto">
            {allMobile.map((item) => (
              <MobileLink key={item.key} item={item} />
            ))}
          </div>
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-72px)] text-[var(--text)]">
      <aside className="hidden md:flex w-52 shrink-0 flex-col border-r border-[var(--border)] bg-[color-mix(in_srgb,var(--bg-card)_92%,transparent)] px-3 py-6 gap-1">
        <p className="font-sans text-[10px] uppercase tracking-[2px] text-[var(--text-muted)] px-3 mb-3">
          {roleLabel}
        </p>
        {navItems.map((item) => (
          <NormalLink key={item.key} item={item} active={isActive(item, pathname)} />
        ))}
        <div className="mt-2 border-t border-[var(--border)] pt-2 space-y-1">
          {footerItems.map((item) => (
            <NormalLink key={item.key} item={item} active={isActive(item, pathname)} />
          ))}
        </div>
      </aside>
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="md:hidden flex gap-2 px-4 py-3 border-b border-[var(--border)] overflow-x-auto">
          {allMobile.map((item) => (
            <MobileLink key={item.key} item={item} />
          ))}
        </div>
        {children}
      </div>
    </div>
  );
}
