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
  signed_up: "bg-metatron-accent/15 text-metatron-accent",
  converted: "bg-green-500/15 text-green-400",
};

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
    const link = `https://platform.metatron.id/auth/signup?ref=${code}`;
    void navigator.clipboard.writeText(link);
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

  const card = "rounded-[12px] border border-[var(--border)] bg-[var(--bg-card)] p-6";

  return (
    <main className="flex-1 px-6 py-8 md:px-10">
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--text)]">Referrals</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Refer founders and investors to the platform and earn enrichment credits.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Referrals sent", value: info?.total_referrals ?? 0 },
            { label: "Converted to paid", value: info?.converted ?? 0 },
            { label: "Credits earned", value: info?.credits_awarded ?? 0 },
          ].map((stat) => (
            <div key={stat.label} className={card}>
              <p className="font-sans text-[11px] uppercase tracking-wider text-[var(--text-muted)]">{stat.label}</p>
              <p className="mt-2 text-3xl font-semibold text-[var(--text)]">{stat.value}</p>
            </div>
          ))}
        </div>

        <div className={card}>
          <h2 className="font-sans text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Your referral link</h2>
          {info?.referral_code ? (
            <div className="mt-3 flex items-center gap-3">
              <code className="flex-1 rounded-[8px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] truncate">
                {`https://platform.metatron.id/auth/signup?ref=${info.referral_code}`}
              </code>
              <button
                type="button"
                onClick={() => copyLink(info.referral_code!)}
                className="shrink-0 rounded-[12px] border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:border-metatron-accent/30"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          ) : (
            <div className="mt-3">
              <p className="text-sm text-[var(--text-muted)]">
                Generate your unique referral link to start tracking signups.
              </p>
              <button
                type="button"
                onClick={() => void generateCode()}
                disabled={generating}
                className="mt-3 rounded-[12px] bg-metatron-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-60"
              >
                {generating ? "Generating..." : "Generate referral link"}
              </button>
            </div>
          )}
        </div>

        <div className={card}>
          <h2 className="font-sans text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Referral history</h2>
          {!info?.rows.length ? (
            <p className="mt-4 text-sm text-[var(--text-muted)]">No referrals recorded yet.</p>
          ) : (
            <table className="mt-4 w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                  <th className="py-2 text-left">Email</th>
                  <th className="py-2 text-left">Status</th>
                  <th className="py-2 text-left">Credits</th>
                  <th className="py-2 text-left">Date</th>
                </tr>
              </thead>
              <tbody>
                {info.rows.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--border)] last:border-0">
                    <td className="py-2 text-[var(--text)]">{r.referred_email ?? "—"}</td>
                    <td className="py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_COLORS[r.status] ?? ""}`}
                      >
                        {r.status === "signed_up"
                          ? "Signed up"
                          : r.status === "converted"
                            ? "Converted"
                            : r.status}
                      </span>
                    </td>
                    <td className="py-2 text-[var(--text-muted)]">{r.credits_awarded}</td>
                    <td className="py-2 text-[var(--text-muted)]">{formatDate(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </main>
  );
}
