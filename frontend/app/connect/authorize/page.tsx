"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { API_BASE, apiFetch } from "@/lib/api";
import { rememberAfterLogin } from "@/lib/afterLogin";
import { getAccessToken } from "@/lib/tokenStore";

// An AI app (Claude, ChatGPT, Gemini, Grok...) asking to use Kevin for this
// user. The backend's /mcp-auth/authorize sends the browser here with the
// OAuth request in the query string; Allow or Cancel hands back to the app.

const CAN = [
  "Read your profile, pitch and matches",
  "Update your profile and pitch",
  "Request and answer intros",
  "Save what you tell it about intros, matches and programmes",
  "Search people on metatron, as your plan allows",
];

type Params = {
  client_id: string;
  redirect_uri: string;
  code_challenge: string | null;
  code_challenge_method: string | null;
  state: string | null;
  scope: string | null;
};

function readParams(): Params | null {
  const q = new URLSearchParams(window.location.search);
  const client_id = q.get("client_id");
  const redirect_uri = q.get("redirect_uri");
  if (!client_id || !redirect_uri) return null;
  return {
    client_id,
    redirect_uri,
    code_challenge: q.get("code_challenge"),
    code_challenge_method: q.get("code_challenge_method"),
    state: q.get("state"),
    scope: q.get("scope"),
  };
}

export default function ConnectAuthorizePage() {
  const router = useRouter();
  const [params, setParams] = useState<Params | null>(null);
  const [appName, setAppName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!getAccessToken()) {
      rememberAfterLogin(`${window.location.pathname}${window.location.search}`);
      router.replace("/login");
      return;
    }
    const p = readParams();
    if (!p) {
      setError("This link is missing details from the app. Start connecting again from the app.");
      return;
    }
    setParams(p);
    const q = new URLSearchParams({ client_id: p.client_id, redirect_uri: p.redirect_uri });
    fetch(`${API_BASE}/mcp-auth/client?${q}`)
      .then(async (r) => {
        const data = (await r.json().catch(() => ({}))) as { client_name?: string; error_description?: string };
        if (r.ok && data.client_name) setAppName(data.client_name);
        else setError(data.error_description ?? "This app isn't registered. Start connecting again from the app.");
      })
      .catch(() => setError("Couldn't reach metatron. Try again."));
  }, [router]);

  async function answer(allow: boolean) {
    if (!params) return;
    setBusy(true);
    try {
      const res = await apiFetch("/mcp-auth/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...params, allow }),
      });
      const data = (await res.json().catch(() => ({}))) as { redirect?: string; error_description?: string };
      if (res.ok && data.redirect) {
        window.location.href = data.redirect;
        return;
      }
      setError(data.error_description ?? "Couldn't connect. Try again from the app.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-4 py-10 text-[var(--text)]">
      <section className="flex w-full max-w-md flex-col gap-6 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-7 shadow-[var(--card-shadow)]">
        {error ? (
          <>
            <h1 className="text-xl font-semibold">Can&apos;t connect</h1>
            <p className="text-sm text-[var(--text-muted)]">{error}</p>
            <Link href="/" className="text-sm text-[var(--accent-fg)] hover:underline">
              Go to metatron
            </Link>
          </>
        ) : !appName ? (
          <p className="text-sm text-[var(--text-muted)]">Loading…</p>
        ) : (
          <>
            <h1 className="text-[22px] font-semibold leading-snug">{appName} wants to use Kevin</h1>
            <div className="flex flex-col gap-3 rounded-xl bg-[var(--overlay-4)] p-4">
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">It can</span>
              {CAN.map((c) => (
                <div key={c} className="flex gap-3 text-[15px]">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--accent-fg)]">
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                  <span>{c}</span>
                </div>
              ))}
            </div>
            <p className="text-[13px] leading-relaxed text-[var(--text-muted)]">
              What you share is saved to metatron and used to improve matches, as in our{" "}
              <Link href="/terms" className="text-[var(--accent-fg)] hover:underline">
                terms
              </Link>
              . Disconnect any time in Connect Kevin.
            </p>
            <div className="flex gap-2.5">
              <button
                type="button"
                disabled={busy}
                onClick={() => void answer(false)}
                className="inline-flex min-h-12 flex-1 items-center justify-center rounded-xl border border-[var(--overlay-12)] text-[15px] hover:bg-[var(--overlay-4)] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void answer(true)}
                className="inline-flex min-h-12 flex-1 items-center justify-center rounded-xl bg-metatron-accent text-[15px] font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-50"
              >
                Allow
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
