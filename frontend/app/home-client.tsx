"use client";

import { AuroraBackground } from "@/components/ui/aurora-background";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { TextGenerateEffect } from "@/components/ui/text-generate-effect";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

type Role = "founder" | "investor" | "connector";

const ROLES: {
  id: Role;
  icon: string;
  name: string;
  desc: string;
}[] = [
  { id: "founder", icon: "🚀", name: "Founder", desc: "Raise capital" },
  { id: "connector", icon: "🔗", name: "Connector", desc: "Facilitate deals" },
  { id: "investor", icon: "💼", name: "Investor", desc: "Deploy capital" },
];

function HomePageContent() {
  const [selected, setSelected] = useState<Role | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  const selectRoleMode = searchParams.get("select_role") === "1";

  function dashboardPathForSelectedRole(r: Role): string {
    switch (r) {
      case "investor":
        return "/investor";
      case "connector":
        return "/connector";
      default:
        return "/startup";
    }
  }

  async function onContinueOAuthRole() {
    if (!selected) return;

    const oauthToken = window.sessionStorage.getItem("metatron_oauth_token");
    if (!oauthToken) return;

    setLoading(true);
    try {
      const apiBase =
        process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

      const res = await fetch(`${apiBase}/auth/role`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${oauthToken}`,
        },
        body: JSON.stringify({ role: selected }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || "Failed to set role");
      }

      window.sessionStorage.removeItem("metatron_oauth_token");
      window.sessionStorage.removeItem("metatron_oauth_new");

      router.replace(dashboardPathForSelectedRole(selected));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-0 items-center justify-center px-5 py-10">
      <div className="w-full max-w-[520px] text-center">
        <div className="mb-12">
          <div className="mb-4 text-[40px]">🌍</div>
          <h1 className="mb-3 text-[32px] font-bold leading-tight tracking-tight text-[var(--text)] md:text-[42px]">
            <TextGenerateEffect
              words="Welcome to"
              className="inline text-[32px] font-bold md:text-[42px]"
            />
            <span className="text-metatron-accent"> metatron</span>
          </h1>
          <p className="mx-auto max-w-[420px] text-[15px] leading-relaxed text-[var(--text-muted)]">
            The intelligence layer connecting founders, investors, and ecosystem
            partners globally.
          </p>
        </div>

        <p className="mb-4 text-left font-mono text-[11px] font-medium uppercase tracking-[2px] text-[var(--text-muted)]">
          I am a
        </p>
        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {ROLES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelected(r.id)}
              className={[
                "rounded-metatron border px-4 py-6 text-center transition-all duration-250",
                "bg-[var(--bg-card)] border-[var(--border)]",
                "hover:border-metatron-accent/30 hover:shadow-[0_0_24px_rgba(108,92,231,0.08)] hover:-translate-y-0.5",
                selected === r.id
                  ? "border-metatron-accent shadow-[0_0_32px_rgba(108,92,231,0.12)]"
                  : "",
              ].join(" ")}
            >
              <span className="mb-2.5 block text-[28px]">{r.icon}</span>
              <div className="mb-1 text-[15px] font-semibold text-[var(--text)]">
                {r.name}
              </div>
              <div className="font-mono text-xs tracking-wide text-[var(--text-muted)]">
                {r.desc}
              </div>
            </button>
          ))}
        </div>

        <div className="mb-4 flex flex-col items-center justify-center gap-3 sm:flex-row">
          {selectRoleMode ? (
            <ShimmerButton
              type="button"
              disabled={!selected || loading}
              onClick={onContinueOAuthRole}
            >
              {loading ? "Saving…" : "Continue"}
            </ShimmerButton>
          ) : (
            <ShimmerButton
              href="/auth/signup"
              onClick={() => {
                if (selected) {
                  sessionStorage.setItem("metatron_role", selected);
                }
              }}
            >
              Continue
            </ShimmerButton>
          )}
        </div>

        <p className="text-[13px] text-[var(--text-muted)] opacity-60">
          {selectRoleMode
            ? "One last step — select your role on the platform."
            : "Select your role to continue"}
        </p>
      </div>
    </div>
  );
}

export default function HomeClient() {
  return (
    <AuroraBackground>
      <Suspense
        fallback={
          <div className="flex min-h-0 items-center justify-center px-5 py-10">
            <div className="w-full max-w-[520px] text-center">
              <p className="text-[13px] text-[var(--text-muted)] opacity-60">
                Loading…
              </p>
            </div>
          </div>
        }
      >
        <HomePageContent />
      </Suspense>
    </AuroraBackground>
  );
}
