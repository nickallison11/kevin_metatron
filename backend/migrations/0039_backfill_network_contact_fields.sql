-- One-time backfill: parse legacy pipe-separated notes from spreadsheet import
-- (e.g. "Sector: X | Stage: Y | Ticket: Z | Geography: W" or "Location: W") into dedicated columns.
-- Notes are left unchanged for raw context.

UPDATE connector_network_contacts
SET
    sector_focus = CASE
        WHEN notes ~ 'Sector: ([^|]+)' THEN trim(substring(notes from 'Sector: ([^|]+)'))
        ELSE sector_focus
    END,
    stage_focus = CASE
        WHEN notes ~ 'Stage: ([^|]+)' THEN trim(substring(notes from 'Stage: ([^|]+)'))
        ELSE stage_focus
    END,
    ticket_size = CASE
        WHEN notes ~ 'Ticket: ([^|]+)' THEN trim(substring(notes from 'Ticket: ([^|]+)'))
        ELSE ticket_size
    END,
    geography = CASE
        WHEN notes ~ 'Geography: ([^|]+)' THEN trim(substring(notes from 'Geography: ([^|]+)'))
        WHEN notes ~ 'Location: ([^|]+)' THEN trim(substring(notes from 'Location: ([^|]+)'))
        ELSE geography
    END
WHERE sector_focus IS NULL
  AND notes IS NOT NULL
  AND notes LIKE '%Sector:%';
