"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { IconCheck, IconCircle, IconSparkles, IconUpload } from "@tabler/icons-react";
import { API_BASE, authHeaders, authJsonHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { COUNTRIES } from "@/lib/countries";
import { STAGES } from "@/lib/stages";

/* ---------------- types ---------------- */

type ApiProfile = {
  company_name?: string | null;
  one_liner?: string | null;
  stage?: string | null;
  sector?: string | null;
  country?: string | null;
  website?: string | null;
  pitch_deck_url?: string | null;
  ipfs_visibility?: string | null;
  deck_expires_at?: string | null;
  deck_upload_count?: number;
  logo_url?: string | null;
  logo_source?: string | null;
};

type Member = { name: string; role: string; linkedin: string };

type Pitch = {
  id: string;
  title: string;
  description?: string | null;
  problem?: string | null;
  solution?: string | null;
  market_size?: string | null;
  business_model?: string | null;
  traction?: string | null;
  funding_ask?: string | null;
  use_of_funds?: string | null;
  team_size?: number | null;
  incorporation_country?: string | null;
  team_members?: unknown;
};

type PitchField =
  | "description"
  | "problem"
  | "solution"
  | "market_size"
  | "business_model"
  | "traction"
  | "funding_ask"
  | "incorporation_country"
  | "use_of_funds";

type Section = {
  k: string;
  label: string;
  fields?: { f: PitchField; label: string; short?: boolean }[];
  team?: true;
};

const SECTIONS: Section[] = [
  { k: "overview", label: "Overview", fields: [{ f: "description", label: "What does the company do?" }] },
  {
    k: "problem",
    label: "Problem & solution",
    fields: [
      { f: "problem", label: "The problem" },
      { f: "solution", label: "Our solution" },
    ],
  },
  {
    k: "market",
    label: "Market & model",
    fields: [
      { f: "market_size", label: "Market size" },
      { f: "business_model", label: "Business model" },
    ],
  },
  { k: "traction", label: "Traction", fields: [{ f: "traction", label: "What have you achieved so far?" }] },
  {
    k: "raise",
    label: "The raise",
    fields: [
      { f: "funding_ask", label: "Raising", short: true },
      { f: "incorporation_country", label: "Incorporated in", short: true },
    ],
  },
  { k: "funds", label: "Use of funds", fields: [{ f: "use_of_funds", label: "Where will the money go?" }] },
  { k: "team", label: "Team", team: true },
];

/* ---------------- helpers ---------------- */

const card = "rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] shadow-[var(--card-shadow)]";
const eyebrow = "font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]";
const btn =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-[10px] border border-[var(--overlay-12)] px-4 text-[13px] font-medium text-[var(--text)] transition-colors hover:bg-[var(--overlay-4)] disabled:opacity-50";
const btnPrimary =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-[10px] bg-metatron-accent px-4 text-[13px] font-semibold text-white transition-colors hover:bg-metatron-accent-hover disabled:opacity-50";
const input =
  "w-full min-h-11 rounded-[10px] border border-[var(--overlay-12)] bg-[var(--bg)] px-3.5 py-2.5 text-sm text-[var(--text)] outline-none focus:border-metatron-accent";

function initials(s: string): string {
  return (
    s
      .replace(/[^A-Za-z ]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "·"
  );
}

function host(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function membersFrom(raw: unknown): Member[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const o = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      return { name: String(o.name ?? ""), role: String(o.role ?? ""), linkedin: String(o.linkedin ?? "") };
    })
    .filter((m) => m.name.trim());
}

function deckExpiryLabel(iso: string): string {
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  if (days <= 0) return "Deck storage expired";
  return days === 1 ? "Deck expires in 1 day" : `Deck expires in ${days} days`;
}

const stageLabel = (v: string | null | undefined) => STAGES.find((s) => s.v === v)?.label ?? v ?? "";
const countryName = (c: string | null | undefined) => COUNTRIES.find((x) => x.code === c)?.name ?? c ?? "";

/* ---------------- page ---------------- */

export default function StartupProfilePage() {
  const { token, isPro, loading: authLoading } = useAuth();
  const [profile, setProfile] = useState<ApiProfile | null>(null);
  const [pitch, setPitch] = useState<Pitch | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [reading, setReading] = useState(false);
  const [manual, setManual] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [team, setTeam] = useState<Member[]>([]);
  const [company, setCompany] = useState({ company_name: "", one_liner: "", website: "", stage: "", country: "", sectors: "" });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoMsg, setLogoMsg] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const deckInput = useRef<HTMLInputElement | null>(null);
  const logoInput = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [pr, pi] = await Promise.all([
        fetch(`${API_BASE}/profile`, { headers: authJsonHeaders(token) }),
        fetch(`${API_BASE}/pitches`, { headers: authHeaders(token) }),
      ]);
      if (pr.ok) setProfile((await pr.json()) as ApiProfile);
      if (pi.ok) {
        const list = (await pi.json()) as Pitch[];
        setPitch(list[0] ?? null);
      }
    } catch {
      setNotice({ kind: "error", text: "Couldn't load your profile. Refresh to try again." });
    } finally {
      setLoaded(true);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (authLoading || !token) return null;
  if (!loaded) {
    return (
      <main className="p-6 md:p-10">
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      </main>
    );
  }

  const hasDeck = Boolean(profile?.pitch_deck_url?.trim());
  const deckCount = profile?.deck_upload_count ?? 0;
  const freeDeckUsed = !isPro && deckCount >= 1;
  const members = membersFrom(pitch?.team_members);
  const value = (f: PitchField) => String((pitch?.[f] as string | null | undefined) ?? "").trim();
  const complete = (s: Section) => (s.team ? members.length > 0 : (s.fields ?? []).every((x) => value(x.f)));
  const doneCount = SECTIONS.filter(complete).length;
  const name = profile?.company_name?.trim() || "Your startup";

  /* ---------- deck upload ---------- */
  async function uploadDeck(file: File) {
    if (!token) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      setNotice({ kind: "error", text: "Upload your deck as a PDF." });
      return;
    }
    setNotice(null);
    setEditing(null);
    setReading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${API_BASE}/uploads/pitch-deck`, { method: "POST", headers: authHeaders(token), body: fd });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setNotice({
          kind: "error",
          text: typeof data.error === "string" ? data.error : res.status === 403 ? "Free accounts include one deck upload." : "Deck upload failed. Try again.",
        });
        return;
      }
      await load();
      const err = data.extraction_error;
      setNotice(
        typeof err === "string" && err.trim()
          ? { kind: "error", text: "Your deck is uploaded, but Kevin couldn't read it. Fill in the sections below yourself." }
          : { kind: "ok", text: "Kevin read your deck and filled in your profile and pitch. Check them below." },
      );
      // Kevin looks for the logo on the company website in the background.
      window.setTimeout(() => void load(), 6000);
    } catch {
      setNotice({ kind: "error", text: "Deck upload failed. Try again." });
    } finally {
      setReading(false);
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void uploadDeck(f);
  }

  /* ---------- logo ---------- */
  async function uploadLogo(file: File) {
    if (!token) return;
    setLogoBusy(true);
    setLogoMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${API_BASE}/uploads/logo`, { method: "POST", headers: authHeaders(token), body: fd });
      if (!res.ok) {
        setLogoMsg((await res.text()) || "Logo upload failed.");
        return;
      }
      await load();
    } finally {
      setLogoBusy(false);
    }
  }

  async function logoFromWebsite() {
    if (!token) return;
    setLogoBusy(true);
    setLogoMsg(null);
    try {
      const res = await fetch(`${API_BASE}/uploads/logo/from-website`, { method: "POST", headers: authHeaders(token) });
      if (!res.ok) {
        setLogoMsg((await res.text()) || "We couldn't find a logo on your website.");
        return;
      }
      await load();
    } finally {
      setLogoBusy(false);
    }
  }

  /* ---------- company ---------- */
  function startCompanyEdit() {
    setCompany({
      company_name: profile?.company_name ?? "",
      one_liner: profile?.one_liner ?? "",
      website: profile?.website ?? "",
      stage: profile?.stage ?? "",
      country: profile?.country ?? "",
      sectors: profile?.sector ?? "",
    });
    setEditing("company");
  }

  async function saveCompany() {
    if (!token) return;
    setSaving(true);
    try {
      let website = company.website.trim();
      if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
      const sectors = company.sectors
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .join(", ");
      const res = await fetch(`${API_BASE}/profile`, {
        method: "PUT",
        headers: authJsonHeaders(token),
        body: JSON.stringify({
          company_name: company.company_name.trim() || null,
          one_liner: company.one_liner.trim() || null,
          stage: company.stage || null,
          sector: sectors || null,
          country: company.country || null,
          website: website || null,
          // PUT replaces the deck link too; keep the current one.
          pitch_deck_url: profile?.pitch_deck_url ?? null,
        }),
      });
      if (!res.ok) throw new Error();
      setProfile((await res.json()) as ApiProfile);
      setEditing(null);
      setNotice({ kind: "ok", text: "Company details saved." });
      if (website && !profile?.logo_url) window.setTimeout(() => void load(), 6000);
    } catch {
      setNotice({ kind: "error", text: "Couldn't save company details. Try again." });
    } finally {
      setSaving(false);
    }
  }

  /* ---------- pitch sections ---------- */
  function startEdit(s: Section) {
    if (s.team) {
      setTeam(members.length ? members : [{ name: "", role: "", linkedin: "" }]);
    } else {
      const d: Record<string, string> = {};
      for (const x of s.fields ?? []) d[x.f] = value(x.f);
      setDraft(d);
    }
    setEditing(s.k);
    window.setTimeout(() => document.getElementById(`sec-${s.k}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 50);
  }

  async function saveSection(s: Section) {
    if (!token) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      if (s.team) {
        body.team_members = team
          .map((m) => ({ name: m.name.trim(), role: m.role.trim(), linkedin: m.linkedin.trim() }))
          .filter((m) => m.name);
      } else {
        // Empty string (not null) so clearing a field sticks — the API keeps a field when it gets null.
        for (const x of s.fields ?? []) body[x.f] = (draft[x.f] ?? "").trim();
      }
      let res: Response;
      if (pitch) {
        res = await fetch(`${API_BASE}/pitches/${pitch.id}`, { method: "PUT", headers: authJsonHeaders(token), body: JSON.stringify(body) });
      } else {
        res = await fetch(`${API_BASE}/pitches`, {
          method: "POST",
          headers: authJsonHeaders(token),
          body: JSON.stringify({ title: profile?.company_name?.trim() || "My startup", ...body }),
        });
      }
      if (!res.ok) throw new Error();
      setPitch((await res.json()) as Pitch);
      setEditing(null);
      setNotice({ kind: "ok", text: `${s.label} saved.` });
    } catch {
      setNotice({ kind: "error", text: `Couldn't save ${s.label.toLowerCase()}. Try again.` });
    } finally {
      setSaving(false);
    }
  }

  /* ---------- render pieces ---------- */
  const deckInputEl = (
    <input
      ref={deckInput}
      type="file"
      accept="application/pdf,.pdf"
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f) void uploadDeck(f);
      }}
    />
  );

  const noticeEl = notice && (
    <p
      role="status"
      className={`rounded-[10px] px-4 py-3 text-sm ${
        notice.kind === "ok"
          ? "border border-metatron-accent/30 bg-metatron-accent/10 text-[var(--text)]"
          : "border border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-[var(--warn-bg)] text-[var(--text)]"
      }`}
    >
      {notice.text}
    </p>
  );

  if (reading) {
    return (
      <main className="min-w-0">
        <section className="mx-auto flex max-w-5xl flex-col gap-6 p-6 md:p-10">
          <header className="flex flex-col gap-1.5">
            <span className={eyebrow}>Startup Profile</span>
            <h1 className="text-[28px] font-semibold tracking-tight">{hasDeck ? "Reading your new deck" : "Let's build your profile"}</h1>
          </header>
          <div aria-live="polite" className="flex flex-col items-center gap-3.5 rounded-[var(--radius)] border-[1.5px] border-dashed border-metatron-accent/45 bg-metatron-accent/5 px-5 py-14 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-metatron-accent/15 text-metatron-accent">
              <IconSparkles size={28} stroke={1.75} />
            </span>
            <h2 className="text-lg font-semibold">Kevin is reading your deck…</h2>
            <p className="max-w-md text-sm text-[var(--text-muted)]">
              Pulling out your company details, problem, solution, market, traction, raise and team. This takes about a minute.
            </p>
            <div className="h-1.5 w-full max-w-xs overflow-hidden rounded bg-[var(--overlay-8)]">
              <div className="h-full w-2/5 animate-pulse rounded bg-metatron-accent" />
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (!hasDeck && !manual && !pitch) {
    return (
      <main className="min-w-0">
        <section className="mx-auto flex max-w-5xl flex-col gap-6 p-6 md:p-10">
          <header className="flex flex-col gap-1.5">
            <span className={eyebrow}>Startup Profile</span>
            <h1 className="text-[28px] font-semibold tracking-tight">Let&apos;s build your profile</h1>
          </header>
          {noticeEl}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`flex flex-col items-center gap-3.5 rounded-[var(--radius)] border-[1.5px] border-dashed px-5 py-14 text-center transition-colors ${
              dragging ? "border-metatron-accent bg-metatron-accent/10" : "border-metatron-accent/45 bg-metatron-accent/5"
            }`}
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-metatron-accent/15 text-metatron-accent">
              <IconUpload size={28} stroke={1.75} />
            </span>
            <h2 className="text-xl font-semibold">Drop your pitch deck here</h2>
            <p className="max-w-md text-[15px] text-[var(--text-muted)]">
              Kevin reads it and fills in your company profile and pitch for you. You can edit anything afterwards.
            </p>
            <button type="button" onClick={() => deckInput.current?.click()} className={`${btnPrimary} min-h-12 px-6 text-[15px]`}>
              Choose PDF
            </button>
            <span className="text-[13px] text-[var(--text-muted)]">PDF up to 50 MB</span>
            {deckInputEl}
          </div>
          <p className="text-center text-sm text-[var(--text-muted)]">
            No deck yet?{" "}
            <button type="button" onClick={() => setManual(true)} className="font-medium text-metatron-accent hover:underline">
              Fill in your profile manually
            </button>
          </p>
        </section>
      </main>
    );
  }

  const sectors = (profile?.sector ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <main className="min-w-0">
      <section className="mx-auto flex max-w-5xl flex-col gap-6 p-6 md:p-10">
        <header className="flex flex-col gap-1.5">
          <span className={eyebrow}>Startup Profile</span>
          <h1 className="text-[28px] font-semibold tracking-tight">{name}</h1>
          {profile?.one_liner && <p className="text-[15px] text-[var(--text-muted)]">{profile.one_liner}</p>}
        </header>

        {noticeEl}

        {/* 1. Deck — the one action. A new deck re-fills everything below. */}
        <section
          aria-label="Pitch deck"
          onDragOver={(e) => {
            if (freeDeckUsed) return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => (freeDeckUsed ? undefined : onDrop(e))}
          className={`flex flex-wrap items-center gap-4 rounded-[var(--radius)] border border-dashed p-5 ${
            dragging ? "border-metatron-accent bg-metatron-accent/10" : "border-metatron-accent/45 bg-[var(--bg-card)]"
          }`}
        >
          <span className="flex h-16 w-[52px] shrink-0 items-center justify-center rounded-lg border border-[var(--overlay-12)] bg-[var(--bg)] font-mono text-[10px] text-[var(--text-muted)]">
            PDF
          </span>
          <div className="flex min-w-0 flex-1 basis-72 flex-col gap-1">
            {hasDeck ? (
              <>
                <a href={profile!.pitch_deck_url!} target="_blank" rel="noreferrer" className="text-[15px] font-semibold text-[var(--text)] hover:underline">
                  Your pitch deck
                </a>
                <span className="inline-flex items-center gap-1.5 text-[13px] text-metatron-accent">
                  <IconSparkles size={14} stroke={1.75} /> Kevin read this deck and filled in your profile and pitch
                </span>
                <span className="truncate font-mono text-xs text-[var(--text-muted)]">
                  {host(profile!.pitch_deck_url)}
                  {new URL(profile!.pitch_deck_url!, "https://x").pathname}
                </span>
              </>
            ) : (
              <>
                <span className="text-[15px] font-semibold">No deck yet</span>
                <span className="text-[13px] text-[var(--text-muted)]">Upload a PDF and Kevin fills in everything below.</span>
              </>
            )}
            {!isPro && profile?.deck_expires_at && (
              <span className="mt-1 w-fit rounded-md bg-metatron-accent/10 px-2 py-0.5 text-[11px] text-[var(--text)]">
                {deckExpiryLabel(profile.deck_expires_at)}
              </span>
            )}
          </div>
          {freeDeckUsed ? (
            <Link href="/pricing" className={btn}>
              Upgrade to replace your deck
            </Link>
          ) : (
            <button type="button" onClick={() => deckInput.current?.click()} className={`${hasDeck ? btn : btnPrimary} min-h-11 px-5 text-sm`}>
              {hasDeck ? "Upload new deck" : "Upload deck"}
            </button>
          )}
          {deckInputEl}
        </section>

        {/* 2. Logo — from the company website, or uploaded */}
        <section className={`${card} flex flex-wrap items-center gap-4 p-5`} aria-label="Logo">
          {profile?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.logo_url} alt={`${name} logo`} className="h-14 w-14 shrink-0 rounded-[14px] border border-[var(--border)] bg-white object-contain p-1.5" />
          ) : (
            <span aria-hidden className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[14px] border-[1.5px] border-dashed border-[var(--overlay-12)] text-lg font-semibold text-[var(--text-muted)]">
              {initials(name)}
            </span>
          )}
          <div className="flex min-w-0 flex-1 basis-60 flex-col gap-0.5">
            <span className="text-sm font-semibold">Logo</span>
            <span className={`text-[13px] ${profile?.logo_url ? "text-[var(--text-muted)]" : "text-[var(--warn)]"}`}>
              {profile?.logo_url
                ? profile.logo_source === "upload"
                  ? "Uploaded by you"
                  : `Found on ${host(profile.website) || "your website"}`
                : profile?.website
                  ? `We couldn't find a logo on ${host(profile.website)}`
                  : "Add your website and we'll look for your logo there, or upload one"}
            </span>
            <span className="text-xs text-[var(--text-muted)]">Shown on your cards, matches and public profile. A square PNG works best.</span>
            {logoMsg && <span className="text-xs text-[var(--danger)]">{logoMsg}</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            {!profile?.logo_url && profile?.website && (
              <button type="button" disabled={logoBusy} onClick={() => void logoFromWebsite()} className={btn}>
                Look on my website
              </button>
            )}
            <button type="button" disabled={logoBusy} onClick={() => logoInput.current?.click()} className={profile?.logo_url ? btn : btnPrimary}>
              {logoBusy ? "Working…" : profile?.logo_url ? "Replace" : "Upload logo"}
            </button>
            <input
              ref={logoInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void uploadLogo(f);
              }}
            />
          </div>
        </section>

        {/* 3. Company — summary; Edit opens the fields */}
        {editing === "company" ? (
          <section className={`${card} flex flex-col gap-4 border-metatron-accent/60 p-5 ring-4 ring-metatron-accent/10`}>
            <span className={`${eyebrow} !text-metatron-accent`}>Company · editing</span>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
                Company name
                <input className={input} value={company.company_name} onChange={(e) => setCompany({ ...company, company_name: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
                Website
                <input className={input} placeholder="yourcompany.com" value={company.website} onChange={(e) => setCompany({ ...company, website: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
                Stage
                <select className={input} value={company.stage} onChange={(e) => setCompany({ ...company, stage: e.target.value })}>
                  <option value="">Select…</option>
                  {STAGES.map((s) => (
                    <option key={s.v} value={s.v}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
                Country
                <select className={input} value={company.country} onChange={(e) => setCompany({ ...company, country: e.target.value })}>
                  <option value="">Select country…</option>
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
              One-liner
              <input className={input} value={company.one_liner} onChange={(e) => setCompany({ ...company, one_liner: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
              Sectors <span className="font-normal text-[var(--text-muted)]">(comma separated)</span>
              <input className={input} placeholder="FinTech, Payments" value={company.sectors} onChange={(e) => setCompany({ ...company, sectors: e.target.value })} />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className={`${btn} min-h-11 px-5`}>
                Cancel
              </button>
              <button type="button" disabled={saving} onClick={() => void saveCompany()} className={`${btnPrimary} min-h-11 px-5`}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </section>
        ) : (
          <section className={`${card} flex flex-col gap-3.5 p-5`}>
            <div className="flex items-center justify-between">
              <span className={eyebrow}>Company</span>
              <button type="button" onClick={startCompanyEdit} className={`${btn} min-h-8 px-3`} aria-label="Edit company details">
                Edit
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {profile?.stage && <span className="rounded-full bg-metatron-accent/15 px-3 py-1 text-[13px] text-[var(--text)]">{stageLabel(profile.stage)}</span>}
              {sectors.map((s) => (
                <span key={s} className="rounded-full bg-[var(--overlay-6)] px-3 py-1 text-[13px] text-[var(--text-muted)]">
                  {s}
                </span>
              ))}
              {profile?.country && <span className="rounded-full bg-[var(--overlay-6)] px-3 py-1 text-[13px] text-[var(--text-muted)]">{countryName(profile.country)}</span>}
              {!profile?.stage && sectors.length === 0 && !profile?.country && (
                <span className="text-sm text-[var(--warn)]">Add your stage, sectors and country.</span>
              )}
            </div>
            {profile?.website ? (
              <a href={profile.website} target="_blank" rel="noreferrer" className="w-fit text-sm text-metatron-accent hover:underline">
                {host(profile.website)}
              </a>
            ) : (
              <button type="button" onClick={startCompanyEdit} className="w-fit text-sm text-[var(--warn)] hover:underline">
                Add your website
              </button>
            )}
          </section>
        )}

        {/* 4. Your pitch — strength, then the document */}
        <section className={`${card} flex flex-col gap-4 p-5`}>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="flex items-baseline gap-3">
              <h2 className="text-lg font-semibold">Your pitch</h2>
              <span className="text-sm text-[var(--text-muted)]">
                {doneCount} of {SECTIONS.length} sections ready
              </span>
            </div>
            <span className="text-[13px] text-[var(--text-muted)]">This is what investors see when Kevin matches you</span>
          </div>
          <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${SECTIONS.length}, minmax(0, 1fr))` }} role="img" aria-label={`${doneCount} of ${SECTIONS.length} sections complete`}>
            {SECTIONS.map((s) => (
              <span key={s.k} className={`h-1.5 rounded ${complete(s) ? "bg-metatron-accent" : "bg-[var(--overlay-12)]"}`} />
            ))}
          </div>
        </section>

        <div className="flex flex-wrap items-start gap-7">
          <nav aria-label="Pitch sections" className="sticky top-24 flex max-w-[230px] flex-1 basis-48 flex-col gap-0.5">
            {SECTIONS.map((s) => {
              const ok = complete(s);
              return (
                <a
                  key={s.k}
                  href={`#sec-${s.k}`}
                  className={`flex min-h-9 items-center gap-2.5 rounded-[10px] px-3 text-sm hover:bg-[var(--overlay-4)] ${ok ? "text-[var(--text)]" : "text-[var(--warn)]"}`}
                >
                  {ok ? <IconCheck size={16} stroke={2} className="text-metatron-accent" /> : <IconCircle size={16} stroke={1.75} />}
                  {s.label}
                </a>
              );
            })}
          </nav>

          <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-3.5">
            {SECTIONS.map((s) => {
              const id = `sec-${s.k}`;
              const ok = complete(s);

              if (editing === s.k) {
                return (
                  <article key={s.k} id={id} className={`${card} flex scroll-mt-24 flex-col gap-4 border-metatron-accent/60 p-5 ring-4 ring-metatron-accent/10`}>
                    <div className="flex items-center justify-between">
                      <span className={`${eyebrow} !text-metatron-accent`}>{s.label} · editing</span>
                      <span className="text-xs text-[var(--text-muted)]">Changes save when you click Save</span>
                    </div>
                    {s.team ? (
                      <div className="flex flex-col gap-2.5">
                        {team.map((m, i) => (
                          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                            <input className={input} placeholder="Name" aria-label={`Member ${i + 1} name`} value={m.name} onChange={(e) => setTeam(team.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                            <input className={input} placeholder="Role" aria-label={`Member ${i + 1} role`} value={m.role} onChange={(e) => setTeam(team.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))} />
                            <input className={input} placeholder="LinkedIn URL" aria-label={`Member ${i + 1} LinkedIn`} value={m.linkedin} onChange={(e) => setTeam(team.map((x, j) => (j === i ? { ...x, linkedin: e.target.value } : x)))} />
                            <button type="button" aria-label={`Remove member ${i + 1}`} onClick={() => setTeam(team.filter((_, j) => j !== i))} className={`${btn} min-h-11`}>
                              Remove
                            </button>
                          </div>
                        ))}
                        <button type="button" onClick={() => setTeam([...team, { name: "", role: "", linkedin: "" }])} className={`${btn} w-fit`}>
                          + Add member
                        </button>
                      </div>
                    ) : (
                      (s.fields ?? []).map((x) => (
                        <label key={x.f} className="flex flex-col gap-1.5 text-[13px] font-semibold">
                          {x.label}
                          {x.short ? (
                            <input className={input} value={draft[x.f] ?? ""} onChange={(e) => setDraft({ ...draft, [x.f]: e.target.value })} />
                          ) : (
                            <textarea rows={4} className={`${input} resize-y leading-relaxed`} value={draft[x.f] ?? ""} onChange={(e) => setDraft({ ...draft, [x.f]: e.target.value })} />
                          )}
                        </label>
                      ))
                    )}
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => setEditing(null)} className={`${btn} min-h-11 px-5`}>
                        Cancel
                      </button>
                      <button type="button" disabled={saving} onClick={() => void saveSection(s)} className={`${btnPrimary} min-h-11 px-5`}>
                        {saving ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </article>
                );
              }

              if (!ok) {
                return (
                  <article
                    key={s.k}
                    id={id}
                    className="flex scroll-mt-24 flex-wrap items-center justify-between gap-3.5 rounded-[var(--radius)] border border-dashed border-[color-mix(in_srgb,var(--warn)_45%,transparent)] bg-[var(--warn-bg)] p-5"
                  >
                    <div className="flex min-w-0 flex-1 basis-72 flex-col gap-1.5">
                      <span className={`${eyebrow} !text-[var(--warn)]`}>{s.label}</span>
                      <p className="text-sm text-[var(--text)]">
                        {hasDeck ? "Kevin couldn't find this in your deck. " : ""}
                        {s.k === "funds" ? "Investors ask about it in almost every first call." : "Add it so investors get the full picture."}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => startEdit(s)}
                      className="inline-flex min-h-11 items-center rounded-xl border border-[color-mix(in_srgb,var(--warn)_50%,transparent)] px-5 text-sm font-semibold text-[var(--warn)] hover:bg-[var(--warn-bg)]"
                    >
                      Add {s.label.toLowerCase()}
                    </button>
                  </article>
                );
              }

              return (
                <article key={s.k} id={id} className={`${card} flex scroll-mt-24 flex-col gap-3 p-5`}>
                  <div className="flex items-center justify-between">
                    <span className={eyebrow}>
                      {s.label}
                      {s.team ? ` · ${members.length}` : ""}
                    </span>
                    <button type="button" onClick={() => startEdit(s)} className={`${btn} min-h-8 px-3`} aria-label={`Edit ${s.label}`}>
                      Edit
                    </button>
                  </div>
                  {s.team ? (
                    <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,220px),1fr))]">
                      {members.map((m, i) => (
                        <div key={i} className="flex items-center gap-3 rounded-[10px] bg-[var(--overlay-3)] p-3">
                          <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-metatron-accent/20 text-sm font-semibold text-metatron-accent">
                            {initials(m.name)}
                          </span>
                          <div className="flex min-w-0 flex-col">
                            <span className="truncate text-sm font-semibold">{m.name}</span>
                            <span className="truncate text-[13px] text-[var(--text-muted)]">{m.role || "—"}</span>
                          </div>
                          {m.linkedin && (
                            <a href={m.linkedin.startsWith("http") ? m.linkedin : `https://${m.linkedin}`} target="_blank" rel="noreferrer" className="ml-auto text-xs text-metatron-accent hover:underline">
                              LinkedIn
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : s.k === "raise" ? (
                    <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr))]">
                      {(s.fields ?? []).map((x) => (
                        <div key={x.f} className="flex flex-col gap-1 rounded-[10px] bg-[var(--overlay-3)] px-4 py-3">
                          <span className="text-xs text-[var(--text-muted)]">{x.label}</span>
                          <span className="text-lg font-semibold">{value(x.f)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (s.fields ?? []).length > 1 ? (
                    <div className="grid gap-5 sm:grid-cols-2">
                      {(s.fields ?? []).map((x) => (
                        <div key={x.f} className="flex flex-col gap-1.5">
                          <span className="text-[13px] font-semibold">{x.label}</span>
                          <p className="whitespace-pre-line text-[15px] leading-relaxed text-[var(--text-muted)]">{value(x.f)}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="whitespace-pre-line text-[15px] leading-relaxed text-[var(--text-muted)]">{value(s.fields![0]!.f)}</p>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
}
