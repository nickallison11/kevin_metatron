"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { AUTH_CHANGED_EVENT, getAccessToken } from "@/lib/tokenStore";

export type AuthState = {
  token: string | null;
  /** True when the user has an active paid subscription (any tier). */
  isPro: boolean;
  /**
   * True when subscription_tier is `basic` or `pro`, or legacy Basic billing (`monthly` / `annual`).
   */
  isBasic: boolean;
  /** True when subscription_tier is `pro` and subscription is active (private IPFS). */
  isProTier: boolean;
  loading: boolean;
};

export type UserRole = "STARTUP" | "INVESTOR" | "INTERMEDIARY";

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = parts[1];
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padLen = (4 - (base64.length % 4)) % 4;
    const normalized = base64 + "=".repeat(padLen);
    const json = atob(normalized);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function decodeJwtRole(token: string): string | null {
  const parsed = decodeJwtPayload(token);
  return typeof parsed?.role === "string" ? parsed.role : null;
}

/**
 * Extracts the user id (`sub` claim) from a JWT. Every metatron JWT shares
 * the same fixed header segment, so a per-user cache key must be derived
 * from the payload, not a prefix of the raw token string.
 */
export function decodeJwtSub(token: string): string | null {
  const parsed = decodeJwtPayload(token);
  return typeof parsed?.sub === "string" ? parsed.sub : null;
}

function dashboardPathForRole(role: string | null): string {
  if (role === "INVESTOR") return "/investor";
  if (role === "INTERMEDIARY") return "/connector";
  return "/startup";
}

export function useAuth(
  requiredRole?: UserRole,
): AuthState & { role: string | null } {
  const router = useRouter();
  const [state, setState] = useState<AuthState>({
    token: null,
    isPro: false,
    isBasic: false,
    isProTier: false,
    loading: true,
  });
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    function onAuthChanged() {
      const fresh = getAccessToken();
      if (!fresh) {
        setState((prev) => ({ ...prev, token: null, loading: false }));
        setRole(null);
        router.replace("/login");
        return;
      }
      setState((prev) => ({ ...prev, token: fresh }));
    }
    window.addEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
  }, [router]);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      setState({
        token: null,
        isPro: false,
        isBasic: false,
        isProTier: false,
        loading: false,
      });
      setRole(null);
      router.replace("/login");
      return;
    }

    const r = decodeJwtRole(token);
    setRole(r);

    if (requiredRole && r && r !== requiredRole) {
      router.replace(dashboardPathForRole(r));
      setState({
        token,
        isPro: false,
        isBasic: false,
        isProTier: false,
        loading: false,
      });
      return;
    }

    // Goes through apiFetch, not a raw fetch: a 401 here means the access
    // token has expired, and this is the very first authenticated call the
    // app makes on load — apiFetch transparently refreshes and retries, or
    // (if the refresh token itself is expired/revoked/idle-timed-out)
    // clears tokens and lets the AUTH_CHANGED_EVENT listener above redirect
    // to /login. Either way this resolves within one round-trip, instead of
    // silently rendering as "logged in" until the 5-minute background
    // refresh interval eventually notices.
    apiFetch("/subscriptions/status")
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (
          data: {
            subscription_status?: string;
            subscription_tier?: string;
          } | null,
        ) => {
          // getAccessToken() is re-read (not the `token` closed over above)
          // since apiFetch may have rotated it via a silent refresh, or
          // cleared it entirely if the session turned out to be dead.
          const current = getAccessToken();
          const active = data?.subscription_status === "active";
          const tier = (data?.subscription_tier ?? "free").toLowerCase();
          const isProTier = active && tier === "pro";
          const isBasic =
            active &&
            (tier === "basic" ||
              tier === "pro" ||
              tier === "monthly" ||
              tier === "annual");
          setState({
            token: current,
            isPro: active,
            isBasic,
            isProTier,
            loading: false,
          });
        },
      )
      .catch(() => {
        setState({
          token: getAccessToken(),
          isPro: false,
          isBasic: false,
          isProTier: false,
          loading: false,
        });
      });
  }, [router, requiredRole]);

  return { ...state, role };
}
