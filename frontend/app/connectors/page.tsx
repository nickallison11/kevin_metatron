"use client";

import { ProBlurOverlay } from "@/components/FounderCard";
import { API_BASE, authHeaders, authJsonHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useCallback, useEffect, useState } from "react";

type ConnectorPublic = {
  user_id: string;
  organisation?: string | null;
  bio?: string | null;
  speciality?: string | null;
  country?: string | null;
};

export default function ConnectorsDiscoveryPage() {
  const { token, loading, isPro } = useAuth();
  const [rows, setRows] = useState<ConnectorPublic[]>([]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/connector-profile/all`, {
        headers: authHeaders(token),
      });
      if (res.ok) {
        setRows((await res.json()) as ConnectorPublic[]);
      }
    } catch {
      /* ignore */
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function connect(
    toUserId: string,
    connectionType: "follow" | "message_request",
  ) {
    if (!token) return;
    await fetch(`${API_BASE}/connections`, {
      method: "POST",
      headers: authJsonHeaders(token),
      body: JSON.stringify({ to_user_id: toUserId, connection_type: connectionType }),
    });
  }

  if (loading || !token) return null;

  return (
    <main className="min-h-[calc(100vh-72px)] text-[var(--text)]">
      <header className="border-b border-[var(--border)] px-6 py-4 md:px-10">
        <p className="mb-1 font-sans text-[11px] font-medium uppercase tracking-[2px] text-[var(--text-muted)]">
          Discovery
        </p>
        <h1 className="text-lg font-semibold">Connectors</h1>
      </header>
      <section className="max-w-5xl p-6 md:p-10">
        <div className="grid gap-4 sm:grid-cols-2">
          {rows.map((c, i) => {
            const bio = c.bio?.trim() ?? "";
            const snippet =
              bio.length > 160 ? `${bio.slice(0, 160)}…` : bio || "—";
            return (
              <div key={c.user_id} className="relative">
                <div className="flex flex-col gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-4">
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--text)]">
                      {c.organisation || "Connector"}
                    </h3>
                    <p className="mt-1 font-sans text-[11px] text-metatron-accent">
                      {c.speciality ?? "—"} · {c.country ?? "—"}
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-[var(--text-muted)]">
                      {snippet}
                    </p>
                  </div>
                  <div className="mt-auto flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void connect(c.user_id, "follow")}
                      className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] hover:border-metatron-accent/30"
                    >
                      Follow
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void connect(c.user_id, "message_request")
                      }
                      className="rounded-lg bg-metatron-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-metatron-accent-hover"
                    >
                      Connect
                    </button>
                  </div>
                </div>
                {!isPro && i >= 2 ? (
                  <ProBlurOverlay label="Upgrade to Pro to see all connectors" />
                ) : null}
              </div>
            );
          })}
          {rows.length === 0 && (
            <p className="text-sm text-[var(--text-muted)] sm:col-span-2">
              No connector profiles yet.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
