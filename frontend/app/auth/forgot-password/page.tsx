"use client";

import { CardHoverEffect } from "@/components/ui/card-hover-effect";
import { API_BASE } from "@/lib/api";
import Link from "next/link";
import { FormEvent, useState } from "react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await fetch(`${API_BASE}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setDone(true);
    } catch {
      setDone(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-[calc(100vh-88px)] items-center justify-center px-5 py-10">
      <div className="relative z-[1] w-full max-w-sm space-y-4">
        <CardHoverEffect layoutId="metatron-forgot-password-hover">
          <div className="w-full rounded-metatron border border-[var(--border)] bg-[var(--bg-card)] p-6">
            <div className="mb-4">
              <h1 className="text-xl font-semibold text-[var(--text)]">
                Forgot password
              </h1>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Enter your email and we&apos;ll send a reset link if an account
                exists.
              </p>
            </div>

            {done ? (
              <p className="text-sm text-[var(--text)]">
                If that email is registered, a reset link is on its way.
              </p>
            ) : (
              <form onSubmit={onSubmit} className="space-y-4">
                <label className="block text-sm space-y-1 text-[var(--text)]">
                  <span className="font-sans text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                    Email
                  </span>
                  <input
                    className="input-metatron w-full"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    type="email"
                    required
                    disabled={loading}
                  />
                </label>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-lg bg-metatron-accent py-2.5 text-sm font-semibold text-white hover:bg-metatron-accent-hover hover:shadow-[0_4px_20px_rgba(108,92,231,0.3)] transition-all disabled:opacity-60"
                >
                  {loading ? "Sending…" : "Send reset link"}
                </button>
              </form>
            )}

            <div className="mt-4 text-center">
              <Link
                href="/login"
                className="text-xs text-metatron-accent hover:text-metatron-accent-hover transition-colors"
              >
                ← Back to sign in
              </Link>
            </div>
          </div>
        </CardHoverEffect>
      </div>
    </div>
  );
}
