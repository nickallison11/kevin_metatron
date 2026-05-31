"use client";

import { useEffect, useRef, useState } from "react";
import { API_BASE, authHeaders, authJsonHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type RoleTarget = "all" | "STARTUP" | "INVESTOR" | "INTERMEDIARY";
type BodyMode = "paste" | "upload";

type KnowledgeRow = {
  id: string;
  title: string;
  body: string;
  role_target: RoleTarget;
  created_at: string;
};

const ROLE_LABELS: Record<RoleTarget, string> = {
  all: "All roles",
  STARTUP: "Founders only",
  INVESTOR: "Investors only",
  INTERMEDIARY: "Connectors only",
};

export default function AdminKevinKnowledgePage() {
  const { token, loading: authLoading } = useAuth();
  const [rows, setRows] = useState<KnowledgeRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [bodyMode, setBodyMode] = useState<BodyMode>("paste");

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [roleTarget, setRoleTarget] = useState<RoleTarget>("all");
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    if (!token) return;
    const res = await fetch(`${API_BASE}/api/admin/kevin/knowledge`, {
      headers: authHeaders(token),
    });
    if (!res.ok) throw new Error(await res.text());
    setRows(await res.json());
  }

  useEffect(() => {
    if (!token || authLoading) return;
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Could not load");
      }
    })();
    return () => { cancelled = true; };
  }, [token, authLoading]);

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !token) return;
    setUploading(true);
    setUploadErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${API_BASE}/api/admin/kevin/knowledge/upload`, {
        method: "POST",
        headers: authHeaders(token),
        body: fd,
      });
      if (!res.ok) throw new Error(await res.text());
      const { text, filename } = await res.json();
      setBody(text);
      if (!title.trim()) {
        setTitle(filename.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "));
      }
      setBodyMode("paste");
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !title.trim() || !body.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/kevin/knowledge`, {
        method: "POST",
        headers: authJsonHeaders(token),
        body: JSON.stringify({ title: title.trim(), body: body.trim(), role_target: roleTarget }),
      });
      if (!res.ok) throw new Error(await res.text());
      setTitle("");
      setBody("");
      setRoleTarget("all");
      setBodyMode("paste");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string, entryTitle: string) {
    if (!token) return;
    if (!window.confirm(`Delete "${entryTitle}"?`)) return;
    setErr(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/kevin/knowledge/${id}`, {
        method: "DELETE",
        headers: authHeaders(token),
      });
      if (!res.ok && res.status !== 204) throw new Error(await res.text());
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not delete");
    }
  }

  if (authLoading || !token) {
    return <div className="p-8 md:p-10"><p className="text-sm text-[var(--text-muted)]">Loading…</p></div>;
  }

  const tabClass = (mode: BodyMode) =>
    `px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
      bodyMode === mode
        ? "bg-[var(--bg-card)] text-[var(--text)] border border-[var(--border)]"
        : "text-[var(--text-muted)] hover:text-[var(--text)]"
    }`;

  return (
    <main className="min-w-0">
      <header className="border-b border-[var(--border)] px-6 py-4 md:px-10">
        <p className="font-sans text-[11px] font-medium uppercase tracking-[2px] text-[var(--text-muted)] mb-1">
          Admin · Kevin
        </p>
        <h1 className="text-lg font-semibold">Knowledge</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Gospel documents injected into every Kevin conversation. Kevin treats these as authoritative.
        </p>
      </header>

      <section className="p-6 md:p-10 space-y-10 max-w-3xl">
        {err && <p className="text-sm text-[rgb(254,202,202)]">{err}</p>}

        {/* Add form */}
        <div>
          <h2 className="text-sm font-semibold mb-4">Add entry</h2>
          <form onSubmit={handleAdd} className="space-y-4">
            <label className="block space-y-1">
              <span className="font-sans text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Title</span>
              <input
                className="input-metatron w-full"
                placeholder="e.g. Investment thesis, Intro process, Pricing FAQ"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </label>

            {/* Body — tab toggle */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-sans text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Body</span>
                <div className="flex items-center gap-1 bg-[var(--bg)] rounded-lg p-1">
                  <button type="button" className={tabClass("paste")} onClick={() => setBodyMode("paste")}>
                    Paste text
                  </button>
                  <button type="button" className={tabClass("upload")} onClick={() => setBodyMode("upload")}>
                    Upload document
                  </button>
                </div>
              </div>

              {bodyMode === "paste" ? (
                <textarea
                  className="input-metatron w-full min-h-[160px] font-mono text-sm"
                  placeholder="Paste or type the content Kevin should treat as gospel…"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  required
                />
              ) : (
                <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5 flex flex-col items-center gap-3 min-h-[120px] justify-center">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.md,.pdf"
                    className="hidden"
                    onChange={handleFileUpload}
                    disabled={uploading}
                  />
                  <button
                    type="button"
                    className="btn-metatron-primary px-5 py-2 text-sm disabled:opacity-50"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {uploading ? "Extracting…" : "Choose file"}
                  </button>
                  <p className="text-xs text-[var(--text-muted)]">.txt · .md · .pdf supported</p>
                  {uploadErr && <p className="text-xs text-[rgb(254,202,202)]">{uploadErr}</p>}
                  {body && !uploadErr && (
                    <p className="text-xs text-[var(--text-muted)]">
                      Text extracted — switch to <strong className="text-[var(--text)]">Paste text</strong> to review before saving
                    </p>
                  )}
                </div>
              )}
            </div>

            <label className="block space-y-1">
              <span className="font-sans text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Show to</span>
              <select
                className="input-metatron w-full"
                value={roleTarget}
                onChange={(e) => setRoleTarget(e.target.value as RoleTarget)}
              >
                <option value="all">All roles</option>
                <option value="STARTUP">Founders only</option>
                <option value="INVESTOR">Investors only</option>
                <option value="INTERMEDIARY">Connectors only</option>
              </select>
            </label>

            <button
              type="submit"
              disabled={saving || !title.trim() || !body.trim()}
              className="btn-metatron-primary px-5 py-2 text-sm disabled:opacity-50"
            >
              {saving ? "Saving…" : "Add to Kevin"}
            </button>
          </form>
        </div>

        {/* Entry list */}
        <div>
          <h2 className="text-sm font-semibold mb-4">
            Current knowledge {rows !== null ? `(${rows.length})` : ""}
          </h2>
          {rows === null ? (
            <p className="text-sm text-[var(--text-muted)]">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No entries yet. Add one above.</p>
          ) : (
            <div className="space-y-3">
              {rows.map((row) => (
                <div
                  key={row.id}
                  className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-4 space-y-2"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-medium text-sm text-[var(--text)]">{row.title}</p>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">
                        {ROLE_LABELS[row.role_target]} · {row.created_at.slice(0, 10)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDelete(row.id, row.title)}
                      className="shrink-0 text-[11px] text-[var(--text-muted)] hover:text-[rgb(254,202,202)]"
                    >
                      Delete
                    </button>
                  </div>
                  <pre className="text-xs text-[var(--text-muted)] whitespace-pre-wrap font-mono leading-relaxed max-h-40 overflow-y-auto">
                    {row.body}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
