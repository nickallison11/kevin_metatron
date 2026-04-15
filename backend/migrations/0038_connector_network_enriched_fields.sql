ALTER TABLE connector_network_contacts
    ADD COLUMN IF NOT EXISTS website TEXT,
    ADD COLUMN IF NOT EXISTS sector_focus TEXT,
    ADD COLUMN IF NOT EXISTS stage_focus TEXT,
    ADD COLUMN IF NOT EXISTS ticket_size TEXT,
    ADD COLUMN IF NOT EXISTS geography TEXT,
    ADD COLUMN IF NOT EXISTS one_liner TEXT;
