ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_number VARCHAR(32);

CREATE UNIQUE INDEX IF NOT EXISTS users_whatsapp_number_unique
    ON users (whatsapp_number)
    WHERE whatsapp_number IS NOT NULL;
