"use client";

import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { ChatGPTLogo, ClaudeLogo, GeminiLogo, GrokLogo } from "@/components/kevin/AppLogos";
import { ConnectRow, RowPanel, listCard, rowBtn, rowBtnPrimary, sectionTitle } from "@/components/kevin/ConnectRow";
import { KevinChannelPicker } from "@/components/kevin/KevinChannelPicker";
import { API_BASE, authHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/** Kevin's MCP server: what users paste into their AI app. */
const MCP_URL = `${API_BASE.replace(/\/+$/, "")}/mcp`;

type App = {
  name: string;
  logo: ReactNode;
  /** Plan or app the connection needs, when it isn't every plan. */
  needs?: string;
  /** Steps after "Copy Kevin's address", ending before "Sign in and Allow". */
  steps: string[];
};

// Menu paths checked 30 Oct 2026 against each app's own help pages.
const APPS: App[] = [
  {
    name: "Claude",
    logo: <ClaudeLogo />,
    steps: ["In Claude, open Settings › Connectors › Add custom connector and paste the address."],
  },
  {
    name: "ChatGPT",
    logo: <ChatGPTLogo />,
    needs: "Business plans",
    steps: [
      "In ChatGPT on the web, open Settings › Apps & Connectors › Advanced settings and turn on Developer mode.",
      "Back in Apps & Connectors, click Create, paste the address and choose OAuth.",
    ],
  },
  {
    name: "Gemini",
    logo: <GeminiLogo />,
    needs: "Web app",
    steps: ["In Gemini on the web, open Settings › Connected apps › Add a custom app and paste the address."],
  },
  {
    name: "Grok",
    logo: <GrokLogo />,
    steps: ["Go to grok.com/connectors, click New connector › Custom and paste the address."],
  },
];

type Connection = { client_id: string; client_name: string; connected_at: string; last_used_at: string | null };

const eyebrow = "font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]";

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

/** "Connected · used 30 Oct" for the most recent of one app's connections. */
function connectedStatus(cs: Connection[]) {
  const used = cs.map((c) => c.last_used_at).filter((d): d is string => !!d).sort().pop();
  return used ? `Connected · used ${day(used)}` : `Connected · ${day(cs[0]!.connected_at)}`;
}

function CopyAddress({ id }: { id?: string }) {
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
      <input
        id={id}
        readOnly
        value={MCP_URL}
        onFocus={(e) => e.currentTarget.select()}
        className="min-w-0 flex-1 truncate bg-transparent font-mono text-[13px] text-[var(--text)] outline-none"
      />
      <button type="button" onClick={() => void copy()} className={rowBtn}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function ConnectSteps({ app }: { app: App }) {
  const steps = ["Copy Kevin's address.", ...app.steps, "Sign in to metatron and click Allow."];
  return (
    <ol className="flex flex-col gap-3 rounded-xl bg-[var(--overlay-4)] p-4">
      {steps.map((s, i) => (
        <li key={s} className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-metatron-accent/20 font-mono text-xs text-[var(--accent-fg)]">
            {i + 1}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-2 text-sm">
            <span>{s}</span>
            {i === 0 && <CopyAddress />}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Connect Kevin, for every role: the user's own AI app or their messaging app. (Email is for notifications only.) */
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

  async function disconnect(key: string, cs: Connection[]) {
    if (!token) return;
    setBusy(key);
    try {
      for (const c of cs) {
        await fetch(`${API_BASE}/mcp-auth/connections/${encodeURIComponent(c.client_id)}`, {
          method: "DELETE",
          headers: authHeaders(token),
        });
      }
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (loading || !token) return null;

  const of = (app: string) => connections.filter((c) => c.client_name.toLowerCase().includes(app.toLowerCase()));
  // Connections from an AI app that isn't one of the four above.
  const others = connections.filter((c) => !APPS.some((a) => c.client_name.toLowerCase().includes(a.name.toLowerCase())));

  return (
    <main className="min-w-0 flex-1">
      <section className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-6 sm:p-6 md:p-10">
        <header className="flex flex-col gap-1.5">
          <span className={eyebrow}>Kevin</span>
          <h1 className="text-[28px] font-semibold tracking-tight">Connect Kevin</h1>
          <p className="text-sm text-[var(--text-muted)]">Use Kevin in the apps you already use.</p>
        </header>

        <section className="flex flex-col gap-3">
          <h2 className={sectionTitle}>Kevin in your favourite AI</h2>
          <div className={listCard}>
            {APPS.map((app) => {
              const cs = of(app.name);
              const isOpen = open === app.name;
              return (
                <div key={app.name}>
                  <ConnectRow
                    logo={app.logo}
                    name={app.name}
                    status={cs.length ? connectedStatus(cs) : app.needs}
                    good={cs.length > 0}
                    action={
                      cs.length ? (
                        <button type="button" disabled={busy === app.name} onClick={() => void disconnect(app.name, cs)} className={rowBtn}>
                          Disconnect
                        </button>
                      ) : (
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          onClick={() => setOpen(isOpen ? null : app.name)}
                          className={isOpen ? rowBtn : rowBtnPrimary}
                        >
                          {isOpen ? "Close" : "Connect"}
                        </button>
                      )
                    }
                  />
                  {isOpen && !cs.length && (
                    <RowPanel>
                      <ConnectSteps app={app} />
                    </RowPanel>
                  )}
                </div>
              );
            })}
            {others.map((c) => (
              <ConnectRow
                key={c.client_id}
                logo="+"
                name={c.client_name}
                status={connectedStatus([c])}
                good
                action={
                  <button type="button" disabled={busy === c.client_id} onClick={() => void disconnect(c.client_id, [c])} className={rowBtn}>
                    Disconnect
                  </button>
                }
              />
            ))}
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-3 px-4 py-3.5 sm:flex-nowrap sm:px-5">
              <span
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[var(--overlay-6)] text-lg font-bold"
              >
                +
              </span>
              <label htmlFor="ck-address" className="shrink-0 text-[15px] font-semibold sm:text-base">
                Another AI
              </label>
              <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
                <CopyAddress id="ck-address" />
              </div>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 items-stretch gap-x-4 gap-y-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <KevinChannelPicker token={token} />

          <section className="flex flex-col gap-3">
            <h2 className={sectionTitle}>Your data</h2>
            <div className="flex flex-1 flex-col justify-between gap-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-[var(--card-shadow)]">
              <p className="text-sm leading-relaxed text-[var(--text-muted)]">
                Everything you share with Kevin, in any app, is saved to your metatron account.
              </p>
              <Link href={profileHref} className="text-sm text-[var(--accent-fg)] hover:underline">
                See and edit your data →
              </Link>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
