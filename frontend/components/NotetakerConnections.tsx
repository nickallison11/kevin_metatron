"use client";

import { API_BASE, authHeaders, authJsonHeaders } from "@/lib/api";
import { useCallback, useEffect, useState } from "react";

type ConnectionStatus = {
  provider: "fireflies" | "fathom" | "tldv";
  connected: boolean;
  connected_at: string | null;
  last_synced_at: string | null;
  last_sync_error: string | null;
};

const PROVIDER_LABEL: Record<ConnectionStatus["provider"], string> = {
  fireflies: "Fireflies",
  fathom: "Fathom",
  tldv: "tl;dv",
};

const PROVIDER_HELP: Record<ConnectionStatus["provider"], string> = {
  fireflies: "From app.fireflies.ai → Settings → Developer settings → API Key.",
  fathom: "From your Fathom account settings → Integrations → API keys.",
  tldv: "Available on tl;dv Pro/Business plans, under Settings → API.",
};

function formatWhen(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function NotetakerConnections({ token }: { token: string }) {
  const [statuses, setStatuses] = useState<ConnectionStatus[]>([]);
  const [openProvider, setOpenProvider] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/integrations/notetaker/status`, {
        headers: authHeaders(token),
      });
      if (res.ok) setStatuses(await res.json());
    } catch {
      /* ignore */
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function connect(provider: string) {
    if (!apiKeyInput.trim()) return;
    setBusy(provider);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/integrations/notetaker/${provider}`, {
        method: "POST",
        headers: authJsonHeaders(token),
        body: JSON.stringify({ api_key: apiKeyInput.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Couldn't connect. Check the key and try again.");
      }
      setApiKeyInput("");
      setOpenProvider(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed.");
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(provider: string) {
    setBusy(provider);
    try {
      await fetch(`${API_BASE}/integrations/notetaker/${provider}`, {
        method: "DELETE",
        headers: authHeaders(token),
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function syncNow(provider: string) {
    setBusy(provider);
    try {
      await fetch(`${API_BASE}/integrations/notetaker/${provider}/sync`, {
        method: "POST",
        headers: authHeaders(token),
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <h2 className="text-sm font-semibold mb-1">Connect your meeting notes</h2>
      <p className="text-sm text-[var(--text-muted)] mb-5">
        Already recording calls with Fireflies, Fathom, or tl;dv? Connect your
        account and Kevin pulls new call notes in automatically — no manual
        uploads needed.
      </p>

      <div className="space-y-3">
        {statuses.map((s) => (
          <div
            key={s.provider}
            className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-[var(--text)]">
                  {PROVIDER_LABEL[s.provider]}
                </p>
                {s.connected ? (
                  <p className="text-xs text-green-400 mt-0.5">
                    Connected · last synced {formatWhen(s.last_synced_at)}
                  </p>
                ) : (
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">Not connected</p>
                )}
                {s.last_sync_error && (
                  <p className="text-xs text-[rgb(254,202,202)] mt-1">{s.last_sync_error}</p>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                {s.connected ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void syncNow(s.provider)}
                      disabled={busy === s.provider}
                      className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-[var(--text-muted)] disabled:opacity-50"
                    >
                      {busy === s.provider ? "Syncing…" : "Sync now"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void disconnect(s.provider)}
                      disabled={busy === s.provider}
                      className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-[var(--text-muted)] disabled:opacity-50"
                    >
                      Disconnect
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      setOpenProvider((o) => (o === s.provider ? null : s.provider))
                    }
                    className="btn-metatron-primary px-4 py-2 text-xs"
                  >
                    Connect
                  </button>
                )}
              </div>
            </div>

            {openProvider === s.provider && !s.connected && (
              <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 space-y-2">
                <p className="text-xs text-[var(--text-muted)]">{PROVIDER_HELP[s.provider]}</p>
                <div className="flex items-center gap-2">
                  <input
                    className="input-metatron flex-1 py-2 text-xs"
                    placeholder="Paste your API key"
                    type="password"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void connect(s.provider);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => void connect(s.provider)}
                    disabled={busy === s.provider || !apiKeyInput.trim()}
                    className="shrink-0 btn-metatron-primary px-4 py-2 text-xs disabled:opacity-50"
                  >
                    {busy === s.provider ? "Connecting…" : "Save"}
                  </button>
                </div>
                {error && <p className="text-xs text-[rgb(254,202,202)]">{error}</p>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
