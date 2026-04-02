"use client";

import { useAuth } from "@/lib/auth";

export default function ConnectorDashboardPage() {
  const { loading } = useAuth();

  if (loading) return null;

  return (
    <main className="min-h-[calc(100vh-72px)] text-[var(--text)]">
      <header className="border-b border-[var(--border)] px-6 py-4 md:px-10">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[2px] text-[var(--text-muted)] mb-1">
          Dashboard
        </p>
        <h1 className="text-lg font-semibold">Connector</h1>
      </header>
      <section className="p-6 md:p-10 max-w-3xl">
        <div className="rounded-metatron border border-[var(--border)] bg-[var(--bg-card)] p-5">
          <h2 className="text-sm font-semibold mb-2">Coming soon</h2>
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            Referrals, deal facilitation, and introductions between founders
            and investors will live here.
          </p>
        </div>
      </section>
    </main>
  );
}
