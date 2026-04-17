"use client";

import Link from "next/link";
import { API_BASE, authJsonHeaders } from "@/lib/api";

export type FounderPublic = {
  user_id: string;
  company_name?: string | null;
  one_liner?: string | null;
  stage?: string | null;
  sector?: string | null;
  country?: string | null;
  pitch_deck_url?: string | null;
};

type Props = {
  founder: FounderPublic;
  token: string;
  showMessage?: boolean;
  onFollowed?: () => void;
  onIntroRequested?: () => void;
};

export function FounderCard({
  founder,
  token,
  showMessage = true,
  onFollowed,
  onIntroRequested,
}: Props) {
  async function follow() {
    try {
      const res = await fetch(`${API_BASE}/connections`, {
        method: "POST",
        headers: authJsonHeaders(token),
        body: JSON.stringify({
          to_user_id: founder.user_id,
          connection_type: "follow",
        }),
      });
      if (res.ok) onFollowed?.();
    } catch {
      /* ignore */
    }
  }

  async function messageRequest() {
    try {
      const res = await fetch(`${API_BASE}/connections`, {
        method: "POST",
        headers: authJsonHeaders(token),
        body: JSON.stringify({
          to_user_id: founder.user_id,
          connection_type: "message_request",
        }),
      });
      if (res.ok) onFollowed?.();
    } catch {
      /* ignore */
    }
  }

  async function requestIntro() {
    try {
      const res = await fetch(`${API_BASE}/deals/intros`, {
        method: "POST",
        headers: authJsonHeaders(token),
        body: JSON.stringify({
          startup_user_id: founder.user_id,
          note: "Request intro via Metatron.",
        }),
      });
      if (res.ok) onIntroRequested?.();
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="relative flex flex-col gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <div>
        <h3 className="text-sm font-semibold text-[var(--text)]">
          {founder.company_name || "Unnamed company"}
        </h3>
        <p className="mt-1 font-sans text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
          {(founder.stage || "—") +
            " · " +
            (founder.sector || "—") +
            (founder.country ? ` · ${founder.country}` : "")}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-[var(--text-muted)]">
          {founder.one_liner || "No one-liner yet."}
        </p>
      </div>
      <div className="mt-auto flex flex-wrap gap-2">
        {founder.pitch_deck_url ? (
          <a
            href={founder.pitch_deck_url}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-metatron-accent/30 bg-metatron-accent/15 px-3 py-1.5 text-xs font-semibold text-metatron-accent hover:bg-metatron-accent/25"
          >
            Pitch deck
          </a>
        ) : (
          <span className="text-[11px] text-[var(--text-muted)]">
            No deck on file
          </span>
        )}
        <button
          type="button"
          onClick={() => void follow()}
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] hover:border-metatron-accent/30"
        >
          Follow
        </button>
        <button
          type="button"
          onClick={() => void requestIntro()}
          className="rounded-lg bg-metatron-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-metatron-accent-hover"
        >
          Request intro
        </button>
        {showMessage && (
          <button
            type="button"
            onClick={() => void messageRequest()}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text-muted)] hover:border-metatron-accent/30 hover:text-[var(--text)]"
          >
            Message
          </button>
        )}
      </div>
    </div>
  );
}

export function ProBlurOverlay({ label }: { label: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[1] flex flex-col items-center justify-center gap-2 rounded-[var(--radius)] bg-[#0a0a0f]/80 px-4 backdrop-blur-sm">
      <p className="text-center text-xs font-medium text-[var(--text)]">
        {label}
      </p>
      <Link
        href="/pricing"
        className="pointer-events-auto rounded-lg bg-metatron-accent px-4 py-2 text-xs font-semibold text-white hover:bg-metatron-accent-hover"
      >
        Upgrade Plan
      </Link>
    </div>
  );
}
