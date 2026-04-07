"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { API_BASE, authHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type AdminUserRow = {
  id: string;
  email: string;
  role: string;
  is_pro: boolean;
  is_admin: boolean;
  telegram_id: string | null;
  created_at: string;
  kevin_message_count: number;
};

function roleLabel(role: string) {
  switch (role) {
    case "STARTUP":
      return "Founder";
    case "INVESTOR":
      return "Investor";
    case "INTERMEDIARY":
      return "Connector";
    default:
      return role;
  }
}

function formatJoined(iso: string) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export default function AdminUsersPage() {
  const { token, loading: authLoading } = useAuth();
  const [rows, setRows] = useState<AdminUserRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token || authLoading) return;
    let cancelled = false;
    (async () => {
      setErr(null);
      try {
        const res = await fetch(`${API_BASE}/api/admin/users`, {
          headers: authHeaders(token),
        });
        if (!res.ok) {
          const t = await res.text();
          throw new Error(t.trim() || "Could not load users");
        }
        const data = (await res.json()) as AdminUserRow[];
        if (!cancelled) setRows(data);
      } catch (e) {
        if (!cancelled)
          setErr(e instanceof Error ? e.message : "Could not load users");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, authLoading]);

  if (authLoading || !token) {
    return (
      <div className="p-8 md:p-10">
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      </div>
    );
  }

  return (
    <main className="min-w-0">
      <header className="border-b border-[var(--border)] px-6 py-4 md:px-10">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[2px] text-[var(--text-muted)] mb-1">
          Admin
        </p>
        <h1 className="text-lg font-semibold">Users</h1>
      </header>

      <section className="p-6 md:p-10">
        {err ? (
          <p className="text-sm text-[rgb(254,202,202)]">{err}</p>
        ) : rows === null ? (
          <p className="text-sm text-[var(--text-muted)]">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No users yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)]">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                  <th className="px-4 py-3 font-mono text-[11px] uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-4 py-3 font-mono text-[11px] uppercase tracking-wider">
                    Role
                  </th>
                  <th className="px-4 py-3 font-mono text-[11px] uppercase tracking-wider">
                    Tier
                  </th>
                  <th className="px-4 py-3 font-mono text-[11px] uppercase tracking-wider">
                    Telegram
                  </th>
                  <th className="px-4 py-3 font-mono text-[11px] uppercase tracking-wider">
                    Joined
                  </th>
                  <th className="px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-right">
                    Kevin today
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr
                    key={u.id}
                    className="border-b border-[var(--border)] last:border-0 hover:bg-[rgba(108,92,231,0.06)]"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/users/${u.id}`}
                        className="font-medium text-[var(--text)] hover:text-metatron-accent hover:underline"
                      >
                        {u.email}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">
                      {roleLabel(u.role)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={[
                          "font-mono text-[10px] uppercase tracking-wider border px-2 py-0.5 rounded",
                          u.is_pro
                            ? "border-metatron-accent/40 text-metatron-accent"
                            : "border-[var(--border)] text-[var(--text-muted)]",
                        ].join(" ")}
                      >
                        {u.is_pro ? "Pro" : "Free"}
                      </span>
                      {u.is_admin ? (
                        <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                          admin
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {u.telegram_id ? (
                        <span className="text-xs text-[var(--text)]">Linked</span>
                      ) : (
                        <span className="text-xs text-[var(--text-muted)]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--text-muted)]">
                      {formatJoined(u.created_at)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs">
                      {u.kevin_message_count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
