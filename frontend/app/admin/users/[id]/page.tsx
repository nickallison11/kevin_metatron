"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { API_BASE, authHeaders, authJsonHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { MeResponse } from "@/lib/me";

type AdminUserCore = {
  id: string;
  email: string;
  role: string;
  is_pro: boolean;
  is_admin: boolean;
  is_suspended: boolean;
  telegram_id: string | null;
  whatsapp_number: string | null;
  subscription_tier: string;
  created_at: string;
};

type AdminProfile = {
  company_name: string | null;
  one_liner: string | null;
  stage: string | null;
  sector: string | null;
  country: string | null;
  website: string | null;
  pitch_deck_url: string | null;
};

type AdminPitch = {
  id: string;
  title: string;
  description: string | null;
  created_at: string;
};

type KevinUsageDay = {
  usage_date: string;
  message_count: number;
};

type AdminUserDetail = {
  user: AdminUserCore;
  profile: AdminProfile | null;
  pitches: AdminPitch[];
  kevin_usage_7d: KevinUsageDay[];
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

export default function AdminUserDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();
  const { token, loading: authLoading } = useAuth();

  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [proSaving, setProSaving] = useState(false);
  const [suspendSaving, setSuspendSaving] = useState(false);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  useEffect(() => {
    if (!token || authLoading) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/me`, {
          headers: authHeaders(token),
        });
        if (!res.ok) return;
        const me = (await res.json()) as MeResponse;
        if (!cancelled) {
          setMyUserId(me.id ?? null);
          setIsSuperAdmin(Boolean(me.is_super_admin));
        }
      } catch {
        if (!cancelled) {
          setMyUserId(null);
          setIsSuperAdmin(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, authLoading]);

  useEffect(() => {
    if (!token || authLoading || !id) return;
    let cancelled = false;
    (async () => {
      setErr(null);
      try {
        const res = await fetch(`${API_BASE}/api/admin/users/${id}`, {
          headers: authHeaders(token),
        });
        if (res.status === 404) {
          router.replace("/admin/users");
          return;
        }
        if (!res.ok) {
          const t = await res.text();
          throw new Error(t.trim() || "Could not load user");
        }
        const data = (await res.json()) as AdminUserDetail;
        if (!cancelled) setDetail(data);
      } catch (e) {
        if (!cancelled)
          setErr(e instanceof Error ? e.message : "Could not load user");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, authLoading, id, router]);

  async function togglePro(next: boolean) {
    if (!token || !detail) return;
    setProSaving(true);
    setErr(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${id}/pro`, {
        method: "PUT",
        headers: authJsonHeaders(token),
        body: JSON.stringify({ is_pro: next }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t.trim() || "Could not update tier");
      }
      setDetail((d) =>
        d
          ? {
              ...d,
              user: { ...d.user, is_pro: next },
            }
          : d
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not update tier");
    } finally {
      setProSaving(false);
    }
  }

  async function toggleSuspend() {
    if (!token || !detail) return;
    setSuspendSaving(true);
    setErr(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${id}/suspend`, {
        method: "PUT",
        headers: authHeaders(token),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt.trim() || "Could not update suspension");
      }
      const data = (await res.json()) as { is_suspended: boolean };
      setDetail((d) =>
        d
          ? {
              ...d,
              user: { ...d.user, is_suspended: data.is_suspended },
            }
          : d
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not update suspension");
    } finally {
      setSuspendSaving(false);
    }
  }

  async function deleteUser() {
    if (!token) return;
    const ok = window.confirm(
      "Permanently delete this user? This cannot be undone."
    );
    if (!ok) return;
    setDeleteSaving(true);
    setErr(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${id}`, {
        method: "DELETE",
        headers: authHeaders(token),
      });
      if (res.status === 204) {
        router.push("/admin/users");
        return;
      }
      const t = await res.text();
      throw new Error(t.trim() || "Could not delete user");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not delete user");
    } finally {
      setDeleteSaving(false);
    }
  }

  if (authLoading || !token) {
    return (
      <div className="p-8 md:p-10">
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      </div>
    );
  }

  if (err && !detail) {
    return (
      <div className="p-8 md:p-10 space-y-4">
        <p className="text-sm text-[rgb(254,202,202)]">{err}</p>
        <Link
          href="/admin/users"
          className="text-sm text-metatron-accent hover:underline"
        >
          ← Back to users
        </Link>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="p-8 md:p-10">
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      </div>
    );
  }

  const u = detail.user;
  const p = detail.profile;
  const isSelf = myUserId !== null && myUserId === id;

  return (
    <main className="min-w-0">
      <header className="border-b border-[var(--border)] px-6 py-4 md:px-10">
        <Link
          href="/admin/users"
          className="text-xs text-metatron-accent hover:underline mb-2 inline-block"
        >
          ← Users
        </Link>
        <p className="font-mono text-[11px] font-medium uppercase tracking-[2px] text-[var(--text-muted)] mb-1">
          Admin
        </p>
        <h1 className="text-lg font-semibold break-all">{u.email}</h1>
        <p className="text-xs text-[var(--text-muted)] mt-1">
          {roleLabel(u.role)} · joined {u.created_at}
        </p>
      </header>

      <section className="p-6 md:p-10 max-w-3xl space-y-6">
        {err ? (
          <p className="text-sm text-[rgb(254,202,202)]">{err}</p>
        ) : null}

        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-6 space-y-4">
          <h2 className="text-sm font-semibold">Account</h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="font-mono text-[10px] uppercase text-[var(--text-muted)]">
                Tier
              </dt>
              <dd className="mt-1 flex flex-wrap items-center gap-2">
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
                <button
                  type="button"
                  disabled={proSaving}
                  onClick={() => togglePro(!u.is_pro)}
                  className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-50"
                >
                  {proSaving
                    ? "Saving…"
                    : u.is_pro
                      ? "Set to Free"
                      : "Set to Pro"}
                </button>
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] uppercase text-[var(--text-muted)]">
                Subscription
              </dt>
              <dd className="mt-1 text-[var(--text)]">{u.subscription_tier}</dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] uppercase text-[var(--text-muted)]">
                Telegram
              </dt>
              <dd className="mt-1 text-[var(--text)] break-all">
                {u.telegram_id ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] uppercase text-[var(--text-muted)]">
                WhatsApp
              </dt>
              <dd className="mt-1 text-[var(--text)] break-all">
                {u.whatsapp_number ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] uppercase text-[var(--text-muted)]">
                Admin
              </dt>
              <dd className="mt-1 text-[var(--text)]">{u.is_admin ? "Yes" : "No"}</dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] uppercase text-[var(--text-muted)]">
                Suspended
              </dt>
              <dd className="mt-1 text-[var(--text)]">
                {u.is_suspended ? "Yes" : "No"}
              </dd>
            </div>
          </dl>
          {isSelf ? (
            <p className="text-xs text-[var(--text-muted)] pt-2 border-t border-[var(--border)]">
              You cannot suspend or delete your own account from the admin panel.
            </p>
          ) : isSuperAdmin ? (
            <div className="flex flex-wrap gap-3 pt-4 border-t border-[var(--border)]">
              <button
                type="button"
                disabled={suspendSaving}
                onClick={() => void toggleSuspend()}
                className="rounded-lg border border-[rgba(239,68,68,0.45)] bg-transparent px-4 py-2 text-xs font-semibold text-[rgb(254,202,202)] hover:bg-[rgba(239,68,68,0.12)] disabled:opacity-50"
              >
                {suspendSaving
                  ? "Updating…"
                  : u.is_suspended
                    ? "Unsuspend"
                    : "Suspend"}
              </button>
              <button
                type="button"
                disabled={deleteSaving}
                onClick={() => void deleteUser()}
                className="rounded-lg border border-[rgba(239,68,68,0.45)] bg-transparent px-4 py-2 text-xs font-semibold text-[rgb(254,202,202)] hover:bg-[rgba(239,68,68,0.12)] disabled:opacity-50"
              >
                {deleteSaving ? "Deleting…" : "Delete user"}
              </button>
            </div>
          ) : null}
        </div>

        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-6 space-y-3">
          <h2 className="text-sm font-semibold">Profile</h2>
          {!p ? (
            <p className="text-xs text-[var(--text-muted)]">No profile row.</p>
          ) : (
            <dl className="grid grid-cols-1 gap-2 text-sm">
              {[
                ["Company", p.company_name],
                ["One-liner", p.one_liner],
                ["Stage", p.stage],
                ["Sector", p.sector],
                ["Country", p.country],
                ["Website", p.website],
                ["Deck URL", p.pitch_deck_url],
              ].map(([label, val]) => (
                <div key={label as string} className="flex gap-2">
                  <dt className="w-28 shrink-0 font-mono text-[10px] uppercase text-[var(--text-muted)]">
                    {label}
                  </dt>
                  <dd className="min-w-0 break-words text-[var(--text)]">
                    {val ?? "—"}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-6 space-y-3">
          <h2 className="text-sm font-semibold">Pitches</h2>
          {detail.pitches.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">None.</p>
          ) : (
            <ul className="space-y-2">
              {detail.pitches.map((pitch) => (
                <li
                  key={pitch.id}
                  className="rounded-lg border border-[var(--border)] px-3 py-2"
                >
                  <p className="font-medium text-sm">{pitch.title}</p>
                  {pitch.description ? (
                    <p className="text-xs text-[var(--text-muted)] mt-1 line-clamp-2">
                      {pitch.description}
                    </p>
                  ) : null}
                  <p className="text-[10px] text-[var(--text-muted)] mt-1">
                    {pitch.created_at}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-6 space-y-3">
          <h2 className="text-sm font-semibold">Kevin usage (last 7 days)</h2>
          {detail.kevin_usage_7d.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">No rows.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                    <th className="text-left py-2 font-mono text-[11px] uppercase">
                      Date
                    </th>
                    <th className="text-right py-2 font-mono text-[11px] uppercase">
                      Messages
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {detail.kevin_usage_7d.map((row) => (
                    <tr
                      key={row.usage_date}
                      className="border-b border-[var(--border)] last:border-0"
                    >
                      <td className="py-2 text-[var(--text)]">{row.usage_date}</td>
                      <td className="py-2 text-right font-mono">
                        {row.message_count}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
