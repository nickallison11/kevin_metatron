DELETE FROM connector_network_contacts a
USING connector_network_contacts b
WHERE a.ctid > b.ctid
  AND a.connector_user_id = b.connector_user_id
  AND a.role = b.role
  AND lower(a.name) = lower(b.name);
