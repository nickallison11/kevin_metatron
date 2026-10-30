"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { KevinChannelPicker } from "@/components/kevin/KevinChannelPicker";
import { API_BASE, authHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/** Kevin's MCP server: what users paste into their AI app. */
const MCP_URL = `${API_BASE.replace(/\/+$/, "")}/mcp`;

type App = {
  name: string;
  /** Plan or app the connection needs, when it isn't every plan. */
  needs?: string;
  /** Steps after "Copy Kevin's address", ending before "Sign in and Allow". */
  steps: string[];
};

// Menu paths checked 30 Oct 2026 against each app's own help pages.
const APPS: App[] = [
  { name: "Claude", steps: ["In Claude, open Settings › Connectors › Add custom connector and paste the address."] },
  {
    name: "ChatGPT",
    needs: "Business plans",
    steps: [
      "In ChatGPT on the web, open Settings › Apps & Connectors › Advanced settings and turn on Developer mode.",
      "Back in Apps & Connectors, click Create, paste the address and choose OAuth.",
    ],
  },
  {
    name: "Gemini",
    needs: "Web app",
    steps: ["In Gemini on the web, open Settings › Connected apps › Add a custom app and paste the address."],
  },
  { name: "Grok", steps: ["Go to grok.com/connectors, click New connector › Custom and paste the address."] },
];

type Connection = { client_id: string; client_name: string; connected_at: string; last_used_at: string | null };

const card =
  "flex min-w-0 items-center gap-3.5 rounded-[var(--radius)] border bg-[var(--bg-card)] p-5 shadow-[var(--card-shadow)]";
const eyebrow = "font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]";
const btn =
  "inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-[var(--overlay-12)] px-4 text-sm text-[var(--text)] hover:bg-[var(--overlay-4)] disabled:opacity-50";
const btnPrimary =
  "inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-metatron-accent px-[18px] text-sm font-semibold text-white hover:bg-metatron-accent-hover";

function Tile({ label }: { label: string }) {
  return (
    <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--overlay-6)] text-lg font-bold">
      {label}
    </span>
  );
}

function CopyAddress() {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(MCP_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the address stays visible to copy by hand */
    }
  }
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] py-1.5 pl-3.5 pr-1.5">
      <code className="min-w-0 flex-1 select-all truncate font-mono text-[13px] text-[var(--text)]">{MCP_URL}</code>
      <button type="button" onClick={() => void copy()} className={btnPrimary}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function ConnectSteps({ app, onClose }: { app: App; onClose: () => void }) {
  const steps = ["Copy Kevin's address.", ...app.steps, "Sign in to metatron and click Allow."];
  return (
    <section className="flex flex-col gap-4 rounded-[var(--radius)] border border-metatron-accent/50 bg-[var(--bg-card)] p-5 shadow-[var(--card-shadow)]">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">Connect {app.name}</h3>
        <button type="button" onClick={onClose} className={btn}>
          Close
        </button>
      </div>
      <ol className="flex flex-col gap-3">
        {steps.map((s, i) => (
          <li key={s} className="flex gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-metatron-accent/20 font-mono text-[13px] text-[var(--accent-fg)]">
              {i + 1}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5 text-[15px]">
              <span>{s}</span>
              {i === 0 && <CopyAddress />}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Connect Kevin, for every role: the user's own AI app, their phone, and email. */
export function ConnectKevin({ profileHref }: { profileHref: string }) {
  const { token, loading } = useAuth();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const res = await fetch(`${API_BASE}/mcp-auth/connections`, { headers: authHeaders(token) }).catch(() => null);
    if (res?.ok) setConnections((await res.json()) as Connection[]);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function disconnect(c: Connection) {
    if (!token) return;
    setBusy(c.client_id);
    try {
      await fetch(`${API_BASE}/mcp-auth/connections/${encodeURIComponent(c.client_id)}`, {
        method: "DELETE",
        headers: authHeaders(token),
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (loading || !token) return null;

  const connectedTo = (app: string) => connections.some((c) => c.client_name.toLowerCase().includes(app.toLowerCase()));
  const openApp = APPS.find((a) => a.name === open) ?? null;

  return (
    <main className="min-w-0 flex-1">
      <section className="mx-auto flex max-w-6xl flex-col gap-7 p-6 md:p-10">
        <header className="flex flex-col gap-1.5">
          <span className={eyebrow}>Kevin</span>
          <h1 className="text-[28px] font-semibold tracking-tight">Connect Kevin</h1>
          <p className="text-sm text-[var(--text-muted)]">Use Kevin in the apps you already use.</p>
        </header>

        <div className="flex flex-col items-start gap-6 lg:flex-row">
          <div className="flex w-full min-w-0 flex-1 flex-col gap-7">
            <section className="flex flex-col gap-3">
              <h2 className={eyebrow}>Your AI</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {APPS.map((app) => {
                  const connected = connectedTo(app.name);
                  return (
                    <div key={app.name} className={`${card} ${connected ? "border-metatron-accent/50" : "border-[var(--border)]"}`}>
                      <Tile label={app.name[0]!} />
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-base font-semibold">{app.name}</span>
                        <span className={`text-[13px] ${connected ? "text-[var(--good)]" : "text-[var(--text-muted)]"}`}>
                          {connected ? "Connected" : (app.needs ?? " ")}
                        </span>
                      </div>
                      {!connected && (
                        <button type="button" onClick={() => setOpen(app.name)} className={btnPrimary}>
                          Connect
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {openApp && <ConnectSteps app={openApp} onClose={() => setOpen(null)} />}
              <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-4 sm:flex-row sm:items-center">
                <span className="shrink-0 text-sm text-[var(--text-muted)]">Another AI</span>
                <div className="min-w-0 flex-1">
                  <CopyAddress />
                </div>
              </div>
            </section>

            <KevinChannelPicker token={token} />

            <section className="flex flex-col gap-3">
              <h2 className={eyebrow}>Email</h2>
              <div className={`${card} border-[var(--border)]`}>
                <Tile label="@" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="select-all text-base font-semibold">kevin@metatron.id</span>
                  <span className="text-[13px] text-[var(--text-muted)]">Always on</span>
                </div>
              </div>
            </section>
          </div>

          <aside className="flex w-full flex-col gap-4 lg:w-80 lg:shrink-0">
            {connections.length > 0 && (
              <section className="flex flex-col gap-3.5 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-[var(--card-shadow)]">
                <h2 className={eyebrow}>Connected apps</h2>
                {connections.map((c, i) => (
                  <div key={c.client_id} className={`flex items-center gap-3 ${i > 0 ? "border-t border-[var(--border)] pt-3.5" : ""}`}>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[15px] font-medium">{c.client_name}</span>
                      <span className="text-[13px] text-[var(--text-muted)]">
                        Since {new Date(c.connected_at).toLocaleDateString()}
                        {c.last_used_at ? ` · used ${new Date(c.last_used_at).toLocaleDateString()}` : ""}
                      </span>
                    </div>
                    <button type="button" disabled={busy === c.client_id} onClick={() => void disconnect(c)} className={btn}>
                      Disconnect
                    </button>
                  </div>
                ))}
              </section>
            )}
            <section className="flex flex-col gap-2.5 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-[var(--card-shadow)]">
              <h2 className={eyebrow}>Your data</h2>
              <p className="text-sm leading-relaxed text-[var(--text-muted)]">
                Everything you share with Kevin, in any app, is saved to your metatron account.
              </p>
              <Link href={profileHref} className="text-sm text-[var(--accent-fg)] hover:underline">
                See and edit your data
              </Link>
            </section>
          </aside>
        </div>
      </section>
    </main>
  );
}
