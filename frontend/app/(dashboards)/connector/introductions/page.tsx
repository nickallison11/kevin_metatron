"use client";

import { useCallback, useEffect, useState } from "react";
import { API_BASE, authJsonHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import ConnectorUpgradeGate from "@/components/ConnectorUpgradeGate";

type Profile = { connector_tier?: string | null };

type IntroRow = {
  id: string;
  person_a_name: string;
  person_a_email: string | null;
  person_b_name: string;
  person_b_email: string | null;
  notes: string | null;
  status: string;
  created_at: string;
};

const STATUS_LABELS: Record<string, string> = { pending: "Pending", sent: "Sent", closed: "Closed" };
const STATUS_COLORS: Record<string, string> = {
  pending: "bg-[var(--border)] text-[var(--text-muted)]",
  sent: "bg-metatron-accent/15 text-metatron-accent",
  closed: "bg-green-500/15 text-green-400",
};
const STATUSES = ["pending", "sent", "closed"];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export default function ConnectorIntroductionsPage() {
  const { token, loading } = useAuth("INTERMEDIARY");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [rows, setRows] = useState<IntroRow[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    person_a_name: "",
    person_a_email: "",
    person_b_name: "",
    person_b_email: "",
    notes: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!token) return;
    try {
      const [pRes, iRes] = await Promise.all([
        fetch(`${API_BASE}/connector-profile`, { headers: authJsonHeaders(token) }),
        fetch(`${API_BASE}/connector-profile/introductions`, { headers: authJsonHeaders(token) }),
      ]);
      if (pRes.ok) setProfile((await pRes.json()) as Profile);
      if (iRes.ok) setRows((await iRes.json()) as IntroRow[]);
    } finally {
      setDataLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const onCreate = async () => {
    if (!token) return;
    if (!form.person_a_name.trim() || !form.person_b_name.trim()) {
      setError("Both names are required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/connector-profile/introductions`, {
        method: "POST",
        headers: authJsonHeaders(token),
        body: JSON.stringify({
          person_a_name: form.person_a_name.trim(),
          person_a_email: form.person_a_email.trim() || null,
          person_b_name: form.person_b_name.trim(),
          person_b_email: form.person_b_email.trim() || null,
          notes: form.notes.trim() || null,
        }),
      });
      if (!res.ok) throw new Error("Could not create introduction.");
      setShowModal(false);
      setForm({ person_a_name: "", person_a_email: "", person_b_name: "", person_b_email: "", notes: "" });
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setSubmitting(false);
    }
  };

  const onStatusChange = async (id: string, status: string) => {
    if (!token) return;
    await fetch(`${API_BASE}/connector-profile/introductions/${id}`, {
      method: "PATCH",
      headers: authJsonHeaders(token),
      body: JSON.stringify({ status }),
    });
    await loadData();
  };

  const onDelete = async (id: string) => {
    if (!token || !confirm("Delete this introduction?")) return;
    await fetch(`${API_BASE}/connector-profile/introductions/${id}`, {
      method: "DELETE",
      headers: authJsonHeaders(token),
    });
    await loadData();
  };

  if (loading || dataLoading) {
    return (
      <div className="flex min-h-[calc(100vh-72px)] items-center justify-center">
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      </div>
    );
  }
  if (!token) return null;

  if (profile?.connector_tier !== "paid") {
    return <ConnectorUpgradeGate feature="Introductions" />;
  }

  return (
    <main className="flex-1 px-6 py-8 md:px-10">
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--text)]">Introductions</h1>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Track the introductions you broker between people in your network.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setShowModal(true);
              setError(null);
            }}
            className="rounded-[12px] bg-metatron-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-metatron-accent-hover"
          >
            + New Introduction
          </button>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-[12px] border border-[var(--border)] bg-[var(--bg-card)] px-6 py-12 text-center">
            <p className="text-sm text-[var(--text-muted)]">
              No introductions logged yet. Click &quot;New Introduction&quot; to record your first one.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-[12px] border border-[var(--border)] bg-[var(--bg-card)]">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                    Person A
                  </th>
                  <th className="px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                    Person B
                  </th>
                  <th className="px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                    Notes
                  </th>
                  <th className="px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                    Status
                  </th>
                  <th className="px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                    Date
                  </th>
                  <th className="px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-[var(--text-muted)]"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg)]">
                    <td className="px-4 py-3">
                      <p className="font-medium text-[var(--text)]">{r.person_a_name}</p>
                      {r.person_a_email && <p className="text-xs text-[var(--text-muted)]">{r.person_a_email}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-[var(--text)]">{r.person_b_name}</p>
                      {r.person_b_email && <p className="text-xs text-[var(--text-muted)]">{r.person_b_email}</p>}
                    </td>
                    <td className="px-4 py-3 max-w-[180px] text-xs text-[var(--text-muted)] truncate">
                      {r.notes ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={r.status}
                        onChange={(e) => void onStatusChange(r.id, e.target.value)}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold border-0 cursor-pointer ${STATUS_COLORS[r.status] ?? ""}`}
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABELS[s]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--text-muted)]">{formatDate(r.created_at)}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => void onDelete(r.id)}
                        className="text-xs text-[var(--text-muted)] hover:text-red-400"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-[12px] border border-[var(--border)] bg-[var(--bg-card)] p-6">
            <h2 className="mb-4 text-lg font-semibold text-[var(--text)]">New Introduction</h2>
            <div className="space-y-3">
              {error && <p className="text-xs text-red-400">{error}</p>}
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                    Person A Name *
                  </span>
                  <input
                    className="input-metatron w-full"
                    value={form.person_a_name}
                    onChange={(e) => setForm((f) => ({ ...f, person_a_name: e.target.value }))}
                  />
                </label>
                <label className="space-y-1">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                    Person A Email
                  </span>
                  <input
                    className="input-metatron w-full"
                    type="email"
                    value={form.person_a_email}
                    onChange={(e) => setForm((f) => ({ ...f, person_a_email: e.target.value }))}
                  />
                </label>
                <label className="space-y-1">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                    Person B Name *
                  </span>
                  <input
                    className="input-metatron w-full"
                    value={form.person_b_name}
                    onChange={(e) => setForm((f) => ({ ...f, person_b_name: e.target.value }))}
                  />
                </label>
                <label className="space-y-1">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                    Person B Email
                  </span>
                  <input
                    className="input-metatron w-full"
                    type="email"
                    value={form.person_b_email}
                    onChange={(e) => setForm((f) => ({ ...f, person_b_email: e.target.value }))}
                  />
                </label>
              </div>
              <label className="block space-y-1">
                <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Notes</span>
                <textarea
                  className="input-metatron w-full resize-none"
                  rows={3}
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-[12px] border border-[var(--border)] px-4 py-2 text-sm text-[var(--text)] hover:border-metatron-accent/30"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void onCreate()}
                disabled={submitting}
                className="rounded-[12px] bg-metatron-accent px-4 py-2 text-sm font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-60"
              >
                {submitting ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
