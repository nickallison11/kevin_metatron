CREATE TABLE connector_network_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connector_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('investor', 'founder')),
    name TEXT NOT NULL,
    email TEXT,
    firm_or_company TEXT,
    linkedin_url TEXT,
    notes TEXT,
    invited_at TIMESTAMPTZ,
    joined_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX connector_network_contacts_connector_idx ON connector_network_contacts(connector_user_id);
