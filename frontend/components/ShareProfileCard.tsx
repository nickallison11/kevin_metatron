"use client";

import { useState } from "react";
import { decodeJwtSub } from "@/lib/auth";
import { PUBLIC_URL } from "@/lib/site";

export default function ShareProfileCard({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const userId = decodeJwtSub(token);
  if (!userId) return null;

  const link = `${PUBLIC_URL}/startups/${userId}`;

  function copyLink() {
    void navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <h2 className="font-sans text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
        Share your public profile
      </h2>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        Market your deck directly — anyone can view and rate your startup here.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <code className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text)] truncate">
          {link}
        </code>
        <button
          type="button"
          onClick={copyLink}
          className="shrink-0 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--text)] hover:border-metatron-accent/30"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
    </div>
  );
}
