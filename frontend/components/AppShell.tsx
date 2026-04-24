"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { API_BASE } from "@/lib/api";

const LOGO_URL = "/metatron-logo.png";

const navLinkClass =
  "text-sm text-[var(--text-muted)] transition-colors hover:text-[var(--text)]";

function SunIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="22" />
      <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" />
      <line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
      <line x1="2" y1="12" x2="4" y2="12" />
      <line x1="20" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" />
      <line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

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

  useEffect(() => {
    const stored = localStorage.getItem("metatron_theme");
    if (stored === "light" || stored === "dark") {
      setTheme(stored);
    } else if (window.matchMedia("(prefers-color-scheme: light)").matches) {
      setTheme("light");
    }
  }, []);
  const [token, setToken] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "light") {
      root.classList.add("light");
    } else {
      root.classList.remove("light");
    }
  }, [theme]);

  useEffect(() => {
    const stored = window.localStorage.getItem("metatron_token");
    setToken(stored);

    function onStorage(e: StorageEvent) {
      if (e.key === "metatron_token") {
        setToken(e.newValue);
      }
    }

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    setToken(window.localStorage.getItem("metatron_token"));
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!token) {
      setIsAdmin(false);
      return;
    }
    let cancelled = false;
    fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { is_admin?: boolean } | null) => {
        if (!cancelled && data?.is_admin) setIsAdmin(true);
        else if (!cancelled) setIsAdmin(false);
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false);
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

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="grid-bg" aria-hidden />
      <div className="orb" aria-hidden />

      <nav className="nav-metatron">
        {/* Logo */}
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={LOGO_URL}
            alt="metatron"
            height={42}
            width={160}
            className="h-[42px] w-auto"
          />
        </Link>

        {/* Desktop nav links — hidden on mobile */}
        <div className="ml-6 hidden min-w-0 items-center gap-x-6 md:flex">
          {loggedIn && (
            <>
              <Link href="/founders" className={navLinkClass}>Founder</Link>
              <Link href="/connectors" className={navLinkClass}>Connector</Link>
              <Link href="/investors" className={navLinkClass}>Investor</Link>
              <Link href="/pricing" className={navLinkClass}>Pricing</Link>
            </>
          )}
          {isAdmin && (
            <Link href="/admin/users" className={navLinkClass}>Admin</Link>
          )}
        </div>

        <div className="flex-1" aria-hidden />

        {/* Desktop right controls — hidden on mobile */}
        <div className="hidden shrink-0 items-center gap-3 md:flex">
          {token ? (
            <>
              <Link href={dashboardHref} className={navLinkClass}>
                Dashboard
              </Link>
              <button
                type="button"
                onClick={() => {
                  window.localStorage.removeItem("metatron_token");
                  setToken(null);
                  router.push("/");
                }}
                className="rounded-lg bg-metatron-accent/10 px-3 py-2 text-sm font-semibold text-metatron-accent transition-colors hover:bg-metatron-accent/15"
              >
                Log out
              </button>
            </>
          ) : (
            <Link href="/login" className={navLinkClass}>
              Sign in
            </Link>
          )}
          <button
            type="button"
            onClick={toggleTheme}
            className="inline-flex items-center justify-center rounded-lg border border-[var(--border)] p-2 text-[var(--text-muted)] transition-colors hover:border-metatron-accent/25 hover:text-[var(--text)]"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>

        {/* Mobile right — theme toggle + hamburger */}
        <div className="flex items-center gap-2 md:hidden">
          <button
            type="button"
            onClick={toggleTheme}
            className="inline-flex items-center justify-center rounded-lg border border-[var(--border)] p-2 text-[var(--text-muted)]"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
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
          <Link
            href="/founders"
            className={navLinkClass}
            onClick={() => setMenuOpen(false)}
          >
            Founder
          </Link>
          <Link
            href="/connectors"
            className={navLinkClass}
            onClick={() => setMenuOpen(false)}
          >
            Connector
          </Link>
          <Link
            href="/investors"
            className={navLinkClass}
            onClick={() => setMenuOpen(false)}
          >
            Investor
          </Link>
          {loggedIn && (
            <Link
              href="/pricing"
              className={navLinkClass}
              onClick={() => setMenuOpen(false)}
            >
              Pricing
            </Link>
          )}
          {isAdmin && (
            <Link
              href="/admin/users"
              className={navLinkClass}
              onClick={() => setMenuOpen(false)}
            >
              Admin
            </Link>
          )}
          <div className="border-t border-[var(--border)] pt-4">
            {token ? (
              <>
                <Link
                  href={dashboardHref}
                  className={navLinkClass}
                  onClick={() => setMenuOpen(false)}
                >
                  Dashboard
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    window.localStorage.removeItem("metatron_token");
                    setToken(null);
                    router.push("/");
                    setMenuOpen(false);
                  }}
                  className="mt-3 rounded-lg bg-metatron-accent/10 px-3 py-2 text-sm font-semibold text-metatron-accent"
                >
                  Log out
                </button>
              </>
            ) : (
              <Link
                href="/login"
                className={navLinkClass}
                onClick={() => setMenuOpen(false)}
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      )}

      <div className="relative z-[1] min-h-[calc(100vh-72px)]">
        {children}
      </div>
    </div>
  );
}
