"use client";

import { API_BASE, authHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useCallback, useEffect, useState } from "react";

type Row = {
  id: string;
  email: string | null;
  referred_user_id: string | null;
  status: string;
  created_at: string;
};

export default function ConnectorReferralsPage() {
  const { token, loading } = useAuth("INTERMEDIARY");
  const [rows, setRows] = useState<Row[]>([]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/connector-profile/referrals`, {
        headers: authHeaders(token),
      });
      if (res.ok) {
        setRows((await res.json()) as Row[]);
      }
    } catch {
      /* ignore */
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading || !token) return null;

  return (
    <main className="flex-1">
      <header className="border-b border-[var(--border)] px-6 py-4 md:px-10">
        <p className="mb-1 font-mono text-[11px] font-medium uppercase tracking-[2px] text-[var(--text-muted)]">
          Referrals
        </p>
        <h1 className="text-lg font-semibold">Platform referrals</h1>
      </header>
      <section className="max-w-5xl p-6 md:p-10">
        <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)]">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[11px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-[var(--border)] last:border-0"
                >
                  <td className="px-4 py-3 text-[var(--text)]">
                    {r.email ?? "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-metatron-accent">
                    {r.status === "active" || r.referred_user_id
                      ? "signed up"
                      : r.status}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--text-muted)]">
                    {new Date(r.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && (
          <p className="mt-6 text-sm text-[var(--text-muted)]">
            No referrals recorded yet. When referral tracking is enabled, rows
            will appear here.
          </p>
        )}
      </section>
    </main>
  );
}
