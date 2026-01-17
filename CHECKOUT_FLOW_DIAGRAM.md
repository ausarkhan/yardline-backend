# Booking Checkout Session Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    STRIPE CHECKOUT SESSION FLOW                         │
│                         (Hosted Payment)                                │
└─────────────────────────────────────────────────────────────────────────┘

┌──────────┐         ┌──────────┐         ┌──────────┐         ┌──────────┐
│  Mobile  │         │ Backend  │         │  Stripe  │         │ Webhook  │
│   App    │         │   API    │         │ Checkout │         │ Handler  │
└────┬─────┘         └────┬─────┘         └────┬─────┘         └────┬─────┘
     │                    │                     │                     │
     │  1. POST /v1/bookings/checkout-session  │                     │
     │ ───────────────────>                    │                     │
     │  { bookingId }     │                    │                     │
     │                    │                     │                     │
     │                    │  2. Validate       │                     │
     │                    │  - Load booking    │                     │
     │                    │  - Check auth      │                     │
     │                    │  - Check status    │                     │
     │                    │  - Calc amount     │                     │
     │                    │                     │                     │
     │                    │  3. Create Session │                     │
     │                    │ ─────────────────> │                     │
     │                    │  stripe.checkout   │                     │
     │                    │  .sessions.create()│                     │
     │                    │                     │                     │
     │                    │  4. Return URL     │                     │
     │                    │ <───────────────── │                     │
     │                    │  { url, sessionId }│                     │
     │                    │                     │                     │
     │  5. Return URL     │                    │                     │
     │ <───────────────────                    │                     │
     │  { url, sessionId }│                    │                     │
     │                    │                     │                     │
     │  6. Open URL       │                    │                     │
     │  in Browser        │                    │                     │
     │ ───────────────────────────────────────>│                     │
     │                    │                     │                     │
     │                    │                     │                     │
     │  7. Customer       │                     │                     │
     │  Completes         │                     │                     │
     │  Payment           │                     │                     │
     │ <══════════════════════════════════════>│                     │
     │  (Stripe Hosted    │                     │                     │
     │   Payment Page)    │                     │                     │
     │                    │                     │                     │
     │                    │                     │  8. Payment Success │
     │                    │                     │ ──────────────────> │
     │                    │                     │  checkout.session   │
     │                    │                     │  .completed         │
     │                    │                     │                     │
     │                    │                     │  9. Update Booking  │
     │                    │                     │ <─────────────────  │
     │                    │                     │  UPDATE bookings    │
     │                    │                     │  SET status='conf'  │
     │                    │                     │  payment='captured' │
     │                    │                     │                     │
     │  10. Redirect      │                     │                     │
     │  Success URL       │                     │                     │
     │ <───────────────────────────────────────│                     │
     │  yardline://payment-success?            │                     │
     │  type=booking&session_id=cs_xxx         │                     │
     │                    │                     │                     │
     │  11. Refresh       │                     │                     │
     │  Booking Details   │                     │                     │
     │ ───────────────────>                    │                     │
     │  GET /v1/bookings/:id                   │                     │
     │                    │                     │                     │
     │  12. Updated       │                     │                     │
     │  Booking Data      │                     │                     │
     │ <───────────────────                    │                     │
     │  status: confirmed │                     │                     │
     │  payment: captured │                     │                     │
     │                    │                     │                     │
     │  ✅ COMPLETE       │                     │                     │
     │                    │                     │                     │
```

## Key Points

### 🔐 Security
- Amount calculated **server-side** (step 2)
- Authorization verified **before** session creation
- Webhook **signature verified** (step 8)
- **Idempotent** processing (safe to retry)

### ⚡ Automatic Confirmation
- **No provider acceptance** needed
- Booking **auto-confirmed** on payment
- **Instant** status update via webhook

### 🎯 User Experience
1. Tap "Pay" button
2. Opens browser/webview
3. Complete payment on Stripe
4. Auto-returns to app
5. Booking confirmed!

## Error Flows

### Payment Failed
```
Customer
   │
   │  Complete Payment (Card Declined)
   │ ──────────────────────────────────> Stripe
   │                                        │
   │                                        │  checkout.session
   │                                        │  .async_payment_failed
   │                                        │ ─────────────────> Webhook
   │                                        │                       │
   │                                        │              UPDATE bookings
   │                                        │              SET payment_status
   │                                        │              = 'failed'
   │                                        │                       │
   │  Redirect Cancel URL                  │                       │
   │ <──────────────────────────────────────                       │
   │  yardline://payment-cancel?                                   │
   │  type=booking&bookingId=xxx                                   │
```

### Customer Cancels
```
Customer
   │
   │  Click "Back" or "Cancel"
   │ ──────────────────────────────────> Stripe
   │                                        │
   │  Redirect Cancel URL                  │
   │ <──────────────────────────────────────
   │  yardline://payment-cancel?
   │  type=booking&bookingId=xxx
   │
   │  (No webhook - booking stays pending)
```

## Database State Transitions

```
┌─────────────────────────────────────────────────────────────┐
│                  BOOKING STATUS FLOW                        │
└─────────────────────────────────────────────────────────────┘

Initial State:
  status: 'pending'
  payment_status: 'none'
  stripe_checkout_session_id: null

After Checkout Session Created:
  status: 'pending'  (unchanged)
  payment_status: 'none'  (unchanged)
  stripe_checkout_session_id: null  (not stored yet)

After Payment Success (Webhook):
  status: 'confirmed'  ✅
  payment_status: 'captured'  ✅
  stripe_checkout_session_id: 'cs_xxx'  ✅
  payment_intent_id: 'pi_xxx'  ✅
  updated_at: NOW()  ✅

After Payment Failed (Webhook):
  status: 'pending'  (unchanged)
  payment_status: 'failed'  ❌
  stripe_checkout_session_id: null
  updated_at: NOW()
```

## Metadata Flow

```
┌─────────────────────────────────────────────────────────────┐
│              METADATA TRACKING                              │
└─────────────────────────────────────────────────────────────┘

Checkout Session Metadata:
{
  "bookingId": "uuid",
  "type": "booking",  ← CRITICAL for routing
  "customerId": "uuid",
  "providerId": "uuid",
  "serviceId": "uuid",
  "date": "2026-02-01",
  "timeStart": "14:00:00",
  "mode": "live"
}

Webhook Detection:
if (session.metadata.type === 'booking') {
  → handleBookingCheckoutSessionCompleted()
} else {
  → handleCheckoutSessionCompleted()  // Tickets
}
```

## Connect Transfers (If Provider Has Account)

```
┌─────────────────────────────────────────────────────────────┐
│              PAYMENT DISTRIBUTION                           │
└─────────────────────────────────────────────────────────────┘

Total Charge: $50.00
   │
   ├─> Service Price: $42.00
   │   └─> Transfer to Provider Account
   │       (transfer_data.destination)
   │
   └─> Platform Fee: $8.00
       └─> YardLine Platform Account
           (application_fee_amount)

Configuration in Session:
payment_intent_data: {
  transfer_data: {
    destination: providerAccountId
  },
  application_fee_amount: servicePriceCents
}
```

## Comparison: PaymentIntent vs Checkout Session

```
┌───────────────────────────────────────────────────────────────────┐
│                    PAYMENT METHODS                                │
└───────────────────────────────────────────────────────────────────┘

PaymentIntent (In-App)           Checkout Session (Hosted)
─────────────────────────        ─────────────────────────────
1. Create booking                1. Create booking (optional)
2. Get client_secret             2. Get checkout URL
3. PaymentSheet.present()        3. Open URL in browser
4. Customer enters card          4. Customer enters payment
5. Payment authorized            5. Payment completed
6. Provider accepts              6. [Auto-confirmed via webhook]
7. Backend captures              7. [Already captured]
8. Booking confirmed             8. Booking confirmed

Time: ~2-5 minutes               Time: ~30 seconds
Steps: 8                         Steps: 5
Provider action: Required        Provider action: None
Mobile SDK: Required             Mobile SDK: Optional
Payment page: In-app             Payment page: Browser/webview
```

## Summary

✅ **Simpler flow:** No provider acceptance needed  
✅ **Faster:** Payment confirms booking instantly  
✅ **Hosted:** Stripe handles payment page  
✅ **Secure:** Server-side validation throughout  
✅ **Reliable:** Webhook-driven confirmation  
