"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { API_BASE, authJsonHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function AdminAddProspectPage() {
  const router = useRouter();
  const { token, loading: authLoading } = useAuth();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [pitchDeckUrl, setPitchDeckUrl] = useState("");
  const [role, setRole] = useState("");
  const [notes, setNotes] = useState("");
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setCreating(true);
    setErr(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/prospects`, {
        method: "POST",
        headers: authJsonHeaders(token),
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          linkedin_url: linkedinUrl.trim() || null,
          pitch_deck_url: pitchDeckUrl.trim() || null,
          role: role.trim() || null,
          notes: notes.trim() || null,
          status: "contacted",
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t.trim() || "Could not create prospect");
      }
      router.push("/admin/prospects");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create prospect");
    } finally {
      setCreating(false);
    }
  }

  if (authLoading || !token) {
    return (
      <div className="p-8 md:p-10">
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      </div>
    );
  }

  return (
    <main className="min-w-0">
      <header className="border-b border-[var(--border)] px-6 py-4 md:px-10">
        <Link
          href="/admin/prospects"
          className="text-xs text-metatron-accent hover:underline mb-2 inline-block"
        >
          ← Prospects
        </Link>
        <p className="font-sans text-[11px] font-medium uppercase tracking-[2px] text-[var(--text-muted)] mb-1">
          Admin
        </p>
        <h1 className="text-lg font-semibold">Add prospect</h1>
      </header>

      <section className="p-6 md:p-10">
        {err ? (
          <p className="text-sm text-[rgb(254,202,202)] mb-4">{err}</p>
        ) : null}

        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-6 space-y-4 max-w-xl">
          <form onSubmit={onCreate} className="space-y-3 text-sm">
            <label className="block space-y-1">
              <span className="font-sans text-[11px] uppercase text-[var(--text-muted)]">
                Name
              </span>
              <input
                className="input-metatron w-full"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>
            <label className="block space-y-1">
              <span className="font-sans text-[11px] uppercase text-[var(--text-muted)]">
                Email
              </span>
              <input
                className="input-metatron w-full"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label className="block space-y-1">
              <span className="font-sans text-[11px] uppercase text-[var(--text-muted)]">
                LinkedIn URL
              </span>
              <input
                className="input-metatron w-full"
                type="url"
                value={linkedinUrl}
                onChange={(e) => setLinkedinUrl(e.target.value)}
                placeholder="https://"
              />
            </label>
            <label className="block space-y-1">
              <span className="font-sans text-[11px] uppercase text-[var(--text-muted)]">
                PITCH DECK URL
              </span>
              <input
                className="input-metatron w-full"
                type="url"
                value={pitchDeckUrl}
                onChange={(e) => setPitchDeckUrl(e.target.value)}
                placeholder="https://"
              />
            </label>
            <label className="block space-y-1">
              <span className="font-sans text-[11px] uppercase text-[var(--text-muted)]">
                Role
              </span>
              <input
                className="input-metatron w-full"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="Founder, investor, …"
              />
            </label>
            <label className="block space-y-1">
              <span className="font-sans text-[11px] uppercase text-[var(--text-muted)]">
                Notes
              </span>
              <textarea
                className="input-metatron w-full min-h-[80px]"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
            <button
              type="submit"
              disabled={creating}
              className="rounded-lg bg-metatron-accent px-4 py-2 text-xs font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-60"
            >
              {creating ? "Adding…" : "Add prospect"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
