// Where to go after signing in, when a page sent the user to /login first
// (e.g. an AI app asking to connect to Kevin). Kept for this tab only.
const KEY = "metatron_after_login";

/** Remember the current page to come back to after login. */
export function rememberAfterLogin(path: string): void {
  try {
    sessionStorage.setItem(KEY, path);
  } catch {
    /* storage blocked: the user lands on their dashboard instead */
  }
}

/** The remembered page, once; only paths on this site. */
export function takeAfterLogin(): string | null {
  try {
    const path = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return path && path.startsWith("/") && !path.startsWith("//") ? path : null;
  } catch {
    return null;
  }
}
