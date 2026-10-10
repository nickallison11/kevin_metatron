"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ProBlurOverlay } from "@/components/FounderCard";
import { API_BASE, authHeaders, authJsonHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type InvestorPublic = {
  user_id: string;
  firm_name?: string | null;
  bio?: string | null;
  sectors?: string[] | null;
  stages?: string[] | null;
  ticket_size_min?: number | null;
  ticket_size_max?: number | null;
  country?: string | null;
  logo_url?: string | null;
};
type ReviewSummary = { investor_user_id: string; review_count: number; avg_stars: number | null };

function initials(name: string): string {
  return (
    name
      .replace(/[^A-Za-z ]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "·"
  );
}

function ticket(inv: InvestorPublic): string | null {
  if (inv.ticket_size_min == null && inv.ticket_size_max == null) return null;
  return `$${inv.ticket_size_min ?? "?"} – $${inv.ticket_size_max ?? "?"}`;
}

/**
 * Browse Investors — every investor profile, searchable. Rendered inside the
 * founder and connector dashboards (and on the legacy /investors page).
 * Free accounts see the first two investors; the rest are blurred.
 */
export function InvestorDirectory({ detailBase }: { detailBase?: string } = {}) {
  const { token, loading, isPro } = useAuth();
  const [rows, setRows] = useState<InvestorPublic[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState("");
  const [sent, setSent] = useState<Record<string, "follow" | "intro_request">>({});
  const [ratings, setRatings] = useState<Record<string, ReviewSummary>>({});

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/investor-profile/all`, { headers: authHeaders(token) });
      if (res.ok) setRows((await res.json()) as InvestorPublic[]);
      const rs = await fetch(`${API_BASE}/investor-profile/review-summaries`, { headers: authHeaders(token) });
      if (rs.ok) {
        const list = (await rs.json()) as ReviewSummary[];
        setRatings(Object.fromEntries(list.map((r) => [r.investor_user_id, r])));
      }
    } catch {
      /* shown as the empty state */
    } finally {
      setLoaded(true);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function connect(toUserId: string, connectionType: "follow" | "intro_request") {
    if (!token) return;
    const res = await fetch(`${API_BASE}/connections`, {
      method: "POST",
      headers: authJsonHeaders(token),
      body: JSON.stringify({ to_user_id: toUserId, connection_type: connectionType }),
    });
    if (res.ok) setSent((s) => ({ ...s, [toUserId]: connectionType }));
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((inv) =>
      [inv.firm_name, inv.bio, inv.country, ...(inv.sectors ?? []), ...(inv.stages ?? [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [rows, q]);

  if (loading || !token) return null;

  return (
    <main className="min-w-0">
      <section className="mx-auto flex max-w-6xl flex-col gap-6 p-6 md:p-10">
        <header className="flex flex-col gap-1.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">Browse Investors</span>
          <h1 className="text-[28px] font-semibold tracking-tight text-[var(--text)]">Every investor on metatron</h1>
          <p className="text-sm text-[var(--text-muted)]">
            Search the full directory. Investors Kevin picked for you are on the Matches page.
          </p>
        </header>

        <label className="flex min-h-11 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-3.5 text-[var(--text-muted)]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <span className="sr-only">Search investors</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by firm, sector, stage or country"
            className="min-w-0 flex-1 bg-transparent text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
          />
        </label>

        {loaded && filtered.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">{rows.length === 0 ? "No investor profiles yet." : "No investors match that search."}</p>
        ) : (
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((inv, i) => {
              const name = inv.firm_name || "Independent investor";
              const bio = inv.bio?.trim() ?? "";
              const chips = [...(inv.stages ?? []).slice(0, 2), ...(inv.sectors ?? []).slice(0, 2), ticket(inv)].filter(Boolean) as string[];
              const done = sent[inv.user_id];
              const rating = ratings[inv.user_id];
              return (
                <div key={inv.user_id} className="relative">
                  <article className="flex h-full flex-col gap-3.5 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-[var(--card-shadow)]">
                    <div className="flex items-center gap-3">
                      {inv.logo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={inv.logo_url} alt="" className="h-11 w-11 shrink-0 rounded-xl border border-[var(--border)] bg-white object-contain p-1.5" />
                      ) : (
                        <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-metatron-accent/15 text-sm font-semibold text-metatron-accent">
                          {initials(name)}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-base font-semibold text-[var(--text)]">
                          {detailBase ? (
                            <Link href={`${detailBase}/${inv.user_id}`} className="hover:underline">
                              {name}
                            </Link>
                          ) : (
                            name
                          )}
                        </h3>
                        <p className="text-[13px] text-[var(--text-muted)]">{inv.country ?? "—"}</p>
                      </div>
                      {rating && rating.avg_stars != null && (
                        <span className="shrink-0 text-[13px] text-[var(--text-muted)]" title={`${rating.review_count} founder review${rating.review_count === 1 ? "" : "s"}`}>
                          <span className="text-[var(--star)]">★</span> {rating.avg_stars.toFixed(1)} <span className="text-xs">({rating.review_count})</span>
                        </span>
                      )}
                    </div>
                    <p className="line-clamp-3 text-sm leading-relaxed text-[var(--text-muted)]">{bio || "No thesis yet."}</p>
                    {chips.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {chips.map((c) => (
                          <span key={c} className="rounded-full bg-[var(--overlay-6)] px-2.5 py-1 text-xs text-[var(--text-muted)]">
                            {c}
                          </span>
                        ))}
                      </div>
                    )}
                    {detailBase && (
                      <Link href={`${detailBase}/${inv.user_id}`} className="text-[13px] font-medium text-metatron-accent hover:underline">
                        View profile and reviews →
                      </Link>
                    )}
                    <div className="mt-auto flex gap-2 border-t border-[var(--border)] pt-3">
                      <button
                        type="button"
                        disabled={Boolean(done)}
                        onClick={() => void connect(inv.user_id, "follow")}
                        className="min-h-10 flex-1 rounded-[10px] border border-[var(--overlay-12)] text-[13px] font-medium text-[var(--text)] hover:bg-[var(--overlay-4)] disabled:opacity-50"
                      >
                        {done === "follow" ? "Following" : "Follow"}
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(done)}
                        onClick={() => void connect(inv.user_id, "intro_request")}
                        className="min-h-10 flex-1 rounded-[10px] bg-metatron-accent text-[13px] font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-50"
                      >
                        {done === "intro_request" ? "Requested" : "Connect"}
                      </button>
                    </div>
                  </article>
                  {!isPro && i >= 2 ? <ProBlurOverlay label="Upgrade to see all investors" /> : null}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
