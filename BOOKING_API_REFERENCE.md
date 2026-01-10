# Booking System API Quick Reference

## Flow Overview
```
1. Customer: POST /v1/bookings → status=pending, payment=authorized
2. Provider: POST /v1/bookings/:id/accept → status=confirmed, payment=captured
   OR
   Provider: POST /v1/bookings/:id/decline → status=declined, payment=canceled
```

## Status Transitions

```
                    ┌─────────┐
                    │ PENDING │
                    │ (auth)  │
                    └────┬────┘
                         │
         ┌───────────────┼───────────────┐
         │               │               │
    ┌────▼────┐     ┌────▼────┐    ┌────▼────┐
    │CONFIRMED│     │DECLINED │    │CANCELLED│
    │(capture)│     │(cancel) │    │(cancel) │
    └─────────┘     └─────────┘    └─────────┘
```

## Quick API Examples

### 1. Create Service
```bash
curl -X POST http://localhost:3000/v1/services \
  -H "Content-Type: application/json" \
  -d '{
    "providerId": "provider-1",
    "name": "Lawn Mowing",
    "priceCents": 5000,
    "duration": 60
  }'
```

### 2. Request Booking (Customer)
```bash
curl -X POST http://localhost:3000/v1/bookings \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "customer-1",
    "serviceId": "SERVICE_ID",
    "requestedDate": "2026-01-15",
    "requestedTime": "14:00",
    "customerEmail": "test@example.com",
    "customerName": "Test User"
  }'
```

### 3. Accept Booking (Provider)
```bash
curl -X POST http://localhost:3000/v1/bookings/BOOKING_ID/accept \
  -H "Content-Type: application/json" \
  -d '{"providerId": "provider-1"}'
```

### 4. Decline Booking (Provider)
```bash
curl -X POST http://localhost:3000/v1/bookings/BOOKING_ID/decline \
  -H "Content-Type: application/json" \
  -d '{
    "providerId": "provider-1",
    "reason": "Not available"
  }'
```

### 5. Cancel Booking (Customer)
```bash
curl -X POST http://localhost:3000/v1/bookings/BOOKING_ID/cancel \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "customer-1",
    "reason": "Changed my mind"
  }'
```

### 6. Get Booking
```bash
curl http://localhost:3000/v1/bookings/BOOKING_ID
```

### 7. List Provider Bookings
```bash
curl "http://localhost:3000/v1/bookings?providerId=provider-1&status=pending"
```

### 8. List Customer Bookings
```bash
curl "http://localhost:3000/v1/bookings?customerId=customer-1"
```

## Payment States

| Booking Status | Payment Status | Meaning |
|----------------|----------------|---------|
| pending | authorized | Payment hold placed, no charge yet |
| confirmed | captured | Payment charged successfully |
| declined | canceled | Authorization released, no charge |
| cancelled | canceled | Customer cancelled, no charge |
| expired | failed | Authorization expired, cannot capture |

## Error Codes

| Code | Meaning | Action |
|------|---------|--------|
| `resource_missing` | Service/booking not found | Check ID is valid |
| `permission_denied` | Wrong provider/customer | Verify ownership |
| `invalid_state` | Cannot transition from current status | Check booking.status |
| `booking_conflict` | Time slot already booked | Choose different time |
| `payment_expired` | Authorization expired | Create new booking |
| `amount_too_small` | Under $0.50 | Increase service price |
| `review_mode_limit_exceeded` | Over review mode limit | Use lower price for testing |

## Pricing (Model A)

```javascript
// Service price set by provider
servicePriceCents = 5000; // $50.00

// Platform fee calculated server-side
platformFeeCents = calculateBookingPlatformFee(5000); // ~$15.00

// Total charged to customer
totalChargeCents = 5000 + 1500; // $65.00

// Money flow after capture:
// - Customer charged: $65.00
// - Provider receives: $50.00 (via Stripe Connect)
// - YardLine receives: $0.99 (after Stripe fees)
// - Stripe fees: ~$2.19 (2.9% + $0.30)
```

## Testing Tips

### Test Cards (Stripe Test Mode)
- Success: `4242 4242 4242 4242`
- Requires 3DS: `4000 0025 0000 3155`
- Declined: `4000 0000 0000 9995`

### Test Script
```bash
# Run all tests
./test-booking-system.sh

# Check server logs for details
npm run dev
```

### Webhook Testing (Stripe CLI)
```bash
# Forward webhooks to local server
stripe listen --forward-to localhost:3000/v1/stripe/webhooks

# Trigger test events
stripe trigger payment_intent.succeeded
stripe trigger payment_intent.canceled
```

## Frontend Integration

### Customer Booking Flow
```typescript
// 1. Request booking
const { booking, paymentIntentClientSecret } = await createBooking({
  serviceId,
  requestedDate,
  requestedTime
});

// 2. Handle payment action if needed
if (booking.payment_status !== 'authorized') {
  await stripe.confirmCardPayment(paymentIntentClientSecret);
}

// 3. Poll or listen for status updates
const updatedBooking = await pollBookingStatus(booking.bookingId);
```

### Provider Accept/Decline
```typescript
// Accept
await acceptBooking(bookingId, providerId);
invalidateQueries(['bookings', 'provider', providerId]);

// Decline
await declineBooking(bookingId, providerId, 'Not available');
invalidateQueries(['bookings', 'provider', providerId]);
```

## Webhook Events to Handle

```typescript
// payment_intent.succeeded
// → booking.payment_status = 'captured'

// payment_intent.canceled  
// → booking.payment_status = 'canceled'

// payment_intent.payment_failed
// → booking.payment_status = 'failed'
// → booking.status = 'cancelled' (if pending)
```

## Common Scenarios

### Happy Path
1. Customer requests booking → pending/authorized
2. Provider accepts → confirmed/captured
3. Payment charged, booking confirmed

### Provider Declines
1. Customer requests booking → pending/authorized
2. Provider declines → declined/canceled
3. Authorization released, no charge

### Customer Cancels
1. Customer requests booking → pending/authorized
2. Customer cancels → cancelled/canceled
3. Authorization released, no charge

### Authorization Expires
1. Customer requests booking → pending/authorized
2. Provider waits too long to accept
3. Provider tries to accept → error
4. Booking → expired/failed
5. Customer must create new booking

### Double Booking Prevention
1. Provider has confirmed booking 14:00-15:00
2. Customer requests booking 14:30-15:30
3. Request succeeds → pending/authorized
4. Provider tries to accept → 409 Conflict error
5. Provider should decline instead

## Environment Variables

```bash
# Stripe Keys
STRIPE_TEST_SECRET_KEY=sk_test_xxx
STRIPE_LIVE_SECRET_KEY=sk_live_xxx

# Webhook Secrets
STRIPE_TEST_WEBHOOK_SECRET=whsec_xxx
STRIPE_LIVE_WEBHOOK_SECRET=whsec_xxx

# Environment Mode
STRIPE_ENV=test  # or 'live'

# Review Mode (optional)
REVIEW_MODE=true
```

## Monitoring Checklist

- [ ] Monitor failed captures (authorization expired)
- [ ] Track booking conflict rate
- [ ] Alert on webhook processing failures
- [ ] Monitor payment success/failure rates
- [ ] Track average time to accept/decline
- [ ] Alert on abnormal cancellation rates

## Next Steps

1. ✅ Implementation complete
2. 🧪 Run test script
3. 🔗 Configure webhooks
4. 🎨 Implement frontend UI
5. 🚀 Deploy to production

---

**For detailed documentation, see [BOOKING_SYSTEM.md](./BOOKING_SYSTEM.md)**
