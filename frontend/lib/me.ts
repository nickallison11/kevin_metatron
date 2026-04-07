/** Matches backend `MeResponse` from `/auth/me`. */
export type MeResponse = {
  id: string;
  email: string;
  role: string;
  is_pro: boolean;
  is_admin: boolean;
  totp_enabled: boolean;
  first_name: string | null;
  last_name: string | null;
  telegram_id: string | null;
  whatsapp_number: string | null;
};
