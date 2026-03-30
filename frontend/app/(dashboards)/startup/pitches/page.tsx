"use client";

import { FormEvent, useEffect, useState } from "react";
import { API_BASE, authHeaders, authJsonHeaders } from "@/lib/api";

type Pitch = {
  id: string;
  title: string;
  description?: string | null;
};

export default function StartupPitchesPage() {
  const [token, setToken] = useState<string | null>(null);
  const [pitches, setPitches] = useState<Pitch[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setToken(window.localStorage.getItem("metatron_token"));
  }, []);

  async function load() {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/pitches`, {
        headers: authHeaders(token)
      });
      if (res.ok) setPitches(await res.json());
    } catch {
      setMsg("Failed to load pitches.");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!token) {
      setMsg("No token — sign up as founder first.");
      return;
    }
    setMsg(null);
    try {
      const res = await fetch(`${API_BASE}/pitches`, {
        method: "POST",
        headers: authJsonHeaders(token),
        body: JSON.stringify({ title, description: description || null })
      });
      if (!res.ok) throw new Error("failed");
      setTitle("");
      setDescription("");
      setMsg("Pitch created.");
      load();
    } catch {
      setMsg("Failed to create pitch.");
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
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5 space-y-3">
          <h2 className="text-sm font-semibold">Create a pitch</h2>
          <form onSubmit={onCreate} className="space-y-3 text-sm">
            <input
              className="input-metatron"
              placeholder="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
            <textarea
              className="input-metatron min-h-[96px] resize-y"
              placeholder="Short description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <button
              type="submit"
              className="rounded-lg bg-metatron-accent px-4 py-2 text-xs font-semibold text-white hover:bg-metatron-accent-hover"
            >
              Save pitch
            </button>
          </form>
        </div>
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5">
          <h2 className="text-sm font-semibold mb-3">All pitches</h2>
          <ul className="space-y-2 text-sm">
            {pitches.map((p) => (
              <li
                key={p.id}
                className="rounded-lg border border-[var(--border)] px-3 py-2.5"
              >
                <div className="font-medium">{p.title}</div>
                {p.description && (
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    {p.description}
                  </p>
                )}
              </li>
            ))}
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
