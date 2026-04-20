"use client";

import { CardHoverEffect } from "@/components/ui/card-hover-effect";
import Link from "next/link";
import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const OAUTH_SIGNUP_ENABLED = false;

function IconGoogle({ className }: { className?: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      className={className}
    >
      <path
        d="M21.6 12.27c0-.68-.06-1.2-.2-1.72H12v3.24h5.42c-.11.9-.7 2.25-2.05 3.16l-.02.12 2.97 2.3.21.02c1.95-1.8 3.07-4.45 3.07-7.12Z"
        fill="currentColor"
      />
      <path
        d="M12 22c2.7 0 4.97-.88 6.63-2.4l-3.15-2.44c-.86.58-2.02.99-3.48.99-2.61 0-4.82-1.74-5.61-4.14l-.11.01-3.07 2.38-.04.11A10 10 0 0 0 12 22Z"
        fill="currentColor"
      />
      <path
        d="M6.39 13.99A6 6 0 0 1 6 12c0-.69.12-1.35.34-1.99l-.01-.11L3.23 7.5l-.1.05A10 10 0 0 0 2 12c0 1.62.39 3.15 1.08 4.5l3.31-2.51Z"
        fill="currentColor"
      />
      <path
        d="M12 5.8c1.48 0 2.54.63 3.12 1.17l2.28-2.23C16.96 3.45 14.7 2 12 2A10 10 0 0 0 3.13 7.56l3.44 2.42C7.36 7.42 9.39 5.8 12 5.8Z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconLinkedin({ className }: { className?: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      className={className}
    >
      <path
        d="M4.98 3.5C4.98 4.88 3.88 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1 4.98 2.12 4.98 3.5ZM0.5 23.5H4.5V7.5H0.5V23.5ZM8.5 7.5H12.34V9.5h.05c.53-1 1.83-2.05 3.77-2.05 4.03 0 4.78 2.65 4.78 6.1v10H20.9v-9.02c0-2.15-.04-4.92-2.98-4.92-2.98 0-3.44 2.32-3.44 4.75v9.19H8.5V7.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconGithub({ className }: { className?: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      className={className}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.48 2 2 6.58 2 12.26c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49 0-.24-.01-.88-.01-1.72-2.78.62-3.37-1.38-3.37-1.38-.46-1.18-1.12-1.5-1.12-1.5-.92-.64.07-.63.07-.63 1.02.07 1.55 1.07 1.55 1.07.9 1.58 2.36 1.12 2.94.85.09-.67.35-1.12.63-1.38-2.22-.26-4.56-1.14-4.56-5.05 0-1.12.39-2.03 1.03-2.74-.1-.26-.45-1.32.1-2.75 0 0 .84-.28 2.75 1.05.8-.23 1.66-.34 2.52-.34.86 0 1.71.12 2.51.34 1.91-1.33 2.75-1.05 2.75-1.05.55 1.43.2 2.5.1 2.75.64.71 1.03 1.62 1.03 2.74 0 3.92-2.35 4.79-4.58 5.05.36.32.68.95.68 1.92 0 1.38-.01 2.5-.01 2.84 0 .27.18.6.69.49A10.06 10.06 0 0 0 22 12.26C22 6.58 17.52 2 12 2Z"
        fill="currentColor"
      />
    </svg>
  );
}

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

function InviteOnlyMessage() {
  return (
    <div className="relative flex min-h-[calc(100vh-88px)] items-center justify-center px-5 py-10">
      <CardHoverEffect
        layoutId="metatron-signup-card-hover"
        className="relative z-[1] w-full max-w-sm"
      >
        <div className="w-full space-y-4 rounded-metatron border border-[var(--border)] bg-[var(--bg-card)] p-6 text-center">
          <h1 className="text-xl font-semibold text-[var(--text)]">
            This platform is currently invite-only
          </h1>
          <p className="text-sm leading-relaxed text-[var(--text-muted)]">
            New accounts are created through invitation links only. Your link
            must include both the invite token and the secret code query
            parameters.
          </p>
          <Link
            href="/login"
            className="inline-flex w-full items-center justify-center rounded-lg border border-[var(--border)] py-2.5 text-sm font-semibold text-[var(--text)] transition-colors hover:border-metatron-accent/30"
          >
            Sign in
          </Link>
        </div>
      </CardHoverEffect>
    </div>
  );
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
    const inviteCode = searchParams.get("invite")?.trim() ?? "";
    const inviteSecret = searchParams.get("code")?.trim() ?? "";
    const referralCode = searchParams.get("ref")?.trim() ?? null;
    if (!inviteCode || !inviteSecret) {
      setResult("Missing invitation link. Use the full URL you were sent.");
      return;
    }
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000"}/auth/register`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            password,
            invite_code: inviteCode,
            invite_secret: inviteSecret,
            ...(selectedRole ? { role: selectedRole } : {}),
            ...(referralCode ? { referral_code: referralCode } : {}),
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
          <span className="font-sans text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
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
          <span className="font-sans text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
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
      {OAUTH_SIGNUP_ENABLED && (
        <>
          <div className="flex items-center gap-3 mt-4">
            <div className="flex-1 border-t border-[var(--border)]" />
            <span className="text-xs text-[var(--text-muted)]">or continue with</span>
            <div className="flex-1 border-t border-[var(--border)]" />
          </div>
          <div className="flex flex-col gap-2 mt-3">
            {[
              { provider: "google", label: "Continue with Google", Icon: IconGoogle },
              { provider: "linkedin", label: "Continue with LinkedIn", Icon: IconLinkedin },
              { provider: "github", label: "Continue with GitHub", Icon: IconGithub },
            ].map(({ provider, label, Icon }) => (
              <button
                key={provider}
                type="button"
                onClick={() => {
                  window.location.href = `${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000"}/auth/oauth/${provider}/authorize`;
                }}
                className="flex items-center justify-center gap-2 w-full rounded-lg border border-[var(--border)] py-2.5 text-sm font-semibold text-[var(--text)] hover:border-metatron-accent/30 transition-colors"
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
        </>
      )}
      </CardHoverEffect>
    </div>
  );
}

function SignupGate() {
  const searchParams = useSearchParams();
  const hasInvite = Boolean(searchParams.get("invite")?.trim());
  const hasCode = Boolean(searchParams.get("code")?.trim());
  if (!hasInvite || !hasCode) {
    return <InviteOnlyMessage />;
  }
  return <SignupForm />;
}

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="relative flex min-h-[calc(100vh-88px)] items-center justify-center px-5 py-10">
          <p className="relative z-[1] text-sm text-[var(--text-muted)]">Loading…</p>
        </div>
      }
    >
      <SignupGate />
    </Suspense>
  );
}
