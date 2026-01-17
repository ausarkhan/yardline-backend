# Stripe Checkout Session for Bookings - Implementation Summary

## ✅ Implementation Complete

This implementation adds Stripe-hosted Checkout Session support for bookings, allowing customers to complete payment via a Stripe-hosted payment page with automatic booking confirmation via webhooks.

---

## Files Modified

### 1. `/src/routes/bookings.ts`
**Added:** `POST /bookings/checkout-session` endpoint

**Route Pattern:**
- Defined inside router as: `router.post('/bookings/checkout-session', ...)`
- Mounted at `/v1` in index.ts
- **Final URL:** `POST /v1/bookings/checkout-session`

**Features:**
- ✅ Validates bookingId from request body
- ✅ Loads booking from database
- ✅ Authorization check (customer owns booking)
- ✅ Status validation (cannot checkout cancelled/declined bookings)
- ✅ Prevents duplicate checkout sessions
- ✅ Calculates amount server-side (no client tampering)
- ✅ Review mode enforcement
- ✅ Creates Stripe Checkout Session with proper metadata
- ✅ Configures Connect transfers for provider payouts
- ✅ Returns hosted URL and sessionId

### 2. `/src/index.ts`
**Modified:** Webhook handler and added booking checkout session processing

**Changes:**
1. Updated `handleCheckoutSessionCompleted()` to detect booking sessions via `metadata.type === 'booking'`
2. Added new function `handleBookingCheckoutSessionCompleted()` to mark bookings paid
3. Added handlers for async payment events:
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`

**Webhook Features:**
- ✅ Idempotent processing (safe to retry)
- ✅ Marks booking as `confirmed` with `payment_status: 'captured'`
- ✅ Stores `stripe_checkout_session_id` and `payment_intent_id`
- ✅ Handles delayed payment methods (ACH, SEPA)
- ✅ Comprehensive error logging

---

## Files Created

### 1. `/migrations/004_add_checkout_session_support.sql`
Adds database column to track checkout sessions:

```sql
ALTER TABLE bookings ADD COLUMN stripe_checkout_session_id TEXT;
CREATE INDEX bookings_checkout_session_idx ON bookings(stripe_checkout_session_id);
```

### 2. `/CHECKOUT_SESSION_BOOKINGS.md`
Complete implementation guide covering:
- API endpoint documentation
- Mobile app integration steps
- Deep link handling
- Testing with cURL
- Webhook processing details
- Security features
- Troubleshooting guide

### 3. `/test-checkout-booking.sh`
Automated test script that:
- Creates test service
- Creates test booking
- Creates checkout session
- Prompts for manual payment
- Verifies webhook updated booking
- Tests error cases

### 4. `/curl-example-checkout.sh`
Quick example for creating checkout session:
```bash
export AUTH_TOKEN='your-token'
./curl-example-checkout.sh 'booking-uuid'
```

---

## Environment Variables

### New Variable

Add to `.env`:

```bash
# Mobile app URL scheme for deep link redirects
APP_URL_SCHEME=yardline  # Default if not set
```

Updated in `/ENVIRONMENT_CONFIG.md`

---

## API Specification

### Endpoint: POST /v1/bookings/checkout-session

**Authentication:** Required (Bearer token)

**Request:**
```json
{
  "bookingId": "uuid-of-booking"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "url": "https://checkout.stripe.com/c/pay/cs_test_...",
    "sessionId": "cs_test_..."
  }
}
```

**Error Responses:**

| Code | Type | Description |
|------|------|-------------|
| 400 | `invalid_request_error` | Missing bookingId |
| 400 | `invalid_state` | Booking is cancelled/declined |
| 400 | `already_paid` | Checkout session already exists |
| 400 | `amount_too_small` | Amount below $0.50 |
| 400 | `review_mode_error` | Amount exceeds review mode limit |
| 403 | `permission_denied` | User doesn't own booking |
| 404 | `resource_missing` | Booking not found |
| 500 | `api_error` | Server error |

---

## Integration Flow

### Mobile App Integration

```typescript
// 1. Create checkout session
const { data } = await fetch('/v1/bookings/checkout-session', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ bookingId })
}).then(r => r.json());

// 2. Open Stripe hosted page
Linking.openURL(data.url);

// 3. Handle return via deep link
Linking.addEventListener('url', (event) => {
  const url = new URL(event.url);
  if (url.searchParams.get('type') === 'booking') {
    const sessionId = url.searchParams.get('session_id');
    // Payment complete! Refresh booking details
    fetchBooking(bookingId);
  }
});
```

### Deep Link URLs

**Success:**
```
yardline://payment-success?type=booking&session_id={CHECKOUT_SESSION_ID}
```

**Cancel:**
```
yardline://payment-cancel?type=booking&bookingId={bookingId}
```

---

## Webhook Processing

### Events Handled

| Event | Action |
|-------|--------|
| `checkout.session.completed` | Mark booking paid (status=confirmed, payment_status=captured) |
| `checkout.session.async_payment_succeeded` | Same as completed (delayed payment methods) |
| `checkout.session.async_payment_failed` | Mark payment_status=failed |

### Session Metadata

All checkout sessions include:
```json
{
  "bookingId": "uuid",
  "type": "booking",
  "customerId": "uuid",
  "providerId": "uuid",
  "serviceId": "uuid",
  "date": "2026-02-01",
  "timeStart": "14:00:00",
  "mode": "live"
}
```

### Database Updates

Webhook updates bookings table:
```sql
UPDATE bookings SET
  status = 'confirmed',
  payment_status = 'captured',
  stripe_checkout_session_id = 'cs_...',
  payment_intent_id = 'pi_...',
  updated_at = NOW()
WHERE id = booking_id;
```

---

## Testing

### Run Automated Test

```bash
export AUTH_TOKEN='your-jwt-token'
export API_URL='http://localhost:3000'
./test-checkout-booking.sh
```

The script will:
1. ✅ Create test service
2. ✅ Create test booking
3. ✅ Create checkout session
4. ⏸️ Pause for manual payment
5. ✅ Verify webhook updated booking
6. ✅ Test error cases

### Quick Manual Test

```bash
# Create checkout session
export AUTH_TOKEN='your-token'
./curl-example-checkout.sh 'your-booking-id'

# Open URL in browser
# Complete payment
# Check booking status
curl http://localhost:3000/v1/bookings/your-booking-id \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  | jq '.data | {status, payment_status, stripe_checkout_session_id}'
```

---

## Security Features

✅ **Server-side amount calculation** - Client cannot manipulate price  
✅ **Authorization enforcement** - Only booking owner can checkout  
✅ **Status validation** - Cannot checkout cancelled/declined bookings  
✅ **Webhook signature verification** - All events verified  
✅ **Idempotent processing** - Duplicate webhooks handled safely  
✅ **Review mode limits** - Respects $1.00 limit during app review  
✅ **No client secrets exposed** - Only returns public checkout URL  

---

## Payment Flow Comparison

### Original (PaymentIntent In-App)
1. Create booking → Get client_secret
2. Confirm payment with PaymentSheet
3. Provider accepts → Capture payment
4. Booking confirmed

### New (Checkout Session Hosted) ⭐
1. Create booking (optional - can be pre-existing)
2. Request checkout session → Get URL
3. Open URL in browser
4. Complete payment on Stripe page
5. **Webhook auto-confirms booking**
6. Redirect back via deep link

**Key Advantage:** No provider acceptance needed - payment immediately confirms booking!

---

## Connect Transfers

If booking has a provider with Stripe Connect account:

```typescript
sessionParams.payment_intent_data = {
  transfer_data: {
    destination: providerAccountId  // Provider's connected account
  },
  application_fee_amount: service_price_cents,  // Platform fee
  metadata: { ... }
};
```

Provider automatically receives their payout when payment succeeds.

---

## Database Schema Changes

### Added Column

```sql
-- bookings table
stripe_checkout_session_id TEXT  -- Checkout Session ID (cs_...)
```

### Existing Columns Used

```sql
payment_intent_id TEXT           -- PaymentIntent ID (pi_...)
payment_status TEXT              -- 'captured' after successful checkout
status TEXT                      -- 'confirmed' after successful checkout
```

---

## Migration Instructions

### Apply Database Migration

```bash
# Via psql
psql $DATABASE_URL -f migrations/004_add_checkout_session_support.sql

# Or via Supabase dashboard
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT;
CREATE INDEX bookings_checkout_session_idx ON bookings(stripe_checkout_session_id) 
  WHERE stripe_checkout_session_id IS NOT NULL;
```

### Update Environment

```bash
# Add to .env
APP_URL_SCHEME=yardline
```

### Deploy Backend

```bash
git pull origin main
npm install  # if dependencies changed
pm2 restart yardline-api  # or your process manager
```

---

## Monitoring

### Success Logs

```
✅ Created Checkout Session cs_test_xxx for booking uuid-xxx
   Amount: $50.00, Service: Lawn Mowing

🛒 Processing booking checkout session: cs_test_xxx
✅ Booking uuid-xxx marked as paid via checkout session cs_test_xxx
   Payment Intent: pi_xxx, Amount: $50.00
```

### Error Logs

```
❌ Booking uuid-xxx not found for checkout session cs_xxx
❌ Failed to update booking uuid-xxx: [error details]
```

### Stripe Dashboard

Monitor in Stripe Dashboard:
- Payments → Checkout Sessions
- Filter by metadata: `type: booking`
- View session details and customer journey

---

## Troubleshooting

### Session Creation Fails

**Issue:** `already_paid` error  
**Fix:** Booking already has checkout session - check `stripe_checkout_session_id` column

**Issue:** `invalid_state` error  
**Fix:** Booking is cancelled/declined - create new booking

### Webhook Not Updating Booking

**Issue:** Booking still pending after payment  
**Checks:**
1. Verify webhook endpoint accessible: `curl https://your-api.com/v1/stripe/webhooks`
2. Check webhook secret configured: `STRIPE_LIVE_WEBHOOK_SECRET`
3. Verify webhook event includes `metadata.type: 'booking'`
4. Check server logs for webhook errors
5. View webhook attempts in Stripe Dashboard

### Deep Link Not Working

**Issue:** App doesn't open after payment  
**Fixes:**
1. Verify `APP_URL_SCHEME` matches app configuration
2. Check iOS `Info.plist`: `CFBundleURLSchemes` includes scheme
3. Check Android `AndroidManifest.xml`: `<data android:scheme="yardline" />`
4. Test deep link: `xcrun simctl openurl booted "yardline://payment-success?type=booking&session_id=cs_test"`

---

## Future Enhancements

Potential improvements:
- [ ] Add `checkout.session.expired` webhook handler
- [ ] Support refunds via checkout session
- [ ] Add session status polling endpoint
- [ ] Store customer details from checkout
- [ ] Support payment method collection for future use
- [ ] Add receipt email configuration

---

## Documentation Links

- **Implementation Guide:** [CHECKOUT_SESSION_BOOKINGS.md](./CHECKOUT_SESSION_BOOKINGS.md)
- **Environment Config:** [ENVIRONMENT_CONFIG.md](./ENVIRONMENT_CONFIG.md)
- **Database Migration:** [migrations/004_add_checkout_session_support.sql](./migrations/004_add_checkout_session_support.sql)
- **Test Script:** [test-checkout-booking.sh](./test-checkout-booking.sh)
- **cURL Example:** [curl-example-checkout.sh](./curl-example-checkout.sh)

---

## Summary

✅ **Endpoint Added:** `POST /v1/bookings/checkout-session`  
✅ **Webhook Enhanced:** Processes booking checkout sessions  
✅ **Database Migration:** Adds `stripe_checkout_session_id` column  
✅ **Documentation:** Complete guide and examples  
✅ **Testing:** Automated test script included  
✅ **Security:** Server-side validation, idempotent webhooks  
✅ **Integration:** Deep link support for mobile apps  

**Ready for production use!** 🚀
