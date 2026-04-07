"use client";

import { useEffect, useMemo, useState } from "react";
import { API_BASE, authHeaders, authJsonHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type ProspectStatus =
  | "signed_up"
  | "contacted"
  | "responded"
  | "onboarded"
  | "declined";

type ProspectRow = {
  id: string;
  name: string;
  email: string;
  linkedin_url: string | null;
  pitch_deck_url: string | null;
  role: string | null;
  status: ProspectStatus;
  notes: string | null;
  created_at: string;
};

const COLUMNS: { status: ProspectStatus; title: string }[] = [
  { status: "signed_up", title: "Signed up (invite)" },
  { status: "contacted", title: "Contacted" },
  { status: "responded", title: "Responded" },
  { status: "onboarded", title: "Onboarded" },
  { status: "declined", title: "Declined" },
];

export default function AdminProspectsPage() {
  const { token, loading: authLoading } = useAuth();
  const [rows, setRows] = useState<ProspectRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    if (!token) return;
    setErr(null);
    const res = await fetch(`${API_BASE}/api/admin/prospects`, {
      headers: authHeaders(token),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(t.trim() || "Could not load prospects");
    }
    const data = (await res.json()) as ProspectRow[];
    setRows(data);
  }

  useEffect(() => {
    if (!token || authLoading) return;
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch (e) {
        if (!cancelled)
          setErr(e instanceof Error ? e.message : "Could not load prospects");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, authLoading]);

  const byStatus = useMemo(() => {
    const m: Record<ProspectStatus, ProspectRow[]> = {
      signed_up: [],
      contacted: [],
      responded: [],
      onboarded: [],
      declined: [],
    };
    if (!rows) return m;
    for (const r of rows) {
      if (m[r.status]) m[r.status].push(r);
    }
    return m;
  }, [rows]);

  async function updateStatus(id: string, status: ProspectStatus) {
    if (!token) return;
    setErr(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/prospects/${id}`, {
        method: "PUT",
        headers: authJsonHeaders(token),
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t.trim() || "Could not update");
      }
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not update");
    }
  }

  async function saveNotes(id: string, nextNotes: string) {
    if (!token) return;
    setErr(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/prospects/${id}`, {
        method: "PUT",
        headers: authJsonHeaders(token),
        body: JSON.stringify({ notes: nextNotes }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t.trim() || "Could not save notes");
      }
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save notes");
    }
  }

  async function removeProspect(id: string) {
    if (!token) return;
    const ok = window.confirm("Delete this prospect?");
    if (!ok) return;
    setErr(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/prospects/${id}`, {
        method: "DELETE",
        headers: authHeaders(token),
      });
      if (!res.ok && res.status !== 204) {
        const t = await res.text();
        throw new Error(t.trim() || "Could not delete");
      }
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not delete");
    }
  }

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
        <h1 className="text-lg font-semibold">Prospects</h1>
      </header>

      <section className="p-6 md:p-10 space-y-8">
        {err ? (
          <p className="text-sm text-[rgb(254,202,202)]">{err}</p>
        ) : null}

        {rows === null ? (
          <p className="text-sm text-[var(--text-muted)]">Loading…</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-5 lg:grid-cols-3 md:grid-cols-2">
            {COLUMNS.map((col) => (
              <div key={col.status} className="space-y-3 min-h-[120px]">
                <h3 className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                  {col.title}
                </h3>
                <div className="space-y-2">
                  {byStatus[col.status].map((r) => (
                    <ProspectCard
                      key={r.id}
                      prospect={r}
                      onStatus={updateStatus}
                      onNotesBlur={saveNotes}
                      onDelete={removeProspect}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function ProspectCard({
  prospect,
  onStatus,
  onNotesBlur,
  onDelete,
}: {
  prospect: ProspectRow;
  onStatus: (id: string, s: ProspectStatus) => void;
  onNotesBlur: (id: string, notes: string) => void;
  onDelete: (id: string) => void;
}) {
  const [localNotes, setLocalNotes] = useState(prospect.notes ?? "");

  useEffect(() => {
    setLocalNotes(prospect.notes ?? "");
  }, [prospect.notes, prospect.id]);

  return (
    <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg)] p-3 space-y-2">
      <p className="font-medium text-sm text-[var(--text)]">{prospect.name}</p>
      <p className="text-xs text-[var(--text-muted)] break-all">{prospect.email}</p>
      {prospect.linkedin_url ? (
        <a
          href={prospect.linkedin_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-metatron-accent hover:underline break-all"
        >
          LinkedIn
        </a>
      ) : null}
      {prospect.pitch_deck_url ? (
        <a
          href={prospect.pitch_deck_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-metatron-accent hover:underline"
        >
          View deck →
        </a>
      ) : null}
      {prospect.role ? (
        <p className="text-xs text-[var(--text)]">{prospect.role}</p>
      ) : null}
      <label className="block space-y-1">
        <span className="font-mono text-[10px] uppercase text-[var(--text-muted)]">
          Status
        </span>
        <select
          className="input-metatron w-full text-sm"
          value={prospect.status}
          onChange={(e) =>
            onStatus(prospect.id, e.target.value as ProspectStatus)
          }
        >
          <option value="signed_up">Signed up (invite)</option>
          <option value="contacted">Contacted</option>
          <option value="responded">Responded</option>
          <option value="onboarded">Onboarded</option>
          <option value="declined">Declined</option>
        </select>
      </label>
      <label className="block space-y-1">
        <span className="font-mono text-[10px] uppercase text-[var(--text-muted)]">
          Notes
        </span>
        <textarea
          className="input-metatron w-full min-h-[56px] text-xs"
          value={localNotes}
          onChange={(e) => setLocalNotes(e.target.value)}
          onBlur={() => {
            if (localNotes !== (prospect.notes ?? "")) {
              onNotesBlur(prospect.id, localNotes);
            }
          }}
        />
      </label>
      <button
        type="button"
        onClick={() => onDelete(prospect.id)}
        className="text-[11px] text-[var(--text-muted)] hover:text-[rgb(254,202,202)]"
      >
        Delete
      </button>
    </div>
  );
}
