"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { API_BASE, authHeaders } from "@/lib/api";
import { ago, btn, card } from "@/components/startup/dashboardStyles";

type DeckView = {
  id: string;
  viewed_at: string;
  source: string;
  viewer_email: string | null;
  viewer_role: string | null;
  viewer_org: string | null;
};

/** "Who viewed your deck" — founder dashboard. */
export default function DeckActivityCard({ token, hasDeck }: { token: string; hasDeck: boolean }) {
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

  const since = Date.now() - 30 * 86400000;
  const recent = (views ?? []).filter((v) => new Date(v.viewed_at).getTime() >= since).length;

  return (
    <section className={card}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Who viewed your deck</h2>
        {views && views.length > 0 && <span className="text-[13px] text-[var(--text-muted)]">{recent} in 30 days</span>}
      </div>
      {views === null ? (
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      ) : views.length > 0 ? (
        views.slice(0, 5).map((v) => (
          <div key={v.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-3 text-sm">
            <span>{v.viewer_org || v.viewer_email || "Anonymous visitor"}</span>
            <span className="text-[13px] text-[var(--text-muted)]">{ago(v.viewed_at)}</span>
          </div>
        ))
      ) : hasDeck ? (
        <p className="text-sm text-[var(--text-muted)]">No deck views yet. Investors who open your deck show up here, with their firm.</p>
      ) : (
        <>
          <p className="text-sm text-[var(--text-muted)]">Add your deck and every investor who opens it shows up here, with their firm.</p>
          <div>
            <Link href="/startup/profile" className={btn}>
              Add your deck
            </Link>
          </div>
        </>
      )}
    </section>
  );
}
