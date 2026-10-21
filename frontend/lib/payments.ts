import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";

/**
 * Whether paid plans can be bought right now. The backend's PAYMENTS_ENABLED
 * setting decides; until it answers this is `false`, so pay buttons never
 * flash on while payments are switched off.
 */
export function usePaymentsEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/commerce/config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { payments_enabled?: boolean } | null) => {
        if (!cancelled) setEnabled(d?.payments_enabled === true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return enabled;
}
