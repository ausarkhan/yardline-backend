# YardLine Booking Backend - Test Checklist

## Schema Validation

### ✅ Database Schema
- [ ] Verify `bookings` table has columns:
  - `id` (uuid PK)
  - `customer_id` (uuid)
  - `provider_id` (uuid)
  - `service_id` (uuid, nullable)
  - `date` (date)
  - `time_start` (time without time zone)
  - `time_end` (time without time zone)
  - `time_range` (tsrange, generated)
  - `status` (text with CHECK constraint)
  - `payment_intent_id` (text, nullable)
  - `payment_status` (text with CHECK constraint)
  - `amount_total` (int, nullable)
  - `service_price_cents` (int, nullable)
  - `platform_fee_cents` (int, nullable)
  - `decline_reason` (text, nullable)
  - `created_at`, `updated_at` (timestamptz)

- [ ] Verify exclusion constraint exists:
  ```sql
  CONSTRAINT no_double_booking EXCLUDE USING gist (provider_id WITH =, time_range WITH &&)
  WHERE (status IN ('pending','confirmed'))
  ```

- [ ] Verify SQL function exists:
  ```sql
  check_booking_conflict(p_provider_id uuid, p_date date, p_time_start time, p_time_end time, p_exclude_booking_id uuid)
  ```

## API Tests

### 1. Create Booking (POST /v1/bookings)

#### Test 1.1: Create valid booking with service
```bash
curl -X POST http://localhost:3000/v1/bookings \
  -H "Authorization: Bearer <customer_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "serviceId": "<service_uuid>",
    "date": "2026-02-15",
    "timeStart": "10:00:00",
    "customerEmail": "customer@example.com",
    "customerName": "Test Customer"
  }'
```
**Expected:**
- ✅ Status 200
- ✅ Returns booking object with `id`, `date`, `time_start`, `time_end`
- ✅ `status` = 'pending'
- ✅ `payment_status` = 'authorized'
- ✅ `payment_intent_id` is set
- ✅ `platform_fee_cents` = max(99, min(round(0.08 * service_price_cents), 1299))
- ✅ `amount_total` = service_price_cents + platform_fee_cents

#### Test 1.2: Create booking with custom timeEnd
```bash
curl -X POST http://localhost:3000/v1/bookings \
  -H "Authorization: Bearer <customer_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "serviceId": "<service_uuid>",
    "date": "2026-02-15",
    "timeStart": "14:00:00",
    "timeEnd": "16:30:00",
    "customerEmail": "customer@example.com"
  }'
```
**Expected:**
- ✅ Status 200
- ✅ Uses provided `timeEnd` instead of calculating from service duration

#### Test 1.3: Validation - Invalid time (end <= start)
```bash
curl -X POST http://localhost:3000/v1/bookings \
  -H "Authorization: Bearer <customer_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "serviceId": "<service_uuid>",
    "date": "2026-02-15",
    "timeStart": "10:00:00",
    "timeEnd": "09:00:00"
  }'
```
**Expected:**
- ✅ Status 400
- ✅ Error: "End time must be after start time"

#### Test 1.4: Validation - Past date/time
```bash
curl -X POST http://localhost:3000/v1/bookings \
  -H "Authorization: Bearer <customer_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "serviceId": "<service_uuid>",
    "date": "2020-01-01",
    "timeStart": "10:00:00"
  }'
```
**Expected:**
- ✅ Status 400
- ✅ Error: "Requested time must be in the future"

### 2. Booking Conflicts (409 Handling)

#### Test 2.1: Create conflicting booking (same provider, overlapping time)
```bash
# First booking
curl -X POST http://localhost:3000/v1/bookings \
  -H "Authorization: Bearer <customer1_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "serviceId": "<service_uuid>",
    "date": "2026-02-20",
    "timeStart": "10:00:00",
    "timeEnd": "11:00:00"
  }'

# Second booking (conflict)
curl -X POST http://localhost:3000/v1/bookings \
  -H "Authorization: Bearer <customer2_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "serviceId": "<same_service_uuid>",
    "date": "2026-02-20",
    "timeStart": "10:30:00",
    "timeEnd": "11:30:00"
  }'
```
**Expected:**
- ✅ First booking: Status 200
- ✅ Second booking: Status 409
- ✅ Error type: 'booking_conflict'
- ✅ Error message: "Time slot already booked"

#### Test 2.2: Exact same time slot
```bash
curl -X POST http://localhost:3000/v1/bookings \
  -H "Authorization: Bearer <customer_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "serviceId": "<service_uuid>",
    "date": "2026-02-21",
    "timeStart": "14:00:00",
    "timeEnd": "15:00:00"
  }'

# Try to book same slot again
curl -X POST http://localhost:3000/v1/bookings \
  -H "Authorization: Bearer <another_customer_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "serviceId": "<same_service_uuid>",
    "date": "2026-02-21",
    "timeStart": "14:00:00",
    "timeEnd": "15:00:00"
  }'
```
**Expected:**
- ✅ First booking: Status 200
- ✅ Second booking: Status 409

#### Test 2.3: Non-overlapping bookings (should succeed)
```bash
curl -X POST http://localhost:3000/v1/bookings \
  -H "Authorization: Bearer <customer_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "serviceId": "<service_uuid>",
    "date": "2026-02-22",
    "timeStart": "10:00:00",
    "timeEnd": "11:00:00"
  }'

# Adjacent booking (starts when first ends)
curl -X POST http://localhost:3000/v1/bookings \
  -H "Authorization: Bearer <customer_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "serviceId": "<same_service_uuid>",
    "date": "2026-02-22",
    "timeStart": "11:00:00",
    "timeEnd": "12:00:00"
  }'
```
**Expected:**
- ✅ Both bookings: Status 200 (no overlap, ranges use '[)' - exclusive end)

### 3. List Bookings (GET /v1/bookings)

#### Test 3.1: List as customer
```bash
curl -X GET "http://localhost:3000/v1/bookings?role=customer" \
  -H "Authorization: Bearer <customer_token>"
```
**Expected:**
- ✅ Status 200
- ✅ Returns only bookings where `customer_id` = authenticated user

#### Test 3.2: List as provider
```bash
curl -X GET "http://localhost:3000/v1/bookings?role=provider" \
  -H "Authorization: Bearer <provider_token>"
```
**Expected:**
- ✅ Status 200
- ✅ Returns only bookings where `provider_id` = authenticated user

#### Test 3.3: Filter by status
```bash
curl -X GET "http://localhost:3000/v1/bookings?role=provider&status=pending" \
  -H "Authorization: Bearer <provider_token>"
```
**Expected:**
- ✅ Returns only pending bookings for the provider

### 4. Accept Booking (POST /v1/bookings/:id/accept)

#### Test 4.1: Provider accepts pending booking
```bash
curl -X POST http://localhost:3000/v1/bookings/<booking_id>/accept \
  -H "Authorization: Bearer <provider_token>"
```
**Expected:**
- ✅ Status 200
- ✅ `status` updated to 'confirmed'
- ✅ `payment_status` updated to 'captured'
- ✅ Stripe PaymentIntent is captured
- ✅ Returns updated booking

#### Test 4.2: Accept with conflicting booking (race condition)
```bash
# Create two pending bookings for same time slot
# (requires manual DB insert to bypass initial check)
# Then try to accept both

curl -X POST http://localhost:3000/v1/bookings/<booking1_id>/accept \
  -H "Authorization: Bearer <provider_token>"

curl -X POST http://localhost:3000/v1/bookings/<booking2_id>/accept \
  -H "Authorization: Bearer <provider_token>"
```
**Expected:**
- ✅ First accept: Status 200
- ✅ Second accept: Status 409
- ✅ Error: "You have a conflicting booking at this time"

#### Test 4.3: Non-provider tries to accept
```bash
curl -X POST http://localhost:3000/v1/bookings/<booking_id>/accept \
  -H "Authorization: Bearer <customer_token>"
```
**Expected:**
- ✅ Status 403
- ✅ Error: "You do not have permission to accept this booking"

#### Test 4.4: Accept already confirmed booking (idempotency)
```bash
curl -X POST http://localhost:3000/v1/bookings/<already_confirmed_booking_id>/accept \
  -H "Authorization: Bearer <provider_token>"
```
**Expected:**
- ✅ Status 400
- ✅ Error: "Booking is confirmed, not pending"

### 5. Decline Booking (POST /v1/bookings/:id/decline)

#### Test 5.1: Provider declines pending booking
```bash
curl -X POST http://localhost:3000/v1/bookings/<booking_id>/decline \
  -H "Authorization: Bearer <provider_token>" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Not available at this time"}'
```
**Expected:**
- ✅ Status 200
- ✅ `status` updated to 'declined'
- ✅ `payment_status` updated to 'canceled'
- ✅ `decline_reason` is set
- ✅ Stripe PaymentIntent is canceled

#### Test 5.2: Decline without reason
```bash
curl -X POST http://localhost:3000/v1/bookings/<booking_id>/decline \
  -H "Authorization: Bearer <provider_token>"
```
**Expected:**
- ✅ Status 200
- ✅ `decline_reason` is null

### 6. Cancel Booking (POST /v1/bookings/:id/cancel)

#### Test 6.1: Customer cancels pending booking
```bash
curl -X POST http://localhost:3000/v1/bookings/<booking_id>/cancel \
  -H "Authorization: Bearer <customer_token>" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Changed my mind"}'
```
**Expected:**
- ✅ Status 200
- ✅ `status` updated to 'cancelled'
- ✅ `payment_status` updated to 'canceled'
- ✅ Stripe PaymentIntent is canceled

#### Test 6.2: Customer tries to cancel confirmed booking
```bash
curl -X POST http://localhost:3000/v1/bookings/<confirmed_booking_id>/cancel \
  -H "Authorization: Bearer <customer_token>"
```
**Expected:**
- ✅ Status 400
- ✅ Error: "Cannot cancel confirmed booking. Please contact the provider."

### 7. Platform Fee Calculation

Verify the formula: `platformFee = max(99, min(round(0.08 * price), 1299))`

#### Test 7.1: Low price (< $12.38)
```bash
# Service price: $10.00 (1000 cents)
# Expected platform fee: $0.99 (99 cents - minimum)
```
**Expected:**
- ✅ `platform_fee_cents` = 99
- ✅ `amount_total` = 1099

#### Test 7.2: Mid-range price
```bash
# Service price: $50.00 (5000 cents)
# Expected platform fee: $4.00 (400 cents = 0.08 * 5000)
```
**Expected:**
- ✅ `platform_fee_cents` = 400
- ✅ `amount_total` = 5400

#### Test 7.3: High price (> $162.38)
```bash
# Service price: $200.00 (20000 cents)
# Expected platform fee: $12.99 (1299 cents - maximum)
```
**Expected:**
- ✅ `platform_fee_cents` = 1299
- ✅ `amount_total` = 21299

## Edge Cases & Error Handling

### 8. Database Constraint Verification

#### Test 8.1: Verify exclusion constraint in DB
```sql
-- Check constraint exists
SELECT conname, pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conname = 'no_double_booking';

-- Try to insert overlapping bookings manually
INSERT INTO bookings (customer_id, provider_id, date, time_start, time_end, status)
VALUES 
  ('customer-uuid', 'provider-uuid', '2026-03-01', '10:00:00', '11:00:00', 'pending'),
  ('customer2-uuid', 'provider-uuid', '2026-03-01', '10:30:00', '11:30:00', 'pending');
-- Should fail with SQLSTATE 23P01
```

#### Test 8.2: Verify SQL function works
```sql
SELECT check_booking_conflict(
  'provider-uuid',
  '2026-03-01',
  '10:00:00',
  '11:00:00'
);
-- Should return true if conflict exists, false otherwise
```

### 9. Authentication & Authorization

#### Test 9.1: Create booking without auth
```bash
curl -X POST http://localhost:3000/v1/bookings \
  -H "Content-Type: application/json" \
  -d '{"serviceId": "test", "date": "2026-02-15", "timeStart": "10:00:00"}'
```
**Expected:**
- ✅ Status 401
- ✅ Error: "Missing or invalid authorization header"

#### Test 9.2: Customer tries to accept their own booking
```bash
curl -X POST http://localhost:3000/v1/bookings/<booking_id>/accept \
  -H "Authorization: Bearer <customer_token_who_created_it>"
```
**Expected:**
- ✅ Status 403
- ✅ Error: Permission denied

## Summary Checklist

- [ ] All booking CRUD operations work with `date` + `time_start` + `time_end` format
- [ ] No `timestamptz` or `tstzrange` used in application code
- [ ] Platform fee formula implemented server-side
- [ ] Conflict checking works via SQL function
- [ ] Exclusion constraint prevents race conditions (returns 409)
- [ ] PaymentIntent capture on accept, cancel on decline
- [ ] Role-based filtering (`role=customer` or `role=provider`)
- [ ] Proper auth/ownership enforcement
- [ ] Time validation (end > start, future dates only)
- [ ] Idempotency on accept/decline operations

## Manual Testing Script

See `test-booking-system.sh` for automated test scenarios.
