"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function StartupDashboardPage() {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    setToken(window.localStorage.getItem("metatron_token"));
  }, []);

  return (
    <main className="flex-1">
      <header className="border-b border-[var(--border)] px-6 py-4 md:px-10">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[2px] text-[var(--text-muted)] mb-1">
          Dashboard
        </p>
        <h1 className="text-lg font-semibold">Founder overview</h1>
      </header>
      <section className="p-6 md:p-10 grid gap-4 sm:grid-cols-2 max-w-4xl">
        <Link
          href="/startup/profile"
          className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5 hover:border-metatron-accent/30 transition-colors"
        >
          <h2 className="text-sm font-semibold text-metatron-accent mb-1">
            Profile & deck
          </h2>
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            Company details, stage, sector, and pitch deck upload.
          </p>
        </Link>
        <Link
          href="/startup/pitches"
          className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5 hover:border-metatron-accent/30 transition-colors"
        >
          <h2 className="text-sm font-semibold text-metatron-accent mb-1">
            Pitches
          </h2>
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            Create and manage fundraising narratives.
          </p>
        </Link>
        <Link
          href="/startup/calls"
          className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5 hover:border-metatron-accent/30 transition-colors sm:col-span-2"
        >
          <h2 className="text-sm font-semibold text-metatron-accent mb-1">
            Call intelligence
          </h2>
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            Upload recordings for mock transcription and Claude analysis.
          </p>
        </Link>
        {!token && (
          <p className="text-xs text-[var(--text-muted)] sm:col-span-2">
            Sign up and select Founder to get a token, then use the nav to
            build your profile.
          </p>
        )}
      </section>
    </main>
  );
}
