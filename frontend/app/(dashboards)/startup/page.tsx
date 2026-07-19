"use client";

import AngelScoreCard from "@/components/AngelScoreCard";
import ChannelLinksCard from "@/components/ChannelLinksCard";
import KevinMatchFeed from "@/components/KevinMatchFeed";
import { useAuth } from "@/lib/auth";

export default function StartupDashboardPage() {
  const { loading, token } = useAuth();

  if (loading) return null;
  if (!token) return null;

  return (
    <main className="flex-1">
      <section className="p-6 md:p-10 max-w-5xl mx-auto space-y-4">
        <h1 className="text-2xl font-semibold text-[var(--text)]">Founder overview</h1>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[380px_1fr] lg:items-start">
          <div className="space-y-4">
            <AngelScoreCard token={token} />
            <ChannelLinksCard token={token} />
          </div>
          <KevinMatchFeed token={token} role="founder" />
        </div>
      </section>
    </main>
  );
}
