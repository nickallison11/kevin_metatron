CREATE UNIQUE INDEX IF NOT EXISTS connector_network_contacts_unique_name
ON connector_network_contacts (connector_user_id, role, lower(name));
