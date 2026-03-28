"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

const LOGO_URL =
  "https://metatron.id/wp-content/uploads/2026/03/metatron-_Logo.png";

export default function AppShell({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "light") {
      root.classList.add("light");
    } else {
      root.classList.remove("light");
    }
  }, [theme]);

  function toggleTheme() {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }

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
          <Link
            href="/auth/signup"
            className="text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
          >
            Sign up
          </Link>
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
