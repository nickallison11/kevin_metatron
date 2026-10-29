"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { API_BASE, authJsonHeaders } from "@/lib/api";
import { useUpgrade } from "@/components/upgrade/UpgradeProvider";
import { btn, card, eyebrow } from "@/components/startup/dashboardStyles";

type Programme = {
  name: string;
  url: string | null;
  kind: string;
  location: string | null;
  summary: string | null;
  verified: boolean;
};

type Readiness = {
  stage: string;
  label: string;
  previous: string | null;
  next: string | null;
  summary: string;
  /** Null on Free: what's missing and the programmes are Basic/Pro. */
  gaps: string[] | null;
  next_steps: string[] | null;
  programmes: Programme[] | null;
  assessed_at: string;
};

const ASK_HREF = `/startup/kevin?ask=${encodeURIComponent("Am I ready to talk to investors?")}`;

/** Where the founder stands on the way to funding, as Kevin assessed it in chat. */
export default function ReadinessCard({ token }: { token: string }) {
  const { openUpgrade } = useUpgrade();
  const [readiness, setReadiness] = useState<Readiness | null | undefined>(undefined);

  useEffect(() => {
    fetch(`${API_BASE}/readiness`, { headers: authJsonHeaders(token) })
      .then((r) => (r.ok ? (r.json() as Promise<Readiness | null>) : null))
      .then(setReadiness)
      .catch(() => setReadiness(null));
  }, [token]);

  if (readiness === undefined) return null;

  if (!readiness) {
    return (
      <section className={card}>
        <span className={`${eyebrow} text-[var(--text-muted)]`}>Funding stage</span>
        <span className="text-lg font-semibold">Ready for investors?</span>
        <div>
          <Link href={ASK_HREF} className={btn}>
            Ask Kevin
          </Link>
        </div>
      </section>
    );
  }

  const steps = [
    { label: readiness.previous, current: false, done: true },
    { label: readiness.label, current: true, done: true },
    { label: readiness.next, current: false, done: false },
  ].filter((s): s is { label: string; current: boolean; done: boolean } => Boolean(s.label));

  return (
    <section className={card}>
      <div className="flex items-center justify-between gap-2">
        <span className={`${eyebrow} text-[var(--text-muted)]`}>Funding stage</span>
        <span className="text-xs text-[var(--text-muted)]">{new Date(readiness.assessed_at).toLocaleDateString()}</span>
      </div>

      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((s) => (
          <div key={s.label} className="flex flex-col gap-1.5">
            <i className={`h-1.5 rounded ${s.done ? "bg-metatron-accent" : "bg-[var(--overlay-8)]"}`} />
            <span className={`text-[13px] ${s.current ? "font-semibold text-[var(--text)]" : "text-[var(--text-muted)]"}`}>{s.label}</span>
          </div>
        ))}
      </div>

      <span className="text-xl font-semibold">{readiness.label}</span>
      <p className="text-sm leading-relaxed text-[var(--text-muted)]">{readiness.summary}</p>

      {readiness.gaps ? (
        <>
          {readiness.gaps.length > 0 && readiness.next && (
            <div className="flex flex-col gap-1.5">
              <span className={`${eyebrow} text-[var(--text-muted)]`}>To reach {readiness.next}</span>
              <ol className="flex flex-col gap-1 text-sm">
                {readiness.gaps.map((g, i) => (
                  <li key={g} className="flex gap-2.5">
                    <span className="font-mono text-[var(--accent-fg)]">{i + 1}</span>
                    <span>{g}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {readiness.programmes && readiness.programmes.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className={`${eyebrow} text-[var(--text-muted)]`}>Programmes</span>
              {readiness.programmes.map((p) => (
                <div key={p.name} className="flex items-center justify-between gap-3 border-t border-[var(--border)] pt-2">
                  <div className="flex min-w-0 flex-col">
                    {p.url ? (
                      <a href={p.url} target="_blank" rel="noopener noreferrer" className="truncate font-medium text-[var(--text)] hover:underline">
                        {p.name}
                      </a>
                    ) : (
                      <span className="truncate font-medium">{p.name}</span>
                    )}
                    {p.location && <span className="truncate text-[13px] text-[var(--text-muted)]">{p.location}</span>}
                  </div>
                  {p.verified && (
                    <span className="shrink-0 rounded-lg bg-[var(--good-bg)] px-2 py-0.5 font-mono text-[11px] text-[var(--good)]">Verified</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="flex items-start gap-2 text-[13px] leading-relaxed text-[var(--text-muted)]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="mt-0.5 shrink-0">
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          <span>
            {"What's missing and programmes for you on Basic and Pro. "}
            <button type="button" onClick={openUpgrade} className="text-[var(--accent-fg)] hover:underline">
              Upgrade
            </button>
          </span>
        </p>
      )}

      <div>
        <Link href={ASK_HREF} className={btn}>
          Ask Kevin
        </Link>
      </div>
    </section>
  );
}
