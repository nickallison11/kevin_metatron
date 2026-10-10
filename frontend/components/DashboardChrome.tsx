"use client";

import Link from "next/link";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand } from "@tabler/icons-react";
import { API_BASE, authHeaders } from "@/lib/api";
import { getAccessToken } from "@/lib/tokenStore";
import type { MeResponse } from "@/lib/me";

type IconComponent = ComponentType<{ size?: number | string; stroke?: number | string }>;

/**
 * Shared layout shell for the three role dashboards (Startup/Investor/
 * Connector). Each role's Shell builds its own grouped nav (and keeps its
 * own lock/paywall logic); this component owns the sidebar's rendering,
 * its expanded/collapsed state, and the account card. Collapsing only
 * changes the sidebar's own width and whether labels are shown.
 */
type BaseItem = {
  key: string;
  label: string;
  icon: IconComponent;
  /** Count shown as a pill, e.g. intro requests waiting. Hidden when 0. */
  badge?: number;
  /** Also mark active on sub-routes (e.g. /startup/investors/<id>). */
  matchPrefix?: boolean;
};
export type ChromeNavItem =
  | (BaseItem & { href: string; kind: "link" })
  | (BaseItem & { href: string; kind: "tease-link" })
  | (BaseItem & { kind: "locked"; onClick: () => void });

export type ChromeNavGroup = { title: string; items: ChromeNavItem[] };

function isActive(item: ChromeNavItem, pathname: string): boolean {
  if (item.kind === "locked") return false;
  if (pathname === item.href) return true;
  return Boolean(item.matchPrefix) && pathname.startsWith(item.href + "/");
}

function Badge({ n, floating }: { n: number; floating?: boolean }) {
  return (
    <span
      className={
        floating
          ? "absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-metatron-accent px-1 text-[10px] font-semibold text-white"
          : "ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-metatron-accent px-1.5 text-[11px] font-semibold text-white"
      }
    >
      {n}
    </span>
  );
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
  const badge = item.badge && item.badge > 0 ? <Badge n={item.badge} floating={!expanded} /> : null;
  const base = expanded
    ? "relative flex h-10 w-full items-center gap-2.5 rounded-[10px] px-3 text-left text-sm transition-colors"
    : "relative flex h-10 w-10 items-center justify-center rounded-[10px] transition-colors";
  const activeCls = "bg-metatron-accent/15 font-semibold text-[var(--text)] [&>svg]:text-metatron-accent";
  const inactiveCls = "font-medium text-[var(--text-muted)] hover:bg-[var(--overlay-4)] hover:text-[var(--text)]";

  if (item.kind === "locked") {
    return (
      <button
        type="button"
        onClick={item.onClick}
        title={expanded ? undefined : `${item.label} â€” Upgrade`}
        aria-label={expanded ? `${item.label} (upgrade required)` : `${item.label} (locked, upgrade required)`}
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
      title={expanded ? undefined : item.kind === "tease-link" ? `${item.label} â€” Upgrade` : item.label}
      aria-label={expanded ? undefined : item.label}
      aria-current={active ? "page" : undefined}
      className={`${base} ${active ? activeCls : inactiveCls}`}
    >
      <Icon size={18} stroke={1.75} />
      {expanded && item.label}
      {badge}
      {!badge && lockedDot}
    </Link>
  );
}

function MobileLink({ item, active }: { item: ChromeNavItem; active: boolean }) {
  if (item.kind === "locked") {
    return (
      <button
        type="button"
        onClick={item.onClick}
        className="shrink-0 cursor-pointer rounded-lg border border-metatron-accent/30 px-3 py-1.5 text-xs text-metatron-accent opacity-50"
      >
        {item.label} Â· Upgrade
      </button>
    );
  }
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "shrink-0 rounded-lg bg-metatron-accent/15 px-3 py-1.5 text-xs font-semibold text-[var(--text)]"
          : item.kind === "tease-link"
            ? "shrink-0 rounded-lg border border-metatron-accent/30 px-3 py-1.5 text-xs text-metatron-accent"
            : "shrink-0 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)]"
      }
    >
      {item.label}
      {item.kind === "tease-link" ? " Â· Upgrade" : ""}
      {item.badge ? ` Â· ${item.badge}` : ""}
    </Link>
  );
}

function initials(s: string): string {
  return (
    s
      .replace(/[^A-Za-z ]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "Â·"
  );
}

/** Name + plan for the account card at the bottom of the sidebar. */
function useAccount(roleLabel: string): { name: string; plan: string } | null {
  const [me, setMe] = useState<MeResponse | null>(null);
  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    let cancelled = false;
    fetch(`${API_BASE}/auth/me`, { headers: authHeaders(token) })
      .then((r) => (r.ok ? (r.json() as Promise<MeResponse>) : null))
      .then((d) => {
        if (!cancelled && d) setMe(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  if (!me) return null;
  const full = [me.first_name, me.last_name].filter(Boolean).join(" ").trim();
  const tier = me.is_pro ? "Pro" : me.is_basic ? "Basic" : "Free";
  return { name: full || me.email, plan: `${roleLabel} Â· ${tier}` };
}

export default function DashboardChrome({
  roleLabel,
  pathname,
  groups,
  children,
}: {
  roleLabel: string;
  pathname: string;
  groups: ChromeNavGroup[];
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  const account = useAccount(roleLabel);

  useEffect(() => {
    try {
      if (localStorage.getItem("metatron_sidebar_expanded") === "0") setExpanded(false);
    } catch {
      /* storage blocked */
    }
  }, []);

  function toggle() {
    setExpanded((e) => {
      const next = !e;
      try {
        localStorage.setItem("metatron_sidebar_expanded", next ? "1" : "0");
      } catch {
        /* storage blocked */
      }
      return next;
    });
  }

  const allItems = groups.flatMap((g) => g.items);

  return (
    <div className="flex min-h-[calc(100vh-72px)] text-[var(--text)]">
      <aside
        aria-label={`${roleLabel} menu`}
        className={
          expanded
            ? "sticky top-[82px] hidden h-[calc(100vh-82px)] w-60 shrink-0 flex-col gap-5 overflow-y-auto border-r border-[var(--border)] bg-[var(--bg)] px-3 py-4 md:flex"
            : "sticky top-[82px] hidden h-[calc(100vh-82px)] w-16 shrink-0 flex-col items-center gap-5 overflow-y-auto border-r border-[var(--border)] bg-[var(--bg)] py-4 md:flex"
        }
      >
        <div className={expanded ? "flex items-center justify-between px-1" : "flex flex-col items-center"}>
          {expanded && (
            <span className="rounded-md bg-[var(--overlay-6)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
              {roleLabel}
            </span>
          )}
          <button
            type="button"
            onClick={toggle}
            title={`${roleLabel} menu â€” ${expanded ? "collapse" : "expand"}`}
            aria-label={expanded ? "Collapse menu" : "Expand menu"}
            className="flex h-9 w-9 items-center justify-center rounded-[10px] text-[var(--text-muted)] transition-colors hover:bg-[var(--overlay-4)] hover:text-[var(--text)]"
          >
            {expanded ? (
              <IconLayoutSidebarLeftCollapse size={18} stroke={1.75} />
            ) : (
              <IconLayoutSidebarLeftExpand size={18} stroke={1.75} />
            )}
          </button>
        </div>

        {groups.map((g) => (
          <nav key={g.title} aria-label={g.title} className={expanded ? "flex flex-col gap-0.5" : "flex flex-col items-center gap-1"}>
            {expanded ? (
              <span className="px-3 pb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)] opacity-80">
                {g.title}
              </span>
            ) : (
              <span className="mb-1 h-px w-6 bg-[var(--border)]" aria-hidden />
            )}
            {g.items.map((item) => (
              <NavRow key={item.key} item={item} active={isActive(item, pathname)} expanded={expanded} />
            ))}
          </nav>
        ))}

        {account && (
          <div
            className={
              expanded
                ? "mt-auto flex items-center gap-2.5 rounded-[10px] bg-[var(--overlay-3)] px-2.5 py-2.5"
                : "mt-auto flex justify-center"
            }
            title={expanded ? undefined : `${account.name} â€” ${account.plan}`}
          >
            <span
              aria-hidden
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-metatron-accent/20 text-xs font-semibold text-metatron-accent"
            >
              {initials(account.name)}
            </span>
            {expanded && (
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[13px] font-semibold">{account.name}</span>
                <span className="truncate text-xs text-[var(--text-muted)]">{account.plan}</span>
              </span>
            )}
          </div>
        )}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex gap-2 overflow-x-auto border-b border-[var(--border)] px-4 py-3 md:hidden">
          {allItems.map((item) => (
            <MobileLink key={item.key} item={item} active={isActive(item, pathname)} />
          ))}
        </div>
        {children}
      </div>
    </div>
  );
}
