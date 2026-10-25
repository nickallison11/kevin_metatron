"use client";

import { FormEvent, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { API_BASE, authHeaders, authJsonHeaders } from "@/lib/api";
import { clearTokens } from "@/lib/tokenStore";
import { useAuth } from "@/lib/auth";
import type { MeResponse } from "@/lib/me";
import { passwordMeetsRules } from "@/lib/passwordRules";
import { PasswordRules } from "@/components/PasswordRules";

type Tab = "account" | "security" | "notifications" | "listing" | "delete";

const card = "rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-card)] shadow-[var(--card-shadow)]";
const input =
  "w-full min-h-11 rounded-[10px] border border-[var(--overlay-12)] bg-[var(--bg)] px-3.5 py-2.5 text-sm text-[var(--text)] outline-none focus:border-metatron-accent";
const btn =
  "inline-flex min-h-10 items-center justify-center rounded-[10px] border border-[var(--overlay-12)] px-4 text-[13px] font-medium text-[var(--text)] hover:bg-[var(--overlay-4)] disabled:opacity-50";
const btnPrimary =
  "inline-flex min-h-10 items-center justify-center rounded-[10px] bg-metatron-accent px-4 text-[13px] font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-50";
const btnDanger =
  "inline-flex min-h-10 items-center justify-center rounded-[10px] border border-[var(--danger)] px-4 text-[13px] font-semibold text-[var(--danger)] hover:bg-[var(--danger)] hover:text-white disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-[var(--danger)]";

function Row({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-t border-[var(--border)] px-5 py-4 first:border-t-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-0.5">
        <strong className="text-sm">{title}</strong>
        {sub && <span className="text-[13px] text-[var(--text-muted)]">{sub}</span>}
      </div>
      {children}
    </div>
  );
}

function Switch({ on, label, disabled, onChange }: { on: boolean; label: string; disabled?: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors disabled:opacity-40 ${on ? "bg-metatron-accent" : "bg-[var(--overlay-12)]"}`}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : "translate-x-0"}`} />
    </button>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
      <span>{label}</span>
      {children}
    </label>
  );
}

/** A 6-digit authenticator code, or a 10-character backup code (dash optional). */
function isSecondFactorCode(code: string) {
  return /^[0-9]{6}$/.test(code) || code.replace(/-/g, "").length === 10;
}

function Note({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="status" className="text-[13px] text-[var(--text-muted)]">
      {text}
    </p>
  );
}

/**
 * Settings for every role: Account, Security, Notifications, (founders) Public
 * listing, and Delete account. `role` gates the founder-only tab and the auth
 * check; the pages under /startup, /investor and /connector render this.
 */
export function AccountSettings({ role }: { role: "STARTUP" | "INVESTOR" | "INTERMEDIARY" }) {
  const router = useRouter();
  const { token, loading: authLoading } = useAuth(role === "STARTUP" ? undefined : role);
  const [tab, setTab] = useState<Tab>("account");

  // The account menu links straight to a tab with ?tab=security etc.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "account" || t === "security" || t === "notifications" || t === "listing" || t === "delete") setTab(t);
  }, []);

  const [me, setMe] = useState<MeResponse | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [personalMsg, setPersonalMsg] = useState<string | null>(null);
  const [personalSaving, setPersonalSaving] = useState(false);

  const [editingEmail, setEditingEmail] = useState(false);
  const [emailCurrentPassword, setEmailCurrentPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [changeEmailMsg, setChangeEmailMsg] = useState<string | null>(null);
  const [changingEmail, setChangingEmail] = useState(false);

  const [editingPassword, setEditingPassword] = useState(false);
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
  const [setupSecret, setSetupSecret] = useState<string | null>(null);
  // Shown once, right after they're generated; the server keeps only hashes.
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [backupSaved, setBackupSaved] = useState(false);
  const [backupRemaining, setBackupRemaining] = useState<number | null>(null);
  const [regenMode, setRegenMode] = useState(false);
  const [regenCode, setRegenCode] = useState("");
  const [regenLoading, setRegenLoading] = useState(false);

  const [emailPrefsLoaded, setEmailPrefsLoaded] = useState(false);
  const [weeklyMatches, setWeeklyMatches] = useState(true);
  const [unsubscribedAll, setUnsubscribedAll] = useState(false);
  const [emailPrefsMsg, setEmailPrefsMsg] = useState<string | null>(null);
  const [emailPrefsSaving, setEmailPrefsSaving] = useState(false);

  const [publicListingLoaded, setPublicListingLoaded] = useState(false);
  const [isPubliclyListed, setIsPubliclyListed] = useState(true);
  const [publicListingMsg, setPublicListingMsg] = useState<string | null>(null);
  const [publicListingSaving, setPublicListingSaving] = useState(false);

  const [deleteText, setDeleteText] = useState("");
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const isFounder = role === "STARTUP";

  // Drawn in the browser: the otpauth URI carries the 2FA secret, so it must
  // never be sent to an outside QR service.
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  // Backup codes are shown only once: warn before leaving until they're saved.
  useEffect(() => {
    if (!backupCodes || backupSaved) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [backupCodes, backupSaved]);

  useEffect(() => {
    if (!otpauthUri) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(otpauthUri, { width: 200, margin: 1 })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setTwoFaMsg("Could not draw the QR code. Please try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [otpauthUri]);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/me`, { headers: authHeaders(token) });
        if (res.ok) {
          const data = (await res.json()) as MeResponse;
          setMe(data);
          setFirstName(data.first_name ?? "");
          setLastName(data.last_name ?? "");
          setTwoFactorEnabled(Boolean(data.totp_enabled));
          setBackupRemaining(data.backup_codes_remaining ?? 0);
        }
      } catch {
        // Keep the page usable even if /auth/me fails.
      }
      try {
        const epRes = await fetch(`${API_BASE}/subscriptions/email-preferences`, { headers: authHeaders(token) });
        if (epRes.ok) {
          const ep = await epRes.json();
          setWeeklyMatches(ep.weekly_matches ?? true);
          setUnsubscribedAll(ep.unsubscribed_all ?? false);
          setEmailPrefsLoaded(true);
        }
      } catch {
        // non-fatal
      }
      if (isFounder) {
        try {
          const profileRes = await fetch(`${API_BASE}/profile`, { headers: authHeaders(token) });
          if (profileRes.ok) {
            const profile = await profileRes.json();
            setIsPubliclyListed(profile.is_publicly_listed ?? true);
            setPublicListingLoaded(true);
          }
        } catch {
          // non-fatal
        }
      }
    })();
  }, [token, isFounder]);

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
      if (!res.ok) throw new Error(txt.trim() || "Could not save your name");
      setMe((prev) => (prev ? { ...prev, first_name: firstName, last_name: lastName } : prev));
      setEditingName(false);
      setPersonalMsg("Name saved.");
    } catch (err) {
      setPersonalMsg(err instanceof Error ? err.message : "Could not save your name");
    } finally {
      setPersonalSaving(false);
    }
  }

  async function onChangeEmail(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setChangingEmail(true);
    setChangeEmailMsg(null);
    try {
      const res = await fetch(`${API_BASE}/auth/change-email`, {
        method: "PUT",
        headers: authJsonHeaders(token),
        body: JSON.stringify({ current_password: emailCurrentPassword, new_email: newEmail }),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(txt.trim() || "Could not change email");
      setMe((prev) => (prev ? { ...prev, email: newEmail } : prev));
      setChangeEmailMsg("Email updated.");
      setEmailCurrentPassword("");
      setNewEmail("");
      setEditingEmail(false);
    } catch (err) {
      setChangeEmailMsg(err instanceof Error ? err.message : "Could not change email");
    } finally {
      setChangingEmail(false);
    }
  }

  async function onChangePassword(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    if (!passwordMeetsRules(newPassword)) {
      setChangePasswordMsg("Your new password doesn't meet the rules yet.");
      return;
    }
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
        body: JSON.stringify({ current_password: pwCurrentPassword, new_password: newPassword }),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(txt.trim() || "Could not change password");
      setChangePasswordMsg("Password updated.");
      setPwCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      setEditingPassword(false);
    } catch (err) {
      setChangePasswordMsg(err instanceof Error ? err.message : "Could not change password");
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
      const res = await fetch(`${API_BASE}/auth/2fa/setup`, { method: "POST", headers: authHeaders(token) });
      if (!res.ok) throw new Error((await res.text()).trim() || "Could not set up 2FA");
      const data = (await res.json().catch(() => ({}))) as { otpauth_uri?: string; secret?: string };
      setOtpauthUri(data.otpauth_uri ?? null);
      setSetupSecret(data.secret ?? null);
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
      if (!res.ok) throw new Error((await res.text()).trim() || "Could not confirm 2FA");
      const data = (await res.json().catch(() => ({}))) as { backup_codes?: string[] };
      setTwoFactorEnabled(true);
      setOtpauthUri(null);
      setSetupSecret(null);
      setConfirmCode("");
      showBackupCodes(data.backup_codes ?? []);
      setTwoFaMsg("Two-factor authentication is on. Save your backup codes before you leave this page.");
      setDisableMode(false);
      setDisableCode("");
    } catch (err) {
      setTwoFaMsg(err instanceof Error ? err.message : "Could not confirm 2FA");
    } finally {
      setConfirmLoading(false);
    }
  }

  function showBackupCodes(codes: string[]) {
    setBackupCodes(codes);
    setBackupSaved(false);
    setBackupRemaining(codes.length);
  }

  function backupCodesText(codes: string[]) {
    const lines = [
      "metatron two-factor backup codes",
      `Account: ${me?.email ?? ""}`,
      `Created: ${new Date().toISOString().slice(0, 10)}`,
      "",
      "Each code signs you in once if you can't use your authenticator app.",
      "",
      ...codes,
      "",
    ];
    return lines.join("\n");
  }

  async function copyBackupCodes() {
    if (!backupCodes) return;
    try {
      await navigator.clipboard.writeText(backupCodesText(backupCodes));
      setTwoFaMsg("Backup codes copied.");
    } catch {
      setTwoFaMsg("Couldn't copy. Use Download instead, or write the codes down.");
    }
  }

  function downloadBackupCodes() {
    if (!backupCodes) return;
    const url = URL.createObjectURL(new Blob([backupCodesText(backupCodes)], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "metatron-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onRegenerateBackupCodes(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setRegenLoading(true);
    setTwoFaMsg(null);
    try {
      const res = await fetch(`${API_BASE}/auth/2fa/backup-codes`, {
        method: "POST",
        headers: authJsonHeaders(token),
        body: JSON.stringify({ code: regenCode }),
      });
      if (!res.ok) throw new Error((await res.text()).trim() || "Could not create new backup codes");
      const data = (await res.json().catch(() => ({}))) as { backup_codes?: string[] };
      showBackupCodes(data.backup_codes ?? []);
      setRegenMode(false);
      setRegenCode("");
      setTwoFaMsg("New backup codes created. Your old ones no longer work.");
    } catch (err) {
      setTwoFaMsg(err instanceof Error ? err.message : "Could not create new backup codes");
    } finally {
      setRegenLoading(false);
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
      setBackupCodes(null);
      setBackupRemaining(0);
      setTwoFaMsg("Two-factor authentication is off.");
    } catch (err) {
      setTwoFaMsg(err instanceof Error ? err.message : "Could not disable 2FA");
    } finally {
      setDisableLoading(false);
    }
  }

  async function saveEmailPrefs(next: { weekly_matches: boolean; unsubscribed_all: boolean }, revert: () => void) {
    if (!token) return;
    setEmailPrefsSaving(true);
    setEmailPrefsMsg(null);
    try {
      const res = await fetch(`${API_BASE}/subscriptions/email-preferences`, {
        method: "PUT",
        headers: authJsonHeaders(token),
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error();
      setEmailPrefsMsg("Saved.");
    } catch {
      revert();
      setEmailPrefsMsg("Could not save preferences.");
    } finally {
      setEmailPrefsSaving(false);
    }
  }

  async function togglePublicListing() {
    if (!token) return;
    const next = !isPubliclyListed;
    setIsPubliclyListed(next);
    setPublicListingSaving(true);
    setPublicListingMsg(null);
    try {
      const res = await fetch(`${API_BASE}/profile/public-listing`, {
        method: "PUT",
        headers: authJsonHeaders(token),
        body: JSON.stringify({ is_publicly_listed: next }),
      });
      if (!res.ok) throw new Error();
      setPublicListingMsg("Saved.");
    } catch {
      setIsPubliclyListed(!next);
      setPublicListingMsg("Could not save preference.");
    } finally {
      setPublicListingSaving(false);
    }
  }

  async function onDeleteAccount() {
    if (!token || deleteText !== "DELETE") return;
    setDeleting(true);
    setDeleteMsg(null);
    try {
      const res = await fetch(`${API_BASE}/auth/account`, { method: "DELETE", headers: authHeaders(token) });
      if (!res.ok) throw new Error((await res.text()).trim() || "Could not delete account");
      clearTokens();
      router.push("/");
    } catch (err) {
      setDeleteMsg(err instanceof Error ? err.message : "Could not delete account");
      setDeleting(false);
    }
  }

  if (authLoading || !token || !me) {
    return (
      <main className="min-w-0 flex-1 p-6 md:p-10">
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      </main>
    );
  }

  const roleLabel = role === "STARTUP" ? "Founder" : role === "INVESTOR" ? "Investor" : "Connector";
  const plan = me.is_pro ? "Pro" : me.is_basic ? "Basic" : "Free";
  const fullName = [me.first_name, me.last_name].filter(Boolean).join(" ").trim();
  const tabs: [Tab, string][] = [
    ["account", "Account"],
    ["security", "Security"],
    ["notifications", "Notifications"],
    ...(isFounder ? ([["listing", "Public listing"]] as [Tab, string][]) : []),
    ["delete", "Delete account"],
  ];

  return (
    <main className="min-w-0 flex-1">
      <section className="mx-auto flex max-w-5xl flex-col gap-6 p-6 md:p-10">
        <header className="flex flex-col gap-1.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">Settings</span>
          <h1 className="text-[28px] font-semibold tracking-tight">Account &amp; security</h1>
          <p className="text-sm text-[var(--text-muted)]">
            {me.email} · {roleLabel} · {plan}
          </p>
        </header>

        <div className="flex flex-col gap-6 md:flex-row md:items-start">
          <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto md:w-48 md:shrink-0 md:flex-col">
            {tabs.map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-current={tab === id ? "page" : undefined}
                onClick={() => setTab(id)}
                className={`min-h-10 shrink-0 rounded-[10px] px-3 text-left text-sm ${
                  tab === id ? "bg-metatron-accent/15 font-semibold text-[var(--text)]" : "text-[var(--text-muted)] hover:bg-[var(--overlay-4)]"
                } ${id === "delete" ? "text-[var(--danger)]" : ""}`}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="flex min-w-0 flex-1 flex-col gap-4">
            {tab === "account" && (
              <>
                <section className={card}>
                  <Row title="Name" sub={fullName || "Not set"}>
                    {!editingName && (
                      <button type="button" className={btn} onClick={() => setEditingName(true)}>
                        Edit
                      </button>
                    )}
                  </Row>
                  {editingName && (
                    <form onSubmit={onSavePersonalDetails} className="flex flex-col gap-3 border-t border-[var(--border)] px-5 py-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="First name">
                          <input className={input} value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" />
                        </Field>
                        <Field label="Last name">
                          <input className={input} value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" />
                        </Field>
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          className={btn}
                          onClick={() => {
                            setEditingName(false);
                            setFirstName(me.first_name ?? "");
                            setLastName(me.last_name ?? "");
                          }}
                        >
                          Cancel
                        </button>
                        <button type="submit" className={btnPrimary} disabled={personalSaving}>
                          {personalSaving ? "Saving…" : "Save"}
                        </button>
                      </div>
                    </form>
                  )}
                  <Row title="Email" sub={me.email}>
                    {!editingEmail && (
                      <button type="button" className={btn} onClick={() => setEditingEmail(true)}>
                        Change
                      </button>
                    )}
                  </Row>
                  {editingEmail && (
                    <form onSubmit={onChangeEmail} className="flex flex-col gap-3 border-t border-[var(--border)] px-5 py-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="New email">
                          <input className={input} type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required autoComplete="email" />
                        </Field>
                        <Field label="Current password">
                          <input
                            className={input}
                            type="password"
                            value={emailCurrentPassword}
                            onChange={(e) => setEmailCurrentPassword(e.target.value)}
                            required
                            autoComplete="current-password"
                          />
                        </Field>
                      </div>
                      <div className="flex justify-end gap-2">
                        <button type="button" className={btn} onClick={() => setEditingEmail(false)}>
                          Cancel
                        </button>
                        <button type="submit" className={btnPrimary} disabled={changingEmail}>
                          {changingEmail ? "Updating…" : "Update email"}
                        </button>
                      </div>
                    </form>
                  )}
                  <Row title="Role" sub={roleLabel} />
                  <Row title="Plan" sub={plan} />
                </section>
                <Note text={personalMsg} />
                <Note text={changeEmailMsg} />
              </>
            )}

            {tab === "security" && (
              <>
                <section className={card}>
                  <Row title="Password" sub="Use at least 8 characters.">
                    {!editingPassword && (
                      <button type="button" className={btn} onClick={() => setEditingPassword(true)}>
                        Change
                      </button>
                    )}
                  </Row>
                  {editingPassword && (
                    <form onSubmit={onChangePassword} className="flex flex-col gap-3 border-t border-[var(--border)] px-5 py-4">
                      <Field label="Current password">
                        <input
                          className={input}
                          type="password"
                          value={pwCurrentPassword}
                          onChange={(e) => setPwCurrentPassword(e.target.value)}
                          required
                          autoComplete="current-password"
                        />
                      </Field>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="New password">
                          <input className={input} type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required autoComplete="new-password" />
                        </Field>
                        <Field label="Confirm new password">
                          <input
                            className={input}
                            type="password"
                            value={confirmNewPassword}
                            onChange={(e) => setConfirmNewPassword(e.target.value)}
                            required
                            autoComplete="new-password"
                          />
                        </Field>
                      </div>
                      <PasswordRules password={newPassword} />
                      <div className="flex justify-end gap-2">
                        <button type="button" className={btn} onClick={() => setEditingPassword(false)}>
                          Cancel
                        </button>
                        <button type="submit" className={btnPrimary} disabled={changingPassword}>
                          {changingPassword ? "Updating…" : "Update password"}
                        </button>
                      </div>
                    </form>
                  )}
                  <Row
                    title="Two-factor authentication"
                    sub={
                      twoFactorEnabled
                        ? `On · a code from your authenticator app is needed to sign in${
                            backupRemaining !== null ? ` · ${backupRemaining} backup code${backupRemaining === 1 ? "" : "s"} left` : ""
                          }`
                        : "Adds a code from your authenticator app when you sign in"
                    }
                  >
                    {twoFactorEnabled ? (
                      !disableMode &&
                      !regenMode &&
                      !backupCodes && (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className={btn}
                            onClick={() => {
                              setRegenMode(true);
                              setRegenCode("");
                              setTwoFaMsg(null);
                            }}
                          >
                            New backup codes
                          </button>
                          <button
                            type="button"
                            className={btn}
                            onClick={() => {
                              setDisableMode(true);
                              setDisableCode("");
                              setTwoFaMsg(null);
                            }}
                          >
                            Turn off
                          </button>
                        </div>
                      )
                    ) : (
                      !qrDataUrl && (
                        <button type="button" className={btnPrimary} onClick={() => void onSetup2fa()} disabled={setupLoading}>
                          {setupLoading ? "Preparing…" : "Set up"}
                        </button>
                      )
                    )}
                  </Row>
                  {!twoFactorEnabled && qrDataUrl && (
                    <div className="flex flex-col gap-4 border-t border-[var(--border)] px-5 py-4 sm:flex-row sm:items-start">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={qrDataUrl} alt="QR code to scan with your authenticator app" className="h-[200px] w-[200px] rounded-[10px] border border-[var(--border)] bg-white p-2" />
                      <form onSubmit={onConfirm2fa} className="flex flex-1 flex-col gap-3">
                        <p className="text-sm text-[var(--text-muted)]">Scan the code with your authenticator app, then enter the 6-digit code it shows.</p>
                        {setupSecret && (
                          <div className="flex flex-col gap-1 text-[13px] text-[var(--text-muted)]">
                            <span>Can&apos;t scan? Enter this key in your app instead:</span>
                            <code className="select-all break-all rounded-[8px] bg-[var(--overlay-4)] px-2.5 py-1.5 font-mono text-[13px] text-[var(--text)]">
                              {setupSecret.match(/.{1,4}/g)?.join(" ")}
                            </code>
                          </div>
                        )}
                        <Field label="6-digit code">
                          <input
                            className={input}
                            inputMode="numeric"
                            pattern="[0-9]*"
                            maxLength={6}
                            autoComplete="one-time-code"
                            value={confirmCode}
                            onChange={(e) => setConfirmCode(e.target.value.replace(/[^0-9]/g, ""))}
                            required
                          />
                        </Field>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className={btn}
                            onClick={() => {
                              setOtpauthUri(null);
                              setSetupSecret(null);
                            }}
                          >
                            Cancel
                          </button>
                          <button type="submit" className={btnPrimary} disabled={confirmLoading || confirmCode.length !== 6}>
                            {confirmLoading ? "Confirming…" : "Turn on 2FA"}
                          </button>
                        </div>
                      </form>
                    </div>
                  )}
                  {twoFactorEnabled && disableMode && (
                    <form onSubmit={onDisable2fa} className="flex flex-col gap-3 border-t border-[var(--border)] px-5 py-4">
                      <Field label="Current 6-digit code, or a backup code">
                        <input
                          className={input}
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                          autoComplete="one-time-code"
                          maxLength={11}
                          value={disableCode}
                          onChange={(e) => setDisableCode(e.target.value.replace(/[^a-zA-Z0-9-]/g, ""))}
                          required
                        />
                      </Field>
                      <div className="flex justify-end gap-2">
                        <button type="button" className={btn} onClick={() => setDisableMode(false)}>
                          Cancel
                        </button>
                        <button type="submit" className={btnDanger} disabled={disableLoading || !isSecondFactorCode(disableCode)}>
                          {disableLoading ? "Turning off…" : "Turn off 2FA"}
                        </button>
                      </div>
                    </form>
                  )}
                  {twoFactorEnabled && regenMode && (
                    <form onSubmit={onRegenerateBackupCodes} className="flex flex-col gap-3 border-t border-[var(--border)] px-5 py-4">
                      <p className="text-sm text-[var(--text-muted)]">You&apos;ll get 10 new codes. Your current backup codes will stop working.</p>
                      <Field label="Current 6-digit code, or a backup code">
                        <input
                          className={input}
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                          autoComplete="one-time-code"
                          maxLength={11}
                          value={regenCode}
                          onChange={(e) => setRegenCode(e.target.value.replace(/[^a-zA-Z0-9-]/g, ""))}
                          required
                        />
                      </Field>
                      <div className="flex justify-end gap-2">
                        <button type="button" className={btn} onClick={() => setRegenMode(false)}>
                          Cancel
                        </button>
                        <button type="submit" className={btnPrimary} disabled={regenLoading || !isSecondFactorCode(regenCode)}>
                          {regenLoading ? "Creating…" : "Get new codes"}
                        </button>
                      </div>
                    </form>
                  )}
                  {twoFactorEnabled && backupCodes && (
                    <div className="flex flex-col gap-4 border-t border-[var(--border)] px-5 py-4">
                      <div className="flex flex-col gap-1">
                        <strong className="text-sm">Save your backup codes</strong>
                        <p className="text-[13px] text-[var(--text-muted)]">
                          If you lose your phone, each code signs you in once. This is the only time they&apos;re shown, so keep them somewhere safe, like a password manager.
                        </p>
                      </div>
                      <ol className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-[10px] bg-[var(--overlay-4)] px-4 py-3 font-mono text-[14px] text-[var(--text)] sm:max-w-md">
                        {backupCodes.map((c) => (
                          <li key={c} className="select-all">
                            {c}
                          </li>
                        ))}
                      </ol>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className={btn} onClick={() => void copyBackupCodes()}>
                          Copy
                        </button>
                        <button type="button" className={btn} onClick={downloadBackupCodes}>
                          Download .txt
                        </button>
                      </div>
                      <label className="flex items-center gap-2 text-[13px]">
                        <input type="checkbox" checked={backupSaved} onChange={(e) => setBackupSaved(e.target.checked)} />
                        I&apos;ve saved these codes somewhere safe
                      </label>
                      <div className="flex justify-end">
                        <button
                          type="button"
                          className={btnPrimary}
                          disabled={!backupSaved}
                          onClick={() => {
                            setBackupCodes(null);
                            setTwoFaMsg(null);
                          }}
                        >
                          Done
                        </button>
                      </div>
                    </div>
                  )}
                </section>
                <Note text={changePasswordMsg} />
                <Note text={twoFaMsg} />
              </>
            )}

            {tab === "notifications" && (
              <>
                <section className={card}>
                  {!emailPrefsLoaded ? (
                    <p className="px-5 py-4 text-sm text-[var(--text-muted)]">Loading…</p>
                  ) : (
                    <>
                      <Row title="Weekly matches" sub="Your investor or founder match digest, every Tuesday">
                        <Switch
                          label="Weekly matches"
                          on={weeklyMatches && !unsubscribedAll}
                          disabled={emailPrefsSaving || unsubscribedAll}
                          onChange={() => {
                            const next = !weeklyMatches;
                            setWeeklyMatches(next);
                            void saveEmailPrefs({ weekly_matches: next, unsubscribed_all: unsubscribedAll }, () => setWeeklyMatches(!next));
                          }}
                        />
                      </Row>
                      <Row title="Unsubscribe from all emails" sub="Stops digests and news. Receipts and security emails still send.">
                        <Switch
                          label="Unsubscribe from all emails"
                          on={unsubscribedAll}
                          disabled={emailPrefsSaving}
                          onChange={() => {
                            const next = !unsubscribedAll;
                            setUnsubscribedAll(next);
                            void saveEmailPrefs({ weekly_matches: weeklyMatches, unsubscribed_all: next }, () => setUnsubscribedAll(!next));
                          }}
                        />
                      </Row>
                    </>
                  )}
                </section>
                <Note text={emailPrefsMsg} />
              </>
            )}

            {tab === "listing" && isFounder && (
              <>
                <section className={card}>
                  {!publicListingLoaded ? (
                    <p className="px-5 py-4 text-sm text-[var(--text-muted)]">Loading…</p>
                  ) : (
                    <Row title="Show my startup in the public directory" sub="Investors and the public can find you on Browse Startups and leave reviews. On by default.">
                      <Switch label="Public listing" on={isPubliclyListed} disabled={publicListingSaving} onChange={() => void togglePublicListing()} />
                    </Row>
                  )}
                </section>
                <Note text={publicListingMsg} />
              </>
            )}

            {tab === "delete" && (
              <section className={`${card} flex flex-col gap-3 border-[var(--danger)] p-5`}>
                <h2 className="text-base font-semibold">Delete your account</h2>
                <p className="text-sm text-[var(--text-muted)]">
                  This removes your profile, {isFounder ? "pitch, " : ""}matches, calls and messages. It can&apos;t be undone. Type DELETE to confirm.
                </p>
                <Field label="Type DELETE">
                  <input className={`${input} max-w-xs`} value={deleteText} onChange={(e) => setDeleteText(e.target.value)} placeholder="DELETE" autoComplete="off" />
                </Field>
                <div>
                  <button type="button" className={btnDanger} disabled={deleteText !== "DELETE" || deleting} onClick={() => void onDeleteAccount()}>
                    {deleting ? "Deleting…" : "Delete account"}
                  </button>
                </div>
                <Note text={deleteMsg} />
              </section>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
