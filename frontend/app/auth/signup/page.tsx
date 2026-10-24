"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import SignupFlow, { type SignupRole } from "@/components/onboarding/SignupFlow";

/** Same sign-up as the home page, opened on its own (e.g. from the login page). */
function SignupPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const r = params.get("role") ?? params.get("invite");
  const role: SignupRole | null = r === "investor" ? "investor" : r === "founder" ? "founder" : null;
  return <SignupFlow initialRole={role} referralCode={params.get("ref")?.trim() || null} onClose={() => router.push("/")} />;
}

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupPageInner />
    </Suspense>
  );
}
