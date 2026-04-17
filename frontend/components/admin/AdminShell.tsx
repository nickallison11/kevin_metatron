"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const LOGO_URL = "/metatron-logo.png";

const linkBase =
  "block rounded-lg px-3 py-2 text-sm transition-colors border border-transparent";
const linkInactive = "text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--border)]";
const linkActive =
  "text-[var(--text)] border-[var(--border)] bg-[var(--bg-card)]";

export default function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  function navClass(href: string) {
    let active = false;
    if (href === "/admin/users") {
      active =
        pathname === "/admin/users" || pathname.startsWith("/admin/users/");
    } else {
      active = pathname === href || pathname.startsWith(`${href}/`);
    }
    return `${linkBase} ${active ? linkActive : linkInactive}`;
  }

  return (
    <div className="flex min-h-[calc(100vh-72px)] flex-col md:flex-row">
      <aside className="shrink-0 border-b border-[var(--border)] bg-[rgba(10,10,15,0.5)] px-4 py-4 md:w-56 md:border-b-0 md:border-r">
        <Link href="/admin/users" className="mb-4 flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={LOGO_URL}
            alt="metatron"
            className="h-8 w-auto max-w-[140px] object-contain object-left"
          />
          <span className="font-sans text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
            Admin
          </span>
        </Link>
        <nav className="flex flex-row flex-wrap gap-1 md:flex-col md:gap-0.5">
          <Link href="/admin/users" className={navClass("/admin/users")}>
            Users
          </Link>
          <div className="flex flex-col gap-0.5">
            <Link href="/admin/prospects" className={navClass("/admin/prospects")}>
              Prospects
            </Link>
            <Link
              href="/admin/prospects/new"
              className={`${linkBase} pl-6 text-xs ${
                pathname === "/admin/prospects/new"
                  ? linkActive
                  : linkInactive
              }`}
            >
              Add prospect
            </Link>
          </div>
          <Link href="/" className={`${linkBase} ${linkInactive} mt-2 md:mt-4`}>
            ← Platform home
          </Link>
        </nav>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
