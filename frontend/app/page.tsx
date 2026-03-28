"use client";

import Link from "next/link";
import { useState } from "react";

type Role = "founder" | "investor" | "connector";

const ROLES: {
  id: Role;
  icon: string;
  name: string;
  desc: string;
}[] = [
  { id: "founder", icon: "🚀", name: "Founder", desc: "Raise capital" },
  { id: "investor", icon: "💼", name: "Investor", desc: "Deploy capital" },
  { id: "connector", icon: "🔗", name: "Connector", desc: "Facilitate deals" }
];

export default function HomePage() {
  const [selected, setSelected] = useState<Role | null>(null);

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-72px)] px-5 py-10">
      <div className="w-full max-w-[520px] text-center">
        <div className="mb-12">
          <div className="text-[40px] mb-4">🌍</div>
          <h1 className="text-[32px] md:text-[42px] font-bold text-[var(--text)] leading-tight tracking-tight mb-3">
            Welcome to <span className="text-metatron-accent">metatron</span>
          </h1>
          <p className="text-[15px] text-[var(--text-muted)] leading-relaxed max-w-[420px] mx-auto">
            The intelligence layer connecting founders, investors, and ecosystem
            partners globally.
          </p>
        </div>

        <p className="font-mono text-[11px] font-medium tracking-[2px] uppercase text-[var(--text-muted)] text-left mb-4">
          I am a
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
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
                  : ""
              ].join(" ")}
            >
              <span className="block text-[28px] mb-2.5">{r.icon}</span>
              <div className="text-[15px] font-semibold text-[var(--text)] mb-1">
                {r.name}
              </div>
              <div className="font-mono text-xs text-[var(--text-muted)] tracking-wide">
                {r.desc}
              </div>
            </button>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center items-center mb-4">
          <Link
            href="/auth/signup"
            onClick={() => {
              if (selected) {
                sessionStorage.setItem("metatron_role", selected);
              }
            }}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-metatron-accent text-white px-7 py-3 text-sm font-semibold hover:bg-metatron-accent-hover hover:shadow-[0_4px_20px_rgba(108,92,231,0.3)] transition-all"
          >
            Continue
          </Link>
        </div>

        <p className="text-[13px] text-[var(--text-muted)] opacity-60">
          Select your role to continue
        </p>
      </div>
    </div>
  );
}
