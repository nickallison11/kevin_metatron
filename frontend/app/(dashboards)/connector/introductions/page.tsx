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
  pending: "bg-[var(--warn-bg)] text-[var(--warn)]",
  sent: "bg-metatron-accent/15 text-[var(--accent-fg)]",
  closed: "bg-[var(--good-bg)] text-[var(--good)]",
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

  const input =
    "w-full min-h-11 rounded-[10px] border border-[var(--overlay-12)] bg-[var(--bg)] px-3.5 py-2.5 text-sm text-[var(--text)] outline-none focus:border-metatron-accent";
  const field = "flex flex-col gap-1.5 text-[13px] font-semibold";

  return (
    <main className="min-w-0 flex-1">
      <section className="mx-auto flex max-w-5xl flex-col gap-5 p-6 md:p-10">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">Introductions</span>
            <h1 className="text-[28px] font-semibold tracking-tight">Warm intros you&apos;ve made</h1>
            <p className="text-sm text-[var(--text-muted)]">Track the introductions you broker between people in your network.</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setShowModal((v) => !v);
              setError(null);
            }}
            className="inline-flex min-h-11 items-center rounded-xl bg-metatron-accent px-5 text-sm font-semibold text-white hover:bg-metatron-accent-hover"
          >
            {showModal ? "Close" : "+ New introduction"}
          </button>
        </header>

        {showModal && (
          <section className="flex flex-col gap-4 rounded-[var(--radius)] border border-metatron-accent/40 bg-[var(--bg-card)] p-5 shadow-[var(--card-shadow)]">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={field}>
                <span>Person A name *</span>
                <input className={input} value={form.person_a_name} onChange={(e) => setForm((f) => ({ ...f, person_a_name: e.target.value }))} />
              </label>
              <label className={field}>
                <span>Person A email</span>
                <input className={input} type="email" value={form.person_a_email} onChange={(e) => setForm((f) => ({ ...f, person_a_email: e.target.value }))} />
              </label>
              <label className={field}>
                <span>Person B name *</span>
                <input className={input} value={form.person_b_name} onChange={(e) => setForm((f) => ({ ...f, person_b_name: e.target.value }))} />
              </label>
              <label className={field}>
                <span>Person B email</span>
                <input className={input} type="email" value={form.person_b_email} onChange={(e) => setForm((f) => ({ ...f, person_b_email: e.target.value }))} />
              </label>
            </div>
            <label className={field}>
              <span>Why they should meet</span>
              <textarea className={`${input} resize-y`} rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </label>
            {error && (
              <p role="alert" className="text-[13px] text-[var(--danger)]">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="inline-flex min-h-11 items-center rounded-xl border border-[var(--overlay-12)] px-5 text-sm font-medium hover:bg-[var(--overlay-4)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void onCreate()}
                disabled={submitting}
                className="inline-flex min-h-11 items-center rounded-xl bg-metatron-accent px-5 text-sm font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-60"
              >
                {submitting ? "Saving…" : "Save introduction"}
              </button>
            </div>
          </section>
        )}

        {rows.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No introductions logged yet. Use &ldquo;New introduction&rdquo; to record your first one.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {rows.map((r) => (
              <article
                key={r.id}
                className="flex flex-col gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-[var(--card-shadow)] sm:flex-row sm:flex-wrap sm:items-center"
              >
                <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-metatron-accent/15 text-[var(--accent-fg)]">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 15l6 -6" />
                    <path d="M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464" />
                    <path d="M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463" />
                  </svg>
                </span>
                <div className="flex min-w-0 flex-1 basis-72 flex-col gap-1">
                  <strong className="text-base">
                    {r.person_a_name} → {r.person_b_name}
                  </strong>
                  <span className="text-[13px] text-[var(--text-muted)]">
                    {[r.person_a_email, r.person_b_email].filter(Boolean).join(" · ") || "No emails"} · {formatDate(r.created_at)}
                  </span>
                  {r.notes && <span className="text-sm text-[var(--text-muted)]">{r.notes}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <label className="sr-only" htmlFor={`status-${r.id}`}>
                    Status
                  </label>
                  <select
                    id={`status-${r.id}`}
                    value={r.status}
                    onChange={(e) => void onStatusChange(r.id, e.target.value)}
                    className={`min-h-9 cursor-pointer rounded-full border-0 px-3 text-[13px] font-semibold ${STATUS_COLORS[r.status] ?? ""}`}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => void onDelete(r.id)}
                    aria-label={`Delete introduction ${r.person_a_name} to ${r.person_b_name}`}
                    className="inline-flex min-h-9 items-center rounded-[10px] px-2.5 text-[13px] text-[var(--text-muted)] hover:text-[var(--danger)]"
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
