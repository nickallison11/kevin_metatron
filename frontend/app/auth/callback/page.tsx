"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

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
    case "STARTUP":
    default:
      return "/startup";
  }
}

function OAuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const token = searchParams.get("token");
    const newParam = searchParams.get("new");
    const isNew = newParam === "true";

    if (!token) {
      router.replace("/login?error=oauth_failed");
      return;
    }

    try {
      window.localStorage.setItem("metatron_token", token);
    } catch {
      router.replace("/login?error=oauth_failed");
      return;
    }

    if (isNew) {
      try {
        window.sessionStorage.setItem("metatron_oauth_token", token);
        window.sessionStorage.setItem("metatron_oauth_new", "true");
      } catch {
        router.replace("/login?error=oauth_failed");
        return;
      }
      router.replace("/?select_role=1");
      return;
    }

    const role = decodeRoleFromJwt(token);
    if (!role) {
      router.replace("/login?error=oauth_failed");
      return;
    }

    router.replace(dashboardPathForRole(role));
  }, [router, searchParams]);

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-72px)] px-5 py-10">
      <div className="w-full max-w-sm text-center rounded-metatron border border-[var(--border)] bg-[var(--bg-card)] p-6">
        <p className="text-[var(--text)] font-semibold">Signing you in…</p>
        <p className="text-xs text-[var(--text-muted)] mt-2">
          Please wait a moment.
        </p>
      </div>
    </div>
  );
}

export default function OAuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[calc(100vh-72px)] px-5 py-10">
          <div className="w-full max-w-sm text-center rounded-metatron border border-[var(--border)] bg-[var(--bg-card)] p-6">
            <p className="text-[var(--text)] font-semibold">Signing you in…</p>
          </div>
        </div>
      }
    >
      <OAuthCallbackContent />
    </Suspense>
  );
}

