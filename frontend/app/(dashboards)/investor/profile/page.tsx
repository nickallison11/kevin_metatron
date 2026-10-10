"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState, type ReactNode } from "react";
import { API_BASE, authHeaders, authJsonHeaders } from "@/lib/api";
import type { MeResponse } from "@/lib/me";
import { COUNTRIES } from "@/lib/countries";
import { STAGES } from "@/lib/stages";
import { SECTOR_OPTIONS } from "@/lib/sectorOptions";
import { useAuth } from "@/lib/auth";
import InvestorReviewsCard from "@/components/investor/InvestorReviewsCard";
import { LogoCard } from "@/components/profile/LogoCard";

type InvestorProfile = {
  firm_name?: string | null;
  bio?: string | null;
  investment_thesis?: string | null;
  sectors?: string[];
  stages?: string[];
  ticket_size_min?: number | null;
  ticket_size_max?: number | null;
  country?: string | null;
  is_accredited?: boolean;
  pass_message_template?: string | null;
  website?: string | null;
};

const card = "flex flex-col gap-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-[var(--card-shadow)]";
const eyebrow = "font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]";
const input =
  "w-full min-h-11 rounded-[10px] border border-[var(--overlay-12)] bg-[var(--bg)] px-3.5 py-2.5 text-sm text-[var(--text)] outline-none focus:border-metatron-accent disabled:opacity-50";
const btnPrimary =
  "inline-flex min-h-11 items-center justify-center rounded-xl bg-metatron-accent px-5 text-sm font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-50";

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
      <span>{label}</span>
      {children}
      {hint && <span className="text-xs font-normal text-[var(--text-muted)]">{hint}</span>}
    </label>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`min-h-8 rounded-full px-3 text-[13px] ${on ? "bg-metatron-accent/15 font-medium text-[var(--accent-fg)]" : "bg-[var(--overlay-6)] text-[var(--text-muted)] hover:text-[var(--text)]"}`}
    >
      {children}
    </button>
  );
}

export default function InvestorProfilePage() {
  const { token, loading: authLoading } = useAuth("INVESTOR");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [p, setP] = useState<InvestorProfile>({ sectors: [], stages: [], is_accredited: false });
  const [saved, setSaved] = useState<InvestorProfile>({});
  const [logo, setLogo] = useState<{ url: string | null; source: string | null }>({ url: null, source: null });
  const [me, setMe] = useState<MeResponse | null>(null);
  const [canEditTemplate, setCanEditTemplate] = useState(false);

  const loadLogo = useCallback(async () => {
    if (!token) return;
    const res = await fetch(`${API_BASE}/profile`, { headers: authHeaders(token) }).catch(() => null);
    if (res?.ok) {
      const d = (await res.json()) as { logo_url?: string | null; logo_source?: string | null };
      setLogo({ url: d.logo_url ?? null, source: d.logo_source ?? null });
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const [res, meRes, sub] = await Promise.all([
          fetch(`${API_BASE}/investor-profile`, { headers: authJsonHeaders(token) }),
          fetch(`${API_BASE}/auth/me`, { headers: authHeaders(token) }),
          fetch(`${API_BASE}/subscriptions/status`, { headers: authJsonHeaders(token) }),
        ]);
        if (res.ok) {
          const data = (await res.json()) as InvestorProfile;
          const next = { ...data, sectors: data.sectors ?? [], stages: data.stages ?? [], is_accredited: Boolean(data.is_accredited) };
          setP(next);
          setSaved(next);
        }
        if (meRes.ok) setMe((await meRes.json()) as MeResponse);
        if (sub.ok) {
          const d = (await sub.json()) as { subscription_tier?: string };
          setCanEditTemplate(d.subscription_tier === "basic" || d.subscription_tier === "pro");
        }
      } catch {
        setMsg({ ok: false, text: "Could not load your profile." });
      } finally {
        setLoading(false);
      }
    })();
    void loadLogo();
  }, [token, loadLogo]);

  function toggle(key: "sectors" | "stages", v: string) {
    setP((prev) => {
      const cur = prev[key] ?? [];
      return { ...prev, [key]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] };
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`${API_BASE}/investor-profile`, {
        method: "PUT",
        headers: authJsonHeaders(token),
        body: JSON.stringify({
          firm_name: p.firm_name ?? null,
          bio: p.bio ?? null,
          investment_thesis: p.investment_thesis ?? null,
          sectors: (p.sectors?.length ?? 0) > 0 ? p.sectors : null,
          stages: (p.stages?.length ?? 0) > 0 ? p.stages : null,
          ticket_size_min: p.ticket_size_min ?? null,
          ticket_size_max: p.ticket_size_max ?? null,
          country: p.country ?? null,
          is_accredited: p.is_accredited ?? false,
          pass_message_template: p.pass_message_template ?? null,
          website: p.website?.trim() || null,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as InvestorProfile;
      const next = { ...data, sectors: data.sectors ?? [], stages: data.stages ?? [], is_accredited: Boolean(data.is_accredited) };
      setP(next);
      setSaved(next);
      setMsg({ ok: true, text: "Saved." });
      // Kevin looks for the firm's logo on the website in the background.
      if (next.website && !logo.url) window.setTimeout(() => void loadLogo(), 6000);
    } catch {
      setMsg({ ok: false, text: "Could not save your profile. Try again." });
    } finally {
      setSaving(false);
    }
  }

  if (authLoading || !token) return null;
  if (loading) {
    return (
      <main className="min-w-0 flex-1 p-6 md:p-10">
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      </main>
    );
  }

  const name = saved.firm_name?.trim() || "Your firm";
  const items: [string, boolean][] = [
    ["Logo", Boolean(logo.url)],
    ["Firm and website", Boolean(saved.firm_name?.trim() && saved.website?.trim())],
    ["Thesis", Boolean((saved.investment_thesis || saved.bio)?.trim())],
    ["Stages and sectors", Boolean(saved.stages?.length && saved.sectors?.length)],
    ["Cheque size", saved.ticket_size_min != null || saved.ticket_size_max != null],
    ["Country", Boolean(saved.country)],
  ];
  const done = items.filter((i) => i[1]).length;

  return (
    <main className="min-w-0 flex-1">
      <section className="mx-auto flex max-w-5xl flex-col gap-5 p-6 md:p-10">
        <header className="flex flex-col gap-1.5">
          <span className={eyebrow}>Investor Profile</span>
          <h1 className="text-[28px] font-semibold tracking-tight">{name}</h1>
          <p className="text-sm text-[var(--text-muted)]">This is what founders see on Browse Investors and in their matches.</p>
        </header>

        <section className={card}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-3">
              <h2 className="text-lg font-semibold">Your profile</h2>
              <span className="text-sm text-[var(--text-muted)]">
                {done} of {items.length} complete
              </span>
            </div>
            <span className="text-[13px] text-[var(--text-muted)]">Complete profiles get better matches</span>
          </div>
          <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }} role="img" aria-label={`${done} of ${items.length} complete`}>
            {items.map(([label, ok]) => (
              <i key={label} className={`h-1.5 rounded ${ok ? "bg-metatron-accent" : "bg-[var(--overlay-8)]"}`} />
            ))}
          </div>
          {done < items.length ? (
            <span className="text-sm text-[var(--text-muted)]">
              Missing:{" "}
              <strong className="text-[var(--warn)]">
                {items
                  .filter((i) => !i[1])
                  .map((i) => i[0])
                  .join(", ")}
              </strong>
            </span>
          ) : (
            <span className="text-sm text-[var(--text-muted)]">Your profile is complete.</span>
          )}
        </section>

        <LogoCard token={token} name={name} logoUrl={logo.url} logoSource={logo.source} website={saved.website} onChanged={() => void loadLogo()} />

        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <section className={card}>
            <span className={eyebrow}>Firm</span>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Firm name">
                <input className={input} value={p.firm_name ?? ""} onChange={(e) => setP((x) => ({ ...x, firm_name: e.target.value }))} autoComplete="organization" />
              </Field>
              <Field label="Website" hint="We look for your logo here.">
                <input className={input} type="url" inputMode="url" placeholder="https://yourfirm.com" value={p.website ?? ""} onChange={(e) => setP((x) => ({ ...x, website: e.target.value }))} />
              </Field>
              <Field label="Country">
                <select className={input} value={p.country ?? ""} onChange={(e) => setP((x) => ({ ...x, country: e.target.value || null }))}>
                  <option value="">Select…</option>
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </section>

          <section className={card}>
            <span className={eyebrow}>Thesis</span>
            <Field label="Investment thesis" hint="Founders see this first. What do you back, and why?">
              <textarea className={`${input} min-h-[110px] resize-y`} value={p.investment_thesis ?? ""} onChange={(e) => setP((x) => ({ ...x, investment_thesis: e.target.value }))} />
            </Field>
            <Field label="About you">
              <textarea className={`${input} min-h-[90px] resize-y`} value={p.bio ?? ""} onChange={(e) => setP((x) => ({ ...x, bio: e.target.value }))} />
            </Field>
          </section>

          <section className={card}>
            <span className={eyebrow}>Focus</span>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-[13px] font-semibold">Stages</legend>
              <div className="flex flex-wrap gap-2">
                {STAGES.map((s) => (
                  <Chip key={s.v} on={(p.stages ?? []).includes(s.v)} onClick={() => toggle("stages", s.v)}>
                    {s.label}
                  </Chip>
                ))}
              </div>
            </fieldset>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-[13px] font-semibold">Sectors</legend>
              <div className="flex flex-wrap gap-2">
                {SECTOR_OPTIONS.map((s) => (
                  <Chip key={s} on={(p.sectors ?? []).includes(s)} onClick={() => toggle("sectors", s)}>
                    {s}
                  </Chip>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Cheque size from (USD)">
                <input
                  className={input}
                  type="number"
                  min={0}
                  value={p.ticket_size_min ?? ""}
                  onChange={(e) => setP((x) => ({ ...x, ticket_size_min: e.target.value ? Number(e.target.value) : null }))}
                />
              </Field>
              <Field label="Cheque size up to (USD)">
                <input
                  className={input}
                  type="number"
                  min={0}
                  value={p.ticket_size_max ?? ""}
                  onChange={(e) => setP((x) => ({ ...x, ticket_size_max: e.target.value ? Number(e.target.value) : null }))}
                />
              </Field>
            </div>
            <label className="flex items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={p.is_accredited ?? false}
                onChange={(e) => setP((x) => ({ ...x, is_accredited: e.target.checked }))}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              I confirm I am an accredited investor (jurisdiction-dependent)
            </label>
          </section>

          <section className={card}>
            <div className="flex items-center justify-between gap-2">
              <span className={eyebrow}>Pass message</span>
              {!canEditTemplate && <span className="rounded-full bg-metatron-accent/15 px-2 py-0.5 text-[11px] font-semibold text-[var(--accent-fg)]">Basic and Pro</span>}
            </div>
            <Field
              label="What founders get when you decline"
              hint={
                <>
                  Use <code className="font-mono">{"{company}"}</code> and <code className="font-mono">{"{firm}"}</code> as placeholders.
                  {!canEditTemplate && (
                    <>
                      {" "}
                      <Link href="/investor/settings/subscription" className="text-[var(--accent-fg)] hover:underline">
                        Upgrade to edit it.
                      </Link>
                    </>
                  )}
                </>
              }
            >
              <textarea
                className={`${input} min-h-[110px] resize-y`}
                disabled={!canEditTemplate}
                placeholder={`Thank you for sharing {company} with us. After careful review, this isn't the right fit for our current portfolio focus. We wish you the very best with your raise and hope our paths cross again.\n\n— {firm}`}
                value={p.pass_message_template ?? ""}
                onChange={(e) => setP((x) => ({ ...x, pass_message_template: e.target.value }))}
              />
            </Field>
          </section>

          <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-end gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-3 shadow-[var(--card-shadow)]">
            {msg && (
              <span role="status" className={`text-sm ${msg.ok ? "text-[var(--accent-fg)]" : "text-[var(--danger)]"}`}>
                {msg.text}
              </span>
            )}
            <button type="submit" disabled={saving} className={btnPrimary}>
              {saving ? "Saving…" : "Save profile"}
            </button>
          </div>
        </form>

        {me?.id && <InvestorReviewsCard token={token} userId={me.id} />}

        <p className="text-sm text-[var(--text-muted)]">
          Looking for WhatsApp or Telegram? They&apos;re on{" "}
          <Link href="/investor/kevin" className="text-[var(--accent-fg)] hover:underline">
            Chat with Kevin
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
