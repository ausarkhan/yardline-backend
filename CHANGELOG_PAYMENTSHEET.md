# Changelog - PaymentSheet Support

## Version: 2026-01-11

### Added

#### New Endpoint: `POST /v1/bookings/confirm-deposit`
- Confirms booking after client successfully completes payment via PaymentSheet
- Validates PaymentIntent status with Stripe before creating booking
- Performs metadata verification to prevent tampering
- Re-checks time slot conflicts to handle race conditions
- Returns booking object with `deposit_status='paid'`

### Changed

#### `POST /v1/bookings/request`
- **Removed**: Server-side PaymentIntent confirmation (`confirm: true`)
- **Removed**: `allow_redirects: 'never'` option (not needed for client-side flow)
- **Added**: Returns `paymentIntentClientSecret` for client-side confirmation
- **Added**: Returns `paymentIntentId` for confirmation step
- **Added**: Returns `bookingDraft` object containing all booking parameters
- **Changed**: No longer creates booking immediately
- **Changed**: Response format now includes draft data instead of created booking

**Old Response Format**:
```json
{
  "booking": { "id": "...", "status": "pending", ... },
  "pricing": { ... },
  "stripe": { "deposit_payment_intent_id": "pi_xxx" }
}
```

**New Response Format**:
```json
{
  "bookingDraft": {
    "service_id": "...",
    "provider_id": "...",
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

### Migration Guide

#### For Mobile Clients

**Before** (single-step):
```javascript
// Single API call
const response = await apiClient.post('/v1/bookings/request', bookingData);
const { booking } = response.data;
// Booking created, payment somehow confirmed
```

**After** (two-step with PaymentSheet):
```javascript
// Step 1: Get PaymentIntent
const requestResponse = await apiClient.post('/v1/bookings/request', bookingData);
const { bookingDraft, paymentIntentClientSecret, paymentIntentId } = requestResponse.data;

// Step 2: Show PaymentSheet
const { error } = await presentPaymentSheet({
  clientSecret: paymentIntentClientSecret
});

if (error) {
  // Handle payment error
  return;
}

// Step 3: Confirm booking
const confirmResponse = await apiClient.post('/v1/bookings/confirm-deposit', {
  payment_intent_id: paymentIntentId,
  ...bookingDraft
});
const { booking } = confirmResponse.data;
// Booking created with deposit_status='paid'
```

### Breaking Changes

1. **Response format changed** for `POST /v1/bookings/request`
   - No longer returns a `booking` object
   - Now returns `bookingDraft`, `paymentIntentClientSecret`, and `paymentIntentId`

2. **Two-step process required**
   - Clients must now call `/confirm-deposit` after payment succeeds
   - Booking is not created until payment is confirmed

3. **Mobile apps must integrate Stripe PaymentSheet SDK**
   - Required for collecting payment information
   - Required for Apple Pay / Google Pay support

### Non-Breaking Changes

- All other endpoints remain unchanged (`/accept`, `/pay-remaining`, etc.)
- Database schema unchanged
- No changes to provider-side flows

### Security Improvements

1. **Server-side payment verification**: Backend independently verifies PaymentIntent status with Stripe
2. **Metadata validation**: PaymentIntent metadata is validated against booking parameters
3. **Double conflict check**: Time slot conflicts checked at both request and confirmation
4. **No client trust**: Booking creation only proceeds after server confirms payment

### Performance

- **Latency**: Two API calls instead of one (request + confirm)
- **User experience**: Improved with native payment UI (Apple Pay, Google Pay)
- **Network**: Minimal increase (~100ms for second call)

### Testing

#### Test Script
```bash
./test-paymentsheet-flow.sh
```

#### Manual Testing
See [PAYMENTSHEET_MOBILE_GUIDE.md](PAYMENTSHEET_MOBILE_GUIDE.md#testing-with-stripe-test-cards)

#### Stripe Test Cards
- Success: `4242 4242 4242 4242`
- Decline: `4000 0000 0000 9995`
- 3DS: `4000 0025 0000 3155`

### Documentation

New documentation files:
1. **[PAYMENTSHEET_MOBILE_GUIDE.md](PAYMENTSHEET_MOBILE_GUIDE.md)** - Complete integration guide for mobile developers
2. **[PAYMENTSHEET_QUICK_REFERENCE.md](PAYMENTSHEET_QUICK_REFERENCE.md)** - Quick reference card
3. **[PAYMENTSHEET_IMPLEMENTATION_SUMMARY.md](PAYMENTSHEET_IMPLEMENTATION_SUMMARY.md)** - Technical implementation details
4. **[test-paymentsheet-flow.sh](test-paymentsheet-flow.sh)** - Test script

### Rollback

If issues arise, rollback is straightforward:
1. Revert `src/routes/bookings-v1.ts` to commit before this change
2. No database migrations to rollback
3. Mobile apps can continue using old single-step flow

### Future Enhancements

Potential improvements for future releases:
- [ ] Webhook handler for asynchronous payment confirmation
- [ ] Support for delayed payment methods (ACH, SEPA, etc.)
- [ ] Save payment methods for future bookings
- [ ] Subscription support for recurring bookings

### Support

- **Backend questions**: See [PAYMENTSHEET_IMPLEMENTATION_SUMMARY.md](PAYMENTSHEET_IMPLEMENTATION_SUMMARY.md)
- **Mobile integration**: See [PAYMENTSHEET_MOBILE_GUIDE.md](PAYMENTSHEET_MOBILE_GUIDE.md)
- **Stripe docs**: https://stripe.com/docs/payments/payment-sheet

---

**Modified Files**:
- `src/routes/bookings-v1.ts` (lines 115-327)

**New Files**:
- `PAYMENTSHEET_MOBILE_GUIDE.md`
- `PAYMENTSHEET_QUICK_REFERENCE.md`
- `PAYMENTSHEET_IMPLEMENTATION_SUMMARY.md`
- `test-paymentsheet-flow.sh`
- `CHANGELOG_PAYMENTSHEET.md` (this file)

**Authors**: Backend Team  
**Date**: 2026-01-11  
**Version**: 1.0.0
