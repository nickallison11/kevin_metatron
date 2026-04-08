"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { API_BASE } from "@/lib/api";

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
  const [token, setToken] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
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
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }

  const role = token ? decodeRoleFromJwt(token) : null;
  const dashboardHref = dashboardPathForRole(role);
  const loggedIn = Boolean(token);

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="grid-bg" aria-hidden />
      <div className="orb" aria-hidden />

      <nav className="nav-metatron">
        <div className="flex min-w-0 items-center gap-4 md:gap-6">
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
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 md:gap-x-6">
            {loggedIn ? (
              <Link href="/founders" className={navLinkClass}>
                Founder
              </Link>
            ) : (
              <Link href="/founders" className={navLinkClass}>
                Founder
              </Link>
            )}
            {loggedIn ? (
              <Link href="/connectors" className={navLinkClass}>
                Connector
              </Link>
            ) : (
              <Link href="/connectors" className={navLinkClass}>
                Connector
              </Link>
            )}
            {loggedIn ? (
              <Link href="/investors" className={navLinkClass}>
                Investor
              </Link>
            ) : (
              <Link href="/investors" className={navLinkClass}>
                Investor
              </Link>
            )}
            <Link href="/pricing" className={navLinkClass}>
              Pricing
            </Link>
            {isAdmin ? (
              <Link href="/admin/users" className={navLinkClass}>
                Admin
              </Link>
            ) : null}
          </div>
        </div>

        <div className="flex-1" aria-hidden />

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-3">
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
            className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-sm text-[var(--text-muted)] transition-colors hover:border-metatron-accent/25"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
        </div>
      </nav>

      <div className="relative z-[1] min-h-[calc(100vh-72px)]">
        {children}
      </div>
    </div>
  );
}
