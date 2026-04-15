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
  website: string | null;
  sector_focus: string | null;
  stage_focus: string | null;
  ticket_size: string | null;
  geography: string | null;
  one_liner: string | null;
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

type AdminUserOption = {
  id: string;
  email: string;
  role: string;
};

const STAGING_STATUS_RANK: Record<StagedContact["status"], number> = {
  enriched: 0,
  enriching: 1,
  pending: 2,
  failed: 3,
};

function parseRecentStagingFromApi(raw: unknown): StagedContact[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is StagedContact => {
    const r = item as Partial<StagedContact>;
    return typeof r.id === "string" && typeof r.name === "string";
  });
}

function compareStagedContacts(a: StagedContact, b: StagedContact): number {
  const ra = STAGING_STATUS_RANK[a.status];
  const rb = STAGING_STATUS_RANK[b.status];
  if (ra !== rb) return ra - rb;
  if (a.status === "enriched" && b.status === "enriched") {
    const ta = a.enriched_at ? Date.parse(a.enriched_at) : 0;
    const tb = b.enriched_at ? Date.parse(b.enriched_at) : 0;
    return tb - ta;
  }
  return Date.parse(b.created_at) - Date.parse(a.created_at);
}

/** Green glow when a contact id newly appears in the staging `recent` feed (see `loadStaging`). */
const STAGING_RECENT_HIGHLIGHT_BG = "bg-[rgba(0,200,100,0.05)] transition-all duration-1000";
const STAGING_RECENT_HIGHLIGHT = `border-green-400/30 ${STAGING_RECENT_HIGHLIGHT_BG}`;

export default function ConnectorNetworkPage() {
  const { token, loading } = useAuth("INTERMEDIARY");
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [actingAsUserId, setActingAsUserId] = useState("");
  const [actingOptions, setActingOptions] = useState<AdminUserOption[]>([]);
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
  const [contactModalMode, setContactModalMode] = useState<"view" | "edit">("view");
  const [editForm, setEditForm] = useState({
    name: "",
    email: "",
    firm_or_company: "",
    linkedin_url: "",
    website: "",
    sector_focus: "",
    stage_focus: "",
    ticket_size: "",
    geography: "",
    one_liner: "",
    notes: "",
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [editMsg, setEditMsg] = useState<string | null>(null);
  const [viewingContact, setViewingContact] = useState<Contact | null>(null);

  const sheetInputRef = useRef<HTMLInputElement>(null);
  const [ipfsLoading, setIpfsLoading] = useState(false);
  const [ipfsResult, setIpfsResult] = useState<{ cid: string; url: string; count: number } | null>(null);
  const [sheetPreview, setSheetPreview] = useState<{
    investors: SheetPreviewRow[];
    founders: SheetPreviewRow[];
  } | null>(null);
  const [sheetMsg, setSheetMsg] = useState<string | null>(null);

  const [staged, setStaged] = useState<StagedContact[]>([]);
  const [stagingLoading, setStagingLoading] = useState(false);
  const [stagingMsg, setStagingMsg] = useState<string | null>(null);
  const [stagingTab, setStagingTab] = useState<"investor" | "founder" | "all">("investor");
  const [stagingPage, setStagingPage] = useState(0);
  const [stagingTotal, setStagingTotal] = useState(0);
  const [stagingCounts, setStagingCounts] = useState({ pending: 0, enriching: 0, enriched: 0, failed: 0 });
  const [stagingView, setStagingView] = useState<"table" | "cards">("table");
  const [selectedStaged, setSelectedStaged] = useState<Set<string>>(new Set());
  const [importingStaged, setImportingStaged] = useState(false);
  const [editingStagedId, setEditingStagedId] = useState<string | null>(null);
  const [editStagedForm, setEditStagedForm] = useState<Partial<StagedContact>>({});
  const [savingStagedEdit, setSavingStagedEdit] = useState(false);
  const [recentlyEnriched, setRecentlyEnriched] = useState<Set<string>>(() => new Set());
  const [recentFeed, setRecentFeed] = useState<StagedContact[]>([]);
  const prevRecentFeedIdsRef = useRef<Set<string>>(new Set());

  const [form, setForm] = useState({
    role: "investor" as "investor" | "founder",
    name: "",
    email: "",
    firm_or_company: "",
    linkedin_url: "",
    notes: "",
  });

  const connectorApiUrl = useCallback(
    (path: string) => {
      const url = new URL(`${API_BASE}${path}`);
      if (isSuperAdmin && actingAsUserId) {
        url.searchParams.set("as_user", actingAsUserId);
      }
      return url.toString();
    },
    [isSuperAdmin, actingAsUserId],
  );

  const load = useCallback(async () => {
    if (!token) return;
    const res = await fetch(connectorApiUrl("/connector-profile/network"), { headers: authHeaders(token) });
    if (res.ok) setContacts(await res.json());
  }, [token, connectorApiUrl]);

  const loadStaging = useCallback(async () => {
    if (!token) return;
    setStagingLoading(true);
    try {
      const res = await fetch(
        connectorApiUrl(`/connector-profile/network/staging?page=${stagingPage}&per_page=50`),
        { headers: authHeaders(token) },
      );
      const data = await res.json();
      if (!res.ok) return;

      let next: StagedContact[];
      let total: number;
      let counts = { pending: 0, enriching: 0, enriched: 0, failed: 0 };

      if (Array.isArray(data)) {
        next = (data as StagedContact[]).slice(stagingPage * 50, (stagingPage + 1) * 50);
        total = data.length;
        for (const c of data as { status: string }[]) {
          if (c.status in counts) counts[c.status as keyof typeof counts]++;
        }
      } else {
        next = data.contacts ?? [];
        total = data.total ?? 0;
        counts = data.counts ?? { pending: 0, enriching: 0, enriched: 0, failed: 0 };
      }

      const recentRaw = Array.isArray(data) ? [] : ((data as { recent?: unknown }).recent ?? []);
      const recentList = parseRecentStagingFromApi(recentRaw);
      setRecentFeed(recentList);

      const prevFeedIds = prevRecentFeedIdsRef.current;
      const seedRecentFeed = prevFeedIds.size === 0 && recentList.length > 0;
      const newlyInRecentFeed = seedRecentFeed
        ? []
        : recentList.filter((r) => !prevFeedIds.has(r.id)).map((r) => r.id);
      if (newlyInRecentFeed.length > 0) {
        setRecentlyEnriched((prevSet) => {
          const n = new Set(prevSet);
          for (const id of newlyInRecentFeed) n.add(id);
          return n;
        });
        for (const id of newlyInRecentFeed) {
          window.setTimeout(() => {
            setRecentlyEnriched((prevSet) => {
              const n = new Set(prevSet);
              n.delete(id);
              return n;
            });
          }, 3000);
        }
      }
      prevRecentFeedIdsRef.current = new Set(recentList.map((r) => r.id));

      setStaged(next);
      setStagingTotal(total);
      setStagingCounts(counts);
    } finally {
      setStagingLoading(false);
    }
  }, [token, stagingPage, connectorApiUrl]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (token) loadStaging();
  }, [token, loadStaging]);

  useEffect(() => {
    if (stagingTotal <= 0) return;
    const maxPage = Math.max(0, Math.ceil(stagingTotal / 50) - 1);
    if (stagingPage > maxPage) setStagingPage(maxPage);
  }, [stagingTotal, stagingPage]);

  useEffect(() => {
    const isActive = stagingCounts.enriching > 0 || stagingCounts.pending > 0;
    if (!isActive) return;
    const timer = setInterval(() => loadStaging(), 2000);
    return () => clearInterval(timer);
  }, [stagingCounts, loadStaging]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const run = async () => {
      const meRes = await fetch(`${API_BASE}/auth/me`, { headers: authHeaders(token) });
      if (!meRes.ok) return;
      const me = (await meRes.json()) as { is_super_admin?: boolean };
      if (cancelled) return;
      const superAdmin = Boolean(me.is_super_admin);
      setIsSuperAdmin(superAdmin);
      if (!superAdmin) {
        setActingOptions([]);
        setActingAsUserId("");
        return;
      }
      const usersRes = await fetch(`${API_BASE}/admin/users`, { headers: authHeaders(token) });
      if (!usersRes.ok || cancelled) return;
      const users = (await usersRes.json()) as AdminUserOption[];
      const intermediaries = users.filter((u) => u.role === "INTERMEDIARY");
      setActingOptions(intermediaries);
      setActingAsUserId((prev) => prev || intermediaries[0]?.id || "");
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const filtered = useMemo(() => contacts.filter((c) => c.role === tab), [contacts, tab]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const filteredStaged = useMemo(() => {
    const filtered = stagingTab === "all" ? staged : staged.filter((s) => s.role === stagingTab);
    return [...filtered].sort(compareStagedContacts);
  }, [staged, stagingTab]);

  const investorCount = contacts.filter((c) => c.role === "investor").length;
  const founderCount = contacts.filter((c) => c.role === "founder").length;
  const stagedInvestorCount = staged.filter((s) => s.role === "investor").length;
  const stagedFounderCount = staged.filter((s) => s.role === "founder").length;
  const stagedEnrichedCount = stagingCounts.enriched;
  const stagedPendingCount = stagingCounts.pending;
  const stagedFailedCount = stagingCounts.failed;

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setAdding(true);
    const res = await fetch(connectorApiUrl("/connector-profile/network"), {
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
    await fetch(connectorApiUrl(`/connector-profile/network/${id}`), {
      method: "DELETE",
      headers: authHeaders(token),
    });
    setViewingContact((v) => (v?.id === id ? null : v));
    setContactModalMode("view");
    load();
  }

  function populateEditFormFromContact(c: Contact) {
    setEditForm({
      name: c.name,
      email: c.email ?? "",
      firm_or_company: c.firm_or_company ?? "",
      linkedin_url: c.linkedin_url ?? "",
      website: c.website ?? "",
      sector_focus: c.sector_focus ?? "",
      stage_focus: c.stage_focus ?? "",
      ticket_size: c.ticket_size ?? "",
      geography: c.geography ?? "",
      one_liner: c.one_liner ?? "",
      notes: c.notes ?? "",
    });
  }

  function openContactModalView(c: Contact) {
    setViewingContact(c);
    setContactModalMode("view");
    setEditMsg(null);
  }

  function openContactModalEdit(c: Contact) {
    setViewingContact(c);
    setContactModalMode("edit");
    populateEditFormFromContact(c);
    setEditMsg(null);
  }

  const closeContactModal = useCallback(() => {
    setViewingContact(null);
    setContactModalMode("view");
    setEditMsg(null);
  }, []);

  function cancelContactModalEdit() {
    if (!viewingContact) return;
    setContactModalMode("view");
    populateEditFormFromContact(viewingContact);
    setEditMsg(null);
  }

  async function onSaveContactModal() {
    if (!token || !viewingContact) return;
    setSavingEdit(true);
    setEditMsg(null);
    console.log("PUT URL:", connectorApiUrl(`/connector-profile/network/${viewingContact.id}`));
    const res = await fetch(connectorApiUrl(`/connector-profile/network/${viewingContact.id}`), {
      method: "PUT",
      headers: authJsonHeaders(token),
      body: JSON.stringify({ role: viewingContact.role, ...editForm }),
    });
    if (res.ok) {
      closeContactModal();
      await load();
    } else {
      setEditMsg("Save failed.");
    }
    setSavingEdit(false);
  }

  useEffect(() => {
    if (!viewingContact) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeContactModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewingContact, closeContactModal]);

  async function onCsvImport() {
    if (!token || !csvText.trim()) return;
    setCsvImporting(true);
    const res = await fetch(connectorApiUrl("/connector-profile/network/csv"), {
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
        const allContacts: SheetPreviewRow[] = [];
        const seen = new Set<string>();
        const lc = (s: unknown) => String(s ?? "").toLowerCase().trim();
        const cell = (row: unknown[], idx: number) => (idx >= 0 ? String(row[idx] ?? "").trim() : "");

        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
          if (raw.length < 2) continue;

          // Find the real header row (first row with 3+ non-empty cells, within first 5 rows)
          let headerIdx = -1;
          let headers: string[] = [];
          for (let i = 0; i < Math.min(raw.length, 5); i++) {
            const r = raw[i] as unknown[];
            if (r.filter((c) => String(c ?? "").trim() !== "").length >= 3) {
              headerIdx = i;
              headers = r.map((c) => String(c ?? "").trim());
              break;
            }
          }
          if (headerIdx === -1) continue;

          const hl = headers.map(lc);
          const hasContact = hl.some(
            (h) =>
              h.includes("name") ||
              h.includes("email") ||
              h.includes("firm") ||
              h.includes("company") ||
              h.includes("investor"),
          );
          if (!hasContact) continue;

          const fi = (...terms: string[]) => hl.findIndex((h) => terms.some((t) => h.includes(t)));
          const col = {
            investorList: fi("investor", "funder", "vc", "backer"),
            name: fi("name", "contact"),
            firm: fi("firm", "fund", "company", "organisation", "organization", "startup"),
            email: fi("email", "e-mail", "mail"),
            linkedin: fi("linkedin"),
            website: fi("website", "url", "site"),
            sector: fi("sector", "industry", "focus", "vertical", "thesis"),
            stage: fi("stage", "round", "series"),
            ticket: fi("ticket", "check", "cheque", "size", "raised"),
            geo: fi("geo", "location", "country", "city", "region"),
            role: fi("role", "type"),
          };

          for (let i = headerIdx + 1; i < raw.length; i++) {
            const row = raw[i] as unknown[];
            if (col.investorList >= 0) {
              const val = cell(row, col.investorList);
              if (val) {
                val
                  .split(/,|;|\/| and /)
                  .map((s) => s.trim())
                  .filter((s) => s.length > 1)
                  .forEach((inv) => {
                    const norm = inv.toLowerCase();
                    if (!seen.has(norm) && !norm.includes("unnamed") && !norm.includes("undisclosed")) {
                      seen.add(norm);
                      allContacts.push({ role: "investor", name: inv, firm_or_company: inv, notes: "" });
                    }
                  });
              }
            } else {
              const name = cell(row, col.name) || cell(row, col.firm);
              const firm = cell(row, col.firm) || cell(row, col.name);
              if (!name) continue;
              const norm = name.toLowerCase();
              if (seen.has(norm)) continue;
              seen.add(norm);
              const roleVal = cell(row, col.role).toLowerCase();
              const isFounder = roleVal.includes("founder") || roleVal.includes("startup");
              const notesParts = [
                cell(row, col.email) && `Email: ${cell(row, col.email)}`,
                cell(row, col.linkedin) && `LinkedIn: ${cell(row, col.linkedin)}`,
                cell(row, col.website) && `Website: ${cell(row, col.website)}`,
                cell(row, col.sector) && `Sector: ${cell(row, col.sector)}`,
                cell(row, col.stage) && `Stage: ${cell(row, col.stage)}`,
                cell(row, col.ticket) && `Ticket: ${cell(row, col.ticket)}`,
                cell(row, col.geo) && `Location: ${cell(row, col.geo)}`,
              ].filter(Boolean);
              allContacts.push({
                role: isFounder ? "founder" : "investor",
                name,
                firm_or_company: firm,
                notes: notesParts.join(" | "),
              });
            }
          }
        }

        if (allContacts.length === 0) {
          setSheetMsg("No contacts found. Check that your spreadsheet has name, email, or firm columns.");
          return;
        }
        setSheetPreview({
          investors: allContacts.filter((c) => c.role === "investor"),
          founders: allContacts.filter((c) => c.role === "founder"),
        });
      } catch (err) {
        console.error("Sheet parse error:", err);
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
      const res = await fetch(connectorApiUrl("/connector-profile/network/stage"), {
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
    const res = await fetch(connectorApiUrl("/connector-profile/network/staging/enrich"), {
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
    const res = await fetch(connectorApiUrl("/connector-profile/network/staging/enrich"), {
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
    const res = await fetch(connectorApiUrl("/connector-profile/network/staging/import"), {
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

  async function onRetryContact(id: string) {
    if (!token) return;
    await fetch(connectorApiUrl("/connector-profile/network/staging/enrich"), {
      method: "POST",
      headers: authJsonHeaders(token),
      body: JSON.stringify({ ids: [id] }),
    });
    loadStaging();
  }

  async function onClearStaging() {
    if (!token || !confirm("Clear all staged contacts?")) return;
    const res = await fetch(connectorApiUrl("/connector-profile/network/staging"), {
      method: "DELETE",
      headers: authHeaders(token),
    });
    if (res.ok) {
      setStagingPage(0);
      setStagingMsg("Staging cleared.");
      loadStaging();
    }
  }

  async function onExportNetwork() {
    if (!token) return;
    const res = await fetch(connectorApiUrl("/connector-profile/network/export"), { headers: authHeaders(token) });
    if (!res.ok) return;
    const data: Record<string, unknown>[] = await res.json();
    if (data.length === 0) return;
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Network");
    XLSX.writeFile(wb, `metatron-network-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  async function onIpfsSnapshot() {
    if (!token) return;
    setIpfsLoading(true);
    const res = await fetch(connectorApiUrl("/connector-profile/network/ipfs-snapshot"), {
      method: "POST",
      headers: authHeaders(token),
    });
    if (res.ok) {
      const data = await res.json();
      setIpfsResult(data);
    }
    setIpfsLoading(false);
  }

  async function onDeleteStaged(id: string) {
    if (!token) return;
    const res = await fetch(connectorApiUrl(`/connector-profile/network/staging/${id}`), {
      method: "DELETE",
      headers: authHeaders(token),
    });
    if (res.ok) loadStaging();
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
    const res = await fetch(connectorApiUrl(`/connector-profile/network/staging/${id}`), {
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
          {isSuperAdmin && (
            <div className="mt-3 flex items-center gap-2">
              <label className="text-xs text-[#8888a0]">Acting as:</label>
              <select
                value={actingAsUserId}
                onChange={(e) => setActingAsUserId(e.target.value)}
                className="bg-[#0a0a0f] border border-[rgba(255,255,255,0.06)] rounded-lg px-2 py-1 text-xs text-[#e8e8ed]"
              >
                {actingOptions.length === 0 ? (
                  <option value="">No intermediary users</option>
                ) : (
                  actingOptions.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.email}
                    </option>
                  ))
                )}
              </select>
            </div>
          )}
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
          <div className="flex flex-col gap-2">
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
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={onExportNetwork}
                className="px-3 py-1.5 text-xs rounded-xl bg-[rgba(255,255,255,0.04)] text-[#8888a0] border border-[rgba(255,255,255,0.06)] hover:text-[#e8e8ed] hover:border-[rgba(255,255,255,0.12)]"
              >
                Export XLSX
              </button>
              <button
                type="button"
                onClick={onIpfsSnapshot}
                disabled={ipfsLoading}
                className="px-3 py-1.5 text-xs rounded-xl bg-[rgba(108,92,231,0.08)] text-[#6c5ce7] border border-[rgba(108,92,231,0.2)] hover:bg-[rgba(108,92,231,0.15)] disabled:opacity-40"
              >
                {ipfsLoading ? "Anchoring…" : "Anchor to IPFS"}
              </button>
              {ipfsResult?.cid && (
                <a
                  href={ipfsResult.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[#6c5ce7] hover:underline font-mono"
                >
                  {ipfsResult.cid.slice(0, 16)}… ({ipfsResult.count} contacts)
                </a>
              )}
            </div>
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
              <div
                key={c.id}
                onClick={() => openContactModalView(c)}
                className="bg-[#0a0a0f] border border-[rgba(255,255,255,0.06)] rounded-xl p-4 cursor-pointer hover:border-[rgba(108,92,231,0.2)] transition-colors"
              >
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[#e8e8ed]">{c.name}</p>
                    {c.firm_or_company && c.firm_or_company !== c.name && (
                      <p className="text-xs text-[#8888a0]">{c.firm_or_company}</p>
                    )}
                    {c.one_liner && (
                      <div className="mt-2">
                        <p className="text-[10px] uppercase tracking-wide text-[#8888a0] mb-0.5">One-liner</p>
                        <p className="text-xs text-[#e8e8ed] leading-snug">{c.one_liner}</p>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openContactModalEdit(c);
                      }}
                      className="text-xs text-[#6c5ce7] hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(c.id);
                      }}
                      className="text-xs text-red-400 hover:underline ml-2"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1.5 mt-3 text-xs">
                  {c.email && (
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-[#8888a0]">Email</dt>
                      <dd className="text-[#e8e8ed] truncate">{c.email}</dd>
                    </div>
                  )}
                  {c.sector_focus && (
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-[#8888a0]">Sector</dt>
                      <dd className="text-[#e8e8ed]">{c.sector_focus}</dd>
                    </div>
                  )}
                  {c.stage_focus && (
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-[#8888a0]">Stage</dt>
                      <dd className="text-[#e8e8ed]">{c.stage_focus}</dd>
                    </div>
                  )}
                  {c.ticket_size && (
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-[#8888a0]">Ticket</dt>
                      <dd className="text-[#e8e8ed]">{c.ticket_size}</dd>
                    </div>
                  )}
                  {c.geography && (
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-[#8888a0]">Location</dt>
                      <dd className="text-[#e8e8ed]">{c.geography}</dd>
                    </div>
                  )}
                  {c.website && (
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-[#8888a0]">Website</dt>
                      <dd>
                        <a
                          href={c.website}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-[#6c5ce7] hover:underline break-all"
                        >
                          {c.website.replace(/^https?:\/\//, "")}
                        </a>
                      </dd>
                    </div>
                  )}
                  {c.linkedin_url && (
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-[#8888a0]">LinkedIn</dt>
                      <dd>
                        <a
                          href={c.linkedin_url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-[#6c5ce7] hover:underline break-all"
                        >
                          Profile
                        </a>
                      </dd>
                    </div>
                  )}
                </dl>
                {c.notes && (
                  <div className="mt-2 pt-2 border-t border-[rgba(255,255,255,0.06)]">
                    <p className="text-[10px] uppercase tracking-wide text-[#8888a0] mb-0.5">Notes</p>
                    <p className="text-xs text-[#8888a0] line-clamp-3">{c.notes}</p>
                  </div>
                )}
                {c.joined_user_id && (
                  <span className="mt-2 inline-block text-xs bg-[rgba(108,92,231,0.15)] text-[#6c5ce7] px-2 py-0.5 rounded-full">
                    On platform
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[#8888a0] text-xs border-b border-[rgba(255,255,255,0.06)]">
                  <th className="text-left pb-2 pr-3">Name / Firm</th>
                  <th className="text-left pb-2 pr-3">Email</th>
                  <th className="text-left pb-2 pr-3">Sector</th>
                  <th className="text-left pb-2 pr-3">Stage</th>
                  <th className="text-left pb-2 pr-3">Ticket</th>
                  <th className="text-left pb-2 pr-3">Location</th>
                  <th className="text-left pb-2 pr-3">Links</th>
                  <th className="text-left pb-2" />
                </tr>
              </thead>
              <tbody>
                {paginated.map((c) => (
                  <tr key={c.id} className="border-b border-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.02)]">
                    <td className="py-2 pr-3">
                      <p className="text-[#e8e8ed]">{c.name}</p>
                      {c.firm_or_company && c.firm_or_company !== c.name && (
                        <p className="text-[#8888a0] text-xs">{c.firm_or_company}</p>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-[#8888a0] text-xs">{c.email ?? "—"}</td>
                    <td className="py-2 pr-3 text-[#8888a0] text-xs max-w-[120px] truncate">{c.sector_focus ?? "—"}</td>
                    <td className="py-2 pr-3 text-[#8888a0] text-xs">{c.stage_focus ?? "—"}</td>
                    <td className="py-2 pr-3 text-[#8888a0] text-xs">{c.ticket_size ?? "—"}</td>
                    <td className="py-2 pr-3 text-[#8888a0] text-xs">{c.geography ?? "—"}</td>
                    <td className="py-2 pr-3 text-xs flex gap-2">
                      {c.website && <a href={c.website} target="_blank" rel="noreferrer" className="text-[#6c5ce7] hover:underline">Web</a>}
                      {c.linkedin_url && <a href={c.linkedin_url} target="_blank" rel="noreferrer" className="text-[#6c5ce7] hover:underline">LI</a>}
                    </td>
                    <td className="py-2 flex gap-2">
                      <button type="button" onClick={() => openContactModalEdit(c)} className="text-xs text-[#6c5ce7] hover:underline">
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
              Upload a spreadsheet, Kevin enriches each contact with web data, then you import to your network.{" "}
              <a href="/connector/settings" className="text-[#6c5ce7] hover:underline">Use your own API key</a> to boost enrichment.
            </p>
          </div>
          <div className="flex gap-2 items-center flex-wrap justify-end">
            {stagingTotal > 0 && (
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
                {stagedFailedCount > 0 && (
                  <button
                    type="button"
                    onClick={() => onEnrichAll()}
                    className="px-3 py-1.5 bg-[rgba(255,80,80,0.12)] text-red-400 border border-[rgba(255,80,80,0.2)] rounded-xl text-xs font-medium hover:bg-[rgba(255,80,80,0.2)]"
                  >
                    Retry failed ({stagedFailedCount})
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
        {stagingLoading && stagingTotal === 0 && (
          <p className="text-xs text-[#8888a0]">Loading staging…</p>
        )}
        {stagingTotal > 0 && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-[#8888a0]">
              <span>
                {stagingCounts.enriched} of {stagingTotal} enriched
                {stagingCounts.enriching > 0 && (
                  <span className="text-[#6c5ce7] ml-2 animate-pulse">· {stagingCounts.enriching} in progress</span>
                )}
                {stagingCounts.failed > 0 && (
                  <span className="text-red-400 ml-2">· {stagingCounts.failed} failed</span>
                )}
              </span>
              <span>{stagingTotal > 0 ? Math.round((stagingCounts.enriched / stagingTotal) * 100) : 0}%</span>
            </div>
            <div className="w-full bg-[rgba(255,255,255,0.06)] rounded-full h-2">
              <div
                className="bg-[#6c5ce7] h-2 rounded-full transition-all duration-500"
                style={{ width: `${stagingTotal > 0 ? (stagingCounts.enriched / stagingTotal) * 100 : 0}%` }}
              />
            </div>
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

        {stagingTotal > 0 && (
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
                      {t === "all"
                        ? stagingTotal
                        : t === "investor"
                          ? stagedInvestorCount
                          : stagedFounderCount}
                      )
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

            {stagingTotal > 50 && (
              <div className="flex items-center justify-between pt-2">
                <p className="text-xs text-[#8888a0]">
                  Showing {stagingPage * 50 + 1}–{Math.min((stagingPage + 1) * 50, stagingTotal)} of {stagingTotal}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setStagingPage((p) => Math.max(0, p - 1))}
                    disabled={stagingPage === 0}
                    className="px-3 py-1.5 text-xs rounded-xl bg-[rgba(255,255,255,0.04)] text-[#8888a0] hover:text-[#e8e8ed] disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    ← Prev
                  </button>
                  <span className="text-xs text-[#8888a0]">
                    Page {stagingPage + 1} of {Math.ceil(stagingTotal / 50)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setStagingPage((p) => Math.min(Math.ceil(stagingTotal / 50) - 1, p + 1))}
                    disabled={stagingPage >= Math.ceil(stagingTotal / 50) - 1}
                    className="px-3 py-1.5 text-xs rounded-xl bg-[rgba(255,255,255,0.04)] text-[#8888a0] hover:text-[#e8e8ed] disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}

            {(stagingCounts.enriching > 0 || stagingCounts.pending > 0) && recentFeed.length > 0 && (
              <div className="overflow-hidden rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#0a0a0f]">
                <div className="border-b border-[rgba(255,255,255,0.06)] px-3 py-2">
                  <span className="text-[10px] uppercase tracking-wide text-[#6c5ce7]">Live feed</span>
                  <p className="mt-0.5 text-[10px] text-[#8888a0]">Newest enriched first</p>
                </div>
                <ul className="divide-y divide-[rgba(255,255,255,0.06)]">
                  {recentFeed.map((r) => {
                    const flash = recentlyEnriched.has(r.id);
                    return (
                      <li
                        key={r.id}
                        className={`flex items-center justify-between gap-3 px-3 py-2 transition-all duration-1000 ${
                          flash ? `border-l-2 border-l-green-400/50 ${STAGING_RECENT_HIGHLIGHT_BG}` : ""
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-[#e8e8ed]">{r.name}</p>
                          <p className="truncate text-[10px] text-[#8888a0]">{r.sector_focus?.trim() || "—"}</p>
                        </div>
                        <span className="shrink-0 rounded-md bg-[rgba(0,200,100,0.12)] px-2 py-0.5 text-[10px] font-medium text-green-400">
                          enriched
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

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
                        <tr
                          className={
                            recentlyEnriched.has(s.id)
                              ? `border-b border-green-400/30 ${STAGING_RECENT_HIGHLIGHT_BG}`
                              : "border-b border-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.02)]"
                          }
                        >
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
                              {s.status === "failed" && (
                                <button
                                  type="button"
                                  onClick={() => onRetryContact(s.id)}
                                  className="text-orange-400 hover:underline ml-1"
                                >
                                  Retry
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
                  <div
                    key={s.id}
                    className={`rounded-xl p-4 space-y-2 ${
                      recentlyEnriched.has(s.id)
                        ? `border ${STAGING_RECENT_HIGHLIGHT}`
                        : "border border-[rgba(255,255,255,0.06)] bg-[#0a0a0f]"
                    }`}
                  >
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
                      {s.status === "failed" && (
                        <button type="button" onClick={() => onRetryContact(s.id)} className="text-xs text-orange-400 hover:underline">
                          Retry
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
            {stagingTotal > 50 && (
              <div className="flex items-center justify-between pt-2">
                <p className="text-xs text-[#8888a0]">
                  Showing {stagingPage * 50 + 1}–{Math.min((stagingPage + 1) * 50, stagingTotal)} of {stagingTotal}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setStagingPage((p) => Math.max(0, p - 1))}
                    disabled={stagingPage === 0}
                    className="px-3 py-1.5 text-xs rounded-xl bg-[rgba(255,255,255,0.04)] text-[#8888a0] hover:text-[#e8e8ed] disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    ← Prev
                  </button>
                  <span className="text-xs text-[#8888a0]">
                    Page {stagingPage + 1} of {Math.ceil(stagingTotal / 50)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setStagingPage((p) => Math.min(Math.ceil(stagingTotal / 50) - 1, p + 1))}
                    disabled={stagingPage >= Math.ceil(stagingTotal / 50) - 1}
                    className="px-3 py-1.5 text-xs rounded-xl bg-[rgba(255,255,255,0.04)] text-[#8888a0] hover:text-[#e8e8ed] disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Next →
                  </button>
                </div>
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

      {viewingContact && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" aria-hidden onClick={closeContactModal} />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="contact-modal-title"
            className="relative z-10 flex w-full max-w-2xl max-h-[min(90vh,800px)] flex-col rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#16161f]"
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[rgba(255,255,255,0.06)] px-5 py-4">
              <div className="min-w-0 pr-2">
                {contactModalMode === "view" ? (
                  <>
                    <h2 id="contact-modal-title" className="text-2xl font-semibold leading-tight text-[#e8e8ed]">
                      {viewingContact.name}
                    </h2>
                    {viewingContact.firm_or_company && viewingContact.firm_or_company !== viewingContact.name && (
                      <p className="mt-1 text-base text-[#8888a0]">{viewingContact.firm_or_company}</p>
                    )}
                    <p className="mt-2 text-[10px] uppercase tracking-wide text-[#6c5ce7]">{viewingContact.role}</p>
                  </>
                ) : (
                  <>
                    <h2 id="contact-modal-title" className="text-lg font-semibold leading-tight text-[#e8e8ed]">
                      Edit contact
                    </h2>
                    <p className="mt-1 text-xs text-[#8888a0] truncate">{viewingContact.name}</p>
                  </>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {contactModalMode === "view" && (
                  <button
                    type="button"
                    onClick={() => {
                      populateEditFormFromContact(viewingContact);
                      setContactModalMode("edit");
                      setEditMsg(null);
                    }}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-[#6c5ce7] transition-colors hover:bg-[rgba(108,92,231,0.12)]"
                  >
                    Edit
                  </button>
                )}
                <button
                  type="button"
                  onClick={closeContactModal}
                  className="shrink-0 rounded-lg p-2 text-[#8888a0] transition-colors hover:bg-[rgba(255,255,255,0.06)] hover:text-[#e8e8ed]"
                  aria-label="Close"
                >
                  <span className="block text-xl leading-none" aria-hidden>
                    ×
                  </span>
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {contactModalMode === "view" ? (
                <>
                  {viewingContact.one_liner && (
                    <p className="mb-5 text-sm italic leading-relaxed text-[#8888a0]">{viewingContact.one_liner}</p>
                  )}

                  <div className="space-y-3 border-t border-[rgba(255,255,255,0.06)] pt-4">
                    {(
                      [
                        ["Email", viewingContact.email] as const,
                        ["Sector", viewingContact.sector_focus] as const,
                        ["Stage", viewingContact.stage_focus] as const,
                        ["Ticket", viewingContact.ticket_size] as const,
                        ["Geography", viewingContact.geography] as const,
                        ["Website", viewingContact.website] as const,
                        ["LinkedIn", viewingContact.linkedin_url] as const,
                      ] as const
                    ).map(([label, val]) => (
                      <div key={label}>
                        <p className="text-[10px] uppercase tracking-wide text-[#8888a0]">{label}</p>
                        <div className="mt-0.5 text-sm text-[#e8e8ed]">
                          {!val ? (
                            <span className="text-[#8888a0]">—</span>
                          ) : label === "Website" ? (
                            <a
                              href={val}
                              target="_blank"
                              rel="noreferrer"
                              className="break-all text-[#6c5ce7] hover:underline"
                            >
                              {val.replace(/^https?:\/\//, "")}
                            </a>
                          ) : label === "LinkedIn" ? (
                            <a href={val} target="_blank" rel="noreferrer" className="break-all text-[#6c5ce7] hover:underline">
                              View profile
                            </a>
                          ) : label === "Email" ? (
                            <a href={`mailto:${val}`} className="break-all text-[#6c5ce7] hover:underline">
                              {val}
                            </a>
                          ) : (
                            val
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-5 border-t border-[rgba(255,255,255,0.06)] pt-4">
                    <p className="text-[10px] uppercase tracking-wide text-[#8888a0]">Notes</p>
                    <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#0a0a0f] px-3 py-2">
                      {viewingContact.notes ? (
                        <p className="whitespace-pre-wrap text-xs leading-relaxed text-[#8888a0]">{viewingContact.notes}</p>
                      ) : (
                        <span className="text-xs text-[#8888a0]">—</span>
                      )}
                    </div>
                  </div>

                  {viewingContact.joined_user_id && (
                    <p className="mt-4 text-xs text-[#6c5ce7]">On platform</p>
                  )}
                </>
              ) : (
                <div className="space-y-4">
                  {(
                    [
                      ["name", "Name", "text"] as const,
                      ["firm_or_company", "Firm / company", "text"] as const,
                      ["email", "Email", "text"] as const,
                      ["linkedin_url", "LinkedIn URL", "text"] as const,
                      ["website", "Website", "text"] as const,
                      ["sector_focus", "Sector focus", "text"] as const,
                      ["stage_focus", "Stage focus", "text"] as const,
                      ["ticket_size", "Ticket size", "text"] as const,
                      ["geography", "Geography", "text"] as const,
                    ] as const
                  ).map(([key, label, kind]) => (
                    <div key={key}>
                      <label className="block text-xs text-[#8888a0] mb-1">{label}</label>
                      <input
                        type={kind}
                        value={editForm[key]}
                        onChange={(e) => setEditForm((ef) => ({ ...ef, [key]: e.target.value }))}
                        className="w-full bg-[#0a0a0f] border border-[rgba(255,255,255,0.06)] rounded-xl px-3 py-2 text-sm text-[#e8e8ed]"
                      />
                    </div>
                  ))}
                  <div>
                    <label className="block text-xs text-[#8888a0] mb-1">One-liner</label>
                    <textarea
                      value={editForm.one_liner}
                      onChange={(e) => setEditForm((ef) => ({ ...ef, one_liner: e.target.value }))}
                      rows={3}
                      className="w-full bg-[#0a0a0f] border border-[rgba(255,255,255,0.06)] rounded-xl px-3 py-2 text-sm text-[#e8e8ed] resize-y min-h-[4rem]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[#8888a0] mb-1">Notes</label>
                    <textarea
                      value={editForm.notes}
                      onChange={(e) => setEditForm((ef) => ({ ...ef, notes: e.target.value }))}
                      rows={4}
                      className="w-full bg-[#0a0a0f] border border-[rgba(255,255,255,0.06)] rounded-xl px-3 py-2 text-sm text-[#e8e8ed] resize-y min-h-[5rem]"
                    />
                  </div>
                </div>
              )}
            </div>

            {contactModalMode === "edit" && (
              <div className="shrink-0 border-t border-[rgba(255,255,255,0.06)] px-5 py-3 space-y-2">
                {editMsg && <p className="text-xs text-red-400">{editMsg}</p>}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void onSaveContactModal()}
                    disabled={savingEdit}
                    className="px-4 py-2 bg-[#6c5ce7] text-white rounded-xl text-sm font-medium hover:bg-[#7d6ff0] disabled:opacity-50"
                  >
                    {savingEdit ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={cancelContactModalEdit}
                    disabled={savingEdit}
                    className="px-4 py-2 text-sm text-[#8888a0] rounded-xl hover:bg-[rgba(255,255,255,0.06)] hover:text-[#e8e8ed] disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
