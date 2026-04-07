"use client";

import { AnimatedGridPattern } from "@/components/ui/animated-grid-pattern";
import { CardHoverEffect } from "@/components/ui/card-hover-effect";
import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function dashboardPathForRole(role: string | null): string {
  switch (role) {
    case "investor":
      return "/investor";
    case "connector":
      return "/connector";
    default:
      return "/startup";
  }
}

function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [consentGiven, setConsentGiven] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setResult(null);
    setConsentError(null);
    if (!consentGiven) {
      setConsentError(
        "You must agree to the Terms and Privacy notice before signing up.",
      );
      return;
    }
    const selectedRole =
      typeof window !== "undefined"
        ? window.sessionStorage.getItem("metatron_role")
        : null;
    const inviteRaw = searchParams.get("invite");
    const inviteCode = inviteRaw?.trim() || null;
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000"}/auth/register`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            password,
            ...(selectedRole ? { role: selectedRole } : {}),
            ...(inviteCode ? { invite_code: inviteCode } : {}),
          }),
        }
      );
      const text = await res.text();
      let data: { token?: string } = {};
      try {
        data = JSON.parse(text) as { token?: string };
      } catch {
        /* non-JSON error body */
      }
      if (!res.ok) {
        setResult(text.trim() || "Signup failed");
        return;
      }
      if (!data.token) {
        setResult("Signup failed: no token returned");
        return;
      }
      window.localStorage.setItem("metatron_token", data.token);
      router.push(dashboardPathForRole(selectedRole));
    } catch {
      setResult("Signup failed");
    }
  }

  return (
    <div className="relative flex min-h-[calc(100vh-88px)] items-center justify-center px-5 py-10">
      <AnimatedGridPattern />
      <CardHoverEffect
        layoutId="metatron-signup-card-hover"
        className="relative z-[1] w-full max-w-sm"
      >
      <form
        onSubmit={onSubmit}
        className="w-full space-y-4 rounded-metatron border border-[var(--border)] bg-[var(--bg-card)] p-6"
      >
        <h1 className="text-xl font-semibold text-[var(--text)]">
          Create account
        </h1>
        <label className="block text-sm space-y-1 text-[var(--text)]">
          <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
            Email
          </span>
          <input
            className="input-metatron w-full"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            required
          />
        </label>
        <label className="block text-sm space-y-1 text-[var(--text)]">
          <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
            Password
          </span>
          <input
            className="input-metatron w-full"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            required
          />
        </label>
        <label className="flex items-start gap-2 text-sm text-[var(--text-muted)]">
          <input
            type="checkbox"
            checked={consentGiven}
            onChange={(e) => {
              setConsentGiven(e.target.checked);
              if (e.target.checked) setConsentError(null);
            }}
            className="mt-0.5 h-4 w-4 rounded border border-metatron-accent bg-transparent accent-[var(--accent)]"
          />
          <span>
            I agree to the{" "}
            <a href="/terms" className="text-[var(--text)] hover:text-metatron-accent">
              Terms of Service
            </a>{" "}
            and{" "}
            <a href="/privacy" className="text-[var(--text)] hover:text-metatron-accent">
              Privacy Policy
            </a>
            , and I understand my conversations and call transcripts are processed by
            Google Gemini to power Kevin AI.
          </span>
        </label>
        <button
          type="submit"
          disabled={!consentGiven}
          className="w-full rounded-lg bg-metatron-accent py-2.5 text-sm font-semibold text-white hover:bg-metatron-accent-hover hover:shadow-[0_4px_20px_rgba(108,92,231,0.3)] transition-all disabled:opacity-60 disabled:hover:bg-metatron-accent disabled:hover:shadow-none"
        >
          Sign up
        </button>
        {consentError && (
          <p className="text-xs text-[var(--text-muted)]">{consentError}</p>
        )}
        {result && (
          <p className="text-xs text-[var(--text-muted)]">{result}</p>
        )}
      </form>
      </CardHoverEffect>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="relative flex min-h-[calc(100vh-88px)] items-center justify-center px-5 py-10">
          <AnimatedGridPattern />
          <p className="relative z-[1] text-sm text-[var(--text-muted)]">Loading…</p>
        </div>
      }
    >
      <SignupForm />
    </Suspense>
  );
}
