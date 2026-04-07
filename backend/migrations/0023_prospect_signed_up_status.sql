ALTER TABLE prospects DROP CONSTRAINT IF EXISTS prospects_status_check;

ALTER TABLE prospects ADD CONSTRAINT prospects_status_check
  CHECK (status IN ('contacted', 'responded', 'onboarded', 'declined', 'signed_up'));
