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
  /** Digits with country code, from sign-up. */
  phone_number: string | null;
  /** App picked at sign-up: "whatsapp" or "telegram". Null for older accounts. */
  preferred_channel: string | null;
  /** When the user first reached Kevin on WhatsApp or Telegram. */
  channel_connected_at: string | null;
  /** Credits a Free founder can spend to have Kevin read a deck. */
  enrichment_credits: number;
};
