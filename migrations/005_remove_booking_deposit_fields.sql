-- YardLine Booking System - Remove deposit/final payment columns
-- Deposits are deprecated; bookings are paid in full after provider acceptance.

BEGIN;

DROP INDEX IF EXISTS bookings_deposit_payment_intent_idx;
DROP INDEX IF EXISTS bookings_final_payment_intent_idx;
DROP INDEX IF EXISTS bookings_deposit_status_idx;
DROP INDEX IF EXISTS bookings_final_status_idx;

ALTER TABLE bookings
  DROP COLUMN IF EXISTS deposit_payment_intent_id,
  DROP COLUMN IF EXISTS deposit_status,
  DROP COLUMN IF EXISTS final_payment_intent_id,
  DROP COLUMN IF EXISTS final_status;

COMMIT;
