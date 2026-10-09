-- Phone number a user chose to share via Telegram's "Share my phone number" button.
-- Used on the founder contact card sent to investors on intro accept. WhatsApp users
-- don't need this: their whatsapp_number already is their phone.
ALTER TABLE users ADD COLUMN IF NOT EXISTS shared_phone TEXT;
