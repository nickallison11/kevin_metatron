// Keep in step with `password_meets_rules` in backend/src/routes/auth.rs.
export const PASSWORD_RULES: { label: string; ok: (p: string) => boolean }[] = [
  { label: "12+ characters", ok: (p) => p.length >= 12 },
  { label: "Uppercase letter", ok: (p) => /[A-Z]/.test(p) },
  { label: "Lowercase letter", ok: (p) => /[a-z]/.test(p) },
  { label: "Number", ok: (p) => /\d/.test(p) },
  { label: "Symbol", ok: (p) => /[^A-Za-z0-9\s]/.test(p) },
];

export function passwordMeetsRules(p: string): boolean {
  return PASSWORD_RULES.every((r) => r.ok(p));
}
