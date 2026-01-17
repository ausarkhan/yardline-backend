# Stripe Checkout for Bookings - Implementation Guide

## Overview
This implementation adds Stripe-hosted Checkout Session support for bookings, allowing customers to pay via a Stripe-hosted payment page instead of in-app PaymentSheet.

## New Endpoint

### POST /v1/bookings/checkout-session

Creates a Stripe Checkout Session for an existing booking and returns the hosted payment page URL.

**Request:**
```json
{
  "bookingId": "uuid-of-booking"
}
```

**Response:**
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
- `400` - Invalid request, booking not payable, or already paid
- `403` - User does not own the booking
- `404` - Booking not found
- `500` - Server error

## Environment Variables

Add the following to your `.env` file:

```bash
# Mobile app deep link URL scheme (defaults to 'yardline')
APP_URL_SCHEME=yardline
```

This is used to construct the success and cancel URLs:
- Success: `yardline://payment-success?type=booking&session_id={CHECKOUT_SESSION_ID}`
- Cancel: `yardline://payment-cancel?type=booking&bookingId={bookingId}`

## Mobile App Integration

### 1. Create Checkout Session

```typescript
const response = await fetch('https://api.yardline.app/v1/bookings/checkout-session', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${userToken}`
  },
  body: JSON.stringify({
    bookingId: 'booking-uuid'
  })
});

const { data } = await response.json();
const { url, sessionId } = data;
```

### 2. Open Checkout URL in Browser

```typescript
// Open Stripe hosted checkout page
Linking.openURL(url);
```

### 3. Handle Deep Link Return

```typescript
// Listen for app deep links
Linking.addEventListener('url', (event) => {
  const url = new URL(event.url);
  
  if (url.pathname === '//payment-success') {
    const sessionId = url.searchParams.get('session_id');
    const type = url.searchParams.get('type');
    
    if (type === 'booking') {
      // Payment successful! Booking is now confirmed
      // Webhook has already updated the booking status
      // Refresh booking details from API
      fetchBookingDetails(bookingId);
    }
  }
  
  if (url.pathname === '//payment-cancel') {
    // User cancelled payment
    // Show cancellation message
  }
});
```

## Testing with cURL

### Create a Checkout Session

```bash
# Set variables
BOOKING_ID="your-booking-uuid"
AUTH_TOKEN="your-jwt-token"
API_URL="http://localhost:3000"  # or https://api.yardline.app

# Create checkout session
curl -X POST "$API_URL/v1/bookings/checkout-session" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $AUTH_TOKEN" \\
  -d "{\"bookingId\": \"$BOOKING_ID\"}"

# Example response:
# {
#   "success": true,
#   "data": {
#     "url": "https://checkout.stripe.com/c/pay/cs_test_...",
#     "sessionId": "cs_test_..."
#   }
# }
```

### Complete Payment Flow Test

```bash
# 1. Create a booking (existing endpoint)
BOOKING_RESPONSE=$(curl -X POST "$API_URL/v1/bookings" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $AUTH_TOKEN" \\
  -d '{
    "serviceId": "service-uuid",
    "date": "2026-02-01",
    "timeStart": "14:00:00",
    "customerEmail": "customer@example.com",
    "customerName": "John Doe"
  }')

BOOKING_ID=$(echo $BOOKING_RESPONSE | jq -r '.data.booking.id')
echo "Created booking: $BOOKING_ID"

# 2. Create checkout session
CHECKOUT_RESPONSE=$(curl -X POST "$API_URL/v1/bookings/checkout-session" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $AUTH_TOKEN" \\
  -d "{\"bookingId\": \"$BOOKING_ID\"}")

CHECKOUT_URL=$(echo $CHECKOUT_RESPONSE | jq -r '.data.url')
echo "Checkout URL: $CHECKOUT_URL"

# 3. Open in browser to complete payment
echo "Open this URL to complete payment:"
echo $CHECKOUT_URL

# 4. After payment, check booking status
sleep 5  # Wait for webhook
curl "$API_URL/v1/bookings/$BOOKING_ID" \\
  -H "Authorization: Bearer $AUTH_TOKEN" \\
  | jq '.data | {status, payment_status, stripe_checkout_session_id}'
```

## Webhook Processing

The webhook handler processes three events for booking checkout sessions:

### 1. checkout.session.completed
- Triggered when customer completes payment
- Marks booking as `confirmed` with `payment_status: 'captured'`
- Stores `stripe_checkout_session_id` and `payment_intent_id`
- Idempotent (safe to retry)

### 2. checkout.session.async_payment_succeeded
- For delayed payment methods (ACH, SEPA, etc.)
- Same processing as `completed`

### 3. checkout.session.async_payment_failed
- Marks booking `payment_status: 'failed'`

## Database Schema

The `bookings` table includes:

```sql
-- New column added by migration 004
stripe_checkout_session_id TEXT  -- Checkout Session ID (cs_...)

-- Existing columns used
payment_intent_id TEXT           -- PaymentIntent ID (pi_...)
payment_status TEXT              -- 'none', 'authorized', 'captured', 'canceled', 'failed'
status TEXT                      -- 'pending', 'confirmed', 'declined', 'cancelled', 'expired'
```

## Security Features

1. **Server-side amount calculation** - Client cannot manipulate payment amount
2. **Authorization check** - Only booking owner can create checkout session
3. **Status validation** - Cannot checkout for cancelled/declined bookings
4. **Idempotent webhook processing** - Duplicate events are safely ignored
5. **Review mode enforcement** - Respects `REVIEW_MODE_MAX_CHARGE_CENTS` limit
6. **Webhook signature verification** - All webhook events are verified

## Payment Flow Comparison

### PaymentIntent (In-App) - Original
1. Client creates booking → Returns `paymentIntentClientSecret`
2. Client confirms payment with PaymentSheet
3. Provider accepts → Backend captures payment
4. Booking confirmed

### Checkout Session (Hosted) - New
1. Client creates booking (optional - can be pre-existing)
2. Client requests checkout session → Returns hosted URL
3. Client opens URL in browser
4. Customer completes payment on Stripe page
5. Webhook confirms payment → Booking auto-confirmed
6. Client redirected back via deep link

## Connect Transfers

If the booking has a provider with a connected Stripe account, the checkout session automatically configures:
- `transfer_data.destination` - Provider's connected account
- `application_fee_amount` - Platform fee (service_price_cents)

This ensures the provider receives their payment automatically when the booking is paid.

## Migration

Run the migration to add checkout session support:

```bash
psql $DATABASE_URL -f migrations/004_add_checkout_session_support.sql
```

Or via Supabase dashboard:
```sql
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT;
CREATE INDEX IF NOT EXISTS bookings_checkout_session_idx ON bookings(stripe_checkout_session_id) WHERE stripe_checkout_session_id IS NOT NULL;
```

## Monitoring & Logs

Look for these log messages:

**Session Creation:**
```
✅ Created Checkout Session cs_test_xxx for booking uuid
   Amount: $50.00, Service: Lawn Mowing
```

**Webhook Processing:**
```
🛒 Processing booking checkout session: cs_test_xxx
✅ Booking uuid marked as paid via checkout session cs_test_xxx
   Payment Intent: pi_xxx, Amount: $50.00
```

## Troubleshooting

### Session creation fails with "already_paid"
- Booking already has a checkout session
- Check `stripe_checkout_session_id` column

### Webhook not updating booking
- Verify webhook secret is configured: `STRIPE_LIVE_WEBHOOK_SECRET`
- Check webhook logs in Stripe Dashboard
- Ensure `type: 'booking'` is in session metadata

### Deep link not working
- Verify `APP_URL_SCHEME` matches app configuration
- Check iOS `Info.plist` and Android `AndroidManifest.xml` for URL scheme

## Future Enhancements

Potential improvements:
- Add `checkout.session.expired` handling
- Support refunds via checkout session
- Add checkout session status polling endpoint
- Store customer details from checkout session
