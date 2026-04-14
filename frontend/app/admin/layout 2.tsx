"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { API_BASE, authHeaders } from "@/lib/api";
import AdminShell from "@/components/admin/AdminShell";
import { useAuth } from "@/lib/auth";
import type { MeResponse } from "@/lib/me";

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { token, loading: authLoading } = useAuth();
  const [gate, setGate] = useState<"loading" | "ok" | "denied">("loading");

  useEffect(() => {
    if (authLoading) return;
    if (!token) {
      router.replace("/login");
      setGate("denied");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/me`, {
          headers: authHeaders(token),
        });
        if (!res.ok) {
          if (!cancelled) {
            router.replace("/");
            setGate("denied");
          }
          return;
        }
        const data = (await res.json()) as MeResponse;
        if (cancelled) return;
        if (!data.is_admin) {
          router.replace("/");
          setGate("denied");
          return;
        }
        setGate("ok");
      } catch {
        if (!cancelled) {
          router.replace("/");
          setGate("denied");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, token, router]);

  if (authLoading || gate === "loading") {
    return (
      <div className="p-8 md:p-10">
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      </div>
    );
  }

  if (gate !== "ok") {
    return null;
  }

  return <AdminShell>{children}</AdminShell>;
}
