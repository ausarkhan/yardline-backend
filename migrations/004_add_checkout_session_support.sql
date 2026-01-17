-- Add Stripe Checkout Session support to bookings table
-- This allows bookings to be paid via Stripe-hosted checkout pages

-- Add stripe_checkout_session_id column to track checkout sessions
ALTER TABLE bookings 
ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT;

-- Index for fast checkout session lookups
CREATE INDEX IF NOT EXISTS bookings_checkout_session_idx 
  ON bookings(stripe_checkout_session_id) 
  WHERE stripe_checkout_session_id IS NOT NULL;

-- Comment for documentation
COMMENT ON COLUMN bookings.stripe_checkout_session_id IS 
  'Stripe Checkout Session ID when payment is made via hosted checkout page';
