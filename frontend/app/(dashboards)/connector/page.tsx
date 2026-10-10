"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { API_BASE, authHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { MeResponse } from "@/lib/me";

type IntroRow = { id: string; person_a_name: string; person_b_name: string; status: string; created_at: string };
type ReferralInfo = { total_referrals: number; converted: number };
type Contact = { id: string; role: string; email: string | null; linkedin_url: string | null; sector_focus: string | null; one_liner: string | null; joined_user_id: string | null };
type ConnectorProfile = { organisation?: string | null; bio?: string | null; speciality?: string | null; country?: string | null };

const card = "flex flex-col gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-[var(--card-shadow)]";
const eyebrow = "font-mono text-[11px] uppercase tracking-[0.14em]";
const btnPrimary =
  "inline-flex min-h-11 items-center justify-center rounded-xl bg-metatron-accent px-5 text-sm font-semibold text-white hover:bg-metatron-accent-hover";

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-[var(--card-shadow)]">
      <span className="text-[13px] text-[var(--text-muted)]">{label}</span>
      <b className="text-2xl font-semibold">{value}</b>
    </div>
  );
}

function statusPill(status: string): string {
  const s = status.toUpperCase();
  if (s === "CLOSED" || s === "ACCEPTED" || s === "COMPLETED" || s === "CONNECTED") return "bg-[var(--good-bg)] text-[var(--good)]";
  if (s === "SENT") return "bg-metatron-accent/15 text-[var(--accent-fg)]";
  if (s === "DECLINED" || s === "REJECTED") return "bg-[var(--overlay-6)] text-[var(--text-muted)]";
  return "bg-[var(--warn-bg)] text-[var(--warn)]";
}

export default function ConnectorDashboardPage() {
  const { token, loading } = useAuth("INTERMEDIARY");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [profile, setProfile] = useState<ConnectorProfile | null>(null);
  const [logo, setLogo] = useState<string | null>(null);
  const [intros, setIntros] = useState<IntroRow[] | null>(null);
  const [refs, setRefs] = useState<ReferralInfo | null>(null);
  const [contacts, setContacts] = useState<Contact[] | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const get = (path: string) => fetch(`${API_BASE}${path}`, { headers: authHeaders(token) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const [m, cp, prof, ir, rr, net] = await Promise.all([
      get("/auth/me"),
      get("/connector-profile"),
      get("/profile"),
      get("/connector-profile/introductions"),
      get("/connector-profile/referrals"),
      get("/connector-profile/network"),
    ]);
    setMe(m as MeResponse | null);
    setProfile(cp as ConnectorProfile | null);
    setLogo((prof as { logo_url?: string | null } | null)?.logo_url ?? null);
    setIntros((ir as IntroRow[] | null) ?? []);
    setRefs(rr as ReferralInfo | null);
    setContacts((net as Contact[] | null) ?? []);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading || !token) return null;

  const p = profile ?? {};
  const items: [string, boolean][] = [
    ["Photo or logo", Boolean(logo)],
    ["Organisation", Boolean(p.organisation?.trim())],
    ["About you", Boolean(p.bio?.trim())],
    ["Where you help", Boolean(p.speciality?.trim())],
    ["Network imported", (contacts?.length ?? 0) > 0],
  ];
  const done = items.filter((i) => i[1]).length;
  const name = me?.first_name?.trim() || p.organisation?.trim() || "";
  const list = contacts ?? [];
  const enriched = list.filter((c) => c.sector_focus || c.one_liner || c.linkedin_url).length;
  const investors = list.filter((c) => c.role.toLowerCase() === "investor").length;
  const inFlight = (intros ?? []).filter((i) => i.status.toUpperCase() === "PENDING");

  return (
    <main className="min-w-0 flex-1">
      <section className="mx-auto flex max-w-5xl flex-col gap-5 p-6 md:p-10">
        <header className="flex flex-col gap-1.5">
          <span className={`${eyebrow} text-[var(--text-muted)]`}>Dashboard</span>
          <h1 className="text-[28px] font-semibold tracking-tight">
            {greeting()}
            {name ? `, ${name}` : ""}
          </h1>
        </header>

        {profile && contacts && done < items.length && (
          <section className={`${card} md:flex-row md:flex-wrap md:items-center`}>
            <div className="flex min-w-0 flex-1 basis-72 flex-col gap-1.5">
              <div className="flex justify-between gap-2">
                <strong>Complete your profile</strong>
                <span className="text-sm text-[var(--text-muted)]">
                  {done} of {items.length}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded bg-[var(--overlay-8)]">
                <div className="h-full rounded bg-metatron-accent" style={{ width: `${Math.round((done / items.length) * 100)}%` }} />
              </div>
              <span className="text-[13px] text-[var(--text-muted)]">
                Missing:{" "}
                {items
                  .filter((i) => !i[1])
                  .map((i) => i[0].toLowerCase())
                  .join(", ")}
              </span>
            </div>
            <Link href="/connector/profile" className={btnPrimary}>
              Finish profile
            </Link>
          </section>
        )}

        {contacts && (
          <section className={`${card} border-metatron-accent/40 bg-metatron-accent/[0.06] md:flex-row md:flex-wrap md:items-center`}>
            <div className="flex min-w-0 flex-1 basis-80 flex-col gap-1.5">
              <span className={`${eyebrow} text-[var(--accent-fg)]`}>Next step from Kevin</span>
              <span className="text-xl font-semibold">
                {list.length === 0
                  ? "Import your network"
                  : inFlight.length === 0
                    ? "Make an introduction"
                    : `${inFlight.length} introduction${inFlight.length === 1 ? "" : "s"} waiting on a reply`}
              </span>
              <span className="text-sm text-[var(--text-muted)]">
                {list.length === 0
                  ? "Upload a CSV or add contacts one by one. Kevin enriches them and finds who to introduce."
                  : inFlight.length === 0
                    ? `You know ${investors} investor${investors === 1 ? "" : "s"}. Introduce a founder and you're credited if a deal follows.`
                    : "Nudge them, or start another introduction while you wait."}
              </span>
            </div>
            <Link href={list.length === 0 ? "/connector/network" : "/connector/introductions"} className={btnPrimary}>
              {list.length === 0 ? "Open My Network" : "Open Introductions"}
            </Link>
          </section>
        )}

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Contacts" value={contacts === null ? "…" : String(list.length)} />
          <Stat label="Enriched by Kevin" value={contacts === null ? "…" : list.length ? `${Math.round((enriched / list.length) * 100)}%` : "—"} />
          <Stat label="Intros in flight" value={intros === null ? "…" : String(inFlight.length)} />
          <Stat label="Referral signups" value={refs === null ? "—" : String(refs.total_referrals)} />
        </section>

        <section className={card}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">Recent introductions</h2>
            <Link href="/connector/introductions" className="text-sm text-[var(--accent-fg)] hover:underline">
              All introductions
            </Link>
          </div>
          {intros === null ? (
            <p className="text-sm text-[var(--text-muted)]">Loading…</p>
          ) : intros.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No introductions yet.</p>
          ) : (
            intros.slice(0, 5).map((x) => (
              <div key={x.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-3 text-sm">
                <span>
                  {x.person_a_name} → {x.person_b_name}
                </span>
                <span className={`rounded-full px-2.5 py-0.5 text-xs capitalize ${statusPill(x.status)}`}>{x.status.toLowerCase()}</span>
              </div>
            ))
          )}
        </section>
      </section>
    </main>
  );
}
