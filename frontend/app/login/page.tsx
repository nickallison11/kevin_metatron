"use client";

import { CardHoverEffect } from "@/components/ui/card-hover-effect";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import { API_BASE } from "@/lib/api";

function decodeRoleFromJwt(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = parts[1];
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padLen = (4 - (base64.length % 4)) % 4;
    const normalized = base64 + "=".repeat(padLen);
    const json = atob(normalized);
    const parsed = JSON.parse(json) as { role?: unknown };
    return typeof parsed.role === "string" ? parsed.role : null;
  } catch {
    return null;
  }
}

function dashboardPathForRole(role: string | null | undefined): string {
  switch (role) {
    case "INVESTOR":
      return "/investor";
    case "INTERMEDIARY":
      return "/connector";
    default:
      return "/startup";
  }
}

function IconGoogle() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
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

function IconLinkedIn() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M4.98 3.5C4.98 4.88 3.88 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1 4.98 2.12 4.98 3.5ZM0.5 23.5H4.5V7.5H0.5V23.5ZM8.5 7.5H12.34V9.5h.05c.53-1 1.83-2.05 3.77-2.05 4.03 0 4.78 2.65 4.78 6.1v10H20.9v-9.02c0-2.15-.04-4.92-2.98-4.92-2.98 0-3.44 2.32-3.44 4.75v9.19H8.5V7.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconGithub() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.48 2 2 6.58 2 12.26c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49 0-.24-.01-.88-.01-1.72-2.78.62-3.37-1.38-3.37-1.38-.46-1.18-1.12-1.5-1.12-1.5-.92-.64.07-.63.07-.63 1.02.07 1.55 1.07 1.55 1.07.9 1.58 2.36 1.12 2.94.85.09-.67.35-1.12.63-1.38-2.22-.26-4.56-1.14-4.56-5.05 0-1.12.39-2.03 1.03-2.74-.1-.26-.45-1.32.1-2.75 0 0 .84-.28 2.75 1.05.8-.23 1.66-.34 2.52-.34.86 0 1.71.12 2.51.34 1.91-1.33 2.75-1.05 2.75-1.05.55 1.43.2 2.5.1 2.75.64.71 1.03 1.62 1.03 2.74 0 3.92-2.35 4.79-4.58 5.05.36.32.68.95.68 1.92 0 1.38-.01 2.5-.01 2.84 0 .27.18.6.69.49A10.06 10.06 0 0 0 22 12.26C22 6.58 17.52 2 12 2Z"
        fill="currentColor"
      />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [twoFaStep, setTwoFaStep] = useState(false);
  const [partialToken, setPartialToken] = useState<string | null>(null);
  const [twoFaCode, setTwoFaCode] = useState("");
  const [twoFaLoading, setTwoFaLoading] = useState(false);
  const [twoFaError, setTwoFaError] = useState<string | null>(null);
  const [oauthConsentGiven, setOauthConsentGiven] = useState(false);
  const [oauthConsentError, setOauthConsentError] = useState<string | null>(null);

  const socialButtons = useMemo(
    () => [
      { provider: "google", label: "Continue with Google", Icon: IconGoogle },
      {
        provider: "linkedin",
        label: "Continue with LinkedIn",
        Icon: IconLinkedIn,
      },
      { provider: "github", label: "Continue with GitHub", Icon: IconGithub },
    ],
    [],
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const text = await res.text();
      let data: { token?: string } = {};
      try {
        data = JSON.parse(text) as { token?: string };
      } catch {
        // ignore non-json errors
      }

      if (res.ok && (data as any).requires_2fa && (data as any).partial_token) {
        setTwoFaStep(true);
        setPartialToken((data as any).partial_token as string);
        setTwoFaCode("");
        setTwoFaError(null);
        setError(null);
        return;
      }

      if (!res.ok || !(data as any).token) {
        setError(text.trim() || "Login failed");
        return;
      }

      window.localStorage.setItem("metatron_token", (data as any).token);
      const role = decodeRoleFromJwt((data as any).token);
      router.push(dashboardPathForRole(role));
    } catch {
      setError("Login failed");
    } finally {
      setLoading(false);
    }
  }

  async function onConfirm2fa(e: FormEvent) {
    e.preventDefault();
    if (!partialToken) return;
    setTwoFaError(null);
    setTwoFaLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/2fa/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partial_token: partialToken, code: twoFaCode }),
      });

      const text = await res.text();
      let data: { token?: string } = {};
      try {
        data = JSON.parse(text) as { token?: string };
      } catch {
        // ignore non-json errors
      }

      if (!res.ok || !data.token) {
        setTwoFaError(text.trim() || "Verification failed");
        return;
      }

      window.localStorage.setItem("metatron_token", data.token);
      const role = decodeRoleFromJwt(data.token);
      router.push(dashboardPathForRole(role));
    } catch {
      setTwoFaError("Verification failed");
    } finally {
      setTwoFaLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-[calc(100vh-88px)] items-center justify-center px-5 py-10">
      <div className="relative z-[1] w-full max-w-sm space-y-4">
        <CardHoverEffect layoutId="metatron-login-card-hover">
        <div className="w-full rounded-metatron border border-[var(--border)] bg-[var(--bg-card)] p-6">
          {!twoFaStep ? (
            <>
              <div className="mb-4">
                <h1 className="text-xl font-semibold text-[var(--text)]">
                  Sign in
                </h1>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  Use OAuth or email/password
                </p>
              </div>

              <div className="space-y-3">
                <label className="flex items-start gap-2 text-sm text-[var(--text-muted)]">
                  <input
                    type="checkbox"
                    checked={oauthConsentGiven}
                    onChange={(e) => {
                      setOauthConsentGiven(e.target.checked);
                      if (e.target.checked) setOauthConsentError(null);
                    }}
                    className="mt-0.5 h-4 w-4 rounded border border-metatron-accent bg-transparent accent-[var(--accent)]"
                  />
                  <span>
                    By continuing with OAuth, I agree to the{" "}
                    <a
                      href="/terms"
                      className="text-[var(--text)] hover:text-metatron-accent"
                    >
                      Terms of Service
                    </a>{" "}
                    and{" "}
                    <a
                      href="/privacy"
                      className="text-[var(--text)] hover:text-metatron-accent"
                    >
                      Privacy Policy
                    </a>
                    .
                  </span>
                </label>
                {socialButtons.map(({ provider, label, Icon }) => (
                  <button
                    key={provider}
                    type="button"
                    disabled={!oauthConsentGiven}
                    onClick={() => {
                      if (!oauthConsentGiven) {
                        setOauthConsentError(
                          "You must agree to the Terms and Privacy notice before using OAuth.",
                        );
                        return;
                      }
                      setOauthConsentError(null);
                      window.location.href = `${API_BASE}/auth/oauth/${provider}/authorize`;
                    }}
                    className="w-full inline-flex items-center justify-center gap-3 rounded-lg border border-[var(--border)] bg-transparent px-4 py-2.5 text-sm font-semibold text-[var(--text)] hover:border-metatron-accent/30 hover:shadow-[0_0_24px_rgba(108,92,231,0.08)] transition-all disabled:opacity-60 disabled:hover:border-[var(--border)] disabled:hover:shadow-none"
                  >
                    <Icon />
                    {label}
                  </button>
                ))}
                {oauthConsentError && (
                  <p className="text-xs text-[var(--text-muted)]">
                    {oauthConsentError}
                  </p>
                )}
              </div>

              <div className="mt-4 flex items-center gap-3">
                <div className="h-px flex-1 bg-[var(--border)]" />
                <div className="text-xs text-[var(--text-muted)]">or</div>
                <div className="h-px flex-1 bg-[var(--border)]" />
              </div>

              <form onSubmit={onSubmit} className="mt-4 space-y-4">
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
                    disabled={loading}
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
                    disabled={loading}
                  />
                </label>
                <div className="text-right mt-1">
                  <Link
                    href="/auth/forgot-password"
                    className="text-xs text-[var(--text-muted)] hover:text-metatron-accent transition-colors"
                  >
                    Forgot password?
                  </Link>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-lg bg-metatron-accent py-2.5 text-sm font-semibold text-white hover:bg-metatron-accent-hover hover:shadow-[0_4px_20px_rgba(108,92,231,0.3)] transition-all disabled:opacity-60"
                >
                  {loading ? "Signing in…" : "Log in"}
                </button>

                {error && (
                  <p className="text-xs text-[var(--text-muted)]">{error}</p>
                )}
              </form>

              <p className="mt-4 text-center text-xs text-[var(--text-muted)]">
                New accounts require an invitation link.
              </p>
            </>
          ) : (
            <form onSubmit={onConfirm2fa} className="space-y-4">
              <div className="mb-2">
                <h1 className="text-xl font-semibold text-[var(--text)]">
                  Verify 2FA
                </h1>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  Enter the 6-digit code from your authenticator app.
                </p>
              </div>

              <label className="block text-sm space-y-1 text-[var(--text)]">
                <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                  6-digit code
                </span>
                <input
                  className="input-metatron w-full"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={twoFaCode}
                  onChange={(e) =>
                    setTwoFaCode(e.target.value.replace(/[^0-9]/g, ""))
                  }
                  required
                  disabled={twoFaLoading}
                />
              </label>

              <button
                type="submit"
                disabled={twoFaLoading || twoFaCode.length !== 6}
                className="w-full rounded-lg bg-metatron-accent py-2.5 text-sm font-semibold text-white hover:bg-metatron-accent-hover hover:shadow-[0_4px_20px_rgba(108,92,231,0.3)] transition-all disabled:opacity-60"
              >
                {twoFaLoading ? "Verifying…" : "Verify"}
              </button>

              {twoFaError && (
                <p className="text-xs text-[var(--text-muted)]">{twoFaError}</p>
              )}

              <button
                type="button"
                onClick={() => {
                  setTwoFaStep(false);
                  setPartialToken(null);
                  setTwoFaCode("");
                  setTwoFaError(null);
                }}
                className="w-full rounded-lg border border-[var(--border)] py-2.5 text-sm font-semibold text-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-60"
                disabled={twoFaLoading}
              >
                Back
              </button>
            </form>
          )}
        </div>
        </CardHoverEffect>
      </div>
    </div>
  );
}

