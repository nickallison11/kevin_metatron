"use client";

import { useState } from "react";
import { btn, btnSm, card, eyebrow, reviewRequestMailto } from "@/components/startup/dashboardStyles";

/** Public profile link, plus a pre-written email asking someone for a review. */
export default function ShareProfileCard({ link, company }: { link: string; company: string | null }) {
  const [copied, setCopied] = useState(false);

  function copyLink() {
    void navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className={`${card} p-[22px]`}>
      <span className={`${eyebrow} text-[var(--text-muted)]`}>Share your startup</span>
      <p className="text-[13px] leading-relaxed text-[var(--text-muted)]">
        Anyone can view your deck and rate your startup on your public page.
      </p>
      <div className="flex items-center gap-2 rounded-[10px] border border-[var(--overlay-12)] py-2 pl-3 pr-2">
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--text)]">{link}</code>
        <button type="button" onClick={copyLink} className={btnSm}>
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <a href={reviewRequestMailto(link, company)} className={btn}>
        Ask for a review
      </a>
    </section>
  );
}
