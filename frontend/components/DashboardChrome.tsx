"use client";

import Link from "next/link";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand } from "@tabler/icons-react";

type IconComponent = ComponentType<{ size?: number | string; stroke?: number | string }>;

/**
 * Shared layout shell for the three role dashboards (Startup/Investor/
 * Connector). Each role's Shell component keeps computing its own nav
 * items and lock/paywall logic exactly as before — this component owns
 * the sidebar's expanded/collapsed state and rendering. Collapsing only
 * changes the sidebar's own width and whether labels are shown; it has no
 * effect on page content.
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

function NavRow({
  item,
  active,
  expanded,
}: {
  item: ChromeNavItem;
  active: boolean;
  expanded: boolean;
}) {
  const Icon = item.icon;
  const lockedDot = (item.kind === "tease-link" || item.kind === "locked") && (
    <span
      className={
        expanded
          ? "ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-metatron-accent"
          : "absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-metatron-accent"
      }
      aria-hidden
    />
  );
  const base = expanded
    ? "relative flex h-10 w-full items-center gap-2.5 rounded-[var(--radius)] px-3 text-left text-sm font-medium transition-colors"
    : "relative flex h-10 w-10 items-center justify-center rounded-[10px] transition-colors";
  const activeCls = "border border-metatron-accent/25 bg-metatron-accent/15 text-metatron-accent";
  const inactiveCls =
    "text-[var(--text-muted)] hover:bg-[var(--border)] hover:text-[var(--text)]";

  if (item.kind === "locked") {
    return (
      <button
        type="button"
        onClick={item.onClick}
        title={expanded ? undefined : `${item.label} — Upgrade`}
        aria-label={expanded ? undefined : `${item.label} (locked, upgrade required)`}
        className={`${base} ${inactiveCls} cursor-pointer opacity-60`}
      >
        <Icon size={18} stroke={1.75} />
        {expanded && item.label}
        {lockedDot}
      </button>
    );
  }

  return (
    <Link
      href={item.href}
      title={expanded ? undefined : item.kind === "tease-link" ? `${item.label} — Upgrade` : item.label}
      aria-label={expanded ? undefined : item.label}
      className={`${base} ${active ? activeCls : inactiveCls}`}
    >
      <Icon size={18} stroke={1.75} />
      {expanded && item.label}
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
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("metatron_sidebar_expanded");
    if (stored === "0") setExpanded(false);
  }, []);

  function toggle() {
    setExpanded((e) => {
      const next = !e;
      localStorage.setItem("metatron_sidebar_expanded", next ? "1" : "0");
      return next;
    });
  }

  const allMobile = [...navItems, ...footerItems];
  const allDesktop = [...navItems, ...footerItems];

  return (
    <div className="flex min-h-[calc(100vh-72px)] text-[var(--text)]">
      <aside
        className={
          expanded
            ? "hidden md:flex w-52 shrink-0 flex-col bg-[var(--bg)] px-3 py-4 gap-1"
            : "hidden md:flex w-16 shrink-0 flex-col items-center bg-[var(--bg)] py-4 gap-1"
        }
      >
        <button
          type="button"
          onClick={toggle}
          title={`${roleLabel} menu — ${expanded ? "collapse" : "expand"}`}
          aria-label={expanded ? "Collapse menu" : "Expand menu"}
          className={
            expanded
              ? "mb-2 flex h-10 w-10 items-center justify-center self-start rounded-[10px] text-[var(--text-muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--text)]"
              : "mb-2 flex h-10 w-10 items-center justify-center rounded-[10px] text-[var(--text-muted)] transition-colors hover:bg-[var(--border)] hover:text-[var(--text)]"
          }
        >
          {expanded ? (
            <IconLayoutSidebarLeftCollapse size={18} stroke={1.75} />
          ) : (
            <IconLayoutSidebarLeftExpand size={18} stroke={1.75} />
          )}
        </button>
        {allDesktop.map((item) => (
          <NavRow key={item.key} item={item} active={isActive(item, pathname)} expanded={expanded} />
        ))}
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
