"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export default function EmailPreviewPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const template = params.template as string;
  const userId = searchParams.get("userId");
  const [html, setHtml] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (template !== "founder-weekly-matches" || !userId) {
      setError(
        "Usage: /admin/email-preview/founder-weekly-matches?userId=<uuid>",
      );
      setLoading(false);
      return;
    }

    const token = typeof window !== "undefined"
      ? localStorage.getItem("token")
      : null;

    if (!token) {
      setError("Not authenticated. Please log in first.");
      setLoading(false);
      return;
    }

    fetch(`${API_BASE}/api/admin/users/${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error("Not admin or user not found");
        return r.json();
      })
      .then(() =>
        fetch(`/api/admin/email-preview-render`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ template, userId }),
        }),
      )
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.text();
      })
      .then(setHtml)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [template, userId]);

  if (loading) {
    return (
      <div style={{ padding: 40, color: "#e8e8ed", background: "#0a0a0f", minHeight: "100vh" }}>
        Loading preview...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 40, color: "#ff6b6b", background: "#0a0a0f", minHeight: "100vh" }}>
        {error}
      </div>
    );
  }

  return (
    <iframe
      srcDoc={html}
      style={{ width: "100%", height: "100vh", border: "none" }}
      title="Email preview"
    />
  );
}
