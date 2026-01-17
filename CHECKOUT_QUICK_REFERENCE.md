# Stripe Checkout for Bookings - Quick Reference

## 🚀 New Endpoint

```
POST /v1/bookings/checkout-session
```

**Body:**
```json
{ "bookingId": "uuid" }
```

**Returns:**
```json
{
  "success": true,
  "data": {
    "url": "https://checkout.stripe.com/...",
    "sessionId": "cs_..."
  }
}
```

---

## 📋 Implementation Checklist

### Backend Changes
- ✅ Added `POST /bookings/checkout-session` to bookings.ts
- ✅ Updated webhook to handle booking checkout sessions
- ✅ Added `handleBookingCheckoutSessionCompleted()` function
- ✅ Added async payment event handlers

### Database Changes
- ⚠️ **REQUIRED:** Run migration 004
  ```bash
  psql $DATABASE_URL -f migrations/004_add_checkout_session_support.sql
  ```

### Environment Variables
- ⚠️ **OPTIONAL:** Set `APP_URL_SCHEME` (defaults to 'yardline')
  ```bash
  export APP_URL_SCHEME=yardline
  ```

### Mobile App Changes
- ⚠️ **REQUIRED:** Handle deep links:
  - Success: `yardline://payment-success?type=booking&session_id={CHECKOUT_SESSION_ID}`
  - Cancel: `yardline://payment-cancel?type=booking&bookingId={bookingId}`

---

## 🧪 Quick Test

```bash
export AUTH_TOKEN='your-jwt-token'
./test-checkout-booking.sh
```

Or manually:
```bash
./curl-example-checkout.sh 'booking-uuid'
# Open returned URL in browser
# Complete payment
# Verify booking status updated
```

---

## 🔍 How It Works

1. **Create Session:** Backend creates Stripe Checkout Session
2. **Open URL:** Client opens hosted Stripe payment page in browser
3. **Pay:** Customer completes payment on Stripe
4. **Webhook:** Stripe sends `checkout.session.completed`
5. **Update:** Backend marks booking confirmed/captured
6. **Redirect:** Customer redirected back to app via deep link

---

## 📁 Files Modified

```
src/routes/bookings.ts              # Added checkout-session endpoint
src/index.ts                        # Updated webhook handler
migrations/004_add_checkout_session_support.sql  # Database migration
ENVIRONMENT_CONFIG.md               # Added APP_URL_SCHEME docs
```

## 📄 Files Created

```
CHECKOUT_SESSION_BOOKINGS.md        # Complete implementation guide
CHECKOUT_IMPLEMENTATION_SUMMARY.md  # This summary
test-checkout-booking.sh            # Automated test script
curl-example-checkout.sh            # Quick cURL example
```

---

## 🛡️ Security

- ✅ Server-side amount calculation (no client tampering)
- ✅ Authorization check (only booking owner)
- ✅ Status validation (no cancelled/declined bookings)
- ✅ Idempotent webhooks (safe retries)
- ✅ Signature verification (authentic events only)
- ✅ Review mode enforcement (App Store limits)

---

## 🐛 Common Issues

| Issue | Fix |
|-------|-----|
| Webhook not updating | Check `STRIPE_LIVE_WEBHOOK_SECRET` configured |
| Deep link not working | Verify `APP_URL_SCHEME` matches app config |
| `already_paid` error | Booking has existing checkout session |
| `invalid_state` error | Booking is cancelled or declined |

---

## 📊 Monitoring

Check logs for:
```
✅ Created Checkout Session cs_xxx for booking uuid
✅ Booking uuid marked as paid via checkout session cs_xxx
```

Check database:
```sql
SELECT 
  id,
  status,
  payment_status,
  stripe_checkout_session_id
FROM bookings
WHERE stripe_checkout_session_id IS NOT NULL;
```

---

## 🎯 Key Differences from PaymentIntent Flow

| PaymentIntent (In-App) | Checkout Session (Hosted) |
|------------------------|---------------------------|
| Client confirms payment | Stripe hosted page |
| Provider must accept | Auto-confirms on payment |
| Requires PaymentSheet | Opens in browser |
| Manual capture flow | Auto-capture |

---

## 📚 Documentation

- **Full Guide:** [CHECKOUT_SESSION_BOOKINGS.md](./CHECKOUT_SESSION_BOOKINGS.md)
- **Summary:** [CHECKOUT_IMPLEMENTATION_SUMMARY.md](./CHECKOUT_IMPLEMENTATION_SUMMARY.md)
- **Migration:** [migrations/004_add_checkout_session_support.sql](./migrations/004_add_checkout_session_support.sql)

---

**Status: ✅ Implementation Complete - Ready for Production**
