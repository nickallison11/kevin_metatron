"use client";

import AngelScoreCard from "@/components/AngelScoreCard";
import KevinMatchFeed from "@/components/KevinMatchFeed";
import { StartupKevinChatCard } from "@/components/StartupKevinChatCard";
import { ThreeDCard } from "@/components/ui/3d-card";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

export default function StartupDashboardPage() {
  const { isPro, loading, token } = useAuth();
  const router = useRouter();

  if (loading) return null;
  if (!token) return null;

  return (
    <main className="flex-1">
      <header className="border-b border-[var(--border)] px-6 py-4 md:px-10">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[2px] text-[var(--text-muted)] mb-1">
          Dashboard
        </p>
        <h1 className="text-lg font-semibold">Founder overview</h1>
      </header>
      <section className="max-w-4xl space-y-4 p-6 md:p-10">
        <AngelScoreCard token={token} />
        <KevinMatchFeed token={token} role="founder" />
        <StartupKevinChatCard token={token} />

        <div className="grid gap-4 sm:grid-cols-2">
          <ThreeDCard>
            <Link
              href="/startup/profile"
              className="block rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5 transition-colors hover:border-metatron-accent/30"
            >
              <h2 className="mb-1 text-sm font-semibold text-metatron-accent">Profile & deck</h2>
              <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                Company details, stage, sector, and pitch deck link.
              </p>
            </Link>
          </ThreeDCard>

          <ThreeDCard>
            <Link
              href="/startup/pitches"
              className="block rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5 transition-colors hover:border-metatron-accent/30"
            >
              <h2 className="mb-1 text-sm font-semibold text-metatron-accent">Pitch data</h2>
              <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                Create and manage your fundraising pitch data.
              </p>
            </Link>
          </ThreeDCard>

          {isPro ? (
            <ThreeDCard className="sm:col-span-2">
              <Link
                href="/startup/calls"
                className="block rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5 transition-colors hover:border-metatron-accent/30"
              >
                <h2 className="mb-1 text-sm font-semibold text-metatron-accent">Call intelligence</h2>
                <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                  Upload recordings for transcription and AI analysis.
                </p>
              </Link>
            </ThreeDCard>
          ) : (
            <ThreeDCard className="sm:col-span-2">
              <div
                onClick={() => router.push("/pricing")}
                className="cursor-pointer rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5 opacity-60"
              >
                <div className="mb-1 flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-[var(--text-muted)]">Call intelligence</h2>
                  <span className="rounded border border-metatron-accent/40 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-metatron-accent">
                    Pro
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                  Upload recordings for transcription and AI analysis.
                </p>
              </div>
            </ThreeDCard>
          )}
        </div>
      </section>
    </main>
  );
}
