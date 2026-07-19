"use client";

import AngelScoreCard from "@/components/AngelScoreCard";
import KevinMatchFeed from "@/components/KevinMatchFeed";
import { useAuth } from "@/lib/auth";

export default function StartupDashboardPage() {
  const { loading, token } = useAuth();

  if (loading) return null;
  if (!token) return null;

  return (
    <main className="flex-1">
      <header className="border-b border-[var(--border)] px-6 py-4 md:px-10">
        <p className="font-sans text-[11px] font-medium uppercase tracking-[2px] text-[var(--text-muted)] mb-1">
          Dashboard
        </p>
        <h1 className="text-lg font-semibold">Founder overview</h1>
      </header>
      <section className="grid grid-cols-1 gap-4 p-6 md:p-10 lg:grid-cols-[380px_1fr] lg:items-start">
        <AngelScoreCard token={token} />
        <KevinMatchFeed token={token} role="founder" />
      </section>
    </main>
  );
}
