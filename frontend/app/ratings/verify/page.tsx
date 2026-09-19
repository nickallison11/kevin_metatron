"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { API_BASE } from "@/lib/api";

function VerifyReviewInner() {
  const params = useSearchParams();
  const token = params.get("token");
  const [step, setStep] = useState<"loading" | "done" | "error">("loading");

  useEffect(() => {
    if (!token) {
      setStep("error");
      return;
    }
    fetch(`${API_BASE}/ratings/verify`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((r) => setStep(r.ok ? "done" : "error"))
      .catch(() => setStep("error"));
  }, [token]);

  return (
    <main className="min-h-screen bg-[var(--bg)] flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-8 text-center">
        {step === "loading" && (
          <p className="text-sm text-[var(--text-muted)]">Confirming your review…</p>
        )}
        {step === "done" && (
          <div>
            <h1 className="text-xl font-semibold text-[var(--text)] mb-2">Thanks!</h1>
            <p className="text-sm text-[var(--text-muted)]">Your review has been confirmed.</p>
          </div>
        )}
        {step === "error" && (
          <div>
            <h1 className="text-xl font-semibold text-[var(--text)] mb-2">Link expired</h1>
            <p className="text-sm text-[var(--text-muted)]">
              This confirmation link is invalid or has expired.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

export default function VerifyReviewPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center">
          <p className="text-sm text-[var(--text-muted)]">Loading…</p>
        </div>
      }
    >
      <VerifyReviewInner />
    </Suspense>
  );
}
