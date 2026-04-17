"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE, authHeaders, authJsonHeaders } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { MeResponse } from "@/lib/me";

export default function ConnectorSettingsPage() {
  const router = useRouter();
  const { token, loading: authLoading } = useAuth("INTERMEDIARY");

  const [me, setMe] = useState<MeResponse | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [personalMsg, setPersonalMsg] = useState<string | null>(null);
  const [personalSaving, setPersonalSaving] = useState(false);

  const [emailCurrentPassword, setEmailCurrentPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [changeEmailMsg, setChangeEmailMsg] = useState<string | null>(null);
  const [changingEmail, setChangingEmail] = useState(false);

  const [pwCurrentPassword, setPwCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [changePasswordMsg, setChangePasswordMsg] = useState<string | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);

  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [twoFaMsg, setTwoFaMsg] = useState<string | null>(null);

  const [setupLoading, setSetupLoading] = useState(false);
  const [otpauthUri, setOtpauthUri] = useState<string | null>(null);
  const [confirmCode, setConfirmCode] = useState("");
  const [confirmLoading, setConfirmLoading] = useState(false);

  const [disableMode, setDisableMode] = useState(false);
  const [disableCode, setDisableCode] = useState("");
  const [disableLoading, setDisableLoading] = useState(false);

  const qrDataUrl = useMemo(() => {
    if (!otpauthUri) return null;
    return `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(
      otpauthUri
    )}&size=200x200`;
  }, [otpauthUri]);

  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  const roleBadgeText =
    me?.role === "STARTUP"
      ? "Founder"
      : me?.role === "INVESTOR"
        ? "Investor"
        : me?.role === "INTERMEDIARY"
          ? "Connector"
          : "";
  const tierBadgeText = me?.is_pro ? "Pro" : "Free";

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/me`, {
          headers: authHeaders(token),
        });
        if (!res.ok) return;
        const data = (await res.json()) as MeResponse;
        setMe(data);
        setFirstName(data.first_name ?? "");
        setLastName(data.last_name ?? "");
        setTwoFactorEnabled(Boolean(data.totp_enabled));
      } catch {
        // Keep UI usable even if `/auth/me` fails.
      }
    })();
  }, [token]);

  async function onChangeEmail(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setChangingEmail(true);
    setChangeEmailMsg(null);
    try {
      const res = await fetch(`${API_BASE}/auth/change-email`, {
        method: "PUT",
        headers: authJsonHeaders(token),
        body: JSON.stringify({
          current_password: emailCurrentPassword,
          new_email: newEmail,
        }),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(txt.trim() || "Could not change email");
      setChangeEmailMsg("Email updated.");
      setEmailCurrentPassword("");
      setNewEmail("");
    } catch (err) {
      setChangeEmailMsg(err instanceof Error ? err.message : "Could not change email");
    } finally {
      setChangingEmail(false);
    }
  }

  async function onChangePassword(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    if (newPassword !== confirmNewPassword) {
      setChangePasswordMsg("New passwords do not match.");
      return;
    }
    setChangingPassword(true);
    setChangePasswordMsg(null);
    try {
      const res = await fetch(`${API_BASE}/auth/change-password`, {
        method: "PUT",
        headers: authJsonHeaders(token),
        body: JSON.stringify({
          current_password: pwCurrentPassword,
          new_password: newPassword,
        }),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(txt.trim() || "Could not change password");
      setChangePasswordMsg("Password updated.");
      setPwCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
    } catch (err) {
      setChangePasswordMsg(
        err instanceof Error ? err.message : "Could not change password"
      );
    } finally {
      setChangingPassword(false);
    }
  }

  async function onSetup2fa() {
    if (!token) return;
    setSetupLoading(true);
    setTwoFaMsg(null);
    setOtpauthUri(null);
    setConfirmCode("");
    try {
      const res = await fetch(`${API_BASE}/auth/2fa/setup`, {
        method: "POST",
        headers: authHeaders(token),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any).error ?? "Could not set up 2FA");
      setOtpauthUri((data as any).otpauth_uri ?? null);
    } catch (err) {
      setTwoFaMsg(err instanceof Error ? err.message : "Could not set up 2FA");
    } finally {
      setSetupLoading(false);
    }
  }

  async function onConfirm2fa(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setConfirmLoading(true);
    setTwoFaMsg(null);
    try {
      const res = await fetch(`${API_BASE}/auth/2fa/confirm`, {
        method: "POST",
        headers: authJsonHeaders(token),
        body: JSON.stringify({ code: confirmCode }),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(txt.trim() || "Could not confirm 2FA");
      setTwoFactorEnabled(true);
      setOtpauthUri(null);
      setConfirmCode("");
      setTwoFaMsg("2FA enabled.");
      setDisableMode(false);
      setDisableCode("");
    } catch (err) {
      setTwoFaMsg(err instanceof Error ? err.message : "Could not confirm 2FA");
    } finally {
      setConfirmLoading(false);
    }
  }

  async function onDisable2fa(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setDisableLoading(true);
    setTwoFaMsg(null);
    try {
      const res = await fetch(`${API_BASE}/auth/2fa`, {
        method: "DELETE",
        headers: authJsonHeaders(token),
        body: JSON.stringify({ code: disableCode }),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(txt.trim() || "Could not disable 2FA");
      setTwoFactorEnabled(false);
      setOtpauthUri(null);
      setConfirmCode("");
      setDisableCode("");
      setDisableMode(false);
      setTwoFaMsg("2FA disabled.");
    } catch (err) {
      setTwoFaMsg(err instanceof Error ? err.message : "Could not disable 2FA");
    } finally {
      setDisableLoading(false);
    }
  }

  async function onSavePersonalDetails(e: FormEvent) {
    e.preventDefault();
    if (!token || !me) return;
    setPersonalSaving(true);
    setPersonalMsg(null);
    try {
      const res = await fetch(`${API_BASE}/auth/profile`, {
        method: "PUT",
        headers: authJsonHeaders(token),
        body: JSON.stringify({ first_name: firstName, last_name: lastName }),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(txt.trim() || "Could not save personal details");
      setPersonalMsg("Saved.");
      setMe((prev) =>
        prev
          ? {
              ...prev,
              first_name: firstName,
              last_name: lastName,
            }
          : prev
      );
    } catch (err) {
      setPersonalMsg(err instanceof Error ? err.message : "Could not save personal details");
    } finally {
      setPersonalSaving(false);
    }
  }

  async function onDeleteAccount() {
    if (!token) return;
    const ok = window.confirm(
      "Delete your account? This removes your profile, pitches, calls, and memories."
    );
    if (!ok) return;

    try {
      const res = await fetch(`${API_BASE}/auth/account`, {
        method: "DELETE",
        headers: authHeaders(token),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt.trim() || "Could not delete account");
      }
      window.localStorage.removeItem("metatron_token");
      router.push("/");
    } catch (err) {
      setTwoFaMsg(err instanceof Error ? err.message : "Could not delete account");
    }
  }

  if (authLoading || !me) {
    return (
      <main className="flex-1">
        <section className="p-6 md:p-10 max-w-2xl space-y-6">
          <p className="text-sm text-[var(--text-muted)]">Loading…</p>
        </section>
      </main>
    );
  }

  return (
    <main className="flex-1">
      <header className="border-b border-[var(--border)] px-6 py-4 md:px-10">
        <p className="font-sans text-[11px] font-medium uppercase tracking-[2px] text-[var(--text-muted)] mb-1">
          Settings
        </p>
        <h1 className="text-lg font-semibold">Account & security</h1>
        <div className="mt-3 space-y-1">
          <p className="text-xs text-[var(--text-muted)]">Signed in as</p>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-[var(--text)]">
              {me?.email}
            </p>
            {roleBadgeText ? (
              <span className="font-sans text-[10px] uppercase tracking-wider border border-[var(--border)] text-[var(--text-muted)] px-2 py-0.5 rounded">
                {roleBadgeText}
              </span>
            ) : null}
            <span
              className={[
                "font-sans text-[10px] uppercase tracking-wider border px-2 py-0.5 rounded",
                me?.is_pro
                  ? "border-metatron-accent/40 text-metatron-accent"
                  : "border-[var(--border)] text-[var(--text-muted)]",
              ].join(" ")}
            >
              {tierBadgeText}
            </span>
          </div>
          {fullName ? (
            <p className="text-xs text-[var(--text-muted)]">{fullName}</p>
          ) : null}
        </div>
      </header>

      <section className="p-6 md:p-10 max-w-2xl space-y-6">
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-6 space-y-5">
          <h2 className="text-sm font-semibold">Personal details</h2>

          <form onSubmit={onSavePersonalDetails} className="space-y-3 text-sm">
            <label className="block space-y-1">
              <span className="font-sans text-[11px] uppercase text-[var(--text-muted)]">
                First name
              </span>
              <input
                className="input-metatron w-full"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                type="text"
              />
            </label>
            <label className="block space-y-1">
              <span className="font-sans text-[11px] uppercase text-[var(--text-muted)]">
                Last name
              </span>
              <input
                className="input-metatron w-full"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                type="text"
              />
            </label>

            <button
              type="submit"
              disabled={personalSaving}
              className="rounded-lg bg-metatron-accent px-4 py-2 text-xs font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-60"
            >
              {personalSaving ? "Saving…" : "Save personal details"}
            </button>
            {personalMsg && (
              <p className="text-xs text-[var(--text-muted)]">{personalMsg}</p>
            )}
          </form>
        </div>

        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-6 space-y-5">
          <h2 className="text-sm font-semibold">Account</h2>

          <p className="text-xs text-[var(--text-muted)]">
            Current email:{" "}
            <span className="text-[var(--text)] font-semibold">
              {me.email}
            </span>
          </p>

          <form onSubmit={onChangeEmail} className="space-y-3 text-sm">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Change email
            </h3>
            <label className="block space-y-1">
              <span className="font-sans text-[11px] uppercase text-[var(--text-muted)]">
                Current password
              </span>
              <input
                className="input-metatron w-full"
                type="password"
                value={emailCurrentPassword}
                onChange={(e) => setEmailCurrentPassword(e.target.value)}
                required
              />
            </label>
            <label className="block space-y-1">
              <span className="font-sans text-[11px] uppercase text-[var(--text-muted)]">
                New email
              </span>
              <input
                className="input-metatron w-full"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                required
              />
            </label>
            <button
              type="submit"
              disabled={changingEmail}
              className="rounded-lg bg-metatron-accent px-4 py-2 text-xs font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-60"
            >
              {changingEmail ? "Updating…" : "Update email"}
            </button>
            {changeEmailMsg && (
              <p className="text-xs text-[var(--text-muted)]">{changeEmailMsg}</p>
            )}
          </form>

          <div className="h-px bg-[var(--border)]" />

          <form onSubmit={onChangePassword} className="space-y-3 text-sm">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Change password
            </h3>
            <label className="block space-y-1">
              <span className="font-sans text-[11px] uppercase text-[var(--text-muted)]">
                Current password
              </span>
              <input
                className="input-metatron w-full"
                type="password"
                value={pwCurrentPassword}
                onChange={(e) => setPwCurrentPassword(e.target.value)}
                required
              />
            </label>
            <label className="block space-y-1">
              <span className="font-sans text-[11px] uppercase text-[var(--text-muted)]">
                New password
              </span>
              <input
                className="input-metatron w-full"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
            </label>
            <label className="block space-y-1">
              <span className="font-sans text-[11px] uppercase text-[var(--text-muted)]">
                Confirm new password
              </span>
              <input
                className="input-metatron w-full"
                type="password"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                required
              />
            </label>
            <button
              type="submit"
              disabled={changingPassword}
              className="rounded-lg bg-metatron-accent px-4 py-2 text-xs font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-60"
            >
              {changingPassword ? "Updating…" : "Update password"}
            </button>
            {changePasswordMsg && (
              <p className="text-xs text-[var(--text-muted)]">{changePasswordMsg}</p>
            )}
          </form>
        </div>

        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-6 space-y-5">
          <h2 className="text-sm font-semibold">Two-factor authentication</h2>

          {!twoFactorEnabled ? (
            <div className="space-y-4">
              <p className="text-xs text-[var(--text-muted)]">
                Add a one-time code from your authenticator app to secure logins.
              </p>
              <button
                type="button"
                onClick={onSetup2fa}
                disabled={setupLoading}
                className="rounded-lg bg-metatron-accent px-4 py-2 text-xs font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-60"
              >
                {setupLoading ? "Preparing…" : "Set up authenticator app"}
              </button>

              {qrDataUrl && (
                <div className="flex items-start gap-5">
                  <img
                    src={qrDataUrl}
                    alt="2FA QR code"
                    className="w-[200px] h-[200px] rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2"
                  />
                  <form onSubmit={onConfirm2fa} className="flex-1 space-y-3 text-sm">
                    <label className="block space-y-1">
                      <span className="font-sans text-[11px] uppercase text-[var(--text-muted)]">
                        6-digit code
                      </span>
                      <input
                        className="input-metatron w-full"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={6}
                        value={confirmCode}
                        onChange={(e) => setConfirmCode(e.target.value.replace(/[^0-9]/g, ""))}
                        required
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={confirmLoading || confirmCode.length !== 6}
                      className="rounded-lg bg-metatron-accent px-4 py-2 text-xs font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-60"
                    >
                      {confirmLoading ? "Confirming…" : "Enable 2FA"}
                    </button>
                    {twoFaMsg && (
                      <p className="text-xs text-[var(--text-muted)]">{twoFaMsg}</p>
                    )}
                  </form>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <span
                  className="inline-flex items-center rounded-full border px-3 py-1 text-xs"
                  style={{
                    borderColor: "rgba(34,197,94,0.35)",
                    backgroundColor: "rgba(34,197,94,0.12)",
                    color: "rgb(134,239,172)",
                  }}
                >
                  2FA enabled
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setDisableMode(true);
                    setDisableCode("");
                    setTwoFaMsg(null);
                  }}
                  className="rounded-lg bg-[rgba(239,68,68,0.15)] border border-[rgba(239,68,68,0.35)] px-4 py-2 text-xs font-semibold text-[rgb(254,202,202)] hover:bg-[rgba(239,68,68,0.2)]"
                >
                  Disable
                </button>
              </div>

              {disableMode && (
                <form onSubmit={onDisable2fa} className="space-y-3 text-sm">
                  <label className="block space-y-1">
                    <span className="font-sans text-[11px] uppercase text-[var(--text-muted)]">
                      Current 6-digit code
                    </span>
                    <input
                      className="input-metatron w-full"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      value={disableCode}
                      onChange={(e) => setDisableCode(e.target.value.replace(/[^0-9]/g, ""))}
                      required
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={disableLoading || disableCode.length !== 6}
                    className="rounded-lg bg-[rgba(239,68,68,0.15)] border border-[rgba(239,68,68,0.35)] px-4 py-2 text-xs font-semibold text-[rgb(254,202,202)] hover:bg-[rgba(239,68,68,0.2)] disabled:opacity-60"
                  >
                    {disableLoading ? "Disabling…" : "Disable 2FA"}
                  </button>
                  {twoFaMsg && (
                    <p className="text-xs text-[var(--text-muted)]">{twoFaMsg}</p>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setDisableMode(false);
                      setDisableCode("");
                      setTwoFaMsg(null);
                    }}
                    className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
                  >
                    Cancel
                  </button>
                </form>
              )}
            </div>
          )}
        </div>

        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] p-6 space-y-5">
          <h2 className="text-sm font-semibold">Danger zone</h2>

          <button
            type="button"
            onClick={onDeleteAccount}
            className="rounded-lg bg-[rgba(239,68,68,0.15)] border border-[rgba(239,68,68,0.35)] px-4 py-2 text-sm font-semibold text-[rgb(254,202,202)] hover:bg-[rgba(239,68,68,0.2)]"
          >
            Delete account
          </button>

          {twoFaMsg && (
            <p className="text-xs text-[var(--text-muted)] border-t border-[var(--border)] pt-3">
              {twoFaMsg}
            </p>
          )}
        </div>
      </section>
    </main>
  );
}

