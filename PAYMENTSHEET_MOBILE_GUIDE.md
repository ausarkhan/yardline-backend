# PaymentSheet Integration Guide

## Overview

The booking API now supports Stripe PaymentSheet for collecting card payments and Apple Pay on mobile devices. This guide explains the updated flow for creating bookings with deposit payments.

## Updated Flow

### Previous Flow (Server-Side Confirmation)
1. Client calls `POST /v1/bookings/request`
2. Server creates and **confirms** PaymentIntent
3. Payment processed immediately
4. Booking created
5. ❌ **Problem**: No UI for card entry / Apple Pay

### New Flow (Client-Side Confirmation with PaymentSheet)
1. Client calls `POST /v1/bookings/request`
2. Server creates PaymentIntent and returns `client_secret`
3. ✅ Client presents PaymentSheet with `client_secret`
4. User enters card / Apple Pay and confirms
5. Client calls `POST /v1/bookings/confirm-deposit` with `payment_intent_id`
6. Server verifies payment succeeded and creates booking

---

## API Reference

### 1. Request Booking (Get PaymentIntent)

**Endpoint**: `POST /v1/bookings/request`

**Headers**:
```
Authorization: Bearer <customer_jwt_token>
Content-Type: application/json
```

**Request Body**:
```json
{
  "service_id": "uuid",
  "provider_id": "uuid",
  "date": "2026-01-15",
  "time_start": "14:00",
  "time_end": "15:00",
  "promo_code": "OPTIONAL"
}
```

**Response** (200 OK):
```json
{
  "bookingDraft": {
    "service_id": "uuid",
    "provider_id": "uuid",
    "date": "2026-01-15",
    "time_start": "14:00",
    "time_end": "15:00",
    "service_price_cents": 10000,
    "platform_fee_cents": 500
  },
  "paymentIntentClientSecret": "pi_xxx_secret_xxx",
  "paymentIntentId": "pi_xxx"
}
```

**Store the `bookingDraft` object** – you'll need to send it back in step 2.

---

### 2. Present PaymentSheet (Mobile Client)

Use the `paymentIntentClientSecret` to initialize Stripe PaymentSheet:

**iOS (Swift) Example**:
```swift
import StripePaymentSheet

// Initialize PaymentSheet
var configuration = PaymentSheet.Configuration()
configuration.merchantDisplayName = "YardLine"
configuration.applePay = .enabled(
    merchantId: "your-merchant-id",
    merchantCountryCode: "US"
)

let paymentSheet = PaymentSheet(
    paymentIntentClientSecret: clientSecret,
    configuration: configuration
)

// Present PaymentSheet
paymentSheet.present(from: viewController) { result in
    switch result {
    case .completed:
        // Payment succeeded! Call confirm-deposit endpoint
        self.confirmBooking(paymentIntentId: self.paymentIntentId, bookingDraft: self.bookingDraft)
    case .canceled:
        // User canceled
        print("Payment canceled")
    case .failed(let error):
        // Payment failed
        print("Payment failed: \(error)")
    }
}
```

**React Native Example**:
```javascript
import { useStripe } from '@stripe/stripe-react-native';

const { initPaymentSheet, presentPaymentSheet } = useStripe();

// Initialize PaymentSheet
const { error } = await initPaymentSheet({
  paymentIntentClientSecret: clientSecret,
  merchantDisplayName: 'YardLine',
  applePay: {
    merchantCountryCode: 'US',
  },
  googlePay: {
    merchantCountryCode: 'US',
    testEnv: __DEV__,
  },
});

if (error) {
  console.error('PaymentSheet init error:', error);
  return;
}

// Present PaymentSheet
const { error: presentError } = await presentPaymentSheet();

if (presentError) {
  console.error('Payment failed:', presentError);
} else {
  // Payment succeeded! Call confirm-deposit endpoint
  confirmBooking(paymentIntentId, bookingDraft);
}
```

---

### 3. Confirm Booking (After Payment Success)

**Endpoint**: `POST /v1/bookings/confirm-deposit`

**Headers**:
```
Authorization: Bearer <customer_jwt_token>
Content-Type: application/json
```

**Request Body**:
```json
{
  "payment_intent_id": "pi_xxx",
  "service_id": "uuid",
  "provider_id": "uuid",
  "date": "2026-01-15",
  "time_start": "14:00",
  "time_end": "15:00",
  "service_price_cents": 10000,
  "platform_fee_cents": 500
}
```

> **Note**: Send back all fields from `bookingDraft` plus `payment_intent_id`.

**Response** (200 OK):
```json
{
  "booking": {
    "id": "booking-uuid",
    "customer_id": "uuid",
    "provider_id": "uuid",
    "service_id": "uuid",
    "date": "2026-01-15",
    "time_start": "14:00:00",
    "time_end": "15:00:00",
    "status": "pending",
    "deposit_status": "paid",
    "final_status": "not_started",
    "created_at": "2026-01-11T..."
  },
  "pricing": {
    "service_price_cents": 10000,
    "platform_fee_cents": 500,
    "deposit_cents": 500
  },
  "stripe": {
    "deposit_payment_intent_id": "pi_xxx"
  }
}
```

---

## Error Handling

### Common Errors

#### 1. Time Slot Conflict (409)
```json
{
  "error": "Time already booked",
  "code": "booking_conflict",
  "message": "Time slot no longer available"
}
```
**Action**: Show error to user, suggest alternative times.

#### 2. Payment Not Succeeded (400)
```json
{
  "error": "Payment not succeeded. Status: requires_payment_method",
  "code": "payment_not_succeeded",
  "stripe_status": "requires_payment_method"
}
```
**Action**: This should not happen if PaymentSheet completes successfully. If it does, show error and don't retry automatically.

#### 3. Metadata Mismatch (400)
```json
{
  "error": "PaymentIntent metadata mismatch",
  "code": "metadata_mismatch"
}
```
**Action**: This indicates tampering or a bug. Don't retry – show generic error.

#### 4. Invalid PaymentIntent (400)
```json
{
  "error": "Invalid payment_intent_id",
  "code": "invalid_payment_intent"
}
```
**Action**: Should not happen in normal flow. Log and show error.

---

## Mobile Implementation Checklist

- [ ] **Step 1: Call `/v1/bookings/request`**
  - [ ] Send service details and booking time
  - [ ] Store `bookingDraft` object
  - [ ] Store `paymentIntentClientSecret` and `paymentIntentId`

- [ ] **Step 2: Initialize PaymentSheet**
  - [ ] Use `paymentIntentClientSecret` to initialize PaymentSheet
  - [ ] Enable Apple Pay (iOS) / Google Pay (Android)
  - [ ] Set merchant display name to "YardLine"

- [ ] **Step 3: Present PaymentSheet**
  - [ ] Call `presentPaymentSheet()` to show payment UI
  - [ ] Handle user cancellation gracefully
  - [ ] Handle payment errors with user-friendly messages

- [ ] **Step 4: Confirm Booking**
  - [ ] Only call `/v1/bookings/confirm-deposit` after PaymentSheet success
  - [ ] Send `payment_intent_id` + entire `bookingDraft` object
  - [ ] Handle time slot conflicts (suggest alternatives)

- [ ] **Error Handling**
  - [ ] Show loading states during API calls
  - [ ] Handle network errors
  - [ ] Handle booking conflicts (time slot taken)
  - [ ] Handle payment failures

- [ ] **Testing**
  - [ ] Test with Stripe test cards
  - [ ] Test Apple Pay (iOS)
  - [ ] Test Google Pay (Android)
  - [ ] Test error scenarios (declined card, no internet, time conflict)
  - [ ] Test cancellation flow

---

## Security Considerations

1. **Never store `paymentIntentClientSecret` persistently** – only keep in memory during the booking flow.

2. **Don't modify `bookingDraft`** – send it back exactly as received to prevent tampering.

3. **Handle expired PaymentIntents** – PaymentIntents expire after 24 hours. If user takes too long, start over with a new `/request` call.

4. **Verify payment on server** – The backend verifies payment succeeded before creating booking. Never trust client-only confirmation.

---

## Testing with Stripe Test Cards

Use these test cards in development:

| Card Number         | Scenario             |
|---------------------|----------------------|
| 4242 4242 4242 4242 | Success              |
| 4000 0000 0000 9995 | Declined             |
| 4000 0025 0000 3155 | Requires 3DS auth    |

Expiry: Any future date  
CVC: Any 3 digits  
ZIP: Any 5 digits

---

## Example Flow Diagram

```
┌─────────┐                 ┌─────────┐                 ┌────────┐
│  Client │                 │  Server │                 │ Stripe │
└────┬────┘                 └────┬────┘                 └───┬────┘
     │                           │                          │
     │ POST /v1/bookings/request │                          │
     ├──────────────────────────>│                          │
     │                           │ Create PaymentIntent     │
     │                           ├─────────────────────────>│
     │                           │                          │
     │                           │ client_secret            │
     │                           │<─────────────────────────┤
     │ client_secret             │                          │
     │<──────────────────────────┤                          │
     │                           │                          │
     │ presentPaymentSheet()     │                          │
     │ (user enters card)        │                          │
     │                           │                          │
     │ confirm payment           │                          │
     ├──────────────────────────────────────────────────────>│
     │                           │                          │
     │ payment succeeded         │                          │
     │<──────────────────────────────────────────────────────┤
     │                           │                          │
     │ POST /confirm-deposit     │                          │
     ├──────────────────────────>│                          │
     │                           │ Verify PaymentIntent     │
     │                           ├─────────────────────────>│
     │                           │ status: succeeded        │
     │                           │<─────────────────────────┤
     │                           │                          │
     │                           │ Create Booking in DB     │
     │                           │                          │
     │ booking created           │                          │
     │<──────────────────────────┤                          │
     │                           │                          │
```

---

## Next Steps

1. **Integrate Stripe SDK** in your mobile app
2. **Update booking flow** to use the two-step process
3. **Test thoroughly** with test cards and Apple/Google Pay
4. **Deploy** and monitor for payment success rates

For questions, contact the backend team or check [Stripe PaymentSheet Documentation](https://stripe.com/docs/payments/payment-sheet).
