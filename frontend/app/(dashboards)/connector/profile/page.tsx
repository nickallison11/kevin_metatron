"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState, type ReactNode } from "react";
import { API_BASE, authHeaders, authJsonHeaders } from "@/lib/api";
import type { MeResponse } from "@/lib/me";
import { COUNTRIES } from "@/lib/countries";
import { useAuth } from "@/lib/auth";
import { LogoCard } from "@/components/profile/LogoCard";

const SPECIALITIES = ["VC Network", "Angel Network", "Accelerator", "Corporate VC", "Ecosystem Partner", "Family Office", "Other"] as const;

type ConnectorProfile = {
  organisation?: string | null;
  bio?: string | null;
  speciality?: string | null;
  country?: string | null;
  website?: string | null;
  linkedin_url?: string | null;
};

const card = "flex flex-col gap-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-[var(--card-shadow)]";
const eyebrow = "font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]";
const input =
  "w-full min-h-11 rounded-[10px] border border-[var(--overlay-12)] bg-[var(--bg)] px-3.5 py-2.5 text-sm text-[var(--text)] outline-none focus:border-metatron-accent";
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

export default function ConnectorProfilePage() {
  const { token, loading: authLoading } = useAuth("INTERMEDIARY");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [p, setP] = useState<ConnectorProfile>({});
  const [saved, setSaved] = useState<ConnectorProfile>({});
  const [logo, setLogo] = useState<{ url: string | null; source: string | null }>({ url: null, source: null });
  const [contacts, setContacts] = useState(0);

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
        const [meRes, pr, net] = await Promise.all([
          fetch(`${API_BASE}/auth/me`, { headers: authHeaders(token) }),
          fetch(`${API_BASE}/connector-profile`, { headers: authJsonHeaders(token) }),
          fetch(`${API_BASE}/connector-profile/network`, { headers: authHeaders(token) }),
        ]);
        if (meRes.ok) setMe((await meRes.json()) as MeResponse);
        if (pr.ok) {
          const d = (await pr.json()) as ConnectorProfile;
          setP(d);
          setSaved(d);
        }
        if (net.ok) setContacts(((await net.json()) as unknown[]).length);
      } catch {
        setMsg({ ok: false, text: "Could not load your profile." });
      } finally {
        setLoading(false);
      }
    })();
    void loadLogo();
  }, [token, loadLogo]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`${API_BASE}/connector-profile`, {
        method: "PUT",
        headers: authJsonHeaders(token),
        body: JSON.stringify({
          organisation: p.organisation ?? null,
          bio: p.bio ?? null,
          speciality: p.speciality ?? null,
          country: p.country ?? null,
          website: p.website?.trim() || null,
          linkedin_url: p.linkedin_url?.trim() || null,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const d = (await res.json()) as ConnectorProfile;
      setP(d);
      setSaved(d);
      setMsg({ ok: true, text: "Saved." });
      if (d.website && !logo.url) window.setTimeout(() => void loadLogo(), 6000);
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

  const displayName = [me?.first_name, me?.last_name].filter(Boolean).join(" ").trim();
  const name = displayName || saved.organisation?.trim() || "Your profile";
  const items: [string, boolean][] = [
    ["Photo or logo", Boolean(logo.url)],
    ["Organisation", Boolean(saved.organisation?.trim())],
    ["About you", Boolean(saved.bio?.trim())],
    ["Where you help", Boolean(saved.speciality?.trim())],
    ["LinkedIn", Boolean(saved.linkedin_url?.trim())],
    ["Network imported", contacts > 0],
  ];
  const done = items.filter((i) => i[1]).length;

  return (
    <main className="min-w-0 flex-1">
      <section className="mx-auto flex max-w-5xl flex-col gap-5 p-6 md:p-10">
        <header className="flex flex-col gap-1.5">
          <span className={eyebrow}>Connector Profile</span>
          <h1 className="text-[28px] font-semibold tracking-tight">{name}</h1>
          <p className="text-sm text-[var(--text-muted)]">Founders and investors see this when you introduce them.</p>
        </header>

        <section className={card}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-3">
              <h2 className="text-lg font-semibold">Your profile</h2>
              <span className="text-sm text-[var(--text-muted)]">
                {done} of {items.length} complete
              </span>
            </div>
            <span className="text-[13px] text-[var(--text-muted)]">A complete profile makes your intros land</span>
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
              {contacts === 0 && (
                <>
                  .{" "}
                  <Link href="/connector/network" className="text-[var(--accent-fg)] hover:underline">
                    Import your network
                  </Link>
                </>
              )}
            </span>
          ) : (
            <span className="text-sm text-[var(--text-muted)]">Your profile is complete.</span>
          )}
        </section>

        <LogoCard token={token} name={name} label="Photo or logo" logoUrl={logo.url} logoSource={logo.source} website={saved.website} onChanged={() => void loadLogo()} />

        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <section className={card}>
            <span className={eyebrow}>About</span>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" hint={<Link href="/connector/settings" className="text-[var(--accent-fg)] hover:underline">Change it in Settings</Link>}>
                <input className={input} value={displayName || "—"} disabled readOnly />
              </Field>
              <Field label="Organisation">
                <input className={input} value={p.organisation ?? ""} onChange={(e) => setP((x) => ({ ...x, organisation: e.target.value }))} autoComplete="organization" />
              </Field>
            </div>
            <Field label="About you" hint="Who you know and how you help founders and investors.">
              <textarea className={`${input} min-h-[110px] resize-y`} value={p.bio ?? ""} onChange={(e) => setP((x) => ({ ...x, bio: e.target.value }))} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Where you help">
                <select className={input} value={p.speciality ?? ""} onChange={(e) => setP((x) => ({ ...x, speciality: e.target.value || null }))}>
                  <option value="">Select…</option>
                  {SPECIALITIES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
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
            <span className={eyebrow}>Links</span>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="LinkedIn">
                <input
                  className={input}
                  type="url"
                  inputMode="url"
                  placeholder="https://linkedin.com/in/you"
                  value={p.linkedin_url ?? ""}
                  onChange={(e) => setP((x) => ({ ...x, linkedin_url: e.target.value }))}
                />
              </Field>
              <Field label="Website" hint="We look for your logo here.">
                <input className={input} type="url" inputMode="url" placeholder="https://yourorg.com" value={p.website ?? ""} onChange={(e) => setP((x) => ({ ...x, website: e.target.value }))} />
              </Field>
            </div>
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

        <p className="text-sm text-[var(--text-muted)]">
          Looking for WhatsApp or Telegram? They&apos;re on{" "}
          <Link href="/connector/kevin" className="text-[var(--accent-fg)] hover:underline">
            Chat with Kevin
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
