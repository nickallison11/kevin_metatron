"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";

export type AuthState = {
  token: string | null;
  isPro: boolean;
  loading: boolean;
};

export function useAuth(): AuthState {
  const router = useRouter();
  const [state, setState] = useState<AuthState>({
    token: null,
    isPro: false,
    loading: true,
  });

  useEffect(() => {
    const token = window.localStorage.getItem("metatron_token");
    if (!token) {
      setState({ token: null, isPro: false, loading: false });
      router.replace("/login");
      return;
    }

    fetch(`${API_BASE}/subscriptions/status`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { subscription_status?: string } | null) => {
        setState({
          token,
          isPro: data?.subscription_status === "active",
          loading: false,
        });
      })
      .catch(() => {
        setState({ token, isPro: false, loading: false });
      });
  }, [router]);

  return state;
}
