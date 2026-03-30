"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

function dashboardPathForRole(role: string | null): string {
  switch (role) {
    case "investor":
      return "/investor";
    case "connector":
      return "/connector";
    default:
      return "/startup";
  }
}

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [result, setResult] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setResult(null);
    const selectedRole =
      typeof window !== "undefined"
        ? window.sessionStorage.getItem("metatron_role")
        : null;
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000"}/auth/signup`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            password,
            ...(selectedRole ? { role: selectedRole } : {})
          })
        }
      );
      const text = await res.text();
      let data: { token?: string } = {};
      try {
        data = JSON.parse(text) as { token?: string };
      } catch {
        /* non-JSON error body */
      }
      if (!res.ok) {
        setResult(text.trim() || "Signup failed");
        return;
      }
      if (!data.token) {
        setResult("Signup failed: no token returned");
        return;
      }
      window.localStorage.setItem("metatron_token", data.token);
      router.push(dashboardPathForRole(selectedRole));
    } catch {
      setResult("Signup failed");
    }
  }

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-72px)] px-5 py-10">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 rounded-metatron border border-[var(--border)] bg-[var(--bg-card)] p-6"
      >
        <h1 className="text-xl font-semibold text-[var(--text)]">
          Create account
        </h1>
        <label className="block text-sm space-y-1 text-[var(--text)]">
          <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
            Email
          </span>
          <input
            className="input-metatron w-full"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            required
          />
        </label>
        <label className="block text-sm space-y-1 text-[var(--text)]">
          <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
            Password
          </span>
          <input
            className="input-metatron w-full"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            required
          />
        </label>
        <button
          type="submit"
          className="w-full rounded-lg bg-metatron-accent py-2.5 text-sm font-semibold text-white hover:bg-metatron-accent-hover hover:shadow-[0_4px_20px_rgba(108,92,231,0.3)] transition-all"
        >
          Sign up
        </button>
        {result && (
          <p className="text-xs text-[var(--text-muted)]">{result}</p>
        )}
      </form>
    </div>
  );
}
