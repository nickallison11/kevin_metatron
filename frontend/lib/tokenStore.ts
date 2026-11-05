import { API_BASE } from "@/lib/api";

const TOKEN_KEY = "metatron_token";
/** Where the refresh token used to live; now only read once to move it into the cookie. */
const LEGACY_REFRESH_KEY = "metatron_refresh_token";

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

function getLegacyRefreshToken(): string | null {
  return window.localStorage.getItem(LEGACY_REFRESH_KEY);
}

/**
 * Stores the 20-minute access token. The refresh token is an HttpOnly cookie
 * the API sets on sign-in, so scripts on the page can't read it; every call
 * that signs in must send `credentials: "include"` for the cookie to stick.
 */
export function setAccessToken(accessToken: string): void {
  window.localStorage.setItem(TOKEN_KEY, accessToken);
  notifyChanged();
}

/**
 * Signs this device out server-side (fire-and-forget — logout should never
 * be blocked by a network error) and clears the access token locally.
 */
export function clearTokens(): void {
  const legacy = getLegacyRefreshToken();
  fetch(`${API_BASE}/auth/logout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(legacy ? { refresh_token: legacy } : {}),
    credentials: "include",
    keepalive: true,
  }).catch(() => {
    /* logout must succeed locally regardless of network state */
  });
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(LEGACY_REFRESH_KEY);
  notifyChanged();
}

/**
 * Exchanges the refresh cookie for a fresh access token (the API rotates the
 * cookie as it goes). Returns false (and clears tokens) if the session has
 * ended — expired, idle, signed out, or reused — and the caller should treat
 * that as "logged out" and redirect to /login.
 *
 * Refresh tokens are single-use/rotating server-side. If two callers in this
 * tab refreshed at once, the second would present an already-rotated token;
 * `inFlightRefresh` makes every caller in this tab share one request. (Two
 * tabs racing is handled by a short grace window on the server.)
 */
let inFlightRefresh: Promise<boolean> | null = null;

export async function refreshAccessToken(): Promise<boolean> {
  if (inFlightRefresh) return inFlightRefresh;
  inFlightRefresh = doRefresh();
  try {
    return await inFlightRefresh;
  } finally {
    inFlightRefresh = null;
  }
}

async function doRefresh(): Promise<boolean> {
  // A token from before the cookie is sent once; the API answers with the cookie.
  const legacy = getLegacyRefreshToken();
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(legacy ? { refresh_token: legacy } : {}),
      credentials: "include",
    });
    if (!res.ok) {
      clearTokens();
      return false;
    }
    const data = (await res.json()) as { token: string };
    window.localStorage.removeItem(LEGACY_REFRESH_KEY);
    setAccessToken(data.token);
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
    if (getAccessToken()) void refreshAccessToken();
  }, REFRESH_INTERVAL_MS);
  // Move a pre-cookie refresh token into the cookie straight away.
  if (getAccessToken() && getLegacyRefreshToken()) void refreshAccessToken();
}
