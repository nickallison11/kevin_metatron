"use client";

import { AnimatedGridPattern } from "@/components/ui/animated-grid-pattern";
import { CardHoverEffect } from "@/components/ui/card-hover-effect";
import { API_BASE } from "@/lib/api";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    if (!token.trim()) {
      setError("Invalid or expired reset link");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: password }),
      });
      const text = await res.text();
      if (!res.ok) {
        setError(text.trim() || "Invalid or expired reset link");
        return;
      }
      setSuccess(true);
    } catch {
      setError("Invalid or expired reset link");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative z-[1] w-full max-w-sm space-y-4">
      <CardHoverEffect layoutId="metatron-reset-password-hover">
        <div className="w-full rounded-metatron border border-[var(--border)] bg-[var(--bg-card)] p-6">
          <div className="mb-4">
            <h1 className="text-xl font-semibold text-[var(--text)]">
              Set new password
            </h1>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Choose a new password for your account.
            </p>
          </div>

          {success ? (
            <div className="space-y-4">
              <p className="text-sm text-[var(--text)]">Password updated</p>
              <Link
                href="/login"
                className="inline-block text-sm text-metatron-accent hover:text-metatron-accent-hover transition-colors"
              >
                Back to sign in →
              </Link>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <label className="block text-sm space-y-1 text-[var(--text)]">
                <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                  New password
                </span>
                <input
                  className="input-metatron w-full"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  required
                  minLength={8}
                  disabled={loading}
                />
              </label>
              <label className="block text-sm space-y-1 text-[var(--text)]">
                <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                  Confirm password
                </span>
                <input
                  className="input-metatron w-full"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  type="password"
                  required
                  minLength={8}
                  disabled={loading}
                />
              </label>
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-metatron-accent py-2.5 text-sm font-semibold text-white hover:bg-metatron-accent-hover hover:shadow-[0_4px_20px_rgba(108,92,231,0.3)] transition-all disabled:opacity-60"
              >
                {loading ? "Updating…" : "Update password"}
              </button>
              {error && (
                <p className="text-xs text-[var(--text-muted)]">{error}</p>
              )}
            </form>
          )}
        </div>
      </CardHoverEffect>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="relative flex min-h-[calc(100vh-88px)] items-center justify-center px-5 py-10">
      <AnimatedGridPattern />
      <Suspense
        fallback={
          <div className="relative z-[1] w-full max-w-sm rounded-metatron border border-[var(--border)] bg-[var(--bg-card)] p-6 text-sm text-[var(--text-muted)]">
            Loading…
          </div>
        }
      >
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
