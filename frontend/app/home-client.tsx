"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

type Role = "founder" | "investor" | "connector";

const ROLES: {
  id: Role;
  name: string;
  desc: string;
}[] = [
  { id: "founder", name: "Founder", desc: "Raise capital" },
  { id: "connector", name: "Connector", desc: "Facilitate deals" },
  { id: "investor", name: "Investor", desc: "Deploy capital" },
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
    <div className="relative z-10 w-full max-w-[520px] px-5 py-12 text-center">
      {/* Logo */}
      <img
        src="/metatron-logo.png"
        alt="metatron"
        className="mx-auto mb-10 h-[42px] w-auto"
      />

      {/* Hero */}
      <h1
        className="mb-3 text-[28px] font-bold leading-tight tracking-tight md:text-[36px]"
        style={{ color: "#e8e8ed" }}
      >
        The investor intelligence layer
      </h1>
      <p
        className="mx-auto mb-10 max-w-[400px] text-[15px] leading-relaxed"
        style={{ color: "#8888a0" }}
      >
        Eliminating information asymmetry between founders and capital —
        globally.
      </p>

      {/* Role label */}
      <p
        className="mb-4 text-left font-mono text-[10px] uppercase tracking-[3px]"
        style={{ color: "#8888a0" }}
      >
        I am a
      </p>

      {/* Role cards */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {ROLES.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setSelected(r.id)}
            className="rounded-[12px] px-4 py-6 text-center transition-all duration-200"
            style={{
              background: "#16161f",
              border:
                selected === r.id
                  ? "1px solid rgba(108,92,231,0.6)"
                  : "1px solid rgba(255,255,255,0.06)",
              boxShadow:
                selected === r.id
                  ? "0 0 32px rgba(108,92,231,0.15)"
                  : "none",
            }}
          >
            <div
              className="mb-2 font-mono text-[10px] uppercase tracking-[3px]"
              style={{ color: "#6c5ce7" }}
            >
              {r.id}
            </div>
            <div
              className="mb-1 text-[15px] font-semibold"
              style={{ color: "#e8e8ed" }}
            >
              {r.name}
            </div>
            <div className="text-xs" style={{ color: "#8888a0" }}>
              {r.desc}
            </div>
          </button>
        ))}
      </div>

      {/* CTA */}
      {selectRoleMode && (
        <button
          type="button"
          disabled={!selected || loading}
          onClick={onContinueOAuthRole}
          className="mb-6 rounded-[12px] px-8 py-3 text-sm font-semibold text-white transition-colors disabled:opacity-40"
          style={{ background: "#6c5ce7" }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "#7d6ff0";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "#6c5ce7";
          }}
        >
          {loading ? "Saving…" : "Continue →"}
        </button>
      )}

      {/* Footer copy */}
      <p className="text-[13px]" style={{ color: "rgba(136,136,160,0.6)" }}>
        {selectRoleMode
          ? "One last step — select your role on the platform."
          : "Sign up is invite-only. Use your invitation link to create an account, or sign in if you already have one."}
      </p>
    </div>
  );
}

export default function HomeClient() {
  return (
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden"
      style={{ background: "#0a0a0f" }}
    >
      {/* Grid background */}
      <div className="grid-bg absolute inset-0 opacity-40" />

      {/* Purple orb */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 55% at 50% 25%, rgba(108,92,231,0.18) 0%, transparent 70%)",
        }}
      />

      <Suspense
        fallback={
          <div className="relative z-10 px-5 py-12 text-center">
            <p className="text-[13px]" style={{ color: "rgba(136,136,160,0.6)" }}>
              Loading…
            </p>
          </div>
        }
      >
        <HomePageContent />
      </Suspense>
    </div>
  );
}
