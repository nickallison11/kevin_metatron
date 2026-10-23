/** Matches backend `MeResponse` from `/auth/me`. */
export type MeResponse = {
  id: string;
  email: string;
  role: string;
  is_basic: boolean;
  is_pro: boolean;
  is_admin: boolean;
  is_super_admin: boolean;
  totp_enabled: boolean;
  /** Unused 2FA backup codes left. */
  backup_codes_remaining: number;
  first_name: string | null;
  last_name: string | null;
  telegram_id: string | null;
  whatsapp_number: string | null;
};
