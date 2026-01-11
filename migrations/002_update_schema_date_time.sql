-- YardLine Booking System - Update Schema to Use date + time
-- This migration updates the schema to match the actual Supabase implementation
-- using date + time_start + time_end (without timezone) and tsrange

-- ============================================================================
-- 1. Update bookings table structure
-- ============================================================================

-- Drop old constraints and triggers if they exist
DROP TRIGGER IF EXISTS booking_time_range_trigger ON bookings;
DROP FUNCTION IF EXISTS update_booking_time_range();
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS no_double_booking;

-- Update columns to use date + time instead of timestamptz
-- Note: If migrating from existing timestamptz columns, you'll need to convert data
ALTER TABLE bookings 
  DROP COLUMN IF EXISTS requested_date CASCADE,
  DROP COLUMN IF EXISTS requested_time CASCADE,
  DROP COLUMN IF EXISTS time_start CASCADE,
  DROP COLUMN IF EXISTS time_end CASCADE;

-- Add new columns with correct types
ALTER TABLE bookings
  ADD COLUMN date DATE NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN time_start TIME WITHOUT TIME ZONE NOT NULL DEFAULT '09:00:00',
  ADD COLUMN time_end TIME WITHOUT TIME ZONE NOT NULL DEFAULT '10:00:00';

-- Add generated column for time_range using tsrange
ALTER TABLE bookings
  ADD COLUMN time_range TSRANGE 
  GENERATED ALWAYS AS (tsrange((date + time_start), (date + time_end), '[)')) STORED;

-- Update column names (booking_id -> id if needed)
-- Note: Uncomment if your table uses booking_id instead of id
-- ALTER TABLE bookings RENAME COLUMN booking_id TO id;

-- ============================================================================
-- 2. Exclusion constraint for preventing double booking
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Add exclusion constraint using the generated time_range column
ALTER TABLE bookings ADD CONSTRAINT no_double_booking 
  EXCLUDE USING GIST (
    provider_id WITH =,
    time_range WITH &&
  ) 
  WHERE (status IN ('pending', 'confirmed'));

-- ============================================================================
-- 3. Helper function for checking booking conflicts
-- ============================================================================

CREATE OR REPLACE FUNCTION check_booking_conflict(
  p_provider_id UUID,
  p_date DATE,
  p_time_start TIME,
  p_time_end TIME,
  p_exclude_booking_id UUID DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM bookings 
    WHERE provider_id = p_provider_id
      AND status IN ('pending', 'confirmed')
      AND (id != p_exclude_booking_id OR p_exclude_booking_id IS NULL)
      AND time_range && tsrange((p_date + p_time_start), (p_date + p_time_end), '[)')
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 4. Indexes for performance
-- ============================================================================

CREATE INDEX IF NOT EXISTS bookings_provider_status_idx ON bookings(provider_id, status);
CREATE INDEX IF NOT EXISTS bookings_customer_status_idx ON bookings(customer_id, status);
CREATE INDEX IF NOT EXISTS bookings_payment_intent_idx ON bookings(payment_intent_id) WHERE payment_intent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS bookings_time_range_idx ON bookings USING GIST(time_range);
CREATE INDEX IF NOT EXISTS bookings_date_idx ON bookings(date);

-- ============================================================================
-- Migration Complete
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE 'Schema updated to use date + time_start + time_end';
  RAISE NOTICE 'Added time_range generated column using tsrange';
  RAISE NOTICE 'Updated check_booking_conflict function';
  RAISE NOTICE 'Added exclusion constraint no_double_booking';
END $$;
