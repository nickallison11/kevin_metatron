"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

type Role = "founder" | "investor" | "connector";

const ROLES: {
  id: Role;
  label: string;
  tagline: string;
  description: string;
  features: string[];
  cta: string;
}[] = [
  {
    id: "founder",
    label: "FOUNDER",
    tagline: "Raise capital with AI on your side",
    description:
      "Kevin analyses your pitch, scores your investor readiness, and matches you with aligned investors — then sends warm introductions on your behalf.",
    features: [
      "Angel Score — AI-powered investor readiness assessment",
      "Pitch deck hosting — Secure link with 14-day free access",
      "Kevin AI matching — Matched to investors by stage, sector and thesis",
      "Warm introductions — Kevin facilitates intros on your behalf",
      "Call Intelligence — AI analysis of your investor conversations",
      "Kevin chat — Ask Kevin anything about your raise",
    ],
    cta: "Get started as a Founder",
  },
  {
    id: "connector",
    label: "CONNECTOR",
    tagline: "Grow your network's impact",
    description:
      "Import your contact network and let Kevin identify introduction opportunities — tracking every connection you facilitate.",
    features: [
      "Network management — Import and manage your contact network",
      "Intro facilitation — Connect founders with investors in your network",
      "Referral tracking — Track every introduction you've made",
      "metatron connect — Earn credits for enriching founder–investor connections",
    ],
    cta: "Get started as a Connector",
  },
  {
    id: "investor",
    label: "INVESTOR",
    tagline: "Kevin brings founders to you",
    description:
      "Instead of wading through inbound, Kevin curates a deal flow of founders aligned with your thesis — with transparent reasoning for every match.",
    features: [
      "Curated deal flow — Kevin-matched founders, not raw inbound",
      "Match reasoning — See exactly why Kevin surfaced each founder",
      "Pitch deck access — View decks directly in the platform",
      "Intro requests — Accept or decline founder introduction requests",
      "Call Intelligence — AI-powered notes from investor conversations",
    ],
    cta: "Get started as an Investor",
  },
];

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Build your profile",
    desc: "Founders add their pitch data, deck, and company details. Investors set their thesis. Connectors import their network.",
  },
  {
    step: "02",
    title: "Kevin analyses your data",
    desc: "Kevin uses AI to understand thesis alignment, stage fit, sector overlap, and founder readiness — building a match score for every pairing.",
  },
  {
    step: "03",
    title: "Warm introductions",
    desc: "Kevin sends introductions with his reasoning to both parties — via email, Telegram, or WhatsApp — so first contact is always warm and relevant.",
  },
];

// ─── OAuth role selector (compact, shown only in select_role=1 mode) ──────────

function OAuthRoleSelector() {
  const [selected, setSelected] = useState<Role | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  function dashboardPath(r: Role): string {
    if (r === "investor") return "/investor";
    if (r === "connector") return "/connector";
    return "/startup";
  }

  async function onContinue() {
    if (!selected) return;
    const oauthToken = window.sessionStorage.getItem("metatron_oauth_token");
    if (!oauthToken) return;
    setLoading(true);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
      const res = await fetch(`${apiBase}/auth/role`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${oauthToken}` },
        body: JSON.stringify({ role: selected }),
      });
      if (!res.ok) throw new Error();
      window.sessionStorage.removeItem("metatron_oauth_token");
      window.sessionStorage.removeItem("metatron_oauth_new");
      router.replace(dashboardPath(selected));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-72px)] items-center justify-center px-5 py-12">
      <div className="w-full max-w-[480px] text-center">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[3px] text-[var(--text-muted)]">
          One last step
        </p>
        <h1 className="mb-6 text-[24px] font-bold text-[var(--text)]">
          Select your role
        </h1>
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {ROLES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelected(r.id)}
              className="rounded-[12px] px-4 py-5 text-center transition-all duration-200"
              style={{
                background: "var(--bg-card)",
                border: selected === r.id
                  ? "1px solid rgba(108,92,231,0.6)"
                  : "1px solid var(--border)",
                boxShadow: selected === r.id ? "0 0 32px rgba(108,92,231,0.15)" : "none",
              }}
            >
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[3px] text-metatron-accent">
                {r.label}
              </div>
              <div className="text-[14px] font-semibold text-[var(--text)]">
                {r.label.charAt(0) + r.label.slice(1).toLowerCase()}
              </div>
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={!selected || loading}
          onClick={onContinue}
          className="rounded-[12px] bg-metatron-accent px-8 py-3 text-sm font-semibold text-white transition-colors hover:bg-metatron-accent-hover disabled:opacity-40"
        >
          {loading ? "Saving…" : "Continue →"}
        </button>
      </div>
    </div>
  );
}

// ─── Main landing page ────────────────────────────────────────────────────────

function LandingPage() {
  const [activeRole, setActiveRole] = useState<Role | null>(null);
  const router = useRouter();

  function startOnboarding(role: Role) {
    window.sessionStorage.setItem("metatron_role", role);
    router.push("/auth/signup");
  }

  return (
    <div className="relative">
      <div
        className="pointer-events-none absolute inset-0 -z-10 opacity-90"
        style={{
          background:
            "radial-gradient(ellipse 80% 40% at 50% calc(8% + 250px), rgba(108,92,231,0.22), transparent 60%)",
        }}
      />
      {/* ── Role sections ────────────────────────────────────────────────── */}
      <section id="roles" className="mx-auto max-w-5xl px-5 pt-[180px] pb-24">
        <p className="mb-2 text-center font-mono text-[10px] uppercase tracking-[4px] text-[var(--text-muted)]">
          Built for every participant
        </p>
        <h2 className="mb-12 text-center text-[28px] font-bold text-[var(--text)] md:text-[36px]">
          Choose your role
        </h2>

        <div className="flex flex-col gap-4">
          {ROLES.map((r) => {
            const isOpen = activeRole === r.id;
            return (
              <div
                key={r.id}
                className="rounded-[16px] transition-all duration-300"
                style={{
                  background: "var(--bg-card)",
                  border: isOpen
                    ? "1px solid rgba(108,92,231,0.4)"
                    : "1px solid var(--border)",
                  boxShadow: isOpen ? "0 0 40px rgba(108,92,231,0.1)" : "none",
                }}
              >
                {/* Card header */}
                <button
                  type="button"
                  onClick={() => setActiveRole(isOpen ? null : r.id)}
                  className="flex w-full items-center justify-between px-6 py-5 text-left"
                >
                  <div>
                    <p className="mb-1 font-mono text-[10px] uppercase tracking-[3px] text-metatron-accent">
                      {r.label}
                    </p>
                    <p className="text-[18px] font-semibold text-[var(--text)]">
                      {r.tagline}
                    </p>
                  </div>
                  <span
                    className="ml-4 shrink-0 text-lg text-metatron-accent transition-transform duration-200"
                    style={{ transform: isOpen ? "rotate(45deg)" : "none" }}
                  >
                    +
                  </span>
                </button>

                {/* Expanded content */}
                {isOpen && (
                  <div className="px-6 pb-6">
                    <div className="mb-4 border-t border-[var(--border)]" />
                    <p className="mb-5 text-[15px] leading-relaxed text-[var(--text-muted)]">
                      {r.description}
                    </p>
                    <ul className="mb-6 space-y-2.5">
                      {r.features.map((f) => (
                        <li key={f} className="flex items-start gap-3 text-[14px] text-[var(--text)]">
                          <span className="mt-0.5 shrink-0 font-mono text-[11px] text-metatron-accent">
                            ✦
                          </span>
                          {f}
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      onClick={() => startOnboarding(r.id)}
                      className="rounded-[12px] bg-metatron-accent px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-metatron-accent-hover"
                    >
                      {r.cta} →
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── How Kevin works ──────────────────────────────────────────────── */}
      <section className="px-5 py-24">
        <div className="mx-auto max-w-5xl">
          <p className="mb-2 text-center font-mono text-[10px] uppercase tracking-[4px] text-[var(--text-muted)]">
            The process
          </p>
          <h2 className="mb-14 text-center text-[28px] font-bold text-[var(--text)] md:text-[36px]">
            How Kevin works
          </h2>
          <div className="grid gap-6 md:grid-cols-3">
            {HOW_IT_WORKS.map((s) => (
              <div
                key={s.step}
                className="rounded-[16px] px-6 py-7"
                style={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--border)",
                }}
              >
                <p className="mb-3 font-mono text-[11px] uppercase tracking-[3px] text-metatron-accent">
                  {s.step}
                </p>
                <h3 className="mb-3 text-[17px] font-semibold text-[var(--text)]">
                  {s.title}
                </h3>
                <p className="text-[14px] leading-relaxed text-[var(--text-muted)]">
                  {s.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Bottom CTA ───────────────────────────────────────────────────── */}
      <section className="px-5 pt-20 pb-[196px] text-center">
        <div className="mx-auto max-w-[560px]">
          <h2 className="mb-4 text-[28px] font-bold text-[var(--text)] md:text-[36px]">
            Ready to connect?
          </h2>
          <p className="mb-8 text-[15px] leading-relaxed text-[var(--text-muted)]">
            metatron is currently invite-only. Use your invitation link to create an account,
            or sign in if you already have one.
          </p>
          <Link
            href="/login"
            className="rounded-[12px] bg-metatron-accent px-7 py-3 text-sm font-semibold text-white transition-colors hover:bg-metatron-accent-hover"
          >
            Sign in
          </Link>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="px-5 py-8">
        <div className="mx-auto flex max-w-5xl items-center justify-center gap-3">
          <img src="/metatron-logo.png" alt="metatron" className="h-[28px] w-auto opacity-70" />
          <p className="text-[12px] text-[var(--text-muted)]">
            © {new Date().getFullYear()} Metatron DAO (Pty) Ltd
          </p>
        </div>
      </footer>
    </div>
  );
}

// ─── Root export ─────────────────────────────────────────────────────────────

function HomePageContent() {
  const searchParams = useSearchParams();
  const selectRoleMode = searchParams.get("select_role") === "1";

  if (selectRoleMode) return <OAuthRoleSelector />;
  return <LandingPage />;
}

export default function HomeClient() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[calc(100vh-72px)] items-center justify-center">
          <p className="text-[13px] text-[var(--text-muted)]">Loading…</p>
        </div>
      }
    >
      <HomePageContent />
    </Suspense>
  );
}
