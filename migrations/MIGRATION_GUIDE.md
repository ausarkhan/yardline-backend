# Database Migration Guide

## Running the Migration

### Option 1: Supabase Dashboard (Recommended)
1. Go to your Supabase project dashboard
2. Navigate to SQL Editor
3. Copy the contents of `001_booking_system.sql`
4. Paste and run the migration
5. Verify no errors

### Option 2: Supabase CLI
```bash
# Install Supabase CLI if not already installed
npm install -g supabase

# Link your project
supabase link --project-ref YOUR_PROJECT_REF

# Run migration
supabase db push

# Or run the SQL file directly
psql $DATABASE_URL -f migrations/001_booking_system.sql
```

### Option 3: psql Direct
```bash
psql $DATABASE_URL -f migrations/001_booking_system.sql
```

## What This Migration Does

### 1. Adds Payment Tracking Columns
- `payment_intent_id`: Stripe PaymentIntent ID
- `payment_status`: Current payment state (authorized/captured/canceled/failed/expired)
- `amount_total`: Total charge amount in cents
- `service_price_cents`: Service price component
- `platform_fee_cents`: Platform fee component
- `decline_reason`: Optional reason for decline/cancel

### 2. Creates Services Table
- Stores provider service offerings
- Links to auth.users via provider_id
- Includes price, duration, and active status
- Has proper indexes for fast queries

### 3. Updates Bookings Table
- Adds `service_id` foreign key reference
- Adds `time_start` and `time_end` computed timestamp columns
- Updates status constraint to enforce valid states

### 4. Double Booking Prevention
- Uses PostgreSQL exclusion constraint with btree_gist
- Prevents overlapping bookings for same provider
- Only applies to 'pending' and 'confirmed' bookings
- Database-level enforcement (cannot be bypassed)

### 5. Automatic Triggers
- Auto-updates `time_start`/`time_end` when date/time/service changes
- Auto-updates `updated_at` timestamp on modifications

### 6. Row Level Security (RLS)
- Customers can only view/update their own bookings
- Providers can view/update their bookings
- Services are viewable by everyone when active
- Enforces ownership at database level

## Verification

After running the migration, verify it worked:

```sql
-- Check bookings table structure
\d bookings

-- Verify constraint exists
SELECT conname, pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conrelid = 'bookings'::regclass 
AND conname = 'no_double_booking';

-- Check services table
\d services

-- Test the conflict detection function
SELECT check_booking_conflict(
  'provider-uuid'::uuid,
  '2026-01-15 14:00:00+00'::timestamptz,
  '2026-01-15 15:00:00+00'::timestamptz
);
```

## Rollback (if needed)

If you need to rollback this migration:

```sql
-- Remove added columns
ALTER TABLE bookings 
DROP COLUMN IF EXISTS payment_intent_id,
DROP COLUMN IF EXISTS payment_status,
DROP COLUMN IF EXISTS amount_total,
DROP COLUMN IF EXISTS service_price_cents,
DROP COLUMN IF EXISTS platform_fee_cents,
DROP COLUMN IF EXISTS decline_reason,
DROP COLUMN IF EXISTS time_start,
DROP COLUMN IF EXISTS time_end;

-- Drop constraint
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS no_double_booking;

-- Drop services table
DROP TABLE IF EXISTS services CASCADE;

-- Drop triggers and functions
DROP TRIGGER IF EXISTS booking_time_range_trigger ON bookings;
DROP TRIGGER IF EXISTS bookings_updated_at_trigger ON bookings;
DROP TRIGGER IF EXISTS services_updated_at_trigger ON services;
DROP FUNCTION IF EXISTS update_booking_time_range();
DROP FUNCTION IF EXISTS update_updated_at_column();
DROP FUNCTION IF EXISTS check_booking_conflict(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID);
```

## Troubleshooting

### Error: "extension btree_gist does not exist"
```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
```

### Error: "relation bookings does not exist"
This migration assumes the bookings table already exists. Create it first:
```sql
CREATE TABLE bookings (
  booking_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES auth.users(id),
  provider_id UUID NOT NULL REFERENCES auth.users(id),
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Error: "column already exists"
The migration uses `ADD COLUMN IF NOT EXISTS`, so this shouldn't happen. If it does, you can skip that specific column addition.

### Testing Double Booking Prevention
```sql
-- Insert first booking (should succeed)
INSERT INTO bookings (
  customer_id, provider_id, service_id, 
  requested_date, requested_time, status
) VALUES (
  'customer-uuid'::uuid, 
  'provider-uuid'::uuid, 
  'service-uuid'::uuid,
  '2026-01-15', 
  '14:00', 
  'confirmed'
);

-- Try to insert overlapping booking (should fail with exclusion constraint violation)
INSERT INTO bookings (
  customer_id, provider_id, service_id, 
  requested_date, requested_time, status
) VALUES (
  'customer2-uuid'::uuid, 
  'provider-uuid'::uuid,  -- Same provider
  'service-uuid'::uuid,
  '2026-01-15', 
  '14:30',  -- Overlaps with previous booking
  'confirmed'
);
-- Expected error: conflicting key value violates exclusion constraint "no_double_booking"
```

## Next Steps

After migration:
1. Update backend environment variables
2. Install Supabase client: `npm install @supabase/supabase-js`
3. Update backend code to use Supabase instead of in-memory storage
4. Test locally with Stripe test mode
5. Deploy to Railway
