-- YardLine Booking System - Two-Step Payment Migration
-- Adds support for deposit + final payment workflow
-- Step 1: Customer pays platform fee deposit -> booking status='pending'
-- Step 2: Provider accepts -> booking status='accepted'
-- Step 3: Customer pays remaining amount -> final_status='paid'

-- ============================================================================
-- 1. Add two-step payment tracking columns
-- ============================================================================

ALTER TABLE bookings 
ADD COLUMN IF NOT EXISTS deposit_payment_intent_id TEXT,
ADD COLUMN IF NOT EXISTS deposit_status TEXT DEFAULT 'unpaid' CHECK (
  deposit_status IN ('unpaid', 'paid', 'failed', 'refunded')
),
ADD COLUMN IF NOT EXISTS final_payment_intent_id TEXT,
ADD COLUMN IF NOT EXISTS final_status TEXT DEFAULT 'not_started' CHECK (
  final_status IN ('not_started', 'paid', 'failed', 'refunded')
);

-- Update status column to include 'accepted' status for two-step flow
ALTER TABLE bookings 
DROP CONSTRAINT IF EXISTS bookings_status_check,
ADD CONSTRAINT bookings_status_check CHECK (
  status IN ('pending', 'accepted', 'confirmed', 'declined', 'cancelled', 'expired')
);

-- Add indexes for the new payment tracking columns
CREATE INDEX IF NOT EXISTS bookings_deposit_payment_intent_idx 
  ON bookings(deposit_payment_intent_id) 
  WHERE deposit_payment_intent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS bookings_final_payment_intent_idx 
  ON bookings(final_payment_intent_id) 
  WHERE final_payment_intent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS bookings_deposit_status_idx 
  ON bookings(deposit_status) 
  WHERE deposit_status = 'paid';

CREATE INDEX IF NOT EXISTS bookings_final_status_idx 
  ON bookings(final_status) 
  WHERE final_status != 'not_started';

-- ============================================================================
-- 2. Add comment documentation
-- ============================================================================

COMMENT ON COLUMN bookings.deposit_payment_intent_id IS 'Stripe PaymentIntent ID for platform fee deposit';
COMMENT ON COLUMN bookings.deposit_status IS 'Status of the platform fee deposit payment';
COMMENT ON COLUMN bookings.final_payment_intent_id IS 'Stripe PaymentIntent ID for final service payment';
COMMENT ON COLUMN bookings.final_status IS 'Status of the final service payment';
COMMENT ON COLUMN bookings.status IS 'Booking status: pending (deposit paid), accepted (provider approved), confirmed (final payment completed)';
