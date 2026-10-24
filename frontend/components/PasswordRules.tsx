import { PASSWORD_RULES } from "@/lib/passwordRules";

/** Live checklist of the password rules, ticking each one off as it's met. */
export function PasswordRules({ password, id }: { password: string; id?: string }) {
  return (
    <ul id={id} aria-label="Password rules" className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[13px]">
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
  );
}
