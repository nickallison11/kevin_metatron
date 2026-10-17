"use client";

import { useRef, useState } from "react";
import { API_BASE, authHeaders } from "@/lib/api";

const btn =
  "inline-flex min-h-10 items-center justify-center rounded-[10px] border border-[var(--overlay-12)] px-4 text-[13px] font-medium text-[var(--text)] hover:bg-[var(--overlay-4)] disabled:opacity-50";
const btnPrimary =
  "inline-flex min-h-10 items-center justify-center rounded-[10px] bg-metatron-accent px-4 text-[13px] font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-50";

function initials(s: string): string {
  return (
    s
      .replace(/[^A-Za-z ]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "·"
  );
}

function host(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Logo or photo: found on the user's website (or work-email domain), or
 * uploaded. Used on Investor and Connector Profile.
 */
export function LogoCard({
  token,
  name,
  logoUrl,
  logoSource,
  website,
  label = "Logo",
  onChanged,
}: {
  token: string;
  name: string;
  logoUrl: string | null | undefined;
  logoSource: string | null | undefined;
  website: string | null | undefined;
  label?: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  async function run(req: () => Promise<Response>, fallback: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await req();
      if (!res.ok) {
        setMsg((await res.text()) || fallback);
        return;
      }
      onChanged();
    } catch {
      setMsg(fallback);
    } finally {
      setBusy(false);
    }
  }

  function upload(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    void run(() => fetch(`${API_BASE}/uploads/logo`, { method: "POST", headers: authHeaders(token), body: fd }), "Upload failed.");
  }

  return (
    <section
      aria-label={label}
      className="flex flex-wrap items-center gap-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-[var(--card-shadow)]"
    >
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt={`${name} ${label.toLowerCase()}`} className="h-14 w-14 shrink-0 rounded-[14px] border border-[var(--border)] bg-white object-contain p-1.5" />
      ) : (
        <span aria-hidden className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[14px] border-[1.5px] border-dashed border-[var(--overlay-12)] text-lg font-semibold text-[var(--text-muted)]">
          {initials(name)}
        </span>
      )}
      <div className="flex min-w-0 flex-1 basis-60 flex-col gap-0.5">
        <span className="text-sm font-semibold">{label}</span>
        <span className={`text-[13px] ${logoUrl ? "text-[var(--text-muted)]" : "text-[var(--warn)]"}`}>
          {logoUrl
            ? logoSource === "upload"
              ? "Uploaded by you"
              : `Found on ${host(website) || "your website"}`
            : website
              ? `We couldn't find a logo on ${host(website)}`
              : "Add your website and we'll look for your logo there, or upload one"}
        </span>
        <span className="text-xs text-[var(--text-muted)]">Shown on your cards and profile. A square PNG works best.</span>
        {msg && <span className="text-xs text-[var(--danger)]">{msg}</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        {!logoUrl && website && (
          <button
            type="button"
            disabled={busy}
            className={btn}
            onClick={() =>
              void run(() => fetch(`${API_BASE}/uploads/logo/from-website`, { method: "POST", headers: authHeaders(token) }), "We couldn't find a logo on your website.")
            }
          >
            Look on my website
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => fileInput.current?.click()} className={logoUrl ? btn : btnPrimary}>
          {busy ? "Working…" : logoUrl ? "Replace" : `Upload ${label.toLowerCase()}`}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) upload(f);
          }}
        />
      </div>
    </section>
  );
}
