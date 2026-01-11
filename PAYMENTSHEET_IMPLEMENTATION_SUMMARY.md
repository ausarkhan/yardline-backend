# PaymentSheet Implementation Summary

## Changes Made

### 1. Modified `POST /v1/bookings/request`

**File**: [src/routes/bookings-v1.ts](src/routes/bookings-v1.ts#L18)

**Changes**:
- ✅ **Removed** `confirm: true` from PaymentIntent creation
- ✅ **Removed** `allow_redirects: 'never'` (not needed for client-side confirmation)
- ✅ **Returns** `client_secret` instead of confirming payment server-side
- ✅ **Returns** booking draft data for client to store

**New Response Format**:
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

### 2. Created `POST /v1/bookings/confirm-deposit`

**File**: [src/routes/bookings-v1.ts](src/routes/bookings-v1.ts#L184)

**Purpose**: Confirm booking after client successfully completes payment via PaymentSheet

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

**Validation Steps**:
1. ✅ Retrieves PaymentIntent from Stripe
2. ✅ Verifies `status === 'succeeded'`
3. ✅ Verifies metadata matches (customer_id, service_id, provider_id)
4. ✅ Checks for time slot conflicts (again, for race conditions)
5. ✅ Creates booking with `deposit_status='paid'`

**Response**: Same format as old `/request` endpoint (booking object + pricing)

---

## Flow Comparison

### Before (Server-Side Confirmation)
```
Client → POST /request
         ↓
Server creates & confirms PaymentIntent immediately
         ↓
Booking created
         ↓
Response: booking object
```

**Problem**: No UI for card entry / Apple Pay

### After (Client-Side Confirmation with PaymentSheet)
```
Client → POST /request
         ↓
Server creates PaymentIntent (NOT confirmed)
         ↓
Response: client_secret + bookingDraft
         ↓
Client presents PaymentSheet
         ↓
User enters card / Apple Pay
         ↓
Payment confirmed by Stripe
         ↓
Client → POST /confirm-deposit
         ↓
Server verifies payment succeeded
         ↓
Booking created
         ↓
Response: booking object
```

**Benefit**: ✅ Full payment UI with Apple Pay support

---

## Security Features

1. **Metadata Verification**: Server validates PaymentIntent metadata matches booking request
2. **Double Conflict Check**: Time slot conflict checked both at request AND confirm
3. **Payment Verification**: Server independently verifies payment succeeded via Stripe API
4. **No Client Trust**: Booking only created after server confirms payment status

---

## Breaking Changes

### For Mobile Clients

**Old Flow**:
```javascript
// Single call
const response = await fetch('/v1/bookings/request', { ... });
const { booking } = await response.json();
// Done! Booking created
```

**New Flow**:
```javascript
// Step 1: Get PaymentIntent
const requestResponse = await fetch('/v1/bookings/request', { ... });
const { bookingDraft, paymentIntentClientSecret, paymentIntentId } = await requestResponse.json();

// Step 2: Present PaymentSheet
await presentPaymentSheet({ clientSecret: paymentIntentClientSecret });

// Step 3: Confirm booking
const confirmResponse = await fetch('/v1/bookings/confirm-deposit', {
  body: JSON.stringify({
    payment_intent_id: paymentIntentId,
    ...bookingDraft
  })
});
const { booking } = await confirmResponse.json();
```

### Response Format Changes

**`/v1/bookings/request` Response**:

**Before**:
```json
{
  "booking": { "id": "...", ... },
  "pricing": { ... },
  "stripe": { "deposit_payment_intent_id": "pi_xxx" }
}
```

**After**:
```json
{
  "bookingDraft": { "service_id": "...", ... },
  "paymentIntentClientSecret": "pi_xxx_secret_xxx",
  "paymentIntentId": "pi_xxx"
}
```

---

## Testing

### Test Script
```bash
./test-paymentsheet-flow.sh
```

This script demonstrates:
1. Calling `/v1/bookings/request`
2. Getting `client_secret`
3. (Simulating PaymentSheet confirmation)
4. Calling `/v1/bookings/confirm-deposit`

### Manual Testing

**Prerequisites**:
- Stripe test API keys configured
- Valid customer JWT token
- Valid service_id and provider_id

**Test Scenario 1: Success Flow**
```bash
# Step 1: Request booking
curl -X POST http://localhost:3000/v1/bookings/request \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "service_id": "...",
    "provider_id": "...",
    "date": "2026-01-15",
    "time_start": "14:00",
    "time_end": "15:00"
  }'

# Step 2: Use client_secret in PaymentSheet (mobile app)

# Step 3: Confirm booking
curl -X POST http://localhost:3000/v1/bookings/confirm-deposit \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "payment_intent_id": "pi_xxx",
    "service_id": "...",
    "provider_id": "...",
    "date": "2026-01-15",
    "time_start": "14:00",
    "time_end": "15:00",
    "service_price_cents": 10000,
    "platform_fee_cents": 500
  }'
```

**Test Scenario 2: Payment Fails**
- Use Stripe test card `4000 0000 0000 9995` (declined)
- PaymentSheet will show error
- Do NOT call `/confirm-deposit`

**Test Scenario 3: Time Conflict**
- Request booking for same time slot twice
- Second `/confirm-deposit` should return 409 error

---

## Migration Notes

### For Backend Developers
- No database schema changes required
- Endpoint paths remain the same for existing endpoints
- New endpoint added: `POST /v1/bookings/confirm-deposit`
- No breaking changes to other endpoints (`/accept`, `/pay-remaining`)

### For Mobile Developers
- **Must update** booking request flow to two-step process
- **Must integrate** Stripe PaymentSheet SDK
- See [PAYMENTSHEET_MOBILE_GUIDE.md](PAYMENTSHEET_MOBILE_GUIDE.md) for complete integration guide

---

## Files Modified

1. **[src/routes/bookings-v1.ts](src/routes/bookings-v1.ts)**
   - Modified `POST /v1/bookings/request` (lines ~115-170)
   - Added `POST /v1/bookings/confirm-deposit` (lines ~180-327)

---

## Documentation

1. **[PAYMENTSHEET_MOBILE_GUIDE.md](PAYMENTSHEET_MOBILE_GUIDE.md)** - Complete mobile integration guide
2. **[test-paymentsheet-flow.sh](test-paymentsheet-flow.sh)** - Test script demonstrating the flow

---

## Next Steps

### Backend
- ✅ Implementation complete
- [ ] Deploy to staging environment
- [ ] Test with mobile app
- [ ] Monitor Stripe webhook events for payment confirmations

### Mobile
- [ ] Integrate Stripe PaymentSheet SDK
- [ ] Update booking flow to two-step process
- [ ] Test with Stripe test cards
- [ ] Test Apple Pay / Google Pay
- [ ] Handle error scenarios

---

## Rollback Plan

If issues arise, rollback is simple:

1. Revert [src/routes/bookings-v1.ts](src/routes/bookings-v1.ts) to previous version
2. Mobile app continues using old single-step flow
3. No database changes to revert

---

## Support

For questions or issues:
- Check [PAYMENTSHEET_MOBILE_GUIDE.md](PAYMENTSHEET_MOBILE_GUIDE.md) for mobile integration
- Review Stripe PaymentSheet docs: https://stripe.com/docs/payments/payment-sheet
- Contact backend team for API questions
