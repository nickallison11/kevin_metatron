"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

const LOGO_URL =
  "https://metatron.id/wp-content/uploads/2026/03/metatron-_Logo.png";

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

  function toggleTheme() {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }

  const role = token ? decodeRoleFromJwt(token) : null;
  const dashboardHref = dashboardPathForRole(role);

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="grid-bg" aria-hidden />
      <div className="orb" aria-hidden />

      <nav className="nav-metatron">
        <Link href="/" className="flex items-center gap-2.5 shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={LOGO_URL}
            alt="metatron"
            height={42}
            width={160}
            className="h-[42px] w-auto"
          />
        </Link>
        <div className="flex items-center gap-3 flex-wrap justify-end">
          {token ? (
            <>
              <Link
                href={dashboardHref}
                className="text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
              >
                Dashboard
              </Link>
              <button
                type="button"
                onClick={() => {
                  window.localStorage.removeItem("metatron_token");
                  setToken(null);
                  router.push("/");
                }}
                className="rounded-lg bg-metatron-accent/10 px-3 py-2 text-sm font-semibold text-metatron-accent hover:bg-metatron-accent/15 transition-colors"
              >
                Log out
              </button>
            </>
          ) : (
            <>
              <Link
                href="/startup"
                className="text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
              >
                Founder
              </Link>
              <Link
                href="/investor"
                className="text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
              >
                Investor
              </Link>
              <Link
                href="/connector"
                className="text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
              >
                Connector
              </Link>
              <Link
                href="/login"
                className="rounded-lg bg-metatron-accent px-4 py-2 text-sm font-semibold text-white hover:bg-metatron-accent-hover hover:shadow-[0_4px_20px_rgba(108,92,231,0.3)] transition-all"
              >
                Login
              </Link>
            </>
          )}
          <button
            type="button"
            onClick={toggleTheme}
            className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-sm text-[var(--text-muted)] hover:border-metatron-accent/25 transition-colors"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
        </div>
      </nav>

      <div className="relative z-[1] min-h-[calc(100vh-72px)]">{children}</div>
    </div>
  );
}
