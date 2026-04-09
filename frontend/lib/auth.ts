"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";

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

function decodeJwtRole(token: string): string | null {
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
    const token = window.localStorage.getItem("metatron_token");
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

    fetch(`${API_BASE}/subscriptions/status`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (
          data: {
            subscription_status?: string;
            subscription_tier?: string;
          } | null,
        ) => {
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
            token,
            isPro: active,
            isBasic,
            isProTier,
            loading: false,
          });
        },
      )
      .catch(() => {
        setState({
          token,
          isPro: false,
          isBasic: false,
          isProTier: false,
          loading: false,
        });
      });
  }, [router, requiredRole]);

  return { ...state, role };
}
