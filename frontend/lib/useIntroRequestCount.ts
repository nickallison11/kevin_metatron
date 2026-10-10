"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { API_BASE, authHeaders } from "@/lib/api";

type ReceivedIntroState = { intro_accepted_at: string | null; intro_passed_at: string | null };

/**
 * Intro requests still waiting on this user (neither accepted nor passed),
 * for the badge on the Matches nav item. Refreshes on navigation so the
 * badge drops after the user accepts or passes on the Matches page.
 */
export function useIntroRequestCount(token: string | null): number {
  const [count, setCount] = useState(0);
  const pathname = usePathname();

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch(`${API_BASE}/kevin-matches/received-intros`, { headers: authHeaders(token) })
      .then((r) => (r.ok ? (r.json() as Promise<ReceivedIntroState[]>) : []))
      .then((rows) => {
        if (!cancelled) setCount(rows.filter((r) => !r.intro_accepted_at && !r.intro_passed_at).length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [token, pathname]);

  return count;
}
