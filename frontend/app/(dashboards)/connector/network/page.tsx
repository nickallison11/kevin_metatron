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

type StagedContact = {
  id: string;
  role: "investor" | "founder";
  name: string;
  firm_or_company: string | null;
  raw_notes: string | null;
  contact_name: string | null;
  email: string | null;
  linkedin_url: string | null;
  website: string | null;
  sector_focus: string | null;
  stage_focus: string | null;
  ticket_size: string | null;
  geography: string | null;
  one_liner: string | null;
  status: "pending" | "enriching" | "enriched" | "failed";
  enrichment_error: string | null;
  created_at: string;
  enriched_at: string | null;
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
  const [sheetMsg, setSheetMsg] = useState<string | null>(null);

  const [staged, setStaged] = useState<StagedContact[]>([]);
  const [stagingLoading, setStagingLoading] = useState(false);
  const [stagingMsg, setStagingMsg] = useState<string | null>(null);
  const [stagingTab, setStagingTab] = useState<"investor" | "founder" | "all">("investor");
  const [stagingView, setStagingView] = useState<"table" | "cards">("table");
  const [selectedStaged, setSelectedStaged] = useState<Set<string>>(new Set());
  const [importingStaged, setImportingStaged] = useState(false);
  const [editingStagedId, setEditingStagedId] = useState<string | null>(null);
  const [editStagedForm, setEditStagedForm] = useState<Partial<StagedContact>>({});
  const [savingStagedEdit, setSavingStagedEdit] = useState(false);

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
    const res = await fetch(`${API_BASE}/connector-profile/network`, { headers: authHeaders(token) });
    if (res.ok) setContacts(await res.json());
  }, [token]);

  const loadStaging = useCallback(async () => {
    if (!token) return;
    setStagingLoading(true);
    const res = await fetch(`${API_BASE}/connector-profile/network/staging`, { headers: authHeaders(token) });
    if (res.ok) setStaged(await res.json());
    setStagingLoading(false);
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    loadStaging();
  }, [loadStaging]);

  useEffect(() => {
    const hasEnriching = staged.some((s) => s.status === "enriching");
    if (!hasEnriching) return;
    const timer = setInterval(() => loadStaging(), 3000);
    return () => clearInterval(timer);
  }, [staged, loadStaging]);

  const enrichingInStaging = staged.filter((s) => s.status === "enriching").length;

  const filtered = useMemo(() => contacts.filter((c) => c.role === tab), [contacts, tab]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const filteredStaged = useMemo(
    () => (stagingTab === "all" ? staged : staged.filter((s) => s.role === stagingTab)),
    [staged, stagingTab],
  );

  const investorCount = contacts.filter((c) => c.role === "investor").length;
  const founderCount = contacts.filter((c) => c.role === "founder").length;
  const stagedInvestorCount = staged.filter((s) => s.role === "investor").length;
  const stagedFounderCount = staged.filter((s) => s.role === "founder").length;
  const stagedEnrichedCount = staged.filter((s) => s.status === "enriched").length;
  const stagedPendingCount = staged.filter((s) => s.status === "pending" || s.status === "failed").length;

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setAdding(true);
    const res = await fetch(`${API_BASE}/connector-profile/network`, {
      method: "POST",
      headers: authJsonHeaders(token),
      body: JSON.stringify(form),
    });
    if (res.ok) {
      setMsg("Contact added.");
      setForm({ role: "investor", name: "", email: "", firm_or_company: "", linkedin_url: "", notes: "" });
      setShowForm(false);
      load();
    } else {
      setMsg("Error adding contact.");
    }
    setAdding(false);
    setTimeout(() => setMsg(null), 3000);
  }

  async function onDelete(id: string) {
    if (!token || !confirm("Delete this contact?")) return;
    await fetch(`${API_BASE}/connector-profile/network/${id}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
    load();
  }

  function startEdit(c: Contact) {
    setEditingId(c.id);
    setEditForm({
      name: c.name,
      email: c.email ?? "",
      firm_or_company: c.firm_or_company ?? "",
      linkedin_url: c.linkedin_url ?? "",
      notes: c.notes ?? "",
    });
    setEditMsg(null);
  }

  async function onSaveEdit(c: Contact) {
    if (!token) return;
    setSavingEdit(true);
    const res = await fetch(`${API_BASE}/connector-profile/network/${c.id}`, {
      method: "PUT",
      headers: authJsonHeaders(token),
      body: JSON.stringify({ role: c.role, ...editForm }),
    });
    if (res.ok) {
      setEditingId(null);
      load();
    } else {
      setEditMsg("Save failed.");
    }
    setSavingEdit(false);
  }

  async function onCsvImport() {
    if (!token || !csvText.trim()) return;
    setCsvImporting(true);
    const res = await fetch(`${API_BASE}/connector-profile/network/csv`, {
      method: "POST",
      headers: authJsonHeaders(token),
      body: JSON.stringify({ csv: csvText }),
    });
    if (res.ok) {
      const data = await res.json();
      setCsvMsg(`Imported ${data.imported}, skipped ${data.skipped}.`);
      setCsvText("");
      load();
    } else {
      setCsvMsg("Import failed.");
    }
    setCsvImporting(false);
  }

  function onSheetFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSheetMsg(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target!.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        // Read all sheets and combine, skipping sheets with no useful headers
        const rows: Record<string, unknown>[] = [];
        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          const sheetRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
          if (sheetRows.length > 0) {
            const firstRowKeys = Object.keys(sheetRows[0]).map((k) => k.toLowerCase());
            // Only include sheets that look like contact data (name/email/firm-style columns)
            if (
              firstRowKeys.some(
                (k) =>
                  k.includes("name") ||
                  k.includes("email") ||
                  k.includes("firm") ||
                  k.includes("company") ||
                  k.includes("investor"),
              )
            ) {
              rows.push(...sheetRows);
            }
          }
        }
        if (rows.length === 0) {
          setSheetMsg("No data found in spreadsheet.");
          return;
        }

        const originalHeaders = Object.keys(rows[0]);
        const lc = (s: string) => s.toLowerCase().trim();

        const find = (...terms: string[]) =>
          originalHeaders.find((h) => terms.some((t) => lc(h).includes(t)));

        const col = {
          investorList: find("investor", "funder", "vc", "backer"),
          name: find("name", "contact", "full name", "first name"),
          firm: find("firm", "fund", "company", "organisation", "organization", "startup", "deal"),
          email: find("email", "e-mail", "mail"),
          linkedin: find("linkedin", "linked in", "profile"),
          website: find("website", "url", "web", "site"),
          sector: find("sector", "industry", "focus", "vertical", "thesis"),
          stage: find("stage", "round", "series"),
          ticket: find("ticket", "check", "cheque", "size", "amount", "raised", "funding", "usd", "$"),
          geo: find("geo", "location", "country", "city", "region", "hq"),
          role: find("role", "type"),
        };

        const str = (row: Record<string, unknown>, key: string | undefined) =>
          key ? String(row[key] ?? "").trim() : "";

        const investorRows: SheetPreviewRow[] = [];
        const founderRows: SheetPreviewRow[] = [];

        if (col.investorList) {
          const investorSet = new Set<string>();
          for (const row of rows) {
            const val = str(row, col.investorList);
            if (val) {
              const names = val
                .split(/,|;|\/| and /)
                .map((s) => s.trim())
                .filter((s) => s.length > 1);
              for (const inv of names) {
                const norm = inv.toLowerCase();
                if (!investorSet.has(norm) && !norm.includes("unnamed") && !norm.includes("undisclosed")) {
                  investorSet.add(norm);
                  investorRows.push({ role: "investor", name: inv, firm_or_company: inv, notes: "" });
                }
              }
            }
            const founderName = str(row, col.firm) || str(row, col.name);
            if (founderName) {
              const notesParts = [
                str(row, col.sector) && `Sector: ${str(row, col.sector)}`,
                str(row, col.stage) && `Stage: ${str(row, col.stage)}`,
                str(row, col.geo) && `Location: ${str(row, col.geo)}`,
                str(row, col.ticket) && `Amount: ${str(row, col.ticket)}`,
              ].filter(Boolean);
              founderRows.push({
                role: "founder",
                name: founderName,
                firm_or_company: founderName,
                notes: notesParts.join(" | "),
              });
            }
          }
        } else {
          const investorSet = new Set<string>();
          for (const row of rows) {
            const roleVal = str(row, col.role).toLowerCase();
            const isFounder = roleVal.includes("founder") || roleVal.includes("startup");
            const name = str(row, col.name) || str(row, col.firm);
            const firm = str(row, col.firm) || str(row, col.name);
            if (!name) continue;
            const norm = name.toLowerCase();
            if (investorSet.has(norm)) continue;
            investorSet.add(norm);

            const email = str(row, col.email);
            const linkedin = str(row, col.linkedin);
            const website = str(row, col.website);
            const sector = str(row, col.sector);
            const stage = str(row, col.stage);
            const ticket = str(row, col.ticket);
            const geo = str(row, col.geo);

            const notesParts = [
              email && `Email: ${email}`,
              linkedin && `LinkedIn: ${linkedin}`,
              website && `Website: ${website}`,
              sector && `Sector: ${sector}`,
              stage && `Stage: ${stage}`,
              ticket && `Ticket: ${ticket}`,
              geo && `Location: ${geo}`,
            ].filter(Boolean);

            const contact: SheetPreviewRow = {
              role: isFounder ? "founder" : "investor",
              name,
              firm_or_company: firm,
              notes: notesParts.join(" | "),
            };

            if (isFounder) founderRows.push(contact);
            else investorRows.push(contact);
          }
        }

        if (investorRows.length === 0 && founderRows.length === 0) {
          setSheetMsg("No contacts found. Check that your spreadsheet has name, email, or firm columns.");
          return;
        }

        setSheetPreview({ investors: investorRows, founders: founderRows });
      } catch {
        setSheetMsg("Could not parse spreadsheet. Try saving as CSV first.");
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  }

  async function onStageContacts(which: "all" | "investors" | "founders") {
    if (!token || !sheetPreview) return;
    const toStage =
      which === "all"
        ? [...sheetPreview.investors, ...sheetPreview.founders]
        : which === "investors"
          ? sheetPreview.investors
          : sheetPreview.founders;

    setSheetMsg("Staging contacts...");
    const CHUNK = 200;
    let totalStaged = 0;
    for (let i = 0; i < toStage.length; i += CHUNK) {
      const chunk = toStage.slice(i, i + CHUNK).map((r) => ({
        role: r.role,
        name: r.name,
        firm_or_company: r.firm_or_company || null,
        raw_notes: r.notes || null,
      }));
      const res = await fetch(`${API_BASE}/connector-profile/network/stage`, {
        method: "POST",
        headers: authJsonHeaders(token),
        body: JSON.stringify({ contacts: chunk }),
      });
      if (res.ok) {
        const data = await res.json();
        totalStaged += data.staged ?? 0;
      }
    }
    setSheetMsg(`Staged ${totalStaged} contacts for enrichment. See the Staging section below.`);
    setSheetPreview(null);
    loadStaging();
  }

  async function onEnrichSelected() {
    if (!token || selectedStaged.size === 0) return;
    const res = await fetch(`${API_BASE}/connector-profile/network/staging/enrich`, {
      method: "POST",
      headers: authJsonHeaders(token),
      body: JSON.stringify({ ids: Array.from(selectedStaged) }),
    });
    if (res.ok) {
      setStagingMsg(`Enriching ${selectedStaged.size} contacts with Kevin...`);
      setSelectedStaged(new Set());
      loadStaging();
    }
  }

  async function onEnrichAll(role?: "investor" | "founder") {
    if (!token) return;
    const res = await fetch(`${API_BASE}/connector-profile/network/staging/enrich`, {
      method: "POST",
      headers: authJsonHeaders(token),
      body: JSON.stringify({ role: role ?? null }),
    });
    if (res.ok) {
      const data = await res.json();
      setStagingMsg(`Enriching ${data.enriching} contacts... this runs in the background.`);
      loadStaging();
    }
  }

  async function onImportEnriched(ids?: string[]) {
    if (!token) return;
    setImportingStaged(true);
    const res = await fetch(`${API_BASE}/connector-profile/network/staging/import`, {
      method: "POST",
      headers: authJsonHeaders(token),
      body: JSON.stringify({ ids: ids ?? null }),
    });
    if (res.ok) {
      const data = await res.json();
      setStagingMsg(`Imported ${data.imported} contacts to your network.`);
      loadStaging();
      load();
    }
    setImportingStaged(false);
  }

  async function onClearStaging() {
    if (!token || !confirm("Clear all staged contacts?")) return;
    await fetch(`${API_BASE}/connector-profile/network/staging`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
    setStaged([]);
    setStagingMsg("Staging cleared.");
  }

  async function onDeleteStaged(id: string) {
    if (!token) return;
    await fetch(`${API_BASE}/connector-profile/network/staging/${id}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
    setStaged((prev) => prev.filter((s) => s.id !== id));
  }

  function startEditStaged(s: StagedContact) {
    setEditingStagedId(s.id);
    setEditStagedForm({
      contact_name: s.contact_name ?? "",
      email: s.email ?? "",
      linkedin_url: s.linkedin_url ?? "",
      website: s.website ?? "",
      sector_focus: s.sector_focus ?? "",
      stage_focus: s.stage_focus ?? "",
      ticket_size: s.ticket_size ?? "",
      geography: s.geography ?? "",
      one_liner: s.one_liner ?? "",
    });
  }

  async function onSaveStagedEdit(id: string) {
    if (!token) return;
    setSavingStagedEdit(true);
    const res = await fetch(`${API_BASE}/connector-profile/network/staging/${id}`, {
      method: "PUT",
      headers: authJsonHeaders(token),
      body: JSON.stringify(editStagedForm),
    });
    if (res.ok) {
      setEditingStagedId(null);
      loadStaging();
    }
    setSavingStagedEdit(false);
  }

  if (loading) return null;

  const statusBadge = (status: StagedContact["status"]) => {
    const map = {
      pending: "bg-[rgba(255,255,255,0.06)] text-[#8888a0]",
      enriching: "bg-[rgba(108,92,231,0.15)] text-[#6c5ce7] animate-pulse",
      enriched: "bg-[rgba(0,200,100,0.12)] text-green-400",
      failed: "bg-[rgba(255,80,80,0.12)] text-red-400",
    };
    return (
      <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[status]}`}>{status}</span>
    );
  };

  return (
    <div className="space-y-6 px-6 py-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[#e8e8ed]">My Network</h1>
          <p className="text-[#8888a0] text-sm mt-1">Manage and enrich your investor and founder contacts</p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="px-4 py-2 bg-[#6c5ce7] text-white rounded-xl text-sm font-medium hover:bg-[#7d6ff0]"
        >
          {showForm ? "Cancel" : "+ Add Contact"}
        </button>
      </div>

      {msg && <p className="text-sm text-[#6c5ce7]">{msg}</p>}

      {showForm && (
        <form
          onSubmit={onAdd}
          className="bg-[#16161f] border border-[rgba(255,255,255,0.06)] rounded-xl p-5 space-y-4"
        >
          <h2 className="text-sm font-semibold text-[#e8e8ed]">Add Contact</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-[#8888a0] mb-1">Role</label>
              <select
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as "investor" | "founder" }))}
                className="w-full bg-[#0a0a0f] border border-[rgba(255,255,255,0.06)] rounded-xl px-3 py-2 text-sm text-[#e8e8ed]"
              >
                <option value="investor">Investor</option>
                <option value="founder">Founder</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-[#8888a0] mb-1">Name *</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full bg-[#0a0a0f] border border-[rgba(255,255,255,0.06)] rounded-xl px-3 py-2 text-sm text-[#e8e8ed]"
                placeholder="Full name"
              />
            </div>
            <div>
              <label className="block text-xs text-[#8888a0] mb-1">Email</label>
              <input
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full bg-[#0a0a0f] border border-[rgba(255,255,255,0.06)] rounded-xl px-3 py-2 text-sm text-[#e8e8ed]"
                placeholder="email@example.com"
              />
            </div>
            <div>
              <label className="block text-xs text-[#8888a0] mb-1">Firm / Company</label>
              <input
                value={form.firm_or_company}
                onChange={(e) => setForm((f) => ({ ...f, firm_or_company: e.target.value }))}
                className="w-full bg-[#0a0a0f] border border-[rgba(255,255,255,0.06)] rounded-xl px-3 py-2 text-sm text-[#e8e8ed]"
                placeholder="Acme Ventures"
              />
            </div>
            <div>
              <label className="block text-xs text-[#8888a0] mb-1">LinkedIn</label>
              <input
                value={form.linkedin_url}
                onChange={(e) => setForm((f) => ({ ...f, linkedin_url: e.target.value }))}
                className="w-full bg-[#0a0a0f] border border-[rgba(255,255,255,0.06)] rounded-xl px-3 py-2 text-sm text-[#e8e8ed]"
                placeholder="https://linkedin.com/in/..."
              />
            </div>
            <div>
              <label className="block text-xs text-[#8888a0] mb-1">Notes</label>
              <input
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                className="w-full bg-[#0a0a0f] border border-[rgba(255,255,255,0.06)] rounded-xl px-3 py-2 text-sm text-[#e8e8ed]"
                placeholder="Met at AfricArena..."
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={adding}
            className="px-4 py-2 bg-[#6c5ce7] text-white rounded-xl text-sm font-medium hover:bg-[#7d6ff0] disabled:opacity-50"
          >
            {adding ? "Adding..." : "Add Contact"}
          </button>
        </form>
      )}

      <div className="bg-[#16161f] border border-[rgba(255,255,255,0.06)] rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex gap-2">
            {(["investor", "founder"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTab(t);
                  setPage(1);
                }}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  tab === t ? "bg-[#6c5ce7] text-white" : "text-[#8888a0] hover:text-[#e8e8ed]"
                }`}
              >
                {t === "investor" ? "Investors" : "Founders"}
                <span className="ml-1.5 text-xs opacity-70">({t === "investor" ? investorCount : founderCount})</span>
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            {(["card", "list"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`px-3 py-1 rounded-lg text-xs ${
                  view === v ? "bg-[rgba(108,92,231,0.2)] text-[#6c5ce7]" : "text-[#8888a0] hover:text-[#e8e8ed]"
                }`}
              >
                {v === "card" ? "Cards" : "List"}
              </button>
            ))}
          </div>
        </div>

        {paginated.length === 0 ? (
          <p className="text-[#8888a0] text-sm text-center py-8">No {tab}s yet.</p>
        ) : view === "card" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {paginated.map((c) => (
              <div key={c.id} className="bg-[#0a0a0f] border border-[rgba(255,255,255,0.06)] rounded-xl p-4">
                {editingId === c.id ? (
                  <div className="space-y-2">
                    {(["name", "email", "firm_or_company", "linkedin_url", "notes"] as const).map((f) => (
                      <input
                        key={f}
                        value={editForm[f]}
                        onChange={(e) => setEditForm((ef) => ({ ...ef, [f]: e.target.value }))}
                        placeholder={f.replace(/_/g, " ")}
                        className="w-full bg-[#16161f] border border-[rgba(255,255,255,0.06)] rounded-lg px-2 py-1.5 text-xs text-[#e8e8ed]"
                      />
                    ))}
                    {editMsg && <p className="text-xs text-red-400">{editMsg}</p>}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => onSaveEdit(c)}
                        disabled={savingEdit}
                        className="px-3 py-1 bg-[#6c5ce7] text-white rounded-lg text-xs"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="px-3 py-1 text-[#8888a0] text-xs"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-sm font-medium text-[#e8e8ed]">{c.name}</p>
                        {c.firm_or_company && <p className="text-xs text-[#8888a0]">{c.firm_or_company}</p>}
                      </div>
                      <div className="flex gap-1">
                        <button type="button" onClick={() => startEdit(c)} className="text-xs text-[#6c5ce7] hover:underline">
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(c.id)}
                          className="text-xs text-red-400 hover:underline ml-2"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    {c.email && <p className="text-xs text-[#8888a0] mt-1">{c.email}</p>}
                    {c.notes && <p className="text-xs text-[#8888a0] mt-1 line-clamp-2">{c.notes}</p>}
                    {c.joined_user_id && (
                      <span className="mt-2 inline-block text-xs bg-[rgba(108,92,231,0.15)] text-[#6c5ce7] px-2 py-0.5 rounded-full">
                        On platform
                      </span>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[#8888a0] text-xs border-b border-[rgba(255,255,255,0.06)]">
                  <th className="text-left pb-2">Name</th>
                  <th className="text-left pb-2">Firm</th>
                  <th className="text-left pb-2">Email</th>
                  <th className="text-left pb-2">Notes</th>
                  <th className="text-left pb-2" />
                </tr>
              </thead>
              <tbody>
                {paginated.map((c) => (
                  <tr key={c.id} className="border-b border-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.02)]">
                    <td className="py-2 text-[#e8e8ed]">{c.name}</td>
                    <td className="py-2 text-[#8888a0] text-xs">{c.firm_or_company ?? "—"}</td>
                    <td className="py-2 text-[#8888a0] text-xs">{c.email ?? "—"}</td>
                    <td className="py-2 text-[#8888a0] text-xs max-w-xs truncate">{c.notes ?? "—"}</td>
                    <td className="py-2 flex gap-2">
                      <button type="button" onClick={() => startEdit(c)} className="text-xs text-[#6c5ce7] hover:underline">
                        Edit
                      </button>
                      <button type="button" onClick={() => onDelete(c.id)} className="text-xs text-red-400 hover:underline">
                        Del
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 text-xs text-[#8888a0]">
            <span>
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 bg-[rgba(255,255,255,0.06)] rounded-lg disabled:opacity-30"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 bg-[rgba(255,255,255,0.06)] rounded-lg disabled:opacity-30"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="bg-[#16161f] border border-[rgba(255,255,255,0.06)] rounded-xl p-5 space-y-5">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-[#e8e8ed]">Enrichment Staging</h2>
            <p className="text-xs text-[#8888a0] mt-0.5">
              Upload a spreadsheet, Kevin enriches each contact with web data, then you import to your network.
            </p>
          </div>
          <div className="flex gap-2 items-center flex-wrap justify-end">
            {staged.length > 0 && (
              <>
                {stagedPendingCount > 0 && (
                  <button
                    type="button"
                    onClick={() => onEnrichAll()}
                    className="px-3 py-1.5 bg-[#6c5ce7] text-white rounded-xl text-xs font-medium hover:bg-[#7d6ff0]"
                  >
                    Enrich all pending ({stagedPendingCount})
                  </button>
                )}
                {stagedEnrichedCount > 0 && (
                  <button
                    type="button"
                    onClick={() => onImportEnriched()}
                    disabled={importingStaged}
                    className="px-3 py-1.5 bg-green-600 text-white rounded-xl text-xs font-medium hover:bg-green-500 disabled:opacity-50"
                  >
                    {importingStaged ? "Importing..." : `Import enriched (${stagedEnrichedCount})`}
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClearStaging}
                  className="px-3 py-1.5 bg-[rgba(255,80,80,0.1)] text-red-400 rounded-xl text-xs hover:bg-[rgba(255,80,80,0.2)]"
                >
                  Clear all
                </button>
              </>
            )}
          </div>
        </div>

        {stagingMsg && <p className="text-xs text-[#6c5ce7]">{stagingMsg}</p>}
        {stagingLoading && staged.length === 0 && <p className="text-xs text-[#8888a0]">Loading staging…</p>}
        {enrichingInStaging > 0 && (
          <div className="flex items-center gap-2 text-xs text-[#6c5ce7] animate-pulse">
            <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <circle cx="12" cy="12" r="10" strokeWidth="2" strokeDasharray="32" strokeLinecap="round" />
            </svg>
            Enriching {enrichingInStaging} contacts in background...
          </div>
        )}

        <div className="border border-[rgba(255,255,255,0.06)] rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-sm font-medium text-[#e8e8ed]">Smart import from spreadsheet</p>
              <p className="text-xs text-[#8888a0]">
                Upload any .xlsx, .xls, or .csv file. Kevin will detect columns and extract investors and founders.
              </p>
            </div>
            <button
              type="button"
              onClick={() => sheetInputRef.current?.click()}
              className="px-4 py-2 bg-[#6c5ce7] text-white rounded-xl text-sm font-medium hover:bg-[#7d6ff0] whitespace-nowrap"
            >
              Upload spreadsheet
            </button>
            <input ref={sheetInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onSheetFile} />
          </div>

          {sheetMsg && <p className="text-xs text-[#8888a0]">{sheetMsg}</p>}

          {sheetPreview && (
            <div className="border border-[rgba(255,255,255,0.06)] rounded-xl p-4 space-y-4">
              <p className="text-sm font-medium text-[#e8e8ed]">Extraction preview</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-[#0a0a0f] rounded-xl p-3">
                  <p className="text-xs text-[#8888a0] uppercase tracking-wide mb-1">Investors found</p>
                  <p className="text-2xl font-bold text-[#6c5ce7]">{sheetPreview.investors.length}</p>
                  <p className="text-xs text-[#8888a0]">Unique firms extracted from investor column</p>
                </div>
                <div className="bg-[#0a0a0f] rounded-xl p-3">
                  <p className="text-xs text-[#8888a0] uppercase tracking-wide mb-1">Founders found</p>
                  <p className="text-2xl font-bold text-[#6c5ce7]">{sheetPreview.founders.length}</p>
                  <p className="text-xs text-[#8888a0]">Startups with sector, stage and location</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 text-xs text-[#8888a0]">
                <div>
                  <p className="font-medium text-[#e8e8ed] mb-1">Sample investors:</p>
                  {sheetPreview.investors.slice(0, 5).map((i, idx) => (
                    <p key={idx}>{i.name}</p>
                  ))}
                  {sheetPreview.investors.length > 5 && <p>…and {sheetPreview.investors.length - 5} more</p>}
                </div>
                <div>
                  <p className="font-medium text-[#e8e8ed] mb-1">Sample founders:</p>
                  {sheetPreview.founders.slice(0, 5).map((f, idx) => (
                    <p key={idx}>
                      {f.name}
                      {f.notes && ` — ${f.notes.split(" | ")[0]}`}
                    </p>
                  ))}
                  {sheetPreview.founders.length > 5 && <p>…and {sheetPreview.founders.length - 5} more</p>}
                </div>
              </div>
              <p className="text-xs text-[#8888a0]">
                These will be staged for enrichment — Kevin will search the web to fill in contact details, sectors,
                ticket sizes, and more before you import.
              </p>
              <div className="flex gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => onStageContacts("all")}
                  className="px-4 py-2 bg-[#6c5ce7] text-white rounded-xl text-sm font-medium hover:bg-[#7d6ff0]"
                >
                  Stage all {sheetPreview.investors.length + sheetPreview.founders.length} for enrichment
                </button>
                <button
                  type="button"
                  onClick={() => onStageContacts("investors")}
                  className="px-3 py-2 bg-[rgba(108,92,231,0.15)] text-[#6c5ce7] rounded-xl text-sm hover:bg-[rgba(108,92,231,0.25)]"
                >
                  Investors only ({sheetPreview.investors.length})
                </button>
                <button
                  type="button"
                  onClick={() => onStageContacts("founders")}
                  className="px-3 py-2 bg-[rgba(108,92,231,0.15)] text-[#6c5ce7] rounded-xl text-sm hover:bg-[rgba(108,92,231,0.25)]"
                >
                  Founders only ({sheetPreview.founders.length})
                </button>
                <button type="button" onClick={() => setSheetPreview(null)} className="px-3 py-2 text-[#8888a0] text-sm">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {staged.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex gap-2">
                {(["investor", "founder", "all"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setStagingTab(t)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium ${
                      stagingTab === t
                        ? "bg-[#6c5ce7] text-white"
                        : "text-[#8888a0] hover:text-[#e8e8ed]"
                    }`}
                  >
                    {t === "all" ? "All" : t === "investor" ? "Investors" : "Founders"}
                    <span className="ml-1 opacity-70">
                      (
                      {t === "all" ? staged.length : t === "investor" ? stagedInvestorCount : stagedFounderCount})
                    </span>
                  </button>
                ))}
              </div>
              <div className="flex gap-2 items-center flex-wrap">
                {selectedStaged.size > 0 && (
                  <>
                    <button type="button" onClick={onEnrichSelected} className="px-3 py-1 bg-[#6c5ce7] text-white rounded-lg text-xs">
                      Enrich selected ({selectedStaged.size})
                    </button>
                    <button
                      type="button"
                      onClick={() => onImportEnriched(Array.from(selectedStaged))}
                      disabled={importingStaged}
                      className="px-3 py-1 bg-green-600 text-white rounded-lg text-xs disabled:opacity-50"
                    >
                      Import selected
                    </button>
                  </>
                )}
                {(["table", "cards"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setStagingView(v)}
                    className={`px-2 py-1 rounded text-xs ${
                      stagingView === v ? "bg-[rgba(108,92,231,0.2)] text-[#6c5ce7]" : "text-[#8888a0]"
                    }`}
                  >
                    {v === "table" ? "Table" : "Cards"}
                  </button>
                ))}
              </div>
            </div>

            {stagingView === "table" ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[#8888a0] border-b border-[rgba(255,255,255,0.06)]">
                      <th className="text-left pb-2 pr-2">
                        <input
                          type="checkbox"
                          checked={selectedStaged.size === filteredStaged.length && filteredStaged.length > 0}
                          onChange={(e) =>
                            setSelectedStaged(
                              e.target.checked ? new Set(filteredStaged.map((s) => s.id)) : new Set(),
                            )
                          }
                          className="rounded"
                        />
                      </th>
                      <th className="text-left pb-2">Name / Firm</th>
                      <th className="text-left pb-2">Contact</th>
                      <th className="text-left pb-2">Sector</th>
                      <th className="text-left pb-2">Stage</th>
                      <th className="text-left pb-2">Ticket</th>
                      <th className="text-left pb-2">Location</th>
                      <th className="text-left pb-2">Website</th>
                      <th className="text-left pb-2">Status</th>
                      <th className="text-left pb-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStaged.map((s) => (
                      <Fragment key={s.id}>
                        <tr className="border-b border-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.02)]">
                          <td className="py-2 pr-2">
                            <input
                              type="checkbox"
                              checked={selectedStaged.has(s.id)}
                              onChange={(e) =>
                                setSelectedStaged((prev) => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(s.id);
                                  else next.delete(s.id);
                                  return next;
                                })
                              }
                              className="rounded"
                            />
                          </td>
                          <td className="py-2 pr-2">
                            <p className="text-[#e8e8ed] font-medium">{s.name}</p>
                            {s.firm_or_company && s.firm_or_company !== s.name && (
                              <p className="text-[#8888a0]">{s.firm_or_company}</p>
                            )}
                          </td>
                          <td className="py-2 pr-2 text-[#8888a0]">
                            {s.contact_name && <p>{s.contact_name}</p>}
                            {s.email && <p>{s.email}</p>}
                          </td>
                          <td className="py-2 pr-2 text-[#8888a0] max-w-[120px] truncate">{s.sector_focus ?? "—"}</td>
                          <td className="py-2 pr-2 text-[#8888a0]">{s.stage_focus ?? "—"}</td>
                          <td className="py-2 pr-2 text-[#8888a0]">{s.ticket_size ?? "—"}</td>
                          <td className="py-2 pr-2 text-[#8888a0]">{s.geography ?? "—"}</td>
                          <td className="py-2 pr-2 text-[#8888a0] max-w-[100px] truncate">
                            {s.website ? (
                              <a href={s.website} target="_blank" rel="noreferrer" className="text-[#6c5ce7] hover:underline">
                                link
                              </a>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="py-2 pr-2">{statusBadge(s.status)}</td>
                          <td className="py-2">
                            <div className="flex gap-1">
                              <button type="button" onClick={() => startEditStaged(s)} className="text-[#6c5ce7] hover:underline">
                                Edit
                              </button>
                              {s.status === "enriched" && (
                                <button
                                  type="button"
                                  onClick={() => onImportEnriched([s.id])}
                                  className="text-green-400 hover:underline ml-1"
                                >
                                  Import
                                </button>
                              )}
                              <button type="button" onClick={() => onDeleteStaged(s.id)} className="text-red-400 hover:underline ml-1">
                                Del
                              </button>
                            </div>
                          </td>
                        </tr>
                        {editingStagedId === s.id && (
                          <tr className="bg-[rgba(108,92,231,0.05)]">
                            <td colSpan={10} className="py-3 px-2">
                              <div className="grid grid-cols-3 gap-2">
                                {(
                                  [
                                    ["contact_name", "Contact name"],
                                    ["email", "Email"],
                                    ["linkedin_url", "LinkedIn URL"],
                                    ["website", "Website"],
                                    ["sector_focus", "Sector focus"],
                                    ["stage_focus", "Stage focus"],
                                    ["ticket_size", "Ticket size"],
                                    ["geography", "Geography"],
                                    ["one_liner", "One liner"],
                                  ] as [keyof typeof editStagedForm, string][]
                                ).map(([f, label]) => (
                                  <div key={f}>
                                    <label className="block text-[10px] text-[#8888a0] mb-0.5">{label}</label>
                                    <input
                                      value={(editStagedForm[f] as string) ?? ""}
                                      onChange={(e) => setEditStagedForm((ef) => ({ ...ef, [f]: e.target.value }))}
                                      className="w-full bg-[#0a0a0f] border border-[rgba(255,255,255,0.06)] rounded-lg px-2 py-1 text-xs text-[#e8e8ed]"
                                    />
                                  </div>
                                ))}
                              </div>
                              <div className="flex gap-2 mt-2">
                                <button
                                  type="button"
                                  onClick={() => onSaveStagedEdit(s.id)}
                                  disabled={savingStagedEdit}
                                  className="px-3 py-1 bg-[#6c5ce7] text-white rounded-lg text-xs disabled:opacity-50"
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingStagedId(null)}
                                  className="px-3 py-1 text-[#8888a0] text-xs"
                                >
                                  Cancel
                                </button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filteredStaged.map((s) => (
                  <div key={s.id} className="bg-[#0a0a0f] border border-[rgba(255,255,255,0.06)] rounded-xl p-4 space-y-2">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-sm font-medium text-[#e8e8ed]">{s.name}</p>
                        {s.one_liner && <p className="text-xs text-[#8888a0]">{s.one_liner}</p>}
                      </div>
                      {statusBadge(s.status)}
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-xs text-[#8888a0]">
                      {s.contact_name && <span>Contact: {s.contact_name}</span>}
                      {s.email && <span>Email: {s.email}</span>}
                      {s.sector_focus && <span>Sector: {s.sector_focus}</span>}
                      {s.stage_focus && <span>Stage: {s.stage_focus}</span>}
                      {s.ticket_size && <span>Ticket: {s.ticket_size}</span>}
                      {s.geography && <span>Location: {s.geography}</span>}
                    </div>
                    {s.enrichment_error && <p className="text-xs text-red-400">{s.enrichment_error}</p>}
                    <div className="flex gap-2">
                      <button type="button" onClick={() => startEditStaged(s)} className="text-xs text-[#6c5ce7] hover:underline">
                        Edit
                      </button>
                      {s.status === "enriched" && (
                        <button type="button" onClick={() => onImportEnriched([s.id])} className="text-xs text-green-400 hover:underline">
                          Import
                        </button>
                      )}
                      <button type="button" onClick={() => onDeleteStaged(s.id)} className="text-xs text-red-400 hover:underline">
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-[#16161f] border border-[rgba(255,255,255,0.06)] rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-semibold text-[#e8e8ed]">Bulk import via CSV</h2>
        <p className="text-xs text-[#8888a0]">
          Paste CSV with columns: <code className="text-[#6c5ce7]">role, name, email, firm, linkedin, notes</code>
          <br />
          First row is header (skipped). Role must be <code className="text-[#6c5ce7]">investor</code> or{" "}
          <code className="text-[#6c5ce7]">founder</code>.
        </p>
        <textarea
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          rows={5}
          className="w-full bg-[#0a0a0f] border border-[rgba(255,255,255,0.06)] rounded-xl px-3 py-2 text-xs text-[#e8e8ed] font-mono"
          placeholder={
            "role,name,email,firm,linkedin,notes\ninvestor,Jane Smith,jane@vc.com,Acme Ventures,,Invests in fintech\nfounder,John Doe,john@startup.com,Startup Inc,,Met at AfricArena"
          }
        />
        {csvMsg && <p className="text-xs text-[#6c5ce7]">{csvMsg}</p>}
        <button
          type="button"
          onClick={onCsvImport}
          disabled={csvImporting || !csvText.trim()}
          className="px-4 py-2 bg-[#6c5ce7] text-white rounded-xl text-sm font-medium hover:bg-[#7d6ff0] disabled:opacity-50"
        >
          {csvImporting ? "Importing..." : "Import CSV"}
        </button>
      </div>
    </div>
  );
}
