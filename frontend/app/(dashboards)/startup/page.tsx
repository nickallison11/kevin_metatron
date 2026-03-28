"use client";

import { FormEvent, useEffect, useState } from "react";

export default function StartupDashboardPage() {
  const [token, setToken] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setToken(window.localStorage.getItem("metatron_token"));
  }, []);

  async function onCreatePitch(e: FormEvent) {
    e.preventDefault();
    if (!token) {
      setMessage("No token found. Please sign up or log in first.");
      return;
    }
    setMessage(null);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000"}/pitches`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ title, description })
        }
      );
      if (!res.ok) {
        throw new Error("failed");
      }
      setMessage("Pitch created successfully.");
      setTitle("");
      setDescription("");
    } catch {
      setMessage("Failed to create pitch.");
    }
  }

  return (
    <main className="min-h-[calc(100vh-72px)] text-[var(--text)]">
      <header className="border-b border-[var(--border)] px-6 py-4 md:px-10">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[2px] text-[var(--text-muted)] mb-1">
          Dashboard
        </p>
        <h1 className="text-lg font-semibold">Founder</h1>
      </header>
      <section className="p-6 md:p-10 space-y-4 max-w-3xl">
        <div className="rounded-metatron border border-[var(--border)] bg-[var(--bg-card)] p-5 space-y-3">
          <h2 className="text-sm font-semibold text-[var(--text)]">
            Create a pitch
          </h2>
          <form onSubmit={onCreatePitch} className="space-y-3 text-sm">
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
              className="rounded-lg bg-metatron-accent px-4 py-2 text-xs font-semibold text-white hover:bg-metatron-accent-hover hover:shadow-[0_4px_20px_rgba(108,92,231,0.3)] transition-all"
            >
              Save pitch
            </button>
          </form>
          {message && (
            <p className="text-xs text-[var(--text-muted)]">{message}</p>
          )}
        </div>
        <div className="rounded-metatron border border-[var(--border)] bg-[var(--bg-card)] p-5">
          <h2 className="text-sm font-semibold mb-1">Funding pools</h2>
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            Metatron-curated pools and your eligibility will appear here.
          </p>
        </div>
      </section>
    </main>
  );
}
