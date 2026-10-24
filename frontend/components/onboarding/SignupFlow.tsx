"use client";

import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { CountryCodePicker, DIAL_COUNTRIES } from "@/components/onboarding/CountryCodePicker";
import { API_BASE } from "@/lib/api";
import { COUNTRY_COOKIE } from "@/lib/countryCookie";
import { setTokenPair } from "@/lib/tokenStore";

export type SignupRole = "founder" | "investor";
type Choice = SignupRole | "other";
type Channel = "whatsapp" | "telegram";
type Step = "choose" | "other" | "otherDone" | "details" | "verify";

const OPTIONS: { id: Choice; label: string; hint: string }[] = [
  { id: "founder", label: "Investors for my startup", hint: "I'm a founder raising a round" },
  { id: "investor", label: "Startups to invest in", hint: "I'm an investor or angel" },
  { id: "other", label: "Something else", hint: "Tell Kevin what you're after" },
];
const CHANNELS: { id: Channel; label: string; help: string }[] = [
  { id: "whatsapp", label: "WhatsApp", help: "Kevin only messages you after you message him." },
  { id: "telegram", label: "Telegram", help: "You'll connect Telegram from your dashboard." },
];
// Keep in step with `password_meets_rules` in backend/src/routes/auth.rs.
const PASSWORD_RULES: { label: string; ok: (p: string) => boolean }[] = [
  { label: "12+ characters", ok: (p) => p.length >= 12 },
  { label: "Uppercase letter", ok: (p) => /[A-Z]/.test(p) },
  { label: "Lowercase letter", ok: (p) => /[a-z]/.test(p) },
  { label: "Number", ok: (p) => /\d/.test(p) },
  { label: "Symbol", ok: (p) => /[^A-Za-z0-9\s]/.test(p) },
];
const STEP_NO: Partial<Record<Step, number>> = { choose: 1, other: 1, details: 2, verify: 3 };
const BACK: Partial<Record<Step, Step>> = { other: "choose", details: "choose", verify: "details" };

const field =
  "min-h-[52px] w-full rounded-xl border border-[var(--overlay-12)] bg-[var(--bg)] px-3.5 text-base text-[var(--text)] outline-none placeholder:text-[var(--text-muted)] focus:border-metatron-accent";
const label = "flex flex-col gap-2 text-sm font-medium text-[var(--text)]";
const h1 = "text-[28px] font-semibold leading-tight tracking-tight text-[var(--text)]";
const sub = "text-[15px] leading-relaxed text-[var(--text-muted)]";
const linkBtn = "font-semibold text-[var(--text)] underline-offset-2 hover:text-metatron-accent hover:underline";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function visitorCountry(): CountryCode {
  if (typeof document !== "undefined") {
    const m = document.cookie.match(new RegExp(`(?:^|; )${COUNTRY_COOKIE}=([A-Z]{2})`));
    const c = m?.[1];
    if (c && DIAL_COUNTRIES.some((d) => d.code === c)) return c as CountryCode;
  }
  return "ZA";
}

async function post(path: string, body: unknown): Promise<{ ok: boolean; status: number; text: string }> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, text: (await res.text()).trim() };
  } catch {
    return { ok: false, status: 0, text: "" };
  }
}

/**
 * Sign-up: what you're looking for → email, mobile number and WhatsApp or
 * Telegram → the emailed code plus a password. Full screen on a phone, a
 * dialog on wider screens. Ends logged in on the dashboard.
 */
export default function SignupFlow({
  initialRole,
  referralCode,
  onClose,
}: {
  initialRole?: SignupRole | null;
  referralCode?: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(initialRole ? "details" : "choose");
  const [choice, setChoice] = useState<Choice | null>(initialRole ?? null);
  const [email, setEmail] = useState("");
  const [country, setCountry] = useState<CountryCode>("ZA");
  const [national, setNational] = useState("");
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailExists, setEmailExists] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => setCountry(visitorCountry()), []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  useEffect(() => {
    setError(null);
    setEmailExists(false);
    setInfo(null);
    panelRef.current?.querySelector<HTMLElement>("[data-step-title]")?.focus();
  }, [step]);

  const phone = parsePhoneNumberFromString(national, country);
  const phoneOk = Boolean(phone?.isValid());
  const emailOk = EMAIL_RE.test(email.trim());
  const passwordOk = PASSWORD_RULES.every((r) => r.ok(password));
  const role: SignupRole = choice === "investor" ? "investor" : "founder";
  const stepNo = STEP_NO[step] ?? 0;
  const back = BACK[step];

  async function submitDetails() {
    setBusy(true);
    setError(null);
    setEmailExists(false);
    const r = await post("/auth/signup/start", {
      email: email.trim(),
      phone: phone?.number ?? "",
      channel,
      role,
      ...(referralCode ? { referral_code: referralCode } : {}),
    });
    setBusy(false);
    if (r.ok) {
      setCode("");
      setStep("verify");
      return;
    }
    if (r.status === 409 && /email/i.test(r.text)) setEmailExists(true);
    setError(r.text || "Something went wrong. Please try again.");
  }

  async function submitVerify() {
    setBusy(true);
    setError(null);
    const r = await post("/auth/signup/verify", { email: email.trim(), code, password });
    if (!r.ok) {
      setBusy(false);
      setError(r.text || "Something went wrong. Please try again.");
      return;
    }
    try {
      const d = JSON.parse(r.text) as { token: string; refresh_token: string; role: string };
      setTokenPair(d.token, d.refresh_token);
      router.push(d.role === "INVESTOR" ? "/investor" : "/startup");
    } catch {
      setBusy(false);
      setError("Your account was created, but signing in failed. Sign in with your email and password.");
    }
  }

  async function resend() {
    setInfo(null);
    setError(null);
    const r = await post("/auth/signup/resend", { email: email.trim() });
    if (r.ok) setInfo(`We sent a new code to ${email.trim()}.`);
    else setError(r.text || "Could not send a new code.");
  }

  async function submitOther() {
    setBusy(true);
    setError(null);
    const r = await post("/auth/signup/interest", { email: email.trim(), note });
    setBusy(false);
    if (r.ok) setStep("otherDone");
    else setError(r.text || "Something went wrong. Please try again.");
  }

  let cta: { label: string; ok: boolean; run: () => void; hint?: string } | null = null;
  if (step === "choose")
    cta = { label: "Continue", ok: Boolean(choice), run: () => setStep(choice === "other" ? "other" : "details") };
  if (step === "other") cta = { label: "Keep me posted", ok: emailOk && note.trim().length > 0, run: () => void submitOther() };
  if (step === "otherDone") cta = { label: "Back to start", ok: true, run: () => setStep("choose") };
  if (step === "details")
    cta = {
      label: "Continue",
      ok: emailOk && phoneOk,
      run: () => void submitDetails(),
      hint: !emailOk ? "Enter your email to continue." : !phoneOk ? "Enter a valid mobile number to continue." : undefined,
    };
  if (step === "verify")
    cta = {
      label: "Create my account",
      ok: /^\d{6}$/.test(code) && passwordOk,
      run: () => void submitVerify(),
      hint: !/^\d{6}$/.test(code) ? "Enter the 6-digit code from the email." : "Your password doesn't meet the rules yet.",
    };

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (cta?.ok && !busy) cta.run();
  }

  const title = (text: string) => (
    <h1 data-step-title tabIndex={-1} className={`${h1} outline-none`}>
      {text}
    </h1>
  );

  return (
    <div className="fixed inset-0 z-[60] flex bg-[var(--bg)] sm:items-center sm:justify-center sm:bg-black/70 sm:p-6 sm:backdrop-blur-sm">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Create your metatron account"
        className="flex h-full w-full flex-col bg-[var(--bg)] sm:h-auto sm:max-h-[calc(100vh-48px)] sm:max-w-[480px] sm:rounded-[20px] sm:border sm:border-[var(--overlay-12)] sm:bg-[var(--bg-card)] sm:shadow-[0_30px_80px_rgba(0,0,0,0.5)]"
      >
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-[60px] shrink-0 items-center gap-1 px-2 pt-2 sm:px-4">
            {back ? (
              <button type="button" aria-label="Back" onClick={() => setStep(back)} className="flex h-11 w-11 items-center justify-center text-[var(--text)]">
                <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 6l-6 6 6 6" />
                </svg>
              </button>
            ) : (
              <span className="flex h-11 items-center gap-2 pl-3 text-[17px] font-semibold text-[var(--text)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/metatron-logo.png" alt="" width={28} height={32} className="h-8 w-auto" />
                metatron
              </span>
            )}
            <span className="flex-1" />
            {stepNo > 0 && <span className="pr-1 font-mono text-xs text-[var(--text-muted)]">0{stepNo} / 03</span>}
            <button type="button" aria-label="Close" onClick={onClose} className="flex h-11 w-11 items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)]">
              <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          {stepNo > 0 && (
            <div aria-hidden className="grid grid-cols-3 gap-1.5 px-5 pt-1 sm:px-8">
              {[1, 2, 3].map((n) => (
                <span key={n} className={`h-[3px] rounded-full ${n <= stepNo ? "bg-metatron-accent" : "bg-[var(--overlay-12)]"}`} />
              ))}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8">
            {step === "choose" && (
              <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-2">
                  {title("Who are you looking to meet?")}
                  <p className={sub}>Pick one and Kevin takes it from there.</p>
                </div>
                <div role="radiogroup" aria-label="Who you're looking to meet" className="flex flex-col gap-2.5">
                  {OPTIONS.map((o) => {
                    const on = choice === o.id;
                    return (
                      <button
                        key={o.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setChoice(o.id)}
                        className={`flex min-h-[68px] w-full items-center gap-3.5 rounded-[14px] border px-4 py-3.5 text-left ${on ? "border-metatron-accent bg-metatron-accent/[0.12]" : "border-[var(--overlay-12)] hover:bg-[var(--overlay-4)]"}`}
                      >
                        <span aria-hidden className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-[1.5px] ${on ? "border-metatron-accent" : "border-[var(--text-muted)]"}`}>
                          {on && <span className="h-2.5 w-2.5 rounded-full bg-metatron-accent" />}
                        </span>
                        <span className="flex flex-col gap-0.5">
                          <span className="text-base font-medium text-[var(--text)]">{o.label}</span>
                          <span className="text-[13px] text-[var(--text-muted)]">{o.hint}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-sm text-[var(--text-muted)]">
                  Already have an account?{" "}
                  <Link href="/login" className={linkBtn}>
                    Sign in
                  </Link>
                </p>
              </div>
            )}

            {step === "other" && (
              <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-2">
                  {title("What are you after?")}
                  <p className={sub}>Kevin matches founders with investors today. Tell us what you need and we'll let you know.</p>
                </div>
                <label className={label}>
                  Email address
                  <input className={field} type="email" inputMode="email" autoComplete="email" placeholder="alex@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                </label>
                <label className={label}>
                  What you're looking for
                  <textarea className={`${field} resize-none py-3`} rows={3} maxLength={1000} placeholder="e.g. a technical co-founder, my first customers" value={note} onChange={(e) => setNote(e.target.value)} />
                </label>
              </div>
            )}

            {step === "otherDone" && (
              <div className="flex flex-col gap-2">
                {title("Thanks, noted.")}
                <p className={sub}>We'll email you if Kevin starts doing this. No account was created.</p>
              </div>
            )}

            {step === "details" && (
              <div className="flex flex-col gap-5">
                {title("Let's get introduced.")}
                <label className={label}>
                  Email address
                  <input className={field} type="email" inputMode="email" autoComplete="email" placeholder="alex@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </label>
                <div className="flex flex-col gap-2">
                  <span id="signup-phone-label" className="text-sm font-medium text-[var(--text)]">
                    Mobile number
                  </span>
                  <div className="flex gap-2">
                    <CountryCodePicker value={country} onChange={setCountry} />
                    <input
                      className={field}
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel-national"
                      aria-labelledby="signup-phone-label"
                      placeholder="81 234 5678"
                      value={national}
                      onChange={(e) => setNational(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <span id="signup-channel-label" className="text-sm font-medium text-[var(--text)]">
                    Where should Kevin message you?
                  </span>
                  <div role="radiogroup" aria-labelledby="signup-channel-label" className="grid grid-cols-2 gap-2">
                    {CHANNELS.map((c) => {
                      const on = channel === c.id;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => setChannel(c.id)}
                          className={`min-h-[52px] rounded-xl border text-base font-medium text-[var(--text)] ${on ? "border-metatron-accent bg-metatron-accent/[0.12]" : "border-[var(--overlay-12)] hover:bg-[var(--overlay-4)]"}`}
                        >
                          {c.label}
                        </button>
                      );
                    })}
                  </div>
                  <span className="text-[13px] leading-relaxed text-[var(--text-muted)]">{CHANNELS.find((c) => c.id === channel)!.help}</span>
                </div>
                <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                  By continuing, you agree to our{" "}
                  <a href="/terms" target="_blank" className={linkBtn}>
                    Terms
                  </a>{" "}
                  and{" "}
                  <a href="/privacy" target="_blank" className={linkBtn}>
                    Privacy Policy
                  </a>
                  .
                </p>
              </div>
            )}

            {step === "verify" && (
              <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-2">
                  {title("Check your email.")}
                  <p className={sub}>
                    We sent a 6-digit code to <span className="font-medium text-[var(--text)]">{email.trim()}</span>.
                  </p>
                </div>
                <label className={label}>
                  Code from the email
                  <input
                    className={`${field} text-center font-mono text-2xl tracking-[0.4em]`}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="000000"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  />
                </label>
                <div className="flex flex-col gap-2">
                  <label htmlFor="signup-password" className="text-sm font-medium text-[var(--text)]">
                    Create a password
                  </label>
                  <div className="relative">
                    <input
                      id="signup-password"
                      className={`${field} pr-12`}
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      aria-describedby="signup-password-rules"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      aria-pressed={showPassword}
                      className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)]"
                    >
                      <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                        {showPassword ? (
                          <>
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                            <line x1="1" y1="1" x2="23" y2="23" />
                          </>
                        ) : (
                          <>
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </>
                        )}
                      </svg>
                    </button>
                  </div>
                  <ul id="signup-password-rules" aria-label="Password rules" className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[13px]">
                    {PASSWORD_RULES.map((r) => {
                      const met = r.ok(password);
                      return (
                        <li key={r.label} className={`flex items-center gap-1.5 ${met ? "text-[var(--text)]" : "text-[var(--text-muted)]"}`}>
                          <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={met ? "var(--accent)" : "currentColor"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            {met ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <circle cx="12" cy="12" r="4" />}
                          </svg>
                          {r.label}
                          <span className="sr-only">{met ? " (done)" : " (not yet)"}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
                <p className="text-sm text-[var(--text-muted)]">
                  No email? Check spam, or{" "}
                  <button type="button" onClick={() => void resend()} className={linkBtn}>
                    send a new code
                  </button>
                  .
                </p>
                {info && (
                  <p role="status" className="text-sm text-[var(--text-muted)]">
                    {info}
                  </p>
                )}
              </div>
            )}

            {error && (
              <p role="alert" className="mt-4 rounded-xl border border-[var(--warn)] bg-[var(--warn-bg)] px-3.5 py-3 text-sm text-[var(--text)]">
                {error}
                {emailExists && (
                  <>
                    {" "}
                    <Link href="/login" className={linkBtn}>
                      Sign in
                    </Link>
                  </>
                )}
              </p>
            )}
          </div>

          {cta && (
            <div className="shrink-0 border-t border-[var(--border)] px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-3 sm:border-t-0 sm:px-8 sm:pb-8 sm:pt-0">
              <button
                type="submit"
                disabled={!cta.ok || busy}
                className="min-h-[54px] w-full rounded-[14px] bg-metatron-accent text-[17px] font-semibold text-white hover:bg-metatron-accent-hover disabled:opacity-45 disabled:hover:bg-metatron-accent"
              >
                {busy ? "One moment…" : cta.label}
              </button>
              {!cta.ok && cta.hint && <p className="mt-2 text-center text-[13px] text-[var(--text-muted)]">{cta.hint}</p>}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
