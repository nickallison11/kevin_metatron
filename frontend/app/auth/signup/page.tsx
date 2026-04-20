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
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}

function IconLinkedin({ className }: { className?: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path fill="#0A66C2" d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
    </svg>
  );
}

function IconGithub({ className }: { className?: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path fill="#ffffff" fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
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
