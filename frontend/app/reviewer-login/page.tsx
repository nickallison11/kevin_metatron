"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { API_BASE } from "@/lib/api";
import { setReviewerSession } from "@/lib/reviewerToken";

function ReviewerLoginInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token");
  const returnTo = params.get("return_to");

  const [step, setStep] = useState<"loading" | "error" | "done">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError("No token found. Request a new sign-in link.");
      setStep("error");
      return;
    }
    fetch(`${API_BASE}/reviewer-accounts/consume?token=${encodeURIComponent(token)}`)
      .then((r) => {
        if (!r.ok) throw new Error("invalid or expired link");
        return r.json();
      })
      .then((data: { token: string; name: string | null; email: string }) => {
        setReviewerSession(data.token, data.name, data.email);
        setStep("done");
        setTimeout(() => router.replace(returnTo || "/startups"), 1200);
      })
      .catch(() => {
        setError("This link has expired or is invalid. Request a new one.");
        setStep("error");
      });
  }, [token, returnTo, router]);

  return (
    <main className="min-h-screen bg-[var(--bg)] flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-8 text-center">
        {step === "loading" && (
          <p className="text-sm text-[var(--text-muted)]">Signing you in…</p>
        )}
        {step === "done" && (
          <p className="text-sm text-[var(--text-muted)]">Signed in — redirecting…</p>
        )}
        {step === "error" && (
          <div>
            <h1 className="text-xl font-semibold text-[var(--text)] mb-2">Link expired</h1>
            <p className="text-sm text-[var(--text-muted)]">{error}</p>
          </div>
        )}
      </div>
    </main>
  );
}

export default function ReviewerLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center">
          <p className="text-sm text-[var(--text-muted)]">Loading…</p>
        </div>
      }
    >
      <ReviewerLoginInner />
    </Suspense>
  );
}
