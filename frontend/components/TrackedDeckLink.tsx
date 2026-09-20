"use client";

import { API_BASE } from "@/lib/api";
import { getAccessToken } from "@/lib/tokenStore";

export function TrackedDeckLink({
  startupUserId,
  href,
  className,
  children,
}: {
  startupUserId: string;
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  function trackView() {
    const token = getAccessToken();
    fetch(`${API_BASE}/deck-views/${startupUserId}`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      keepalive: true,
    }).catch(() => {
      /* view tracking is best-effort, never block the link */
    });
  }

  return (
    <a href={href} target="_blank" rel="noreferrer" className={className} onClick={trackView}>
      {children}
    </a>
  );
}
