"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  IconBell,
  IconBrandWhatsapp,
  IconCreditCard,
  IconEye,
  IconLogout,
  IconMoon,
  IconUserCircle,
  IconUsersPlus,
} from "@tabler/icons-react";
import { API_BASE, authHeaders } from "@/lib/api";
import type { MeResponse } from "@/lib/me";

type Status = { subscription_status: string; subscription_period_end: string | null; cancel_at_period_end: boolean };
type Usage = { messages_today: number; daily_limit: number | null };
type ReceivedIntro = { intro_accepted_at: string | null; intro_passed_at: string | null };
type DeckView = { id: string; viewed_at: string; viewer_email: string | null; viewer_org: string | null };

const BELL_SEEN_KEY = "metatron_bell_seen";

function initials(s: string): string {
  return (
    s
      .replace(/[^A-Za-z ]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "·"
  );
}

function ago(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}

function getJson<T>(token: string, path: string): Promise<T | null> {
  return fetch(`${API_BASE}${path}`, { headers: authHeaders(token) })
    .then((r) => (r.ok ? (r.json() as Promise<T>) : null))
    .catch(() => null);
}

/** Closes a popover on outside click, Escape, and navigation. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return { open, setOpen, ref };
}

const panel =
  "absolute right-0 top-[calc(100%+10px)] z-[200] flex w-[min(340px,calc(100vw-32px))] flex-col rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] py-2 text-[var(--text)] shadow-[0_16px_40px_rgba(0,0,0,0.35)]";
const row =
  "flex min-h-11 items-center gap-3.5 px-[18px] text-sm text-[var(--text)] transition-colors hover:bg-[var(--overlay-4)] [&>svg]:shrink-0 [&>svg]:text-[var(--text-muted)]";
const divider = <div className="my-1 h-px bg-[var(--border)]" aria-hidden />;

/** Bell: intro requests waiting and (founders) recent deck views. */
function NotificationBell({ token, role, base }: { token: string; role: string | null; base: string }) {
  const { open, setOpen, ref } = usePopover();
  const pathname = usePathname();
  const [requests, setRequests] = useState(0);
  const [views, setViews] = useState<DeckView[]>([]);
  const [seen, setSeen] = useState(0);

  useEffect(() => {
    try {
      setSeen(Number(localStorage.getItem(BELL_SEEN_KEY)) || 0);
    } catch {
      /* storage blocked */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (role === "STARTUP" || role === "INVESTOR") {
      void getJson<ReceivedIntro[]>(token, "/kevin-matches/received-intros").then((rows) => {
        if (!cancelled && rows) setRequests(rows.filter((r) => !r.intro_accepted_at && !r.intro_passed_at).length);
      });
    }
    if (role === "STARTUP") {
      void getJson<DeckView[]>(token, "/deck-views/mine").then((rows) => {
        if (!cancelled && rows) setViews(rows.slice(0, 5));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [token, role, pathname]);

  const newViews = views.filter((v) => new Date(v.viewed_at).getTime() > seen).length;
  const count = requests + newViews;

  function toggle() {
    // Opening the bell marks deck views as seen; intro requests stay until answered.
    if (!open && newViews > 0) {
      const now = Date.now();
      setSeen(now);
      try {
        localStorage.setItem(BELL_SEEN_KEY, String(now));
      } catch {
        /* storage blocked */
      }
    }
    setOpen(!open);
  }

  const items: ReactNode[] = [];
  if (requests > 0) {
    items.push(
      <Link key="requests" href={`${base}/matches`} className={`${row} py-2.5`}>
        <IconUsersPlus size={19} stroke={1.7} />
        <span className="flex-1">
          {requests} intro request{requests === 1 ? "" : "s"} waiting for you
        </span>
      </Link>,
    );
  }
  for (const v of views) {
    items.push(
      <Link key={v.id} href="/startup" className={`${row} py-2.5`}>
        <IconEye size={19} stroke={1.7} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{v.viewer_org || v.viewer_email || "Someone"} viewed your deck</span>
          <span className="text-xs text-[var(--text-muted)]">{ago(v.viewed_at)}</span>
        </span>
      </Link>,
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={count > 0 ? `Notifications, ${count} new` : "Notifications"}
        className="relative flex h-10 w-10 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--overlay-4)] hover:text-[var(--text)]"
      >
        <IconBell size={20} stroke={1.75} />
        {count > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-metatron-accent px-1 text-[10px] font-semibold text-white">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>
      {open && (
        <div className={panel}>
          <span className="px-[18px] pb-1.5 pt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
            Notifications
          </span>
          {items.length > 0 ? items : <p className="px-[18px] py-3 text-sm text-[var(--text-muted)]">Nothing new right now.</p>}
        </div>
      )}
    </div>
  );
}

/**
 * Top-right account area for logged-in users: notification bell plus an
 * initials circle that opens the account menu (plan, Kevin usage, settings
 * links, dark mode, log out). Replaces the sidebar account card.
 */
export default function AccountMenu({
  token,
  role,
  me,
  theme,
  onToggleTheme,
  onLogout,
}: {
  token: string;
  role: string | null;
  me: MeResponse | null;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  onLogout: () => void;
}) {
  const { open, setOpen, ref } = usePopover();
  const [status, setStatus] = useState<Status | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);

  const base = role === "INVESTOR" ? "/investor" : role === "INTERMEDIARY" ? "/connector" : "/startup";
  const roleLabel = role === "INVESTOR" ? "Investor" : role === "INTERMEDIARY" ? "Connector" : "Founder";

  // Refresh plan and usage each time the menu opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void getJson<Status>(token, "/subscriptions/status").then((s) => !cancelled && setStatus(s));
    void getJson<Usage>(token, "/kevin/usage").then((u) => !cancelled && setUsage(u));
    return () => {
      cancelled = true;
    };
  }, [open, token]);

  const name = me ? [me.first_name, me.last_name].filter(Boolean).join(" ").trim() || me.email : "";
  const tier = me?.is_pro ? "Pro" : me?.is_basic ? "Basic" : "Free";
  const periodEnd =
    status?.subscription_period_end && tier !== "Free"
      ? new Date(status.subscription_period_end).toLocaleDateString(undefined, { day: "numeric", month: "short" })
      : null;
  const planLine = periodEnd ? `${tier} plan · ${status?.cancel_at_period_end ? "ends" : "renews"} ${periodEnd}` : `${tier} plan`;
  const channel = me?.whatsapp_number ? "WhatsApp" : me?.telegram_id ? "Telegram" : null;
  const pct = usage?.daily_limit ? Math.min(100, Math.round((usage.messages_today / usage.daily_limit) * 100)) : 0;

  return (
    <div className="flex items-center gap-1.5">
      <NotificationBell token={token} role={role} base={base} />
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="true"
          aria-expanded={open}
          aria-label="Account menu"
          title={me ? `${name} · ${roleLabel} · ${tier}` : undefined}
          className={`flex h-10 w-10 items-center justify-center rounded-full bg-metatron-accent/20 text-[13px] font-semibold text-[var(--accent-fg)] transition-shadow hover:ring-2 hover:ring-metatron-accent/40 ${open ? "ring-2 ring-metatron-accent/60" : ""}`}
        >
          {me ? initials(name) : ""}
        </button>

        {open && (
          <div className={panel}>
            <div className="flex flex-col gap-0.5 px-[18px] py-3">
              <strong className="truncate text-[15px]">{name}</strong>
              <span className="truncate text-xs text-[var(--text-muted)]">{me?.email}</span>
            </div>

            <div className="mx-3 mb-2.5 mt-1 flex flex-col gap-3 rounded-xl bg-[var(--overlay-3)] p-3.5">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                  {roleLabel} · {planLine}
                </span>
                <Link href={`${base}/settings/subscription`} className="text-xs font-semibold text-[var(--accent-fg)] hover:underline">
                  {tier === "Pro" ? "Manage" : "Upgrade"}
                </Link>
              </div>
              {usage && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-[13px]">
                    <span>Kevin messages today</span>
                    <span className="text-[var(--text-muted)]">
                      {usage.daily_limit ? `${usage.messages_today} of ${usage.daily_limit}` : `${usage.messages_today} · unlimited`}
                    </span>
                  </div>
                  {usage.daily_limit && (
                    <div className="h-1.5 rounded-full bg-[var(--overlay-8)]">
                      <div className="h-1.5 rounded-full bg-metatron-accent" style={{ width: `${Math.max(pct, 2)}%` }} />
                    </div>
                  )}
                </div>
              )}
            </div>

            {divider}
            <Link href={`${base}/settings`} className={row}>
              <IconUserCircle size={19} stroke={1.7} />
              Account &amp; security
            </Link>
            <Link href={`${base}/settings/subscription`} className={row}>
              <IconCreditCard size={19} stroke={1.7} />
              Billing &amp; invoices
            </Link>
            <Link href={`${base}/settings?tab=notifications`} className={row}>
              <IconBell size={19} stroke={1.7} />
              Notifications
            </Link>
            <Link href={`${base}/kevin`} className={row}>
              <IconBrandWhatsapp size={19} stroke={1.7} />
              <span className="flex-1">Kevin on your phone</span>
              {channel ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-[var(--good)]">
                  <span className="h-[7px] w-[7px] rounded-full bg-[var(--good)]" aria-hidden />
                  {channel}
                </span>
              ) : (
                <span className="text-xs text-[var(--text-muted)]">Set up</span>
              )}
            </Link>

            {divider}
            <button type="button" role="switch" aria-checked={theme === "dark"} onClick={onToggleTheme} className={`${row} w-full text-left`}>
              <IconMoon size={19} stroke={1.7} />
              <span className="flex-1">Dark mode</span>
              <span
                aria-hidden
                className={`relative h-[22px] w-10 rounded-full transition-colors ${theme === "dark" ? "bg-metatron-accent" : "bg-[var(--overlay-12)]"}`}
              >
                <span
                  className={`absolute top-[3px] h-4 w-4 rounded-full bg-white shadow transition-[left] ${theme === "dark" ? "left-[21px]" : "left-[3px]"}`}
                />
              </span>
            </button>

            {divider}
            <button type="button" onClick={onLogout} className={`${row} w-full text-left`}>
              <IconLogout size={19} stroke={1.7} />
              Log out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
