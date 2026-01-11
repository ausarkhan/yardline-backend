# PaymentSheet Quick Reference

## API Endpoints

### 1. Request Booking (Get client_secret)
```
POST /v1/bookings/request
Authorization: Bearer <customer_token>

Body: {
  service_id, provider_id, date, time_start, time_end
}

Returns: {
  bookingDraft: { ... },
  paymentIntentClientSecret: "pi_xxx_secret_xxx",
  paymentIntentId: "pi_xxx"
}
```

### 2. Confirm Booking (After payment)
```
POST /v1/bookings/confirm-deposit
Authorization: Bearer <customer_token>

Body: {
  payment_intent_id: "pi_xxx",
  ...bookingDraft  // All fields from step 1
}

Returns: {
  booking: { id, status, deposit_status: "paid", ... },
  pricing: { ... },
  stripe: { deposit_payment_intent_id }
}
```

---

## Mobile Integration (3 Steps)

### Step 1: Request
```javascript
const response = await fetch('/v1/bookings/request', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: JSON.stringify({ service_id, provider_id, date, time_start, time_end })
});
const { bookingDraft, paymentIntentClientSecret, paymentIntentId } = await response.json();
```

### Step 2: PaymentSheet
```javascript
// React Native
const { error } = await presentPaymentSheet();
if (!error) {
  // Payment succeeded → go to step 3
}

// iOS Swift
paymentSheet.present(from: vc) { result in
    if case .completed = result {
        // Payment succeeded → go to step 3
    }
}
```

### Step 3: Confirm
```javascript
const response = await fetch('/v1/bookings/confirm-deposit', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: JSON.stringify({
    payment_intent_id: paymentIntentId,
    ...bookingDraft
  })
});
const { booking } = await response.json();
// Done! Booking created with deposit_status='paid'
```

---

## Error Handling

| Code | Status | Meaning | Action |
|------|--------|---------|--------|
| `booking_conflict` | 409 | Time slot taken | Show alternatives |
| `payment_not_succeeded` | 400 | Payment not confirmed | Should not happen; log error |
| `metadata_mismatch` | 400 | Data tampering | Show error; don't retry |
| `invalid_payment_intent` | 400 | Invalid PI ID | Should not happen; log error |

---

## Key Changes

| Before | After |
|--------|-------|
| `/request` confirms payment | `/request` returns `client_secret` |
| No payment UI | PaymentSheet shows card/Apple Pay |
| Single API call | Two API calls (request + confirm) |
| Booking created immediately | Booking created after payment |

---

## Test Cards

| Card | Result |
|------|--------|
| 4242 4242 4242 4242 | Success |
| 4000 0000 0000 9995 | Declined |

---

## Security

✅ Server verifies PaymentIntent status with Stripe  
✅ Metadata validated (customer, service, provider)  
✅ Time conflict re-checked before booking creation  
✅ No trust in client-reported payment status  

---

For complete guide: See [PAYMENTSHEET_MOBILE_GUIDE.md](PAYMENTSHEET_MOBILE_GUIDE.md)
