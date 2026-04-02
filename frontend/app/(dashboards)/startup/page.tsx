"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

export default function StartupDashboardPage() {
  const { isPro, loading } = useAuth();
  const router = useRouter();

  if (loading) return null;

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
            Company details, stage, sector, and pitch deck link.
          </p>
        </Link>

        {isPro ? (
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
        ) : (
          <div
            onClick={() => router.push("/pricing")}
            className="cursor-pointer rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5 opacity-60 flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-sm font-semibold text-[var(--text-muted)]">
                  Pitches
                </h2>
                <span className="font-mono text-[9px] uppercase tracking-wider border border-metatron-accent/40 text-metatron-accent px-1.5 py-0.5 rounded">
                  Pro
                </span>
              </div>
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                Create and manage fundraising narratives.
              </p>
            </div>
          </div>
        )}

        {isPro ? (
          <Link
            href="/startup/calls"
            className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5 hover:border-metatron-accent/30 transition-colors sm:col-span-2"
          >
            <h2 className="text-sm font-semibold text-metatron-accent mb-1">
              Call intelligence
            </h2>
            <p className="text-xs text-[var(--text-muted)] leading-relaxed">
              Upload recordings for transcription and AI analysis.
            </p>
          </Link>
        ) : (
          <div
            onClick={() => router.push("/pricing")}
            className="cursor-pointer rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5 sm:col-span-2 opacity-60"
          >
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-sm font-semibold text-[var(--text-muted)]">
                Call intelligence
              </h2>
              <span className="font-mono text-[9px] uppercase tracking-wider border border-metatron-accent/40 text-metatron-accent px-1.5 py-0.5 rounded">
                Pro
              </span>
            </div>
            <p className="text-xs text-[var(--text-muted)] leading-relaxed">
              Upload recordings for transcription and AI analysis.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
