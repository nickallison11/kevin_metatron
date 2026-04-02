"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE, authHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type Analysis = {
  summary?: string;
  key_takeaways?: string[];
  action_items?: string[];
  investor_sentiment?: string;
};

type CallRow = {
  id: string;
  original_filename: string;
  transcript?: string | null;
  analysis?: Analysis | null;
  created_at: string;
};

export default function StartupCallsPage() {
  const router = useRouter();
  const { token, isPro, loading } = useAuth();
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!loading && token && !isPro) router.replace("/pricing");
  }, [loading, token, isPro, router]);

  const load = useCallback(async () => {
    if (!token || !isPro) return;
    try {
      const res = await fetch(`${API_BASE}/calls`, {
        headers: authHeaders(token)
      });
      if (res.ok) setCalls(await res.json());
    } catch {
      setMsg("Failed to load calls.");
    }
  }, [token, isPro]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return null;
  if (!token) return null;
  if (!isPro) return null;

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !token) return;
    setUploading(true);
    setMsg(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch(`${API_BASE}/calls`, {
        method: "POST",
        headers: authHeaders(token),
        body: fd
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error("upload failed");
      setMsg("Recording processed.");
      setCalls((c) => [data as CallRow, ...c]);
    } catch {
      setMsg("Upload failed.");
    } finally {
      setUploading(false);
    }
    e.target.value = "";
  }

  return (
    <main className="flex-1">
      <header className="border-b border-[var(--border)] px-6 py-4 md:px-10 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] font-medium uppercase tracking-[2px] text-[var(--text-muted)] mb-1">
            Calls
          </p>
          <h1 className="text-lg font-semibold">Call intelligence</h1>
        </div>
        <label className="cursor-pointer rounded-lg bg-metatron-accent px-4 py-2 text-xs font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-50">
          {uploading ? "Processing…" : "Upload recording"}
          <input
            type="file"
            accept=".m4a,.mp3,.wav,audio/*"
            className="hidden"
            onChange={onUpload}
            disabled={uploading}
          />
        </label>
      </header>
      <section className="p-6 md:p-10 max-w-4xl space-y-5">
        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
          Transcription uses a mock pipeline until Whisper is wired. Analysis
          uses Claude when{" "}
          <code className="text-metatron-accent">ANTHROPIC_API_KEY</code> is set.
        </p>
        {msg && <p className="text-xs text-[var(--text-muted)]">{msg}</p>}
        <div className="space-y-5">
          {calls.map((c) => (
            <article
              key={c.id}
              className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden"
            >
              <div className="border-b border-[var(--border)] px-4 py-3 flex flex-wrap justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-[var(--text)]">
                    {c.original_filename}
                  </h2>
                  <p className="text-[11px] text-[var(--text-muted)] font-mono">
                    {new Date(c.created_at).toLocaleString()}
                  </p>
                </div>
              </div>
              {c.transcript && (
                <div className="px-4 py-3 border-b border-[var(--border)]">
                  <p className="font-mono text-[10px] uppercase text-[var(--text-muted)] mb-1">
                    Transcript
                  </p>
                  <p className="text-xs text-[var(--text-muted)] leading-relaxed whitespace-pre-wrap">
                    {c.transcript}
                  </p>
                </div>
              )}
              {c.analysis && (
                <div className="p-4 grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2 rounded-lg border border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_55%,transparent)] p-3">
                    <p className="font-mono text-[10px] uppercase text-metatron-accent mb-1">
                      Summary
                    </p>
                    <p className="text-sm text-[var(--text)] leading-relaxed">
                      {c.analysis.summary ?? "—"}
                    </p>
                  </div>
                  <div className="rounded-lg border border-[var(--border)] p-3">
                    <p className="font-mono text-[10px] uppercase text-[var(--text-muted)] mb-2">
                      Key takeaways
                    </p>
                    <ul className="text-xs text-[var(--text-muted)] space-y-1 list-disc pl-4">
                      {(c.analysis.key_takeaways ?? []).map((t, i) => (
                        <li key={i}>{t}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-lg border border-[var(--border)] p-3">
                    <p className="font-mono text-[10px] uppercase text-[var(--text-muted)] mb-2">
                      Action items
                    </p>
                    <ul className="text-xs text-[var(--text-muted)] space-y-1 list-disc pl-4">
                      {(c.analysis.action_items ?? []).map((t, i) => (
                        <li key={i}>{t}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="sm:col-span-2 rounded-lg border border-metatron-accent/20 bg-metatron-accent/5 p-3">
                    <p className="font-mono text-[10px] uppercase text-[var(--text-muted)] mb-1">
                      Investor sentiment
                    </p>
                    <p className="text-sm font-medium text-metatron-accent">
                      {c.analysis.investor_sentiment ?? "—"}
                    </p>
                  </div>
                </div>
              )}
            </article>
          ))}
          {calls.length === 0 && (
            <p className="text-sm text-[var(--text-muted)]">
              No recordings yet. Upload an .m4a, .mp3, or .wav file.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
