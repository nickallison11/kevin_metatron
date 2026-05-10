"use client";

import type { CSSProperties } from "react";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { API_BASE, authJsonHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  acceptedPeerUserIds,
  type ConnectListsResponse,
} from "@/lib/connectionsHandshake";

type KevinMatch = {
  id: string;
  matched_user_id: string | null;
  match_type: string;
  score: number;
  reasoning: string | null;
  generated_at: string;
  firm_name: string | null;
  company_name: string | null;
  one_liner: string | null;
  stage: string | null;
  sector: string | null;
  country: string | null;
  angel_score: number | null;
  intro_requested_at: string | null;
};

/** Rows from GET /kevin-matches/received-intros (founder sees requester profile in company/one_liner). */
type ReceivedConnect = {
  id: string;
  for_user_id: string;
  score: number;
  reasoning: string | null;
  intro_requested_at: string;
  company_name: string | null;
  one_liner: string | null;
  stage: string | null;
  sector: string | null;
  country: string | null;
  angel_score: number | null;
  founder_email: string;
  deck_url: string | null;
  deck_viewed_at: string | null;
  intro_accepted_at: string | null;
  intro_passed_at: string | null;
};

const PAGE_SIZE = 10;

const DEFAULT_MATCH_COLUMNS = [
  { key: "investor", label: "Investor", width: 200 },
  { key: "sector", label: "Sector", width: 140 },
  { key: "stage", label: "Stage", width: 120 },
  { key: "location", label: "Location", width: 160 },
  { key: "fit", label: "Fit", width: 80 },
  { key: "actions", label: "", width: 140 },
] as const;

function investorDisplayName(r: ReceivedConnect) {
  const n = r.company_name?.trim();
  if (n) return n;
  const o = r.one_liner?.trim();
  if (o) return o;
  return r.founder_email;
}

function StartupMatchesPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { token, loading, role } = useAuth("STARTUP");
  const [matches, setMatches] = useState<KevinMatch[]>([]);
  const [fetching, setFetching] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [introBusy, setIntroBusy] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "card">("list");
  const [page, setPageRaw] = useState(() => {
    const p = Number(searchParams.get("page"));
    return p > 0 ? p : 1;
  });
  const [viewingMatch, setViewingMatch] = useState<KevinMatch | null>(null);
  const [tab, setTab] = useState<"pending" | "sent">("pending");
  const [mainTab, setMainTab] = useState<"matches" | "connectRequests">("matches");
  const [receivedConnects, setReceivedConnects] = useState<ReceivedConnect[]>([]);
  const [connectFetching, setConnectFetching] = useState(false);
  const [connectActionBusy, setConnectActionBusy] = useState<string | null>(null);
  const [acceptedPeerIds, setAcceptedPeerIds] = useState<Set<string>>(new Set());
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const saved = localStorage.getItem("metatron_startup_matches_col_widths");
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const load = useCallback(async () => {
    if (!token) return;
    setFetching(true);
    try {
      const res = await fetch(`${API_BASE}/kevin-matches`, {
        method: "POST",
        headers: authJsonHeaders(token),
      });
      if (!res.ok) {
        setMsg("Could not load matches.");
        return;
      }
      setMatches(await res.json());
    } catch {
      setMsg("Could not load matches.");
    } finally {
      setFetching(false);
    }
  }, [token]);

  const loadConnections = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/connections`, {
        headers: authJsonHeaders(token),
      });
      if (res.ok) {
        const data = (await res.json()) as ConnectListsResponse;
        setAcceptedPeerIds(acceptedPeerUserIds(data));
      }
    } catch {
      /* ignore */
    }
  }, [token]);

  const loadReceivedConnects = useCallback(async () => {
    if (!token || role !== "STARTUP") return;
    setConnectFetching(true);
    try {
      const res = await fetch(`${API_BASE}/kevin-matches/received-intros`, {
        headers: authJsonHeaders(token),
      });
      if (res.ok) setReceivedConnects(await res.json());
    } catch {
      /* ignore */
    } finally {
      setConnectFetching(false);
    }
  }, [token, role]);

  useEffect(() => {
    if (!loading && token) {
      void load();
      void loadConnections();
    }
  }, [loading, token, load, loadConnections]);

  useEffect(() => {
    if (!loading && token && role === "STARTUP" && mainTab === "connectRequests") {
      void loadReceivedConnects();
    }
  }, [loading, token, role, mainTab, loadReceivedConnects]);

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(page));
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [page]);

  useEffect(() => {
    if (Object.keys(colWidths).length > 0) {
      localStorage.setItem("metatron_startup_matches_col_widths", JSON.stringify(colWidths));
    }
  }, [colWidths]);

  const onColResizeStart = useCallback(
    (colKey: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const defaultW = DEFAULT_MATCH_COLUMNS.find((c) => c.key === colKey)?.width ?? 120;
      const startX = e.clientX;
      const startWidth = colWidths[colKey] ?? defaultW;

      const onMove = (moveEvent: MouseEvent) => {
        const dx = moveEvent.clientX - startX;
        const newW = Math.max(80, startWidth + dx);
        setColWidths((prev) => ({ ...prev, [colKey]: newW }));
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [colWidths],
  );

  const pending = useMemo(() => matches.filter((m) => !m.intro_requested_at), [matches]);
  const requested = useMemo(() => matches.filter((m) => m.intro_requested_at), [matches]);
  const allMatches = useMemo(() => [...pending, ...requested], [pending, requested]);
  const activeMatches = useMemo(() => (tab === "pending" ? pending : requested), [tab, pending, requested]);
  const totalPages = Math.max(1, Math.ceil(activeMatches.length / PAGE_SIZE));
  const paginated = activeMatches.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const openConnectRequests = useMemo(
    () =>
      receivedConnects.filter((r) => !r.intro_accepted_at && !r.intro_passed_at),
    [receivedConnects],
  );

  async function requestIntro(matchId: string) {
    if (!token) return;
    setIntroBusy(matchId);
    setMsg(null);
    try {
      const res = await fetch(`${API_BASE}/kevin-matches/${matchId}/request-intro`, {
        method: "POST",
        headers: authJsonHeaders(token),
      });
      if (!res.ok) {
        const t = await res.text();
        setMsg(t.trim() || "Request failed.");
        return;
      }
      setMsg("Connect request sent!");
      setMatches((prev) =>
        prev.map((m) =>
          m.id === matchId ? { ...m, intro_requested_at: new Date().toISOString() } : m
        )
      );
      if (viewingMatch?.id === matchId) {
        setViewingMatch((v) => (v ? { ...v, intro_requested_at: new Date().toISOString() } : v));
      }
      void loadConnections();
    } catch {
      setMsg("Request failed.");
    } finally {
      setIntroBusy(null);
    }
  }

  async function acceptReceivedConnect(r: ReceivedConnect) {
    if (!token) return;
    setConnectActionBusy(r.id + "accept");
    try {
      const res = await fetch(`${API_BASE}/kevin-matches/${r.id}/accept-intro`, {
        method: "POST",
        headers: authJsonHeaders(token),
      });
      if (res.ok) {
        const ts = new Date().toISOString();
        setReceivedConnects((prev) =>
          prev.map((x) => (x.id === r.id ? { ...x, intro_accepted_at: ts } : x))
        );
        void load();
        void loadConnections();
      }
    } finally {
      setConnectActionBusy(null);
    }
  }

  async function declineReceivedConnect(r: ReceivedConnect) {
    if (!token) return;
    setConnectActionBusy(r.id + "decline");
    try {
      const res = await fetch(`${API_BASE}/kevin-matches/${r.id}/pass-intro`, {
        method: "POST",
        headers: authJsonHeaders(token),
      });
      if (res.ok) {
        const ts = new Date().toISOString();
        setReceivedConnects((prev) =>
          prev.map((x) => (x.id === r.id ? { ...x, intro_passed_at: ts } : x))
        );
        void loadConnections();
      }
    } finally {
      setConnectActionBusy(null);
    }
  }

  if (loading) return null;
  if (!token) return null;

  const scoreBadgeColor = (score: number) => {
    if (score >= 85) return "bg-[rgba(0,200,100,0.12)] text-green-400";
    if (score >= 70) return "bg-[rgba(108,92,231,0.15)] text-[#6c5ce7]";
    return "bg-[rgba(255,255,255,0.06)] text-[var(--text-muted)]";
  };

  const showConnectTab = role === "STARTUP";

  return (
    <main className="flex-1 text-[var(--text)]">
      <div className="space-y-6 px-6 py-6 md:px-10">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--text)]">Kevin&apos;s Investor Matches</h1>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              {showConnectTab && mainTab === "connectRequests"
                ? `${openConnectRequests.length} open received-connection${
                    openConnectRequests.length !== 1 ? "s" : ""
                  }`
                : `${pending.length} pending · ${requested.length} connect${
                    requested.length !== 1 ? "s" : ""
                  } requested · refreshes weekly`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {showConnectTab && (
              <div className="flex gap-1">
                {(["connectRequests", "matches"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setMainTab(t);
                      setPageRaw(1);
                    }}
                    className={`px-3 py-1 rounded-lg text-xs font-medium ${
                      mainTab === t
                        ? "bg-[rgba(108,92,231,0.2)] text-[#6c5ce7]"
                        : "text-[var(--text-muted)] hover:text-[var(--text)]"
                    }`}
                  >
                    {t === "connectRequests"
                      ? `Connect Requests${openConnectRequests.length > 0 ? ` (${openConnectRequests.length})` : ""}`
                      : "Matches"}
                  </button>
                ))}
              </div>
            )}
            {mainTab === "matches" && (
              <>
                <div className="flex gap-1">
                  {(["pending", "sent"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        setTab(t);
                        setPageRaw(1);
                      }}
                      className={`px-3 py-1 rounded-lg text-xs font-medium ${
                        tab === t
                          ? "bg-[rgba(108,92,231,0.2)] text-[#6c5ce7]"
                          : "text-[var(--text-muted)] hover:text-[var(--text)]"
                      }`}
                    >
                      {t === "pending" ? "Pending" : "Sent"}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  {(["list", "card"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => {
                        setView(v);
                        setPageRaw(1);
                      }}
                      className={`px-3 py-1 rounded-lg text-xs ${
                        view === v
                          ? "bg-[rgba(108,92,231,0.2)] text-[#6c5ce7]"
                          : "text-[var(--text-muted)] hover:text-[var(--text)]"
                      }`}
                    >
                      {v === "card" ? "Cards" : "List"}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {msg && (
          <p className="text-xs border border-[var(--border)] rounded-xl px-3 py-2 text-[var(--text-muted)]">
            {msg}
          </p>
        )}

        {showConnectTab && mainTab === "connectRequests" && (
          <div className="space-y-4">
            {connectFetching && receivedConnects.length === 0 && (
              <p className="text-sm text-[var(--text-muted)]">Loading…</p>
            )}
            {!connectFetching && openConnectRequests.length === 0 && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-6 text-center">
                <p className="text-sm text-[var(--text-muted)]">
                  No connect requests yet. When an investor sends Connect through Kevin, it will appear
                  here.
                </p>
              </div>
            )}
            {openConnectRequests.length > 0 && (
              <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5 space-y-4">
                {openConnectRequests.map((r) => (
                  <div
                    key={r.id}
                    className="rounded-lg border border-[var(--border)] p-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="min-w-0 flex-1 space-y-2">
                      <p className="text-sm font-semibold text-[var(--text)]">{investorDisplayName(r)}</p>
                      {r.one_liner && (
                        <p className="text-xs text-[var(--text-muted)] line-clamp-3">{r.one_liner}</p>
                      )}
                      <div className="flex flex-wrap gap-2 text-[11px] text-[var(--text-muted)]">
                        {r.sector && <span>{r.sector}</span>}
                        {r.stage && <span>· {r.stage}</span>}
                        {r.country && <span>· {r.country}</span>}
                      </div>
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${scoreBadgeColor(r.score)}`}
                      >
                        {r.score}% fit
                      </span>
                      {r.reasoning && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1">
                            Why Kevin matched
                          </p>
                          <p className="text-xs text-[var(--text)] leading-relaxed">{r.reasoning}</p>
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => void acceptReceivedConnect(r)}
                        disabled={connectActionBusy === r.id + "accept"}
                        className="px-3 py-2 bg-[#6c5ce7] text-white rounded-lg text-xs font-medium hover:bg-[#7d6ff0] disabled:opacity-50"
                      >
                        {connectActionBusy === r.id + "accept" ? "…" : "Accept"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void declineReceivedConnect(r)}
                        disabled={connectActionBusy === r.id + "decline"}
                        className="px-3 py-2 border border-[rgba(239,68,68,0.3)] text-[rgba(254,202,202,0.7)] rounded-lg text-xs hover:border-[rgba(239,68,68,0.5)] disabled:opacity-50"
                      >
                        {connectActionBusy === r.id + "decline" ? "…" : "Decline"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {mainTab === "matches" && (
          <>
            {fetching && allMatches.length === 0 && (
              <p className="text-sm text-[var(--text-muted)]">Kevin is finding your matches…</p>
            )}

            {!fetching && allMatches.length === 0 && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-6 text-center">
                <p className="text-sm text-[var(--text-muted)]">
                  No matches yet. Complete your profile (sector and stage) to get your first weekly batch.
                </p>
              </div>
            )}

            {activeMatches.length > 0 && (
              <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5">
                {view === "card" ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {paginated.map((m) => {
                      const accepted =
                        m.matched_user_id && acceptedPeerIds.has(m.matched_user_id);
                      const dimmed = m.intro_requested_at && !accepted;
                      return (
                        <div
                          key={m.id}
                          onClick={() => setViewingMatch(m)}
                          className={`rounded-xl p-4 cursor-pointer transition-colors border ${
                            dimmed
                              ? "border-[var(--border)] bg-[var(--bg)] opacity-60"
                              : "border-[var(--border)] bg-[var(--bg)] hover:bg-[var(--bg-card)] hover:border-[rgba(108,92,231,0.2)]"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-[var(--text)] truncate">
                                {m.firm_name ?? "Independent investor"}
                              </p>
                              {m.country && (
                                <p className="text-xs text-[var(--text-muted)]">{m.country}</p>
                              )}
                            </div>
                            <span
                              className={`shrink-0 px-2 py-0.5 rounded text-xs font-medium ${scoreBadgeColor(
                                m.score
                              )}`}
                            >
                              {m.score}%
                            </span>
                          </div>
                          {m.one_liner && (
                            <p className="text-xs text-[var(--text-muted)] line-clamp-2 mb-2">{m.one_liner}</p>
                          )}
                          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs mb-3">
                            {m.sector && (
                              <div>
                                <dt className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                                  Sector
                                </dt>
                                <dd className="text-[var(--text)] truncate">{m.sector}</dd>
                              </div>
                            )}
                            {m.stage && (
                              <div>
                                <dt className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                                  Stage
                                </dt>
                                <dd className="text-[var(--text)]">{m.stage}</dd>
                              </div>
                            )}
                          </dl>
                          {!m.intro_requested_at ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void requestIntro(m.id);
                              }}
                              disabled={introBusy === m.id}
                              className="w-full rounded-lg bg-[#6c5ce7] py-2 text-sm font-semibold text-white hover:bg-[#7d6ff0] disabled:opacity-50"
                            >
                              {introBusy === m.id ? "Sending…" : "Connect"}
                            </button>
                          ) : accepted ? (
                            <p className="text-xs font-medium text-green-400">Connected — message</p>
                          ) : (
                            <span className="text-xs text-[#6c5ce7]">Connect requested</span>
                          )}
                          {m.matched_user_id && (
                            <button
                              type="button"
                              title={
                                acceptedPeerIds.has(m.matched_user_id)
                                  ? undefined
                                  : "Connect with this user first"
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!acceptedPeerIds.has(m.matched_user_id!)) return;
                                window.dispatchEvent(
                                  new CustomEvent("metatron:open-chat", {
                                    detail: {
                                      userId: m.matched_user_id!,
                                      name: m.firm_name ?? "Investor",
                                    },
                                  })
                                );
                              }}
                              disabled={!acceptedPeerIds.has(m.matched_user_id)}
                              className="mt-2 w-full rounded-lg border border-[var(--border)] py-1.5 text-xs text-[var(--text-muted)] hover:border-[rgba(108,92,231,0.4)] hover:text-[#6c5ce7] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              Message
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm table-fixed">
                      <thead>
                        <tr className="text-[var(--text-muted)] text-xs border-b border-[var(--border)]">
                          {DEFAULT_MATCH_COLUMNS.map((col) => {
                            const w = colWidths[col.key] ?? col.width;
                            const isFirst = col.key === "investor";
                            return (
                              <th
                                key={col.key}
                                className={`relative cursor-default text-left pb-2 pr-3 ${isFirst ? "pl-3" : ""}`}
                                style={{ width: w, minWidth: 80 }}
                              >
                                {col.label}
                                <div
                                  className="absolute right-0 top-2 bottom-2 w-1 cursor-col-resize z-10 rounded-full transition-colors hover:bg-[#6c5ce7]"
                                  onMouseDown={(e) => onColResizeStart(col.key, e)}
                                  onClick={(e) => e.stopPropagation()}
                                  aria-hidden
                                />
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {paginated.map((m) => {
                          const accepted =
                            m.matched_user_id && acceptedPeerIds.has(m.matched_user_id);
                          const dimmed = m.intro_requested_at && !accepted;
                          return (
                            <tr
                              key={m.id}
                              onClick={() => setViewingMatch(m)}
                              className={`border-b border-[rgba(255,255,255,0.03)] cursor-pointer transition-colors h-14 ${
                                dimmed ? "opacity-50" : "bg-[var(--bg)] hover:bg-[var(--bg-card)]"
                              }`}
                            >
                              {DEFAULT_MATCH_COLUMNS.map((col) => {
                                const w = colWidths[col.key] ?? col.width;
                                const cellStyle: CSSProperties = {
                                  width: w,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                };
                                const isFirst = col.key === "investor";
                                const baseTd = isFirst
                                  ? "py-2 pl-3 pr-3 align-top"
                                  : col.key === "fit"
                                    ? "py-2 pr-3 align-top"
                                    : col.key === "actions"
                                      ? "py-2 pr-3 align-top"
                                      : "py-2 pr-3 text-[var(--text-muted)] text-xs align-top";
                                return (
                                  <td key={col.key} className={baseTd} style={cellStyle}>
                                    {col.key === "investor" ? (
                                      <>
                                        <p className="text-[var(--text)] font-medium">
                                          {m.firm_name ?? "Independent investor"}
                                        </p>
                                        {m.one_liner && (
                                          <p className="text-[var(--text-muted)] text-xs truncate max-w-[200px]">
                                            {m.one_liner}
                                          </p>
                                        )}
                                      </>
                                    ) : col.key === "sector" ? (
                                      (m.sector ?? "—")
                                    ) : col.key === "stage" ? (
                                      (m.stage ?? "—")
                                    ) : col.key === "location" ? (
                                      (m.country ?? "—")
                                    ) : col.key === "fit" ? (
                                      <span
                                        className={`px-2 py-0.5 rounded text-xs font-medium ${scoreBadgeColor(
                                          m.score
                                        )}`}
                                      >
                                        {m.score}%
                                      </span>
                                    ) : (
                                      <div className="flex items-center gap-2 whitespace-nowrap">
                                        {!m.intro_requested_at ? (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              void requestIntro(m.id);
                                            }}
                                            disabled={introBusy === m.id}
                                            className="px-3 py-1.5 bg-[#6c5ce7] text-white rounded-lg text-xs font-medium hover:bg-[#7d6ff0] disabled:opacity-50"
                                          >
                                            {introBusy === m.id ? "…" : "Connect"}
                                          </button>
                                        ) : accepted ? (
                                          <span className="text-xs text-green-400">Connected — message</span>
                                        ) : (
                                          <span className="text-xs text-[#6c5ce7]">Connect requested</span>
                                        )}
                                        {m.matched_user_id && (
                                          <button
                                            type="button"
                                            title={
                                              acceptedPeerIds.has(m.matched_user_id)
                                                ? undefined
                                                : "Connect with this user first"
                                            }
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              if (!acceptedPeerIds.has(m.matched_user_id!)) return;
                                              window.dispatchEvent(
                                                new CustomEvent("metatron:open-chat", {
                                                  detail: {
                                                    userId: m.matched_user_id!,
                                                    name: m.firm_name ?? "Investor",
                                                  },
                                                })
                                              );
                                            }}
                                            disabled={!acceptedPeerIds.has(m.matched_user_id)}
                                            className="px-3 py-1.5 border border-[var(--border)] text-[var(--text-muted)] rounded-lg text-xs hover:border-[rgba(108,92,231,0.4)] hover:text-[#6c5ce7] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                          >
                                            Message
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4 text-xs text-[var(--text-muted)]">
                    <span>
                      Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, activeMatches.length)} of{" "}
                      {activeMatches.length}
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setPageRaw((p) => Math.max(1, p - 1))}
                        disabled={page === 1}
                        className="px-3 py-1 bg-[rgba(255,255,255,0.06)] rounded-lg disabled:opacity-30"
                      >
                        Previous
                      </button>
                      <button
                        type="button"
                        onClick={() => setPageRaw((p) => Math.min(totalPages, p + 1))}
                        disabled={page === totalPages}
                        className="px-3 py-1 bg-[rgba(255,255,255,0.06)] rounded-lg disabled:opacity-30"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {tab === "pending" && pending.length === 0 && requested.length > 0 && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 text-center">
                <p className="text-sm font-semibold text-[var(--text)] mb-1">
                  You&apos;ve reached out to all your matches this week
                </p>
                <p className="text-xs text-[var(--text-muted)]">Your next batch of matches drops in 7 days.</p>
              </div>
            )}

            {tab === "sent" && requested.length === 0 && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-6 text-center">
                <p className="text-sm text-[var(--text-muted)]">
                  No connect requests sent yet. Send your first Connect from the Pending tab.
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {viewingMatch && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto pt-12 pb-4 px-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setViewingMatch(null)} />
          <div className="relative z-10 w-full max-w-lg max-h-[min(90vh,800px)] flex flex-col rounded-xl border border-[var(--border)] bg-[var(--bg-card)]">
            <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
              <div className="min-w-0">
                <h2 className="text-xl font-semibold text-[var(--text)]">
                  {viewingMatch.firm_name ?? "Independent investor"}
                </h2>
                {viewingMatch.country && (
                  <p className="text-sm text-[var(--text-muted)] mt-0.5">{viewingMatch.country}</p>
                )}
                <span
                  className={`mt-2 inline-block px-2 py-0.5 rounded text-xs font-medium ${scoreBadgeColor(
                    viewingMatch.score
                  )}`}
                >
                  {viewingMatch.score}% fit
                </span>
              </div>
              <button
                type="button"
                onClick={() => setViewingMatch(null)}
                className="shrink-0 rounded-lg p-2 text-[var(--text-muted)] hover:bg-[rgba(255,255,255,0.06)] hover:text-[var(--text)]"
              >
                <span className="block text-xl leading-none">×</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {viewingMatch.one_liner && (
                <p className="text-sm italic text-[var(--text-muted)]">{viewingMatch.one_liner}</p>
              )}
              {viewingMatch.reasoning && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1">
                    Why Kevin matched you
                  </p>
                  <p className="text-sm text-[var(--text)] leading-relaxed">{viewingMatch.reasoning}</p>
                </div>
              )}
              <div className="space-y-3 border-t border-[var(--border)] pt-4">
                {(
                  [
                    ["Sector", viewingMatch.sector],
                    ["Stage", viewingMatch.stage],
                    ["Location", viewingMatch.country],
                  ] as const
                ).map(([label, val]) =>
                  val ? (
                    <div key={label}>
                      <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{label}</p>
                      <p className="mt-0.5 text-sm text-[var(--text)]">{val}</p>
                    </div>
                  ) : null
                )}
              </div>
            </div>

            <div className="shrink-0 border-t border-[var(--border)] px-5 py-3 space-y-2">
              {viewingMatch.intro_requested_at &&
                viewingMatch.matched_user_id &&
                acceptedPeerIds.has(viewingMatch.matched_user_id) && (
                  <p className="text-sm text-green-400">Connected — message</p>
                )}
              {viewingMatch.intro_requested_at &&
                viewingMatch.matched_user_id &&
                !acceptedPeerIds.has(viewingMatch.matched_user_id) && (
                  <p className="text-sm text-[var(--text-muted)]">Connect requested</p>
                )}
              {!viewingMatch.intro_requested_at ? (
                <button
                  type="button"
                  onClick={() => void requestIntro(viewingMatch.id)}
                  disabled={introBusy === viewingMatch.id}
                  className="w-full rounded-xl bg-[#6c5ce7] py-2.5 text-sm font-semibold text-white hover:bg-[#7d6ff0] disabled:opacity-50"
                >
                  {introBusy === viewingMatch.id ? "Sending…" : "Connect →"}
                </button>
              ) : null}
              {viewingMatch.matched_user_id && (
                <button
                  type="button"
                  title={
                    acceptedPeerIds.has(viewingMatch.matched_user_id)
                      ? undefined
                      : "Connect with this user first"
                  }
                  onClick={() => {
                    if (!acceptedPeerIds.has(viewingMatch.matched_user_id!)) return;
                    window.dispatchEvent(
                      new CustomEvent("metatron:open-chat", {
                        detail: {
                          userId: viewingMatch.matched_user_id!,
                          name: viewingMatch.firm_name ?? "Investor",
                        },
                      })
                    );
                    setViewingMatch(null);
                  }}
                  disabled={!acceptedPeerIds.has(viewingMatch.matched_user_id)}
                  className="w-full rounded-xl border border-[var(--border)] py-2.5 text-sm text-[var(--text-muted)] hover:border-[rgba(108,92,231,0.4)] hover:text-[#6c5ce7] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Message →
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function StartupMatchesPage() {
  return (
    <Suspense fallback={null}>
      <StartupMatchesPageInner />
    </Suspense>
  );
}
