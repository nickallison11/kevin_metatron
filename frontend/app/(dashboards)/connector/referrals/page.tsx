"use client";

import { useCallback, useEffect, useState } from "react";
import { API_BASE, authJsonHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type ReferralRow = {
  id: string;
  referred_email: string | null;
  referred_user_id: string | null;
  status: string;
  credits_awarded: number;
  created_at: string;
};

type ReferralInfo = {
  referral_code: string | null;
  total_referrals: number;
  converted: number;
  credits_awarded: number;
  rows: ReferralRow[];
};

const STATUS_COLORS: Record<string, string> = {
  signed_up: "bg-metatron-accent/15 text-[var(--accent-fg)]",
  converted: "bg-[var(--good-bg)] text-[var(--good)]",
};

/** Signup link on whichever site the connector is using (dev or production). */
function referralLink(code: string) {
  const origin = typeof window === "undefined" ? "https://platform.metatron.id" : window.location.origin;
  return `${origin}/auth/signup?ref=${code}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export default function ConnectorReferralsPage() {
  const { token, loading } = useAuth("INTERMEDIARY");
  const [info, setInfo] = useState<ReferralInfo | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);

  const loadData = useCallback(async () => {
    if (!token) return;
    try {
      const rRes = await fetch(`${API_BASE}/connector-profile/referrals`, {
        headers: authJsonHeaders(token),
      });
      if (rRes.ok) setInfo((await rRes.json()) as ReferralInfo);
    } finally {
      setDataLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const generateCode = async () => {
    if (!token) return;
    setGenerating(true);
    try {
      const res = await fetch(`${API_BASE}/connector-profile/referral/generate`, {
        method: "POST",
        headers: authJsonHeaders(token),
      });
      if (res.ok) await loadData();
    } finally {
      setGenerating(false);
    }
  };

  const copyLink = (code: string) => {
    void navigator.clipboard.writeText(referralLink(code));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading || dataLoading) {
    return (
      <div className="flex min-h-[calc(100vh-72px)] items-center justify-center">
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      </div>
    );
  }
  if (!token) return null;



  const card = "rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-[var(--card-shadow)]";
  const link = info?.referral_code ? referralLink(info.referral_code) : null;

  return (
    <main className="min-w-0 flex-1">
      <section className="mx-auto flex max-w-5xl flex-col gap-5 p-6 md:p-10">
        <header className="flex flex-col gap-1.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">Referrals</span>
          <h1 className="text-[28px] font-semibold tracking-tight">Invite founders and investors</h1>
          <p className="text-sm text-[var(--text-muted)]">Everyone who signs up with your link is credited to you, and you earn enrichment credits.</p>
        </header>

        <section className={`${card} flex flex-col gap-3`}>
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">Your referral link</span>
          {link ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className="min-w-0 flex-1 select-all break-all rounded-[10px] border border-[var(--border)] bg-[var(--bg)] px-3.5 py-3 font-mono text-[13px]">{link}</code>
              <button
                type="button"
                onClick={() => copyLink(info!.referral_code!)}
                className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-[var(--overlay-12)] px-5 text-sm font-medium hover:bg-[var(--overlay-4)]"
              >
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm text-[var(--text-muted)]">Generate your link to start tracking signups.</p>
              <button
                type="button"
                onClick={() => void generateCode()}
                disabled={generating}
                className="inline-flex min-h-11 items-center rounded-xl bg-metatron-accent px-5 text-sm font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-60"
              >
                {generating ? "Generating…" : "Generate referral link"}
              </button>
            </div>
          )}
        </section>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { label: "Signups", value: info?.total_referrals ?? 0 },
            { label: "Became paying", value: info?.converted ?? 0 },
            { label: "Credits earned", value: info?.credits_awarded ?? 0 },
          ].map((stat) => (
            <div key={stat.label} className={`${card} flex flex-col gap-1 p-4`}>
              <span className="text-[13px] text-[var(--text-muted)]">{stat.label}</span>
              <b className="text-2xl font-semibold">{stat.value}</b>
            </div>
          ))}
        </section>

        <section className={`${card} flex flex-col`}>
          <h2 className="mb-1 text-base font-semibold">Referral history</h2>
          {!info?.rows.length ? (
            <p className="text-sm text-[var(--text-muted)]">No referrals yet. Share your link to get started.</p>
          ) : (
            info.rows.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] py-3 text-sm first:border-t-0">
                <span className="min-w-0 break-all">{r.referred_email ?? "—"}</span>
                <span className="flex items-center gap-3">
                  {r.credits_awarded > 0 && <span className="text-[13px] text-[var(--text-muted)]">+{r.credits_awarded} credits</span>}
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLORS[r.status] ?? "bg-[var(--overlay-6)] text-[var(--text-muted)]"}`}>
                    {r.status === "signed_up" ? "Signed up" : r.status === "converted" ? "Paying" : r.status}
                  </span>
                  <span className="text-[13px] text-[var(--text-muted)]">{formatDate(r.created_at)}</span>
                </span>
              </div>
            ))
          )}
        </section>
      </section>
    </main>
  );
}
