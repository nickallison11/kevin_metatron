"use client";

import { UpgradeButton } from "@/components/upgrade/UpgradeProvider";
import {
  type ChangeEvent,
  FormEvent,
  Fragment,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import * as XLSX from "xlsx";
import { API_BASE, authHeaders, authJsonHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";

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

type ConnectorProfileSummary = {
  connector_tier?: string | null;
  enrichment_credits?: number | null;
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
const STAGING_RECENT_HIGHLIGHT_BG = "bg-[var(--good-bg)] transition-all duration-1000";

function initials(name: string) {
  return (
    name
      .replace(/[^\p{L} ]/gu, "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "·"
  );
}

function ConnectorNetworkPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { token, loading } = useAuth("INTERMEDIARY");
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [actingAsUserId, setActingAsUserId] = useState("");
  const [actingOptions, setActingOptions] = useState<AdminUserOption[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [tab, setTab] = useState<"all" | "investor" | "founder">("all");
  const [query, setQuery] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const stagingRef = useRef<HTMLElement>(null);
  const [page, setPageRaw] = useState(() => {
    const p = Number(searchParams.get("page"));
    return p > 0 ? p : 1;
  });
  const [pageSize, setPageSizeRaw] = useState(() => {
    const s = Number(searchParams.get("size"));
    return [5, 10, 25, 50].includes(s) ? s : 10;
  });
  const setPage = setPageRaw;
  const prevPageSize = useRef(pageSize);
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
  const [connectorTier, setConnectorTier] = useState("free");
  const [enrichmentCredits, setEnrichmentCredits] = useState(0);

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
    const [networkRes, profileRes] = await Promise.all([
      fetch(connectorApiUrl("/connector-profile/network"), { headers: authHeaders(token) }),
      fetch(connectorApiUrl("/connector-profile"), { headers: authHeaders(token) }),
    ]);
    if (networkRes.ok) setContacts(await networkRes.json());
    if (profileRes.ok) {
      const profile = (await profileRes.json()) as ConnectorProfileSummary;
      setConnectorTier(profile.connector_tier ?? "free");
      setEnrichmentCredits(profile.enrichment_credits ?? 0);
    }
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contacts.filter(
      (c) =>
        (tab === "all" || c.role === tab) &&
        (!q ||
          [c.name, c.firm_or_company, c.email, c.sector_focus, c.stage_focus, c.geography]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(q)),
    );
  }, [contacts, tab, query]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    setPage(1);
  }, [tab, query]);

  useEffect(() => {
    setPageRaw((prev) => {
      const firstItem = (prev - 1) * prevPageSize.current + 1;
      return Math.max(1, Math.ceil(firstItem / pageSize));
    });
  }, [pageSize]);

  useEffect(() => {
    prevPageSize.current = pageSize;
  }, [pageSize]);

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(page));
    params.set("size", String(pageSize));
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [page, pageSize]);

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
  const isFreeTier = connectorTier === "free";
  const contactCount = contacts.length;
  const atFreeLimit = isFreeTier && contactCount >= 50;

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

  async function onArchive(id: string) {
    if (!token) return;
    await fetch(connectorApiUrl(`/connector-profile/network/${id}/archive`), {
      method: "POST",
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
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeContactModal();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [viewingContact, closeContactModal]);

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
    setSheetMsg(`${totalStaged} contacts added to Import and enrich below. Press "Enrich waiting" to have Kevin look them up.`);
    setSheetPreview(null);
    loadStaging();
    stagingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
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

  const card = "rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] shadow-[var(--card-shadow)]";
  const eyebrow = "font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]";
  const btn =
    "inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border border-[var(--overlay-12)] px-4 text-[13px] font-medium text-[var(--text)] hover:bg-[var(--overlay-4)] disabled:opacity-50";
  const btnSm =
    "inline-flex min-h-8 items-center justify-center whitespace-nowrap rounded-[8px] border border-[var(--overlay-12)] px-3 text-xs font-medium text-[var(--text)] hover:bg-[var(--overlay-4)] disabled:opacity-50";
  const btnPrimary =
    "inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] bg-metatron-accent px-4 text-[13px] font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-50";
  const input =
    "w-full min-h-11 rounded-[10px] border border-[var(--overlay-12)] bg-[var(--bg)] px-3.5 py-2.5 text-sm text-[var(--text)] outline-none focus:border-metatron-accent";
  const field = "flex flex-col gap-1.5 text-[13px] font-semibold";
  const seg = (on: boolean) =>
    `inline-flex min-h-9 items-center gap-1.5 rounded-[8px] px-3 text-[13px] ${
      on ? "bg-metatron-accent/15 font-semibold text-[var(--text)]" : "text-[var(--text-muted)] hover:text-[var(--text)]"
    }`;

  const statusBadge = (status: StagedContact["status"]) => {
    const map = {
      pending: "bg-[var(--overlay-6)] text-[var(--text-muted)]",
      enriching: "bg-metatron-accent/15 text-[var(--accent-fg)] animate-pulse",
      enriched: "bg-[var(--good-bg)] text-[var(--good)]",
      failed: "bg-[var(--overlay-6)] text-[var(--danger)]",
    };
    const label = { pending: "Waiting", enriching: "Enriching", enriched: "Enriched", failed: "Failed" };
    return <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${map[status]}`}>{label[status]}</span>;
  };

  const introduceHref = (c: Contact) => {
    const p = new URLSearchParams({ a_name: c.name });
    if (c.email) p.set("a_email", c.email);
    return `/connector/introductions?${p.toString()}`;
  };

  const tabCount = { all: contactCount, investor: investorCount, founder: founderCount };
  const enrichingNow = stagingCounts.enriching + stagingCounts.pending;
  const scrollToStaging = () => stagingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <main className="min-w-0 flex-1 text-[var(--text)]">
      <div className="mx-auto flex max-w-5xl flex-col gap-5 p-6 md:p-10">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <span className={eyebrow}>My Network</span>
            <h1 className="text-[28px] font-semibold tracking-tight">
              {contactCount} {contactCount === 1 ? "contact" : "contacts"}
            </h1>
            <p className="text-sm text-[var(--text-muted)]">
              Investors and founders you know. Kevin enriches them and finds who to introduce.
            </p>
            {isSuperAdmin && (
              <label className="mt-2 flex items-center gap-2 text-xs text-[var(--text-muted)]">
                Acting as
                <select
                  value={actingAsUserId}
                  onChange={(e) => setActingAsUserId(e.target.value)}
                  className="min-h-8 rounded-[8px] border border-[var(--overlay-12)] bg-[var(--bg)] px-2 text-xs text-[var(--text)]"
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
              </label>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => sheetInputRef.current?.click()} className={btn}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2" />
                <path d="M7 9l5 -5l5 5" />
                <path d="M12 4l0 12" />
              </svg>
              Upload spreadsheet
            </button>
            <button type="button" onClick={() => setShowForm((v) => !v)} className={btnPrimary} aria-expanded={showForm}>
              {showForm ? "Close" : "+ Add contact"}
            </button>
            <input ref={sheetInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onSheetFile} />
          </div>
        </header>

        {msg && (
          <p role="status" className="text-sm text-[var(--accent-fg)]">
            {msg}
          </p>
        )}

        {showForm && (
          <form onSubmit={onAdd} className={`${card} flex flex-col gap-4 border-metatron-accent/40 p-5`}>
            <h2 className="text-base font-semibold">Add a contact</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={field}>
                <span>Type</span>
                <select
                  value={form.role}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as "investor" | "founder" }))}
                  className={input}
                >
                  <option value="investor">Investor</option>
                  <option value="founder">Founder</option>
                </select>
              </label>
              <label className={field}>
                <span>Name *</span>
                <input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={input} placeholder="Full name" />
              </label>
              <label className={field}>
                <span>Email</span>
                <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className={input} placeholder="name@example.com" />
              </label>
              <label className={field}>
                <span>Firm or company</span>
                <input value={form.firm_or_company} onChange={(e) => setForm((f) => ({ ...f, firm_or_company: e.target.value }))} className={input} />
              </label>
              <label className={field}>
                <span>LinkedIn</span>
                <input value={form.linkedin_url} onChange={(e) => setForm((f) => ({ ...f, linkedin_url: e.target.value }))} className={input} placeholder="https://linkedin.com/in/…" />
              </label>
              <label className={field}>
                <span>Notes</span>
                <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className={input} placeholder="Where you met, what they're looking for" />
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowForm(false)} className={btn}>
                Cancel
              </button>
              <button type="submit" disabled={adding} className={btnPrimary}>
                {adding ? "Adding…" : "Add contact"}
              </button>
            </div>
          </form>
        )}

        {(sheetMsg || sheetPreview) && (
          <section className={`${card} flex flex-col gap-4 p-5`}>
            {sheetMsg && <p className="text-sm text-[var(--text-muted)]">{sheetMsg}</p>}
            {sheetPreview && (
              <>
                <div className="flex flex-col gap-1">
                  <h2 className="text-base font-semibold">Found in your spreadsheet</h2>
                  <p className="text-[13px] text-[var(--text-muted)]">
                    Kevin searches the web for each one to fill in contact details, sectors and ticket sizes. You review them before anything is added to your network.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(
                    [
                      ["Investors", sheetPreview.investors],
                      ["Founders", sheetPreview.founders],
                    ] as const
                  ).map(([label, rows]) => (
                    <div key={label} className="flex flex-col gap-1 rounded-[10px] bg-[var(--overlay-3)] p-4">
                      <span className="text-[13px] text-[var(--text-muted)]">{label}</span>
                      <b className="text-2xl font-semibold">{rows.length}</b>
                      <span className="truncate text-xs text-[var(--text-muted)]">
                        {rows.slice(0, 4).map((r) => r.name).join(", ")}
                        {rows.length > 4 ? ` and ${rows.length - 4} more` : ""}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void onStageContacts("all")} className={btnPrimary}>
                    Enrich all {sheetPreview.investors.length + sheetPreview.founders.length}
                  </button>
                  {sheetPreview.investors.length > 0 && sheetPreview.founders.length > 0 && (
                    <>
                      <button type="button" onClick={() => void onStageContacts("investors")} className={btn}>
                        Investors only
                      </button>
                      <button type="button" onClick={() => void onStageContacts("founders")} className={btn}>
                        Founders only
                      </button>
                    </>
                  )}
                  <button type="button" onClick={() => setSheetPreview(null)} className={btn}>
                    Cancel
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {stagedEnrichedCount > 0 && enrichingNow === 0 && (
          <section className={`${card} flex flex-wrap items-center gap-4 border-dashed border-metatron-accent/50 p-5`}>
            <p className="min-w-0 flex-1 basis-72 text-sm text-[var(--text-muted)]">
              <strong className="text-[var(--text)]">
                {stagedEnrichedCount} {stagedEnrichedCount === 1 ? "contact is" : "contacts are"} enriched by Kevin
              </strong>{" "}
              and ready to add to your network.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={scrollToStaging} className={btn}>
                Review
              </button>
              <button type="button" onClick={() => void onImportEnriched()} disabled={importingStaged} className={btnPrimary}>
                {importingStaged ? "Importing…" : "Import all"}
              </button>
            </div>
          </section>
        )}

        {enrichingNow > 0 && (
          <section className={`${card} flex flex-col gap-2.5 p-5`}>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                <strong>Kevin is enriching {enrichingNow} contacts.</strong>{" "}
                <span className="text-[var(--text-muted)]">You can leave this page; it carries on in the background.</span>
              </span>
              <button type="button" onClick={scrollToStaging} className="text-[13px] font-medium text-[var(--accent-fg)] hover:underline">
                See progress
              </button>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--overlay-8)]">
              <div
                className="h-full rounded-full bg-metatron-accent transition-all duration-500"
                style={{ width: `${stagingTotal > 0 ? (stagingCounts.enriched / stagingTotal) * 100 : 0}%` }}
              />
            </div>
          </section>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium ${
              enrichmentCredits > 0 ? "bg-metatron-accent/10 text-[var(--accent-fg)]" : "bg-[var(--overlay-6)] text-[var(--danger)]"
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11" />
            </svg>
            {enrichmentCredits} enrichment credits
          </span>
          {isFreeTier && (
            <span className={atFreeLimit ? "text-[var(--danger)]" : "text-[var(--text-muted)]"}>{contactCount} of 50 contacts on Free</span>
          )}
          {(isFreeTier || enrichmentCredits <= 0) && (
            <UpgradeButton className="font-medium text-[var(--accent-fg)] hover:underline">
              {isFreeTier ? "Upgrade for unlimited contacts and 50 credits" : "Buy credits"}
            </UpgradeButton>
          )}
          <span className="flex-1" />
          <button type="button" onClick={() => void onExportNetwork()} disabled={contactCount === 0} className={btnSm}>
            Export to Excel
          </button>
          {!isFreeTier && (
            <button type="button" onClick={() => void onIpfsSnapshot()} disabled={ipfsLoading || contactCount === 0} className={btnSm}>
              {ipfsLoading ? "Anchoring…" : "Anchor to IPFS"}
            </button>
          )}
          {ipfsResult?.cid && (
            <a href={ipfsResult.url} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-[var(--accent-fg)] hover:underline">
              {ipfsResult.cid.slice(0, 16)}… ({ipfsResult.count} contacts)
            </a>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex min-h-11 min-w-0 flex-1 basis-64 items-center gap-2 rounded-xl border border-[var(--overlay-12)] bg-[var(--bg-card)] px-3.5 text-[var(--text-muted)]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" />
              <path d="M21 21l-6 -6" />
            </svg>
            <span className="sr-only">Search contacts</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, firm, sector or country"
              className="min-w-0 flex-1 bg-transparent text-sm text-[var(--text)] outline-none"
            />
          </label>
          <div role="group" aria-label="Show" className="flex gap-1 rounded-[10px] border border-[var(--border)] bg-[var(--bg-card)] p-1">
            {(["all", "investor", "founder"] as const).map((t) => (
              <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)} className={seg(tab === t)}>
                {t === "all" ? "All" : t === "investor" ? "Investors" : "Founders"}
                <span className="text-xs text-[var(--text-muted)]">{tabCount[t]}</span>
              </button>
            ))}
          </div>
        </div>

        <section className={`${card} flex flex-col px-5 py-1`}>
          {paginated.length === 0 ? (
            <div className="flex flex-col items-start gap-3 py-6">
              {contactCount === 0 ? (
                <>
                  <p className="text-sm text-[var(--text-muted)]">
                    No contacts yet. Upload a spreadsheet of the investors and founders you know, or add them one at a time.
                  </p>
                  <button type="button" onClick={() => sheetInputRef.current?.click()} className={btnPrimary}>
                    Upload spreadsheet
                  </button>
                </>
              ) : (
                <p className="text-sm text-[var(--text-muted)]">No contacts match.</p>
              )}
            </div>
          ) : (
            paginated.map((c) => {
              const focus = [c.sector_focus, c.stage_focus, c.geography].filter(Boolean).join(" · ");
              return (
                <div key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--border)] py-3 first:border-t-0">
                  <button
                    type="button"
                    onClick={() => openContactModalView(c)}
                    className="flex min-w-0 flex-1 basis-60 items-center gap-3 rounded-[10px] text-left"
                  >
                    <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--overlay-6)] text-[13px] font-semibold text-[var(--text-muted)]">
                      {initials(c.name)}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <strong className="truncate text-sm hover:underline">{c.name}</strong>
                      <span className="truncate text-[13px] text-[var(--text-muted)]">
                        {[c.firm_or_company !== c.name ? c.firm_or_company : null, c.role === "investor" ? "Investor" : "Founder"].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </button>
                  <span className="hidden min-w-0 flex-1 basis-48 truncate text-[13px] text-[var(--text-muted)] md:block">{focus || "Not enriched yet"}</span>
                  {c.joined_user_id && (
                    <span className="rounded-full bg-[var(--good-bg)] px-2.5 py-0.5 text-xs font-semibold text-[var(--good)]">On metatron</span>
                  )}
                  <a href={introduceHref(c)} className={btnSm}>
                    Introduce
                  </a>
                </div>
              );
            })
          )}
        </section>

        {filtered.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 text-[13px] text-[var(--text-muted)]">
            <span>
              Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}
            </span>
            <div className="flex items-center gap-2">
              <label className="sr-only" htmlFor="network-page-size">
                Contacts per page
              </label>
              <select
                id="network-page-size"
                value={pageSize}
                onChange={(e) => setPageSizeRaw(Number(e.target.value))}
                className="min-h-8 rounded-[8px] border border-[var(--overlay-12)] bg-[var(--bg)] px-2 text-xs text-[var(--text)]"
              >
                {[10, 25, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n} per page
                  </option>
                ))}
              </select>
              {totalPages > 1 && (
                <>
                  <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className={btnSm}>
                    Previous
                  </button>
                  <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className={btnSm}>
                    Next
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        <section ref={stagingRef} id="import" className={`${card} mt-2 flex scroll-mt-24 flex-col gap-4 p-5`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 basis-72 flex-col gap-1">
              <h2 className="text-base font-semibold">Import and enrich</h2>
              <p className="text-[13px] text-[var(--text-muted)]">
                Contacts from a spreadsheet wait here while Kevin looks them up. Review them, then import.{" "}
                <a href="/connector/settings" className="text-[var(--accent-fg)] hover:underline">
                  Use your own API key
                </a>{" "}
                to enrich more.
              </p>
            </div>
            {stagingTotal > 0 && (
              <div className="flex flex-wrap gap-2">
                {stagedPendingCount > 0 && (
                  <button
                    type="button"
                    onClick={() => void onEnrichAll()}
                    disabled={enrichmentCredits === 0}
                    title={enrichmentCredits === 0 ? "No credits remaining" : undefined}
                    className={btnPrimary}
                  >
                    Enrich waiting ({stagedPendingCount})
                  </button>
                )}
                {stagedFailedCount > 0 && (
                  <button
                    type="button"
                    onClick={() => void onEnrichAll()}
                    disabled={enrichmentCredits === 0}
                    title={enrichmentCredits === 0 ? "No credits remaining" : undefined}
                    className={btn}
                  >
                    Retry failed ({stagedFailedCount})
                  </button>
                )}
                {stagedEnrichedCount > 0 && (
                  <button type="button" onClick={() => void onImportEnriched()} disabled={importingStaged} className={stagedPendingCount > 0 ? btn : btnPrimary}>
                    {importingStaged ? "Importing…" : `Import enriched (${stagedEnrichedCount})`}
                  </button>
                )}
                <button type="button" onClick={() => void onClearStaging()} className={`${btn} hover:text-[var(--danger)]`}>
                  Clear all
                </button>
              </div>
            )}
          </div>

          {stagingMsg && (
            <p role="status" className="text-[13px] text-[var(--accent-fg)]">
              {stagingMsg}
            </p>
          )}
          {stagingLoading && stagingTotal === 0 && <p className="text-[13px] text-[var(--text-muted)]">Loading…</p>}

          {stagingTotal === 0 && !stagingLoading && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-dashed border-[var(--overlay-12)] p-4">
              <p className="min-w-0 flex-1 basis-64 text-[13px] text-[var(--text-muted)]">
                Nothing waiting. Upload an .xlsx, .xls or .csv file; Kevin detects the columns and picks out investors and founders.
              </p>
              <button type="button" onClick={() => sheetInputRef.current?.click()} className={btn}>
                Upload spreadsheet
              </button>
            </div>
          )}

          {stagingTotal > 0 && (
            <>
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between text-[13px] text-[var(--text-muted)]">
                  <span>
                    {stagingCounts.enriched} of {stagingTotal} enriched
                    {stagingCounts.enriching > 0 && <span className="ml-2 animate-pulse text-[var(--accent-fg)]">· {stagingCounts.enriching} in progress</span>}
                    {stagingCounts.failed > 0 && <span className="ml-2 text-[var(--danger)]">· {stagingCounts.failed} failed</span>}
                  </span>
                  <span>{Math.round((stagingCounts.enriched / stagingTotal) * 100)}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[var(--overlay-8)]">
                  <div className="h-full rounded-full bg-metatron-accent transition-all duration-500" style={{ width: `${(stagingCounts.enriched / stagingTotal) * 100}%` }} />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div role="group" aria-label="Show" className="flex gap-1 rounded-[10px] border border-[var(--border)] p-1">
                  {(["all", "investor", "founder"] as const).map((t) => (
                    <button key={t} type="button" aria-pressed={stagingTab === t} onClick={() => setStagingTab(t)} className={seg(stagingTab === t)}>
                      {t === "all" ? "All" : t === "investor" ? "Investors" : "Founders"}
                      <span className="text-xs text-[var(--text-muted)]">
                        {t === "all" ? stagingTotal : t === "investor" ? stagedInvestorCount : stagedFounderCount}
                      </span>
                    </button>
                  ))}
                </div>
                {selectedStaged.size > 0 && (
                  <div className="flex gap-2">
                    <button type="button" onClick={() => void onEnrichSelected()} className={btnSm}>
                      Enrich selected ({selectedStaged.size})
                    </button>
                    <button type="button" onClick={() => void onImportEnriched(Array.from(selectedStaged))} disabled={importingStaged} className={btnSm}>
                      Import selected
                    </button>
                  </div>
                )}
              </div>

              {enrichingNow > 0 && recentFeed.length > 0 && (
                <div className="overflow-hidden rounded-[10px] border border-[var(--border)]">
                  <p className="border-b border-[var(--border)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--accent-fg)]">Just enriched</p>
                  <ul>
                    {recentFeed.map((r) => (
                      <li
                        key={r.id}
                        className={`flex items-center justify-between gap-3 border-t border-[var(--border)] px-3 py-2 first:border-t-0 ${recentlyEnriched.has(r.id) ? STAGING_RECENT_HIGHLIGHT_BG : ""}`}
                      >
                        <span className="min-w-0 truncate text-[13px]">
                          <strong className="font-medium">{r.name}</strong>
                          <span className="text-[var(--text-muted)]"> · {r.sector_focus?.trim() || "no sector found"}</span>
                        </span>
                        {statusBadge("enriched")}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-[13px]">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-left font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                      <th className="w-8 py-2 pr-2 font-normal">
                        <input
                          type="checkbox"
                          aria-label="Select all"
                          checked={selectedStaged.size === filteredStaged.length && filteredStaged.length > 0}
                          onChange={(e) => setSelectedStaged(e.target.checked ? new Set(filteredStaged.map((s) => s.id)) : new Set())}
                        />
                      </th>
                      <th className="py-2 pr-3 font-normal">Name</th>
                      <th className="py-2 pr-3 font-normal">Contact</th>
                      <th className="py-2 pr-3 font-normal">Focus</th>
                      <th className="py-2 pr-3 font-normal">Ticket</th>
                      <th className="py-2 pr-3 font-normal">Status</th>
                      <th className="py-2 font-normal">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStaged.map((s) => (
                      <Fragment key={s.id}>
                        <tr className={`border-b border-[var(--border)] align-top ${recentlyEnriched.has(s.id) ? STAGING_RECENT_HIGHLIGHT_BG : ""}`}>
                          <td className="py-2.5 pr-2">
                            <input
                              type="checkbox"
                              aria-label={`Select ${s.name}`}
                              checked={selectedStaged.has(s.id)}
                              onChange={(e) =>
                                setSelectedStaged((prev) => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(s.id);
                                  else next.delete(s.id);
                                  return next;
                                })
                              }
                            />
                          </td>
                          <td className="max-w-[200px] py-2.5 pr-3">
                            <p className="truncate font-medium">{s.name}</p>
                            {s.firm_or_company && s.firm_or_company !== s.name && <p className="truncate text-[var(--text-muted)]">{s.firm_or_company}</p>}
                            {s.website && (
                              <a href={s.website} target="_blank" rel="noreferrer" className="block truncate text-xs text-[var(--accent-fg)] hover:underline">
                                {s.website.replace(/^https?:\/\//, "")}
                              </a>
                            )}
                          </td>
                          <td className="max-w-[180px] py-2.5 pr-3 text-[var(--text-muted)]">
                            {s.contact_name && <p className="truncate">{s.contact_name}</p>}
                            {s.email && <p className="truncate">{s.email}</p>}
                            {!s.contact_name && !s.email && "—"}
                          </td>
                          <td className="max-w-[200px] py-2.5 pr-3 text-[var(--text-muted)]">
                            <p className="truncate">{[s.sector_focus, s.stage_focus].filter(Boolean).join(" · ") || "—"}</p>
                            {s.geography && <p className="truncate">{s.geography}</p>}
                          </td>
                          <td className="py-2.5 pr-3 text-[var(--text-muted)]">{s.ticket_size ?? "—"}</td>
                          <td className="py-2.5 pr-3">
                            {statusBadge(s.status)}
                            {s.enrichment_error && <p className="mt-1 max-w-[180px] text-xs text-[var(--danger)]">{s.enrichment_error}</p>}
                          </td>
                          <td className="py-2.5">
                            <div className="flex justify-end gap-3 whitespace-nowrap text-[13px] font-medium">
                              {s.status === "enriched" && (
                                <button type="button" onClick={() => void onImportEnriched([s.id])} className="text-[var(--accent-fg)] hover:underline">
                                  Import
                                </button>
                              )}
                              {s.status === "failed" && (
                                <button type="button" onClick={() => void onRetryContact(s.id)} className="text-[var(--warn)] hover:underline">
                                  Retry
                                </button>
                              )}
                              <button type="button" onClick={() => startEditStaged(s)} className="text-[var(--text-muted)] hover:text-[var(--text)]">
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => void onDeleteStaged(s.id)}
                                aria-label={`Remove ${s.name}`}
                                className="text-[var(--text-muted)] hover:text-[var(--danger)]"
                              >
                                Remove
                              </button>
                            </div>
                          </td>
                        </tr>
                        {editingStagedId === s.id && (
                          <tr className="border-b border-[var(--border)] bg-[var(--overlay-3)]">
                            <td colSpan={7} className="p-3">
                              <div className="grid gap-3 sm:grid-cols-3">
                                {(
                                  [
                                    ["contact_name", "Contact name"],
                                    ["email", "Email"],
                                    ["linkedin_url", "LinkedIn"],
                                    ["website", "Website"],
                                    ["sector_focus", "Sector"],
                                    ["stage_focus", "Stage"],
                                    ["ticket_size", "Ticket size"],
                                    ["geography", "Location"],
                                    ["one_liner", "One-liner"],
                                  ] as [keyof typeof editStagedForm, string][]
                                ).map(([f, label]) => (
                                  <label key={f} className="flex flex-col gap-1 text-xs font-semibold">
                                    <span>{label}</span>
                                    <input
                                      value={(editStagedForm[f] as string) ?? ""}
                                      onChange={(e) => setEditStagedForm((ef) => ({ ...ef, [f]: e.target.value }))}
                                      className="min-h-9 rounded-[8px] border border-[var(--overlay-12)] bg-[var(--bg)] px-2.5 text-[13px] font-normal text-[var(--text)] outline-none focus:border-metatron-accent"
                                    />
                                  </label>
                                ))}
                              </div>
                              <div className="mt-3 flex gap-2">
                                <button type="button" onClick={() => void onSaveStagedEdit(s.id)} disabled={savingStagedEdit} className={btnPrimary}>
                                  {savingStagedEdit ? "Saving…" : "Save"}
                                </button>
                                <button type="button" onClick={() => setEditingStagedId(null)} className={btn}>
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

              {stagingTotal > 50 && (
                <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-[var(--text-muted)]">
                  <span>
                    Showing {stagingPage * 50 + 1}–{Math.min((stagingPage + 1) * 50, stagingTotal)} of {stagingTotal}
                  </span>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setStagingPage((p) => Math.max(0, p - 1))} disabled={stagingPage === 0} className={btnSm}>
                      Previous
                    </button>
                    <button
                      type="button"
                      onClick={() => setStagingPage((p) => Math.min(Math.ceil(stagingTotal / 50) - 1, p + 1))}
                      disabled={stagingPage >= Math.ceil(stagingTotal / 50) - 1}
                      className={btnSm}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        {viewingContact && (
          <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto px-4 py-8">
            <div className="absolute inset-0 bg-black/60" aria-hidden onClick={closeContactModal} />
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="contact-modal-title"
              className="relative z-10 flex max-h-[min(90vh,800px)] w-full max-w-2xl flex-col rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] shadow-[var(--card-shadow)]"
            >
              <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--overlay-6)] text-sm font-semibold text-[var(--text-muted)]">
                    {initials(viewingContact.name)}
                  </span>
                  <div className="min-w-0">
                    <h2 id="contact-modal-title" className="truncate text-xl font-semibold">
                      {contactModalMode === "view" ? viewingContact.name : `Edit ${viewingContact.name}`}
                    </h2>
                    <p className="truncate text-[13px] text-[var(--text-muted)]">
                      {[viewingContact.firm_or_company !== viewingContact.name ? viewingContact.firm_or_company : null, viewingContact.role === "investor" ? "Investor" : "Founder"]
                        .filter(Boolean)
                        .join(" · ")}
                      {viewingContact.joined_user_id ? " · On metatron" : ""}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeContactModal}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-[var(--text-muted)] hover:bg-[var(--overlay-6)] hover:text-[var(--text)]"
                  aria-label="Close"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                    <path d="M18 6l-12 12" />
                    <path d="M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                {contactModalMode === "view" ? (
                  <div className="flex flex-col gap-4">
                    {viewingContact.one_liner && <p className="text-sm leading-relaxed text-[var(--text-muted)]">{viewingContact.one_liner}</p>}
                    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                      {(
                        [
                          ["Email", viewingContact.email],
                          ["Sector", viewingContact.sector_focus],
                          ["Stage", viewingContact.stage_focus],
                          ["Ticket", viewingContact.ticket_size],
                          ["Location", viewingContact.geography],
                          ["Website", viewingContact.website],
                          ["LinkedIn", viewingContact.linkedin_url],
                        ] as const
                      ).map(([label, val]) => (
                        <div key={label} className="min-w-0">
                          <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">{label}</dt>
                          <dd className="mt-0.5 text-sm">
                            {!val ? (
                              <span className="text-[var(--text-muted)]">—</span>
                            ) : label === "Website" ? (
                              <a href={val} target="_blank" rel="noreferrer" className="break-all text-[var(--accent-fg)] hover:underline">
                                {val.replace(/^https?:\/\//, "")}
                              </a>
                            ) : label === "LinkedIn" ? (
                              <a href={val} target="_blank" rel="noreferrer" className="text-[var(--accent-fg)] hover:underline">
                                View profile
                              </a>
                            ) : label === "Email" ? (
                              <a href={`mailto:${val}`} className="break-all text-[var(--accent-fg)] hover:underline">
                                {val}
                              </a>
                            ) : (
                              val
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    {viewingContact.notes && (
                      <div className="flex flex-col gap-1.5">
                        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Notes</span>
                        <p className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-[10px] bg-[var(--overlay-3)] px-3 py-2 text-[13px] leading-relaxed text-[var(--text-muted)]">
                          {viewingContact.notes}
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {(
                      [
                        ["name", "Name"],
                        ["firm_or_company", "Firm or company"],
                        ["email", "Email"],
                        ["linkedin_url", "LinkedIn"],
                        ["website", "Website"],
                        ["sector_focus", "Sector"],
                        ["stage_focus", "Stage"],
                        ["ticket_size", "Ticket size"],
                        ["geography", "Location"],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key} className={field}>
                        <span>{label}</span>
                        <input value={editForm[key]} onChange={(e) => setEditForm((ef) => ({ ...ef, [key]: e.target.value }))} className={input} />
                      </label>
                    ))}
                    <label className={`${field} sm:col-span-2`}>
                      <span>One-liner</span>
                      <textarea
                        value={editForm.one_liner}
                        onChange={(e) => setEditForm((ef) => ({ ...ef, one_liner: e.target.value }))}
                        rows={2}
                        className={`${input} resize-y`}
                      />
                    </label>
                    <label className={`${field} sm:col-span-2`}>
                      <span>Notes</span>
                      <textarea
                        value={editForm.notes}
                        onChange={(e) => setEditForm((ef) => ({ ...ef, notes: e.target.value }))}
                        rows={4}
                        className={`${input} resize-y`}
                      />
                    </label>
                  </div>
                )}
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-[var(--border)] px-5 py-3">
                {contactModalMode === "view" ? (
                  <>
                    <a href={introduceHref(viewingContact)} className={btnPrimary}>
                      Introduce
                    </a>
                    <button type="button" onClick={() => openContactModalEdit(viewingContact)} className={btn}>
                      Edit
                    </button>
                    <span className="flex-1" />
                    <button type="button" onClick={() => void onArchive(viewingContact.id)} className={btn}>
                      Archive
                    </button>
                    <button type="button" onClick={() => void onDelete(viewingContact.id)} className={`${btn} text-[var(--danger)]`}>
                      Delete
                    </button>
                  </>
                ) : (
                  <>
                    {editMsg && (
                      <p role="alert" className="w-full text-[13px] text-[var(--danger)]">
                        {editMsg}
                      </p>
                    )}
                    <button type="button" onClick={() => void onSaveContactModal()} disabled={savingEdit} className={btnPrimary}>
                      {savingEdit ? "Saving…" : "Save"}
                    </button>
                    <button type="button" onClick={cancelContactModalEdit} disabled={savingEdit} className={btn}>
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

export default function ConnectorNetworkPage() {
  return (
    <Suspense fallback={null}>
      <ConnectorNetworkPageInner />
    </Suspense>
  );
}
