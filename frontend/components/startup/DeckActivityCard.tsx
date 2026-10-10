"use client";

import { useEffect, useState } from "react";
import { API_BASE, authHeaders } from "@/lib/api";

type DeckView = {
  id: string;
  viewed_at: string;
  source: string;
  viewer_email: string | null;
  viewer_role: string | null;
  viewer_org: string | null;
};

function ago(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}

/** "Who viewed your deck" — founder dashboard. */
export default function DeckActivityCard({ token }: { token: string }) {
  const [views, setViews] = useState<DeckView[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/deck-views/mine`, { headers: authHeaders(token) })
      .then((r) => (r.ok ? (r.json() as Promise<DeckView[]>) : []))
      .then((d) => !cancelled && setViews(d))
      .catch(() => !cancelled && setViews([]));
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <section className="flex flex-col gap-2.5 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-[var(--card-shadow)]">
      <h2 className="text-base font-semibold">Who viewed your deck</h2>
      {views === null ? (
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      ) : views.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">No deck views yet. Investors who open your deck show up here.</p>
      ) : (
        views.slice(0, 6).map((v) => (
          <div key={v.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] py-2.5 text-sm">
            <span>{v.viewer_org || v.viewer_email || "Anonymous visitor"}</span>
            <span className="text-[var(--text-muted)]">{ago(v.viewed_at)}</span>
          </div>
        ))
      )}
    </section>
  );
}
