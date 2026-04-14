CREATE TABLE connector_network_staging (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connector_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('investor', 'founder')),
    name TEXT NOT NULL,
    firm_or_company TEXT,
    raw_notes TEXT,
    contact_name TEXT,
    email TEXT,
    linkedin_url TEXT,
    website TEXT,
    sector_focus TEXT,
    stage_focus TEXT,
    ticket_size TEXT,
    geography TEXT,
    one_liner TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'enriching', 'enriched', 'failed')),
    enrichment_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    enriched_at TIMESTAMPTZ
);
CREATE INDEX connector_network_staging_connector_idx ON connector_network_staging(connector_user_id);
CREATE INDEX connector_network_staging_status_idx ON connector_network_staging(status);
