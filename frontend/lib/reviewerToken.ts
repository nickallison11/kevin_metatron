const REVIEWER_TOKEN_KEY = "metatron_reviewer_token";
const REVIEWER_NAME_KEY = "metatron_reviewer_name";
const REVIEWER_EMAIL_KEY = "metatron_reviewer_email";

/**
 * Separate storage from the platform `tokenStore` on purpose -- reviewer
 * tokens are a single 30-day JWT with no refresh pair, and must never be
 * picked up by the platform's background auto-refresh interval (which only
 * ever looks at the `metatron_token`/`metatron_refresh_token` keys).
 */
export function getReviewerToken(): string | null {
  return window.localStorage.getItem(REVIEWER_TOKEN_KEY);
}

export function setReviewerSession(token: string, name: string | null, email: string): void {
  window.localStorage.setItem(REVIEWER_TOKEN_KEY, token);
  if (name) window.localStorage.setItem(REVIEWER_NAME_KEY, name);
  window.localStorage.setItem(REVIEWER_EMAIL_KEY, email);
}

export function getReviewerEmail(): string | null {
  return window.localStorage.getItem(REVIEWER_EMAIL_KEY);
}

export function clearReviewerSession(): void {
  window.localStorage.removeItem(REVIEWER_TOKEN_KEY);
  window.localStorage.removeItem(REVIEWER_NAME_KEY);
  window.localStorage.removeItem(REVIEWER_EMAIL_KEY);
}
