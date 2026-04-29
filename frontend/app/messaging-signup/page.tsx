"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { API_BASE } from "@/lib/api";

export default function MessagingSignupPage() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token");

  const [step, setStep] = useState<"loading" | "set-password" | "error" | "done">("loading");
  const [error, setError] = useState<string | null>(null);
  const [jwt, setJwt] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("No token found. Message Kevin again to get a new link.");
      setStep("error");
      return;
    }
    fetch(`${API_BASE}/auth/messaging-signup?token=${encodeURIComponent(token)}`)
      .then((r) => {
        if (!r.ok) throw new Error("invalid or expired link");
        return r.json();
      })
      .then((data: { token?: string; role?: string }) => {
        setJwt(data.token ?? null);
        setRole(data.role ?? null);
        setStep("set-password");
      })
      .catch(() => {
        setError("This link has expired or is invalid. Message Kevin again to get a new one.");
        setStep("error");
      });
  }, [token]);

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    if (password !== confirm) return setError("Passwords do not match.");
    if (!jwt) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/auth/change-password`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({ current_password: "", new_password: password }),
      });
      if (!res.ok) throw new Error("Could not set password");
      window.localStorage.setItem("metatron_token", jwt);
      const dest =
        role === "INVESTOR" ? "/investor" : role === "INTERMEDIARY" ? "/connector" : "/startup";
      router.replace(dest);
    } catch {
      setError("Could not set password. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function skipPassword() {
    if (!jwt) return;
    window.localStorage.setItem("metatron_token", jwt);
    const dest =
      role === "INVESTOR" ? "/investor" : role === "INTERMEDIARY" ? "/connector" : "/startup";
    router.replace(dest);
  }

  return (
    <main className="min-h-screen bg-[var(--bg)] flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-8">
        <img src="/metatron-logo.png" alt="metatron" className="h-8 mb-6" />

        {step === "loading" && (
          <p className="text-sm text-[var(--text-muted)]">Verifying your link…</p>
        )}

        {step === "error" && (
          <div>
            <h1 className="text-xl font-semibold text-[var(--text)] mb-2">Link expired</h1>
            <p className="text-sm text-[var(--text-muted)]">{error}</p>
          </div>
        )}

        {step === "set-password" && (
          <div>
            <h1 className="text-xl font-semibold text-[var(--text)] mb-1">Set your password</h1>
            <p className="text-sm text-[var(--text-muted)] mb-6">
              Your account is ready. Set a password to log in from any device.
            </p>
            <form onSubmit={handleSetPassword} className="space-y-4">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[rgba(255,255,255,0.04)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[#6c5ce7]"
                  placeholder="Min. 8 characters"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Confirm password</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[rgba(255,255,255,0.04)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[#6c5ce7]"
                  placeholder="Repeat password"
                />
              </div>
              {error && <p className="text-xs text-red-400">{error}</p>}
              <button
                type="submit"
                disabled={saving}
                className="w-full rounded-xl bg-[#6c5ce7] py-2.5 text-sm font-semibold text-white hover:bg-[#7d6ff0] disabled:opacity-50"
              >
                {saving ? "Saving…" : "Set password & go to dashboard"}
              </button>
              <button
                type="button"
                onClick={skipPassword}
                className="w-full text-xs text-[var(--text-muted)] hover:text-[var(--text)] mt-1"
              >
                Skip for now — I&apos;ll set a password later
              </button>
            </form>
          </div>
        )}
      </div>
    </main>
  );
}
