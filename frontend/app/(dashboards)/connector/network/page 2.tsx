"use client";

import {
  type ChangeEvent,
  FormEvent,
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as XLSX from "xlsx";
import { API_BASE, authHeaders, authJsonHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const PAGE_SIZE = 10;

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

type SheetPreviewRow = {
  role: string;
  name: string;
  firm_or_company: string;
  notes: string;
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
  const [view, setView] = useState<"card" | "list">("card");
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    email: "",
    firm_or_company: "",
    linkedin_url: "",
    notes: "",
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [editMsg, setEditMsg] = useState<string | null>(null);

  const sheetInputRef = useRef<HTMLInputElement>(null);
  const [sheetPreview, setSheetPreview] = useState<{
    investors: SheetPreviewRow[];
    founders: SheetPreviewRow[];
  } | null>(null);
  const [sheetImporting, setSheetImporting] = useState(false);
  const [sheetMsg, setSheetMsg] = useState<string | null>(null);

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

  const filtered = useMemo(
    () => contacts.filter((c) => c.role === tab),
    [contacts, tab],
  );

  useEffect(() => {
    setPage(1);
    setEditingId(null);
    setEditMsg(null);
  }, [tab]);

  useEffect(() => {
    const tp = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (page > tp) setPage(tp);
  }, [filtered.length, page]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const rangeStart =
    filtered.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, filtered.length);

  function openEdit(c: Contact) {
    setEditingId(c.id);
    setEditForm({
      name: c.name,
      email: c.email ?? "",
      firm_or_company: c.firm_or_company ?? "",
      linkedin_url: c.linkedin_url ?? "",
      notes: c.notes ?? "",
    });
    setEditMsg(null);
    setShowForm(false);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditMsg(null);
  }

  async function onSaveEdit(e: FormEvent, contact: Contact) {
    e.preventDefault();
    e.stopPropagation();
    if (!token) return;
    setSavingEdit(true);
    setEditMsg(null);
    try {
      const res = await fetch(
        `${API_BASE}/connector-profile/network/${contact.id}`,
        {
          method: "PUT",
          headers: authJsonHeaders(token),
          body: JSON.stringify({
            role: contact.role,
            name: editForm.name,
            email: editForm.email || null,
            firm_or_company: editForm.firm_or_company || null,
            linkedin_url: editForm.linkedin_url || null,
            notes: editForm.notes || null,
          }),
        },
      );
      if (!res.ok) {
        const t = await res.text();
        setEditMsg(t || "Could not save.");
        return;
      }
      const updated = (await res.json()) as Contact;
      setContacts((prev) =>
        prev.map((x) => (x.id === updated.id ? updated : x)),
      );
      setEditingId(null);
    } catch {
      setEditMsg("Could not save.");
    } finally {
      setSavingEdit(false);
    }
  }

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
      if (editingId === id) cancelEdit();
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

  function onSpreadsheetFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSheetMsg(null);
    setSheetPreview(null);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
          defval: "",
          raw: false,
        });

        if (rows.length === 0) {
          setSheetMsg("No data found in spreadsheet.");
          return;
        }

        const cell = (row: Record<string, unknown>, col: string | null) => {
          if (!col) return "";
          const v = row[col];
          return v == null ? "" : String(v).trim();
        };

        const headers = Object.keys(rows[0]);
        const find = (keywords: string[]) =>
          headers.find((h) =>
            keywords.some((k) => h.toLowerCase().includes(k)),
          ) ?? null;

        const nameCol = find([
          "deal name",
          "company name",
          "startup",
          "name",
        ]);
        const sectorCol = find(["sector"]);
        const stageCol = find(["stage"]);
        const locationCol = find(["location", "country", "region"]);
        const amountCol = find(["amount", "funding", "raised"]);
        const investorCol = find(["investor"]);
        const acceleratorCol = find(["accelerator"]);

        const founders: SheetPreviewRow[] = [];
        const investorMap = new Map<string, boolean>();

        for (const row of rows) {
          const name = nameCol ? cell(row, nameCol) : "";
          if (!name) continue;

          const parts: string[] = [];
          if (sectorCol && cell(row, sectorCol))
            parts.push(`Sector: ${cell(row, sectorCol)}`);
          if (stageCol && cell(row, stageCol))
            parts.push(`Stage: ${cell(row, stageCol)}`);
          if (locationCol && cell(row, locationCol))
            parts.push(`Location: ${cell(row, locationCol)}`);
          if (amountCol && cell(row, amountCol))
            parts.push(`Raised: ${cell(row, amountCol)}`);
          if (acceleratorCol && cell(row, acceleratorCol))
            parts.push(`Accelerator: ${cell(row, acceleratorCol)}`);

          founders.push({
            role: "founder",
            name,
            firm_or_company: name,
            notes: parts.join(" | "),
          });

          if (investorCol && cell(row, investorCol)) {
            const names = cell(row, investorCol)
              .split(/,|;/)
              .map((s) => s.trim())
              .filter((s) => s.length > 1 && s.length < 80);
            for (const inv of names) {
              if (!investorMap.has(inv.toLowerCase())) {
                investorMap.set(inv.toLowerCase(), true);
              }
            }
          }
        }

        const allInvestorNames = Array.from(
          new Set(
            rows.flatMap((r) =>
              investorCol && cell(r, investorCol)
                ? cell(r, investorCol)
                    .split(/,|;/)
                    .map((s) => s.trim())
                    .filter(Boolean)
                : [],
            ),
          ),
        );

        const investors: SheetPreviewRow[] = Array.from(
          investorMap.keys(),
        ).map((key) => {
          const originalName =
            allInvestorNames.find((n) => n.toLowerCase() === key) ?? key;
          return {
            role: "investor",
            name: originalName,
            firm_or_company: originalName,
            notes: "Imported from spreadsheet",
          };
        });

        setSheetPreview({ investors, founders });
      } catch {
        setSheetMsg("Could not parse spreadsheet. Try saving as CSV first.");
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  }

  async function onConfirmSheetImport(which: "all" | "investors" | "founders") {
    if (!token || !sheetPreview) return;
    setSheetImporting(true);
    setSheetMsg(null);

    const contacts =
      which === "all"
        ? [...sheetPreview.investors, ...sheetPreview.founders]
        : which === "investors"
          ? sheetPreview.investors
          : sheetPreview.founders;

    let totalImported = 0;
    let totalSkipped = 0;
    const CHUNK = 200;

    try {
      for (let i = 0; i < contacts.length; i += CHUNK) {
        const chunk = contacts.slice(i, i + CHUNK);
        const res = await fetch(`${API_BASE}/connector-profile/network/batch`, {
          method: "POST",
          headers: authJsonHeaders(token),
          body: JSON.stringify({
            contacts: chunk.map((c) => ({
              role: c.role,
              name: c.name,
              email: null,
              firm_or_company: c.firm_or_company || null,
              linkedin_url: null,
              notes: c.notes || null,
            })),
          }),
        });
        if (res.ok) {
          const d = (await res.json()) as { imported: number; skipped: number };
          totalImported += d.imported;
          totalSkipped += d.skipped;
        } else {
          const err = await res.text();
          setSheetMsg(err || "Batch import failed.");
          return;
        }
      }
      setSheetMsg(
        `Imported ${totalImported} contacts.${totalSkipped > 0 ? ` ${totalSkipped} skipped.` : ""}`,
      );
      setSheetPreview(null);
      void load();
    } catch {
      setSheetMsg("Import failed.");
    } finally {
      setSheetImporting(false);
    }
  }

  if (loading || !token) return null;

  const editFields = (contact: Contact) => (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="font-sans text-[11px] uppercase text-[var(--text-muted)]">
            Name *
          </span>
          <input
            className="input-metatron w-full"
            required
            value={editForm.name}
            onChange={(e) =>
              setEditForm((f) => ({ ...f, name: e.target.value }))
            }
            placeholder="Full name"
          />
        </label>
        <label className="block space-y-1">
          <span className="font-sans text-[11px] uppercase text-[var(--text-muted)]">
            {contact.role === "investor" ? "Firm" : "Company"}
          </span>
          <input
            className="input-metatron w-full"
            value={editForm.firm_or_company}
            onChange={(e) =>
              setEditForm((f) => ({ ...f, firm_or_company: e.target.value }))
            }
            placeholder={
              contact.role === "investor"
                ? "e.g. Acme Ventures"
                : "e.g. Acme Inc"
            }
          />
        </label>
        <label className="block space-y-1">
          <span className="font-sans text-[11px] uppercase text-[var(--text-muted)]">
            Email
          </span>
          <input
            className="input-metatron w-full"
            type="email"
            value={editForm.email}
            onChange={(e) =>
              setEditForm((f) => ({ ...f, email: e.target.value }))
            }
            placeholder="email@example.com"
          />
        </label>
        <label className="block space-y-1">
          <span className="font-sans text-[11px] uppercase text-[var(--text-muted)]">
            LinkedIn URL
          </span>
          <input
            className="input-metatron w-full"
            type="url"
            value={editForm.linkedin_url}
            onChange={(e) =>
              setEditForm((f) => ({ ...f, linkedin_url: e.target.value }))
            }
            placeholder="https://linkedin.com/in/..."
          />
        </label>
      </div>
      <label className="block space-y-1">
        <span className="font-sans text-[11px] uppercase text-[var(--text-muted)]">
          Notes
        </span>
        <textarea
          className="input-metatron w-full resize-none"
          rows={2}
          value={editForm.notes}
          onChange={(e) =>
            setEditForm((f) => ({ ...f, notes: e.target.value }))
          }
          placeholder="Notes"
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={savingEdit}
          className="rounded-lg bg-metatron-accent px-4 py-2 text-sm font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-60"
        >
          {savingEdit ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={cancelEdit}
          className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          Cancel
        </button>
        {editMsg && <p className="text-xs text-red-400">{editMsg}</p>}
      </div>
    </>
  );

  return (
    <main className="flex-1">
      <header className="border-b border-[var(--border)] px-6 py-4 md:px-10">
        <p className="mb-1 font-sans text-[11px] font-medium uppercase tracking-[2px] text-[var(--text-muted)]">
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
              <span className="ml-2 rounded-full bg-[var(--bg)] px-2 py-0.5 font-sans text-[10px] text-[var(--text-muted)]">
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
                <span className="font-sans text-[11px] uppercase text-[var(--text-muted)]">
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
                <span className="font-sans text-[11px] uppercase text-[var(--text-muted)]">
                  {tab === "investor" ? "Firm" : "Company"}
                </span>
                <input
                  className="input-metatron w-full"
                  value={form.firm_or_company}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, firm_or_company: e.target.value }))
                  }
                  placeholder={
                    tab === "investor"
                      ? "e.g. Acme Ventures"
                      : "e.g. Acme Inc"
                  }
                />
              </label>
              <label className="block space-y-1">
                <span className="font-sans text-[11px] uppercase text-[var(--text-muted)]">
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
                <span className="font-sans text-[11px] uppercase text-[var(--text-muted)]">
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
              <span className="font-sans text-[11px] uppercase text-[var(--text-muted)]">
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
          <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-4 md:p-5 space-y-4">
            <div className="flex items-center justify-end gap-1">
              <button
                type="button"
                onClick={() => {
                  setView("card");
                  setEditingId(null);
                  setEditMsg(null);
                }}
                aria-label="Card view"
                title="Card view"
                className={[
                  "rounded-lg p-2 transition-colors",
                  view === "card"
                    ? "bg-metatron-accent/15 text-metatron-accent"
                    : "text-[var(--text-muted)] hover:bg-[rgba(108,92,231,0.1)]",
                ].join(" ")}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden
                >
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => {
                  setView("list");
                  setEditingId(null);
                  setEditMsg(null);
                }}
                aria-label="List view"
                title="List view"
                className={[
                  "rounded-lg p-2 transition-colors",
                  view === "list"
                    ? "bg-metatron-accent/15 text-metatron-accent"
                    : "text-[var(--text-muted)] hover:bg-[rgba(108,92,231,0.1)]",
                ].join(" ")}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden
                >
                  <line x1="8" y1="6" x2="21" y2="6" strokeLinecap="round" />
                  <line x1="8" y1="12" x2="21" y2="12" strokeLinecap="round" />
                  <line x1="8" y1="18" x2="21" y2="18" strokeLinecap="round" />
                  <line x1="3" y1="6" x2="3.01" y2="6" strokeLinecap="round" />
                  <line
                    x1="3"
                    y1="12"
                    x2="3.01"
                    y2="12"
                    strokeLinecap="round"
                  />
                  <line
                    x1="3"
                    y1="18"
                    x2="3.01"
                    y2="18"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>

            {view === "card" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {paginated.map((c) => (
                  <div
                    key={c.id}
                    className="rounded-[var(--radius)] border border-[var(--border)] bg-[#0a0a0f] p-4 space-y-2"
                  >
                    {editingId === c.id ? (
                      <form
                        onSubmit={(e) => void onSaveEdit(e, c)}
                        className="space-y-4"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {editFields(c)}
                      </form>
                    ) : (
                      <>
                        <div
                          className="flex items-start justify-between gap-2 cursor-pointer"
                          onClick={() => openEdit(c)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              openEdit(c);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                        >
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
                          <div
                            className="flex shrink-0 items-center gap-2"
                            onClick={(e) => e.stopPropagation()}
                          >
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
                              <span className="inline-flex items-center rounded-full border border-[var(--border)] px-2 py-0.5 font-sans text-[10px] text-[var(--text-muted)]">
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
                          <p
                            className="text-xs text-[var(--text-muted)] cursor-pointer"
                            onClick={() => openEdit(c)}
                          >
                            {c.email}
                          </p>
                        )}
                        {c.linkedin_url && (
                          <a
                            href={c.linkedin_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-block text-xs text-metatron-accent hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            LinkedIn →
                          </a>
                        )}
                        {c.notes && (
                          <p
                            className="text-xs text-[var(--text-muted)] italic cursor-pointer"
                            onClick={() => openEdit(c)}
                          >
                            {c.notes}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto -mx-1">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)]">
                      <th className="pb-3 pr-3 font-sans text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                        Name
                      </th>
                      <th className="pb-3 pr-3 font-sans text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                        {tab === "investor" ? "Firm" : "Company"}
                      </th>
                      <th className="pb-3 pr-3 font-sans text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                        Email
                      </th>
                      <th className="pb-3 pr-3 font-sans text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                        Status
                      </th>
                      <th className="pb-3 font-sans text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map((c) => (
                      <Fragment key={c.id}>
                        <tr className="border-b border-[var(--border)] align-top">
                          <td className="py-3 pr-3 text-[var(--text)] font-medium">
                            {c.name}
                          </td>
                          <td className="py-3 pr-3 text-[var(--text-muted)]">
                            {c.firm_or_company ?? "—"}
                          </td>
                          <td className="py-3 pr-3 text-[var(--text-muted)]">
                            {c.email ?? "—"}
                          </td>
                          <td className="py-3 pr-3">
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
                              <span className="inline-flex items-center rounded-full border border-[var(--border)] px-2 py-0.5 font-sans text-[10px] text-[var(--text-muted)]">
                                Not yet
                              </span>
                            )}
                          </td>
                          <td className="py-3">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => openEdit(c)}
                                className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-metatron-accent/10 hover:text-metatron-accent transition-colors"
                                aria-label="Edit"
                                title="Edit"
                              >
                                <svg
                                  width="16"
                                  height="16"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  aria-hidden
                                >
                                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                onClick={() => void onDelete(c.id)}
                                className="rounded-lg p-1.5 text-[var(--text-muted)] hover:text-red-400 transition-colors"
                                aria-label="Remove"
                                title="Remove"
                              >
                                <svg
                                  width="16"
                                  height="16"
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
                          </td>
                        </tr>
                        {editingId === c.id && (
                          <tr className="border-b border-[var(--border)] bg-[rgba(108,92,231,0.06)]">
                            <td colSpan={5} className="p-4">
                              <form
                                onSubmit={(e) => void onSaveEdit(e, c)}
                                className="space-y-4 max-w-3xl"
                              >
                                {editFields(c)}
                              </form>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pt-2 border-t border-[var(--border)]">
              <p className="text-xs text-[var(--text-muted)]">
                Showing {rangeStart}–{rangeEnd} of {filtered.length}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text)] disabled:opacity-40 disabled:cursor-not-allowed hover:border-metatron-accent/30"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() =>
                    setPage((p) => Math.min(totalPages, p + 1))
                  }
                  className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text)] disabled:opacity-40 disabled:cursor-not-allowed hover:border-metatron-accent/30"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="rounded-[var(--radius)] border border-metatron-accent/20 bg-metatron-accent/5 p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[var(--text)]">
                Smart import from spreadsheet
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Upload any .xlsx, .xls, or .csv file. Kevin will detect columns
                and extract investors and founders automatically.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => sheetInputRef.current?.click()}
                className="rounded-lg bg-metatron-accent px-4 py-2 text-sm font-semibold text-white hover:bg-metatron-accent-hover"
              >
                Upload spreadsheet
              </button>
              <input
                ref={sheetInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={onSpreadsheetFile}
              />
            </div>
          </div>

          {sheetPreview && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4 space-y-4">
              <p className="text-sm font-semibold text-[var(--text)]">
                Extraction preview
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
                  <p className="font-sans text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                    Investors found
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-metatron-accent">
                    {sheetPreview.investors.length}
                  </p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    Unique firms extracted from investor column
                  </p>
                </div>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
                  <p className="font-sans text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                    Founders found
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-metatron-accent">
                    {sheetPreview.founders.length}
                  </p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    Startups with sector, stage and location
                  </p>
                </div>
              </div>
              <div className="text-xs text-[var(--text-muted)] bg-[var(--bg)] rounded-lg p-3 space-y-1">
                <p className="font-semibold text-[var(--text)]">
                  Sample investors:
                </p>
                {sheetPreview.investors.slice(0, 5).map((i, idx) => (
                  <p key={`${i.name}-${idx}`}>{i.name}</p>
                ))}
                {sheetPreview.investors.length > 5 && (
                  <p>…and {sheetPreview.investors.length - 5} more</p>
                )}
              </div>
              <div className="text-xs text-[var(--text-muted)] bg-[var(--bg)] rounded-lg p-3 space-y-1">
                <p className="font-semibold text-[var(--text)]">
                  Sample founders:
                </p>
                {sheetPreview.founders.slice(0, 5).map((f, idx) => (
                  <p key={`${f.name}-${idx}`}>
                    {f.name}{" "}
                    <span className="opacity-60">
                      — {f.notes.split(" | ")[0] || "—"}
                    </span>
                  </p>
                ))}
                {sheetPreview.founders.length > 5 && (
                  <p>…and {sheetPreview.founders.length - 5} more</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={sheetImporting}
                  onClick={() => void onConfirmSheetImport("all")}
                  className="rounded-lg bg-metatron-accent px-4 py-2 text-sm font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-60"
                >
                  {sheetImporting
                    ? "Importing…"
                    : `Import all ${sheetPreview.investors.length + sheetPreview.founders.length} contacts`}
                </button>
                <button
                  type="button"
                  disabled={sheetImporting}
                  onClick={() => void onConfirmSheetImport("investors")}
                  className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-60"
                >
                  Investors only ({sheetPreview.investors.length})
                </button>
                <button
                  type="button"
                  disabled={sheetImporting}
                  onClick={() => void onConfirmSheetImport("founders")}
                  className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-60"
                >
                  Founders only ({sheetPreview.founders.length})
                </button>
                <button
                  type="button"
                  onClick={() => setSheetPreview(null)}
                  className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {sheetMsg && (
            <p className="text-xs text-[var(--text-muted)]">{sheetMsg}</p>
          )}
        </div>

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
              className="input-metatron w-full resize-none font-sans text-xs"
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
