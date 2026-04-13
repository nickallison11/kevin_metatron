"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { API_BASE, authHeaders, authJsonHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type Contact = {
  id: string;
  role: "investor" | "founder";
  name: string;
  email: string | null;
  firm_or_company: string | null;
  linkedin_url: string | null;
  notes: string | null;
  invited_at: string | null;
  joined_user_id: string | null;
  created_at: string;
};

export default function ConnectorNetworkPage() {
  const { token, loading } = useAuth("INTERMEDIARY");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [tab, setTab] = useState<"investor" | "founder">("investor");
  const [msg, setMsg] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [csvMsg, setCsvMsg] = useState<string | null>(null);
  const [csvImporting, setCsvImporting] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const [form, setForm] = useState({
    role: "investor" as "investor" | "founder",
    name: "",
    email: "",
    firm_or_company: "",
    linkedin_url: "",
    notes: "",
  });

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/connector-profile/network`, {
        headers: authHeaders(token),
      });
      if (res.ok) setContacts((await res.json()) as Contact[]);
    } catch {}
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setAdding(true);
    setMsg(null);
    try {
      const res = await fetch(`${API_BASE}/connector-profile/network`, {
        method: "POST",
        headers: authJsonHeaders(token),
        body: JSON.stringify({
          role: form.role,
          name: form.name,
          email: form.email || null,
          firm_or_company: form.firm_or_company || null,
          linkedin_url: form.linkedin_url || null,
          notes: form.notes || null,
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        setMsg(t || "Could not add contact.");
        return;
      }
      const newContact = (await res.json()) as Contact;
      setContacts((prev) => [newContact, ...prev]);
      setForm({
        role: tab,
        name: "",
        email: "",
        firm_or_company: "",
        linkedin_url: "",
        notes: "",
      });
      setShowForm(false);
    } catch {
      setMsg("Could not add contact.");
    } finally {
      setAdding(false);
    }
  }

  async function onDelete(id: string) {
    if (!token) return;
    try {
      await fetch(`${API_BASE}/connector-profile/network/${id}`, {
        method: "DELETE",
        headers: authHeaders(token),
      });
      setContacts((prev) => prev.filter((c) => c.id !== id));
    } catch {}
  }

  async function onCsvImport(e: FormEvent) {
    e.preventDefault();
    if (!token || !csvText.trim()) return;
    setCsvImporting(true);
    setCsvMsg(null);
    try {
      const res = await fetch(`${API_BASE}/connector-profile/network/csv`, {
        method: "POST",
        headers: authJsonHeaders(token),
        body: JSON.stringify({ csv: csvText }),
      });
      const data = (await res.json()) as { imported: number; skipped: number };
      setCsvMsg(
        `Imported ${data.imported} contacts. ${data.skipped > 0 ? `${data.skipped} skipped.` : ""}`,
      );
      setCsvText("");
      void load();
    } catch {
      setCsvMsg("Import failed.");
    } finally {
      setCsvImporting(false);
    }
  }

  const filtered = contacts.filter((c) => c.role === tab);

  if (loading || !token) return null;

  return (
    <main className="flex-1">
      <header className="border-b border-[var(--border)] px-6 py-4 md:px-10">
        <p className="mb-1 font-mono text-[11px] font-medium uppercase tracking-[2px] text-[var(--text-muted)]">
          Connector
        </p>
        <h1 className="text-lg font-semibold">My Network</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Import and manage the investors and founders in your network.
        </p>
      </header>

      <section className="max-w-5xl space-y-6 p-6 md:p-10">
        <div className="flex gap-2">
          {(["investor", "founder"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTab(t);
                setForm((f) => ({ ...f, role: t }));
                setShowForm(false);
              }}
              className={[
                "rounded-lg border px-4 py-2 text-sm font-medium transition-colors",
                tab === t
                  ? "border-metatron-accent/40 bg-metatron-accent/10 text-metatron-accent"
                  : "border-[var(--border)] text-[var(--text-muted)] hover:border-metatron-accent/20",
              ].join(" ")}
            >
              {t === "investor" ? "Investors" : "Founders"}
              <span className="ml-2 rounded-full bg-[var(--bg)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-muted)]">
                {contacts.filter((c) => c.role === t).length}
              </span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="rounded-lg bg-metatron-accent px-4 py-2 text-sm font-semibold text-white hover:bg-metatron-accent-hover"
          >
            {showForm ? "Cancel" : `+ Add ${tab}`}
          </button>
        </div>

        {showForm && (
          <form
            onSubmit={onAdd}
            className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5 space-y-4 text-sm"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="font-mono text-[11px] uppercase text-[var(--text-muted)]">
                  Name *
                </span>
                <input
                  className="input-metatron w-full"
                  required
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                  placeholder="Full name"
                />
              </label>
              <label className="block space-y-1">
                <span className="font-mono text-[11px] uppercase text-[var(--text-muted)]">
                  {tab === "investor" ? "Firm" : "Company"}
                </span>
                <input
                  className="input-metatron w-full"
                  value={form.firm_or_company}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, firm_or_company: e.target.value }))
                  }
                  placeholder={
                    tab === "investor" ? "e.g. Acme Ventures" : "e.g. Acme Inc"
                  }
                />
              </label>
              <label className="block space-y-1">
                <span className="font-mono text-[11px] uppercase text-[var(--text-muted)]">
                  Email
                </span>
                <input
                  className="input-metatron w-full"
                  type="email"
                  value={form.email}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, email: e.target.value }))
                  }
                  placeholder="email@example.com"
                />
              </label>
              <label className="block space-y-1">
                <span className="font-mono text-[11px] uppercase text-[var(--text-muted)]">
                  LinkedIn URL
                </span>
                <input
                  className="input-metatron w-full"
                  type="url"
                  value={form.linkedin_url}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, linkedin_url: e.target.value }))
                  }
                  placeholder="https://linkedin.com/in/..."
                />
              </label>
            </div>
            <label className="block space-y-1">
              <span className="font-mono text-[11px] uppercase text-[var(--text-muted)]">
                Notes
              </span>
              <textarea
                className="input-metatron w-full resize-none"
                rows={2}
                value={form.notes}
                onChange={(e) =>
                  setForm((f) => ({ ...f, notes: e.target.value }))
                }
                placeholder="e.g. Met at AfricArena 2025, invests in fintech pre-seed"
              />
            </label>
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={adding}
                className="rounded-lg bg-metatron-accent px-4 py-2 text-sm font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-60"
              >
                {adding ? "Adding…" : "Add contact"}
              </button>
              {msg && <p className="text-xs text-red-400">{msg}</p>}
            </div>
          </form>
        )}

        {filtered.length === 0 ? (
          <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-8 text-center">
            <p className="text-sm text-[var(--text-muted)]">
              No {tab === "investor" ? "investors" : "founders"} in your network
              yet.
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Add them manually above or import via CSV below.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {filtered.map((c) => (
              <div
                key={c.id}
                className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-4 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-[var(--text)]">
                      {c.name}
                    </p>
                    {c.firm_or_company && (
                      <p className="text-xs text-[var(--text-muted)]">
                        {c.firm_or_company}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {c.joined_user_id ? (
                      <span
                        className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px]"
                        style={{
                          borderColor: "rgba(34,197,94,0.35)",
                          backgroundColor: "rgba(34,197,94,0.12)",
                          color: "rgb(134,239,172)",
                        }}
                      >
                        On platform
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full border border-[var(--border)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-muted)]">
                        Not yet
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => void onDelete(c.id)}
                      className="text-[var(--text-muted)] hover:text-red-400 transition-colors"
                      aria-label="Remove"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden
                      >
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                </div>
                {c.email && (
                  <p className="text-xs text-[var(--text-muted)]">{c.email}</p>
                )}
                {c.linkedin_url && (
                  <a
                    href={c.linkedin_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block text-xs text-metatron-accent hover:underline"
                  >
                    LinkedIn →
                  </a>
                )}
                {c.notes && (
                  <p className="text-xs text-[var(--text-muted)] italic">
                    {c.notes}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5 space-y-3">
          <p className="text-sm font-semibold text-[var(--text)]">
            Bulk import via CSV
          </p>
          <p className="text-xs text-[var(--text-muted)]">
            Paste CSV with columns:{" "}
            <code className="text-metatron-accent">
              role, name, email, firm, linkedin, notes
            </code>
            <br />
            First row is header (skipped). Role must be{" "}
            <code className="text-metatron-accent">investor</code> or{" "}
            <code className="text-metatron-accent">founder</code>.
          </p>
          <form onSubmit={onCsvImport} className="space-y-3">
            <textarea
              className="input-metatron w-full resize-none font-mono text-xs"
              rows={6}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder={
                "role,name,email,firm,linkedin,notes\ninvestor,Jane Smith,jane@vc.com,Acme Ventures,,Invests in fintech\nfounder,John Doe,john@startup.com,Startup Inc,,Met at AfricArena"
              }
            />
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={csvImporting || !csvText.trim()}
                className="rounded-lg bg-metatron-accent px-4 py-2 text-sm font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-60"
              >
                {csvImporting ? "Importing…" : "Import CSV"}
              </button>
              {csvMsg && (
                <p className="text-xs text-[var(--text-muted)]">{csvMsg}</p>
              )}
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
