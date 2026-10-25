"use client";

import { FormEvent, useState } from "react";
import { CardHoverEffect } from "@/components/ui/card-hover-effect";
import { API_BASE } from "@/lib/api";

// Shown on production until launch: middleware sends the public pages here
// while NEXT_PUBLIC_PRELAUNCH=true. Uses the backend's existing /waitlist.
export default function ComingSoonPage() {
  const [name, setName] = useState("");
  const [org, setOrg] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("sending");
    try {
      const res = await fetch(`${API_BASE}/waitlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          startup_name: org,
          email,
          user_agent: navigator.userAgent,
          referrer: document.referrer || undefined,
        }),
      });
      setStatus(res.ok ? "done" : "error");
    } catch {
      setStatus("error");
    }
  }

  const inputClass =
    "w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:border-metatron-accent/50 focus:outline-none";

  return (
    <div className="relative flex min-h-[calc(100vh-88px)] items-center justify-center px-5 py-10">
      <div className="relative z-[1] w-full max-w-sm">
        <CardHoverEffect layoutId="metatron-coming-soon-hover">
          <div className="w-full rounded-metatron border border-[var(--border)] bg-[var(--bg-card)] p-6">
            <h1 className="text-xl font-semibold text-[var(--text)]">Kevin is almost here</h1>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              metatron is getting ready for launch. Join the waitlist and Kevin will let you know
              the moment you can sign up.
            </p>

            {status === "done" ? (
              <p className="mt-5 text-sm text-[var(--text)]">
                You&apos;re on the list. Check your inbox for a confirmation email.
              </p>
            ) : (
              <form onSubmit={onSubmit} className="mt-5 space-y-3">
                <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className={inputClass} />
                <input required value={org} onChange={(e) => setOrg(e.target.value)} placeholder="Startup or fund name" className={inputClass} />
                <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" className={inputClass} />
                <button
                  type="submit"
                  disabled={status === "sending"}
                  className="w-full rounded-lg bg-metatron-accent py-2.5 text-sm font-semibold text-white hover:bg-metatron-accent-hover transition-all disabled:opacity-60"
                >
                  {status === "sending" ? "Joining…" : "Join the waitlist"}
                </button>
                {status === "error" && (
                  <p className="text-xs text-[var(--text-muted)]">Something went wrong. Please try again.</p>
                )}
              </form>
            )}

          </div>
        </CardHoverEffect>
      </div>
    </div>
  );
}
