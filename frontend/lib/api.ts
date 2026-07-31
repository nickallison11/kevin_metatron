import { getAccessToken, getRefreshToken, refreshAccessToken } from "@/lib/tokenStore";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export function authJsonHeaders(token: string | null): HeadersInit {
  const h: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export function authHeaders(token: string | null): HeadersInit {
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/**
 * Authenticated fetch with automatic refresh-and-retry on 401. `path` is
 * appended to `API_BASE`. Standard interceptor pattern: attach the current
 * access token, and if the server says it's expired, transparently refresh
 * once (deduped — see `refreshAccessToken` in tokenStore.ts) and retry the
 * same request with the new token before giving up.
 *
 * If the refresh itself fails (expired/revoked/idle-timed-out refresh
 * token), `refreshAccessToken` has already cleared tokens and fired
 * `AUTH_CHANGED_EVENT` — anything using `useAuth()` picks that up and
 * redirects to /login on its own. This just returns the original 401 so
 * the caller doesn't act on stale data while that redirect lands.
 */
export async function apiFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const attempt = (token: string | null) =>
    fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { ...options.headers, ...authHeaders(token) },
    });

  const res = await attempt(getAccessToken());
  if (res.status !== 401 || !getRefreshToken()) return res;

  const refreshed = await refreshAccessToken();
  if (!refreshed) return res;

  return attempt(getAccessToken());
}
