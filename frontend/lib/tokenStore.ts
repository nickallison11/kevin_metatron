import { API_BASE } from "@/lib/api";

const TOKEN_KEY = "metatron_token";
const REFRESH_KEY = "metatron_refresh_token";

/**
 * Same-tab counterpart to the `storage` event (which only fires in *other*
 * tabs). Anything that reads the token reactively — AppShell, useAuth —
 * should listen for this so a silent refresh in this tab is picked up
 * immediately, without waiting for a remount.
 */
export const AUTH_CHANGED_EVENT = "metatron-auth-changed";

function notifyChanged() {
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

export function getAccessToken(): string | null {
  return window.localStorage.getItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return window.localStorage.getItem(REFRESH_KEY);
}

export function setTokenPair(accessToken: string, refreshToken: string): void {
  window.localStorage.setItem(TOKEN_KEY, accessToken);
  window.localStorage.setItem(REFRESH_KEY, refreshToken);
  notifyChanged();
}

/**
 * Revokes the refresh token server-side (fire-and-forget — logout should
 * never be blocked by a network error) and clears both tokens locally.
 */
export function clearTokens(): void {
  const refreshToken = getRefreshToken();
  if (refreshToken) {
    fetch(`${API_BASE}/auth/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
      keepalive: true,
    }).catch(() => {
      /* logout must succeed locally regardless of network state */
    });
  }
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_KEY);
  notifyChanged();
}

/**
 * Exchanges the stored refresh token for a fresh access + refresh pair.
 * Returns false (and clears tokens) if the refresh token is missing,
 * expired, revoked, or reused — the caller should treat that as "logged
 * out" and redirect to /login.
 */
export async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;

  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) {
      clearTokens();
      return false;
    }
    const data = (await res.json()) as { token: string; refresh_token: string };
    setTokenPair(data.token, data.refresh_token);
    return true;
  } catch {
    // Network hiccup — leave existing tokens in place and let the next
    // interval tick retry, rather than logging the user out.
    return false;
  }
}

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 min, well inside the 20-min access-token TTL
let autoRefreshStarted = false;

/**
 * Starts the background refresh timer once per page session. Safe to call
 * from multiple components — only the first call actually starts it.
 */
export function startAutoRefresh(): void {
  if (autoRefreshStarted) return;
  autoRefreshStarted = true;
  setInterval(() => {
    if (getRefreshToken()) void refreshAccessToken();
  }, REFRESH_INTERVAL_MS);
}
