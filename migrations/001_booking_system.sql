-- YardLine Booking System Database Migration
-- This migration adds payment authorization/capture support for bookings

-- ============================================================================
-- 1. Add payment tracking columns to bookings table
-- ============================================================================

ALTER TABLE bookings 
ADD COLUMN IF NOT EXISTS payment_intent_id TEXT,
ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'none' CHECK (
  payment_status IN ('none', 'authorized', 'captured', 'canceled', 'failed', 'expired')
),
ADD COLUMN IF NOT EXISTS amount_total INTEGER,
ADD COLUMN IF NOT EXISTS service_price_cents INTEGER,
ADD COLUMN IF NOT EXISTS platform_fee_cents INTEGER,
ADD COLUMN IF NOT EXISTS decline_reason TEXT;

-- Update status column to use consistent naming
-- If you have 'created' status, map it to 'pending'
UPDATE bookings SET status = 'pending' WHERE status = 'created';

-- Add constraint for valid status values
ALTER TABLE bookings 
DROP CONSTRAINT IF EXISTS bookings_status_check,
ADD CONSTRAINT bookings_status_check CHECK (
  status IN ('pending', 'confirmed', 'declined', 'cancelled', 'expired')
);

-- ============================================================================
-- 2. Add services table if not exists
-- ============================================================================

CREATE TABLE IF NOT EXISTS services (
  service_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL CHECK (price_cents > 0),
  duration INTEGER NOT NULL CHECK (duration > 0), -- in minutes
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast provider lookups
CREATE INDEX IF NOT EXISTS services_provider_id_idx ON services(provider_id);
CREATE INDEX IF NOT EXISTS services_active_idx ON services(active) WHERE active = true;

-- ============================================================================
-- 3. Update bookings table structure
-- ============================================================================

-- Ensure bookings table has required columns
ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES services(service_id),
ADD COLUMN IF NOT EXISTS service_name TEXT,
ADD COLUMN IF NOT EXISTS requested_date DATE NOT NULL,
ADD COLUMN IF NOT EXISTS requested_time TIME NOT NULL,
ADD COLUMN IF NOT EXISTS time_start TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS time_end TIMESTAMPTZ;

-- Computed timestamp columns for overlap detection
-- Update existing rows to populate time_start and time_end
UPDATE bookings 
SET 
  time_start = (requested_date + requested_time)::TIMESTAMPTZ,
  time_end = (requested_date + requested_time + (COALESCE((SELECT duration FROM services WHERE service_id = bookings.service_id), 60) || ' minutes')::INTERVAL)::TIMESTAMPTZ
WHERE time_start IS NULL;

-- Make time_start and time_end NOT NULL after backfilling
ALTER TABLE bookings
ALTER COLUMN time_start SET NOT NULL,
ALTER COLUMN time_end SET NOT NULL;

-- ============================================================================
-- 4. Double booking prevention - Overlap detection
-- ============================================================================

-- Create exclusion constraint to prevent overlapping bookings
-- This prevents two confirmed/pending bookings for same provider with overlapping times
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Drop existing constraint if upgrading
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS no_double_booking;

-- Add exclusion constraint for overlapping time ranges
-- Only applies to pending and confirmed bookings
ALTER TABLE bookings ADD CONSTRAINT no_double_booking 
  EXCLUDE USING GIST (
    provider_id WITH =,
    tstzrange(time_start, time_end, '[)') WITH &&
  ) 
  WHERE (status IN ('pending', 'confirmed'));

-- Index for fast booking queries
CREATE INDEX IF NOT EXISTS bookings_provider_status_idx ON bookings(provider_id, status);
CREATE INDEX IF NOT EXISTS bookings_customer_status_idx ON bookings(customer_id, status);
CREATE INDEX IF NOT EXISTS bookings_payment_intent_idx ON bookings(payment_intent_id) WHERE payment_intent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS bookings_time_range_idx ON bookings USING GIST(tstzrange(time_start, time_end));

-- ============================================================================
-- 5. Trigger to auto-update time_start/time_end on changes
-- ============================================================================

CREATE OR REPLACE FUNCTION update_booking_time_range()
RETURNS TRIGGER AS $$
BEGIN
  -- Get service duration
  NEW.time_start := (NEW.requested_date + NEW.requested_time)::TIMESTAMPTZ;
  NEW.time_end := (NEW.requested_date + NEW.requested_time + 
    (COALESCE((SELECT duration FROM services WHERE service_id = NEW.service_id), 60) || ' minutes')::INTERVAL)::TIMESTAMPTZ;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS booking_time_range_trigger ON bookings;
CREATE TRIGGER booking_time_range_trigger
  BEFORE INSERT OR UPDATE OF requested_date, requested_time, service_id
  ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION update_booking_time_range();

-- ============================================================================
-- 6. Trigger to auto-update updated_at timestamp
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bookings_updated_at_trigger ON bookings;
CREATE TRIGGER bookings_updated_at_trigger
  BEFORE UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS services_updated_at_trigger ON services;
CREATE TRIGGER services_updated_at_trigger
  BEFORE UPDATE ON services
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 7. RLS Policies (Row Level Security)
-- ============================================================================

-- Enable RLS on both tables
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

-- Services policies
DROP POLICY IF EXISTS "Services are viewable by everyone" ON services;
CREATE POLICY "Services are viewable by everyone" 
  ON services FOR SELECT 
  USING (active = true);

DROP POLICY IF EXISTS "Providers can insert their own services" ON services;
CREATE POLICY "Providers can insert their own services" 
  ON services FOR INSERT 
  WITH CHECK (auth.uid() = provider_id);

DROP POLICY IF EXISTS "Providers can update their own services" ON services;
CREATE POLICY "Providers can update their own services" 
  ON services FOR UPDATE 
  USING (auth.uid() = provider_id);

-- Bookings policies
DROP POLICY IF EXISTS "Customers can view their own bookings" ON bookings;
CREATE POLICY "Customers can view their own bookings" 
  ON bookings FOR SELECT 
  USING (auth.uid() = customer_id);

DROP POLICY IF EXISTS "Providers can view their bookings" ON bookings;
CREATE POLICY "Providers can view their bookings" 
  ON bookings FOR SELECT 
  USING (auth.uid() = provider_id);

DROP POLICY IF EXISTS "Customers can create bookings" ON bookings;
CREATE POLICY "Customers can create bookings" 
  ON bookings FOR INSERT 
  WITH CHECK (auth.uid() = customer_id);

DROP POLICY IF EXISTS "Providers can update their bookings" ON bookings;
CREATE POLICY "Providers can update their bookings" 
  ON bookings FOR UPDATE 
  USING (auth.uid() = provider_id);

DROP POLICY IF EXISTS "Customers can update their bookings" ON bookings;
CREATE POLICY "Customers can update their bookings" 
  ON bookings FOR UPDATE 
  USING (auth.uid() = customer_id AND status = 'pending');

-- ============================================================================
-- 8. Helper functions
-- ============================================================================

-- Function to check for booking conflicts (additional safety check)
CREATE OR REPLACE FUNCTION check_booking_conflict(
  p_provider_id UUID,
  p_time_start TIMESTAMPTZ,
  p_time_end TIMESTAMPTZ,
  p_exclude_booking_id UUID DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM bookings 
    WHERE provider_id = p_provider_id
      AND status IN ('pending', 'confirmed')
      AND (booking_id != p_exclude_booking_id OR p_exclude_booking_id IS NULL)
      AND tstzrange(time_start, time_end, '[)') && tstzrange(p_time_start, p_time_end, '[)')
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Migration Complete
-- ============================================================================

-- Verify migration
DO $$
BEGIN
  RAISE NOTICE 'Booking system migration completed successfully';
  RAISE NOTICE 'Added payment tracking columns: payment_intent_id, payment_status';
  RAISE NOTICE 'Added double booking prevention with exclusion constraint';
  RAISE NOTICE 'Added RLS policies for security';
END $$;
