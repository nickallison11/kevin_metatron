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
