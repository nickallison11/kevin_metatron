"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { API_BASE } from "@/lib/api";
import {
  AUTH_CHANGED_EVENT,
  clearTokens,
  getAccessToken,
  startAutoRefresh,
} from "@/lib/tokenStore";
import MessagingWidget from "@/components/MessagingWidget";
import AccountMenu from "@/components/AccountMenu";
import type { MeResponse } from "@/lib/me";

const LOGO_URL = "/metatron-logo.png";

const navLinkClass =
  "text-sm text-[var(--text-muted)] transition-colors hover:text-[var(--text)]";

function decodeRoleFromJwt(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = parts[1];
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padLen = (4 - (base64.length % 4)) % 4;
    const normalized = base64 + "=".repeat(padLen);
    const json = atob(normalized);
    const parsed = JSON.parse(json) as { role?: unknown };
    return typeof parsed.role === "string" ? parsed.role : null;
  } catch {
    return null;
  }
}

function dashboardPathForRole(role: string | null | undefined): string {
  switch (role) {
    case "INVESTOR":
      return "/investor";
    case "INTERMEDIARY":
      return "/connector";
    default:
      return "/startup";
  }
}

export default function AppShell({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  // The inline script in app/layout.tsx sets the class before paint; don't
  // touch it until the saved theme has been read, or light mode flashes dark.
  const [themeReady, setThemeReady] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("metatron_theme");
    if (stored === "light" || stored === "dark") {
      setTheme(stored);
    } else if (window.matchMedia("(prefers-color-scheme: light)").matches) {
      setTheme("light");
    }
    setThemeReady(true);
  }, []);
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!themeReady) return;
    const root = document.documentElement;
    if (theme === "light") {
      root.classList.add("light");
    } else {
      root.classList.remove("light");
    }
  }, [theme, themeReady]);

  useEffect(() => {
    setToken(getAccessToken());
    startAutoRefresh();

    function onStorage(e: StorageEvent) {
      if (e.key === "metatron_token") {
        setToken(e.newValue);
      }
    }
    function onAuthChanged() {
      setToken(getAccessToken());
    }

    window.addEventListener("storage", onStorage);
    window.addEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
    };
  }, []);

  useEffect(() => {
    setToken(getAccessToken());
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!token) {
      setMe(null);
      return;
    }
    let cancelled = false;
    fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: MeResponse | null) => {
        if (!cancelled) setMe(data);
      })
      .catch(() => {
        if (!cancelled) setMe(null);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  function toggleTheme() {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      localStorage.setItem("metatron_theme", next);
      return next;
    });
  }

  const role = token ? decodeRoleFromJwt(token) : null;
  const dashboardHref = dashboardPathForRole(role);
  const loggedIn = Boolean(token);
  const isAdmin = Boolean(me?.is_admin);

  function logOut() {
    clearTokens();
    setToken(null);
    router.push("/login");
  }

  const accountMenu = token ? (
    <AccountMenu token={token} role={role} me={me} theme={theme} onToggleTheme={toggleTheme} onLogout={logOut} />
  ) : null;

  return (
    <>
      <div className="grid-bg" aria-hidden />
      <div className="orb" aria-hidden />

      <div className="relative min-h-screen">
      <nav className="nav-metatron">
        {/* Logo */}
        <Link href={loggedIn ? dashboardHref : "/"} className="flex shrink-0 items-center gap-2.5 md:flex-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={LOGO_URL}
            alt=""
            height={42}
            width={37}
            className="h-[42px] w-auto"
          />
          <span className="flex flex-col leading-none">
            <span className="text-[17px] font-semibold tracking-tight text-[var(--text)]">Kevin AI</span>
            <span className="mt-1 font-mono text-[10px] tracking-[0.08em] text-[var(--text-muted)]">by metatron</span>
          </span>
        </Link>

        {/* Desktop nav links — centered, hidden on mobile */}
        <div className="hidden min-w-0 flex-1 items-center justify-center gap-x-6 md:flex">
          {/* Logged-in navigation lives in the dashboard's left menu. */}
          {isAdmin && (
            <Link href="/admin/users" className={navLinkClass}>Admin</Link>
          )}
        </div>

        {/* Desktop right controls — hidden on mobile */}
        <div className="hidden flex-1 items-center justify-end gap-3 md:flex">
          {accountMenu}
        </div>

        {/* Mobile right — hamburger (theme toggle lives in the account menu once logged in) */}
        <div className="flex items-center gap-2 md:hidden">
          {accountMenu}
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Toggle menu"
            className="rounded-lg border border-[var(--border)] p-2 text-[var(--text-muted)]"
          >
            {menuOpen ? (
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            ) : (
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden
              >
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            )}
          </button>
        </div>
      </nav>

      {/* Mobile menu drawer */}
      {menuOpen && (
        <div className="relative z-[99] flex flex-col gap-4 border-b border-[var(--border)] bg-[var(--bg)] px-6 py-4 md:hidden">
          {isAdmin && (
            <Link
              href="/admin/users"
              className={navLinkClass}
              onClick={() => setMenuOpen(false)}
            >
              Admin
            </Link>
          )}
          {token && (
            <div className="border-t border-[var(--border)] pt-4">
              <Link
                href={dashboardHref}
                className={navLinkClass}
                onClick={() => setMenuOpen(false)}
              >
                Dashboard
              </Link>
            </div>
          )}
        </div>
      )}

      <div className="relative z-[1] min-h-[calc(100vh-72px)]">
        {children}
      </div>
      </div>
      {/* MessagingWidget hidden — Kevin lives on /startup/kevin */}
    </>
  );
}
