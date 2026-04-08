"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { API_BASE, authHeaders, authJsonHeaders } from "@/lib/api";
import { uploadPitchDeckViaPinata } from "@/lib/pinata-deck-upload";
import { useAuth } from "@/lib/auth";

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
  stage?: string | null;
};

type FounderProfile = {
  pitch_deck_url?: string | null;
  deck_expires_at?: string | null;
  deck_upload_count?: number;
};

type FormTab = "overview" | "problem" | "market" | "traction" | "team";

type TeamMemberRow = {
  name: string;
  role: string;
  linkedin: string;
};

const TABS: { id: FormTab; label: string }[] = [
  { id: "overview", label: "Basics" },
  { id: "problem", label: "Problem & solution" },
  { id: "market", label: "Market & model" },
  { id: "traction", label: "Traction & raise" },
  { id: "team", label: "Team" },
];

function tractionHeadline(traction: string | null | undefined): string | null {
  if (!traction?.trim()) return null;
  const line = traction.trim().split(/\n/)[0]?.trim();
  if (!line) return null;
  return line.length > 100 ? `${line.slice(0, 97)}…` : line;
}

function optionalBody(
  fields: Record<string, string>
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(fields)) {
    const t = v.trim();
    out[k] = t.length ? t : null;
  }
  return out;
}

function deckExpiryLabel(iso: string): string {
  const end = new Date(iso).getTime();
  const now = Date.now();
  const ms = end - now;
  if (ms <= 0) return "Deck storage expired";
  const days = Math.ceil(ms / 86400000);
  if (days <= 0) return "Deck expires today";
  if (days === 1) return "Deck expires in 1 day";
  return `Deck expires in ${days} days`;
}

function teamRowsFromPitch(raw: unknown): TeamMemberRow[] {
  if (!Array.isArray(raw)) return [{ name: "", role: "", linkedin: "" }];
  const rows = raw
    .map((item) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const o = item as Record<string, unknown>;
        return {
          name: String(o.name ?? ""),
          role: String(o.role ?? ""),
          linkedin: String(o.linkedin ?? ""),
        };
      }
      return { name: "", role: "", linkedin: "" };
    })
    .filter((m) => m.name || m.role || m.linkedin);
  return rows.length ? rows : [{ name: "", role: "", linkedin: "" }];
}

export default function StartupPitchesPage() {
  const { token, loading, isPro } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);

  const [pitches, setPitches] = useState<Pitch[]>([]);
  const [profile, setProfile] = useState<FounderProfile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [tab, setTab] = useState<FormTab>("overview");
  const [msg, setMsg] = useState<string | null>(null);

  const [uploadBusy, setUploadBusy] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);
  const [reviewPitchId, setReviewPitchId] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [problem, setProblem] = useState("");
  const [solution, setSolution] = useState("");
  const [marketSize, setMarketSize] = useState("");
  const [businessModel, setBusinessModel] = useState("");
  const [traction, setTraction] = useState("");
  const [fundingAsk, setFundingAsk] = useState("");
  const [useOfFunds, setUseOfFunds] = useState("");
  const [teamSize, setTeamSize] = useState("");
  const [incorporationCountry, setIncorporationCountry] = useState("");
  const [teamMembers, setTeamMembers] = useState<TeamMemberRow[]>([
    { name: "", role: "", linkedin: "" },
  ]);

  const loadPitches = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/pitches`, {
        headers: authHeaders(token),
      });
      if (res.ok) setPitches(await res.json());
      else setMsg("Failed to load pitches.");
    } catch {
      setMsg("Failed to load pitches.");
    }
  }, [token]);

  const loadProfile = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/profile`, {
        headers: authHeaders(token),
      });
      if (res.ok) setProfile(await res.json());
      else setProfile(null);
    } catch {
      setProfile(null);
    } finally {
      setProfileLoaded(true);
    }
  }, [token]);

  useEffect(() => {
    if (!loading && token) {
      loadPitches();
      loadProfile();
    }
  }, [loading, token, loadPitches, loadProfile]);

  if (loading) return null;
  if (!token) return null;

  const deckCount = profile?.deck_upload_count ?? 0;
  const freeDeckUsed =
    profileLoaded && !isPro && deckCount >= 1;
  const showForm = showManualForm || reviewPitchId !== null;

  function resetForm() {
    setTitle("");
    setDescription("");
    setProblem("");
    setSolution("");
    setMarketSize("");
    setBusinessModel("");
    setTraction("");
    setFundingAsk("");
    setUseOfFunds("");
    setTeamSize("");
    setIncorporationCountry("");
    setTeamMembers([{ name: "", role: "", linkedin: "" }]);
    setTab("overview");
    setReviewPitchId(null);
  }

  function prefillFromPitch(p: Pitch) {
    setTitle(p.title ?? "");
    setDescription(p.description ?? "");
    setProblem(p.problem ?? "");
    setSolution(p.solution ?? "");
    setMarketSize(p.market_size ?? "");
    setBusinessModel(p.business_model ?? "");
    setTraction(p.traction ?? "");
    setFundingAsk(p.funding_ask ?? "");
    setUseOfFunds(p.use_of_funds ?? "");
    setTeamSize(
      p.team_size != null && Number.isFinite(p.team_size)
        ? String(p.team_size)
        : "",
    );
    setIncorporationCountry(p.incorporation_country ?? "");
    setTeamMembers(teamRowsFromPitch(p.team_members));
    setTab("overview");
  }

  async function onDeckSelected(files: FileList | null) {
    const file = files?.[0];
    if (!file || !token) return;
    setMsg(null);
    setUploadBusy(true);
    try {
      const result = await uploadPitchDeckViaPinata(token, file);
      if (!result.ok) {
        if (result.status === 403) {
          setMsg(
            result.error ||
              "You cannot upload another deck on the free plan.",
          );
        } else {
          setMsg(result.error || "Deck upload failed.");
        }
        return;
      }

      const data = result.data as Record<string, unknown>;
      await loadProfile();

      const extractionErr = data.extraction_error;
      if (typeof extractionErr === "string" && extractionErr.trim()) {
        setMsg(
          `Deck uploaded. Kevin could not auto-fill all fields (${extractionErr}). You can edit below or fill in manually.`,
        );
      } else {
        setMsg("Deck uploaded. Review the fields below, then save to confirm.");
      }

      const pitchRaw = data.pitch;
      if (pitchRaw && typeof pitchRaw === "object" && "id" in pitchRaw) {
        prefillFromPitch(pitchRaw as Pitch);
        setReviewPitchId(String((pitchRaw as Pitch).id));
      }
      setShowManualForm(true);
      loadPitches();
    } catch {
      setMsg("Deck upload failed.");
    } finally {
      setUploadBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onSavePitch(e: FormEvent) {
    e.preventDefault();
    if (!token) {
      setMsg("No token — sign up as founder first.");
      return;
    }
    setMsg(null);
    const opt = optionalBody({
      description,
      problem,
      solution,
      market_size: marketSize,
      business_model: businessModel,
      traction,
      funding_ask: fundingAsk,
      use_of_funds: useOfFunds,
    });

    const membersPayload = teamMembers
      .map((m) => ({
        name: m.name.trim(),
        role: m.role.trim(),
        linkedin: m.linkedin.trim(),
      }))
      .filter((m) => m.name || m.role || m.linkedin);

    const teamSizeParsed = teamSize.trim()
      ? parseInt(teamSize.trim(), 10)
      : NaN;

    const basePayload: Record<string, unknown> = {
      title: title.trim(),
      ...opt,
    };
    if (Number.isFinite(teamSizeParsed) && teamSizeParsed >= 0) {
      basePayload.team_size = teamSizeParsed;
    }
    if (incorporationCountry.trim()) {
      basePayload.incorporation_country = incorporationCountry.trim();
    }
    if (membersPayload.length > 0) {
      basePayload.team_members = membersPayload;
    }

    try {
      if (reviewPitchId) {
        const res = await fetch(`${API_BASE}/pitches/${reviewPitchId}`, {
          method: "PUT",
          headers: authJsonHeaders(token),
          body: JSON.stringify(basePayload),
        });
        if (!res.ok) throw new Error("failed");
        setMsg("Pitch saved.");
        resetForm();
        setShowManualForm(false);
      } else {
        const res = await fetch(`${API_BASE}/pitches`, {
          method: "POST",
          headers: authJsonHeaders(token),
          body: JSON.stringify(basePayload),
        });
        if (!res.ok) throw new Error("failed");
        resetForm();
        setShowManualForm(false);
        setMsg("Pitch saved.");
      }
      loadPitches();
    } catch {
      setMsg("Failed to save pitch.");
    }
  }

  return (
    <main className="flex-1">
      <header className="border-b border-[var(--border)] px-6 py-4 md:px-10">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[2px] text-[var(--text-muted)] mb-1">
          Pitches
        </p>
        <h1 className="text-lg font-semibold">Your pitches</h1>
      </header>
      <section className="p-6 md:p-10 max-w-3xl space-y-6">
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Create a pitch</h2>
              <p className="text-xs text-[var(--text-muted)] leading-relaxed mt-1 max-w-xl">
                Upload a PDF deck and Kevin will extract key fields. You can
                edit everything before saving. PDF only for auto-fill; other
                formats are stored but not parsed.
              </p>
            </div>
            {profile?.deck_expires_at ? (
              <span className="shrink-0 rounded-lg border border-[var(--border)] bg-[rgba(108,92,231,0.12)] px-2.5 py-1 font-mono text-[10px] text-[var(--text)]">
                {deckExpiryLabel(profile.deck_expires_at)}
              </span>
            ) : null}
          </div>

          {!profileLoaded ? (
            <p className="text-xs text-[var(--text-muted)]">Loading profile…</p>
          ) : freeDeckUsed ? (
            <div className="rounded-lg border border-[var(--border)] bg-[rgba(255,255,255,0.02)] px-4 py-3 text-sm text-[var(--text-muted)]">
              <p>
                Free accounts include one deck upload. To replace your deck,
                upgrade to Pro.
              </p>
              <Link
                href="/pricing"
                className="mt-2 inline-block text-xs font-semibold text-metatron-accent hover:underline"
              >
                View plans — upgrade to re-upload
              </Link>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={(e) => onDeckSelected(e.target.files)}
              />
              <button
                type="button"
                disabled={uploadBusy}
                onClick={() => fileRef.current?.click()}
                className="rounded-lg bg-metatron-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-50"
              >
                {uploadBusy ? "Uploading…" : "Upload your deck to create a pitch"}
              </button>
              <p className="text-[11px] text-[var(--text-muted)]">
                PDF · max ~52MB
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              resetForm();
              setShowManualForm(true);
            }}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] underline-offset-2 hover:underline"
          >
            Fill in manually instead
          </button>
        </div>

        {showForm ? (
          <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5 space-y-4">
            <h2 className="text-sm font-semibold">
              {reviewPitchId
                ? "Review and confirm"
                : "Create a pitch (manual)"}
            </h2>
            <p className="text-xs text-[var(--text-muted)] leading-relaxed">
              {reviewPitchId
                ? "We pre-filled this from your deck. Edit anything that looks off, then save."
                : "Work through each section. Only the title is required."}
            </p>

            <div
              className="flex flex-wrap gap-1.5 border-b border-[var(--border)] pb-3"
              role="tablist"
              aria-label="Pitch sections"
            >
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    tab === t.id
                      ? "bg-metatron-accent text-white"
                      : "bg-[rgba(255,255,255,0.04)] text-[var(--text-muted)] hover:text-[var(--text)]"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <form onSubmit={onSavePitch} className="space-y-4 text-sm">
              {tab === "overview" && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-[var(--text)]">
                      Title
                    </label>
                    <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                      Company or product name for this pitch.
                    </p>
                    <input
                      className="input-metatron"
                      placeholder="e.g. Acme — B2B payments for Africa"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-[var(--text)]">
                      Short description
                    </label>
                    <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                      One-liner: what you do and who it is for.
                    </p>
                    <textarea
                      className="input-metatron min-h-[96px] resize-y"
                      placeholder="What is this pitch about?"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {tab === "problem" && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-[var(--text)]">
                      Problem
                    </label>
                    <textarea
                      className="input-metatron min-h-[120px] resize-y"
                      placeholder="What problem are you solving?"
                      value={problem}
                      onChange={(e) => setProblem(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-[var(--text)]">
                      Solution
                    </label>
                    <textarea
                      className="input-metatron min-h-[120px] resize-y"
                      placeholder="How do you solve it?"
                      value={solution}
                      onChange={(e) => setSolution(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {tab === "market" && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-[var(--text)]">
                      Market size
                    </label>
                    <textarea
                      className="input-metatron min-h-[120px] resize-y"
                      placeholder="How big is the opportunity?"
                      value={marketSize}
                      onChange={(e) => setMarketSize(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-[var(--text)]">
                      Business model
                    </label>
                    <textarea
                      className="input-metatron min-h-[120px] resize-y"
                      placeholder="How will you monetize?"
                      value={businessModel}
                      onChange={(e) => setBusinessModel(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {tab === "traction" && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-[var(--text)]">
                      Traction
                    </label>
                    <textarea
                      className="input-metatron min-h-[120px] resize-y"
                      placeholder="What have you achieved so far?"
                      value={traction}
                      onChange={(e) => setTraction(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-[var(--text)]">
                      Funding ask
                    </label>
                    <textarea
                      className="input-metatron min-h-[88px] resize-y"
                      placeholder="e.g. $500k seed on a $4M cap SAFE"
                      value={fundingAsk}
                      onChange={(e) => setFundingAsk(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-[var(--text)]">
                      Use of funds
                    </label>
                    <textarea
                      className="input-metatron min-h-[120px] resize-y"
                      placeholder="Where will the money go?"
                      value={useOfFunds}
                      onChange={(e) => setUseOfFunds(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {tab === "team" && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-[var(--text)]">
                      Number of full-time employees
                    </label>
                    <input
                      className="input-metatron"
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      placeholder="e.g. 5"
                      value={teamSize}
                      onChange={(e) => setTeamSize(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-[var(--text)]">
                      Incorporation country
                    </label>
                    <input
                      className="input-metatron"
                      type="text"
                      placeholder="e.g. United Kingdom"
                      value={incorporationCountry}
                      onChange={(e) => setIncorporationCountry(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="block text-xs font-medium text-[var(--text)]">
                        Team members
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          setTeamMembers((rows) => [
                            ...rows,
                            { name: "", role: "", linkedin: "" },
                          ])
                        }
                        className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text)]"
                      >
                        Add team member
                      </button>
                    </div>
                    <div className="space-y-3">
                      {teamMembers.map((row, i) => (
                        <div
                          key={i}
                          className="rounded-lg border border-[var(--border)] bg-[rgba(255,255,255,0.02)] p-3 space-y-2"
                        >
                          <div className="flex justify-end">
                            <button
                              type="button"
                              disabled={teamMembers.length <= 1}
                              onClick={() =>
                                setTeamMembers((rows) =>
                                  rows.length <= 1
                                    ? rows
                                    : rows.filter((_, j) => j !== i)
                                )
                              }
                              className="text-[11px] text-[var(--text-muted)] hover:text-[rgb(254,202,202)] disabled:opacity-40"
                            >
                              Remove
                            </button>
                          </div>
                          <input
                            className="input-metatron"
                            placeholder="Name"
                            value={row.name}
                            onChange={(e) =>
                              setTeamMembers((rows) =>
                                rows.map((r, j) =>
                                  j === i ? { ...r, name: e.target.value } : r
                                )
                              )
                            }
                          />
                          <input
                            className="input-metatron"
                            placeholder="Role"
                            value={row.role}
                            onChange={(e) =>
                              setTeamMembers((rows) =>
                                rows.map((r, j) =>
                                  j === i ? { ...r, role: e.target.value } : r
                                )
                              )
                            }
                          />
                          <input
                            className="input-metatron"
                            type="url"
                            placeholder="LinkedIn URL"
                            value={row.linkedin}
                            onChange={(e) =>
                              setTeamMembers((rows) =>
                                rows.map((r, j) =>
                                  j === i
                                    ? { ...r, linkedin: e.target.value }
                                    : r
                                )
                              )
                            }
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <button
                type="submit"
                className="rounded-lg bg-metatron-accent px-4 py-2 text-xs font-semibold text-white hover:bg-metatron-accent-hover"
              >
                Save pitch
              </button>
            </form>
          </div>
        ) : null}

        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5">
          <h2 className="text-sm font-semibold mb-3">All pitches</h2>
          <ul className="space-y-3 text-sm">
            {pitches.map((p) => {
              const th = tractionHeadline(p.traction);
              return (
                <li
                  key={p.id}
                  className="rounded-lg border border-[var(--border)] bg-[rgba(255,255,255,0.02)] px-4 py-3 space-y-2"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="font-medium text-[var(--text)] min-w-0">
                      {p.title}
                    </div>
                    {p.stage ? (
                      <span className="shrink-0 rounded-md border border-[var(--border)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                        {p.stage}
                      </span>
                    ) : null}
                  </div>
                  {p.funding_ask?.trim() ? (
                    <p className="text-xs text-[var(--text)]">
                      <span className="text-[var(--text-muted)]">Funding · </span>
                      {p.funding_ask.trim()}
                    </p>
                  ) : null}
                  {th ? (
                    <p className="text-xs text-[var(--text-muted)] line-clamp-2">
                      <span className="text-[var(--text-muted)]">Traction · </span>
                      {th}
                    </p>
                  ) : null}
                  {!p.funding_ask?.trim() && !th && p.description?.trim() ? (
                    <p className="text-xs text-[var(--text-muted)] line-clamp-2">
                      {p.description.trim()}
                    </p>
                  ) : null}
                </li>
              );
            })}
            {pitches.length === 0 && (
              <li className="text-xs text-[var(--text-muted)]">
                No pitches yet.
              </li>
            )}
          </ul>
        </div>
        {msg && (
          <p className="text-xs text-[var(--text-muted)]">{msg}</p>
        )}
      </section>
    </main>
  );
}
