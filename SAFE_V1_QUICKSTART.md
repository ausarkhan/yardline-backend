# Safe V1 Two-Step Payment - Quick Start Guide

## Setup Steps

### 1. Apply Database Migration

Run the migration in your Supabase SQL Editor:

```bash
# Copy and paste the contents of migrations/003_two_step_payment.sql
# into your Supabase SQL Editor and execute
```

Or if using a migration tool:
```bash
psql $DATABASE_URL -f migrations/003_two_step_payment.sql
```

### 2. Configure Environment Variables

Add to your `.env` file:
```bash
# Required
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
STRIPE_SECRET_KEY=sk_test_...

# Optional (defaults shown)
STRIPE_FEE_PERCENT=0.029
STRIPE_FEE_FIXED_CENTS=30
```

### 3. Install Dependencies (if needed)

```bash
npm install
```

### 4. Start the Server

```bash
npm run dev
```

Server runs on `http://localhost:3000`

---

## API Endpoints

All endpoints require authentication via JWT in Authorization header:
```
Authorization: Bearer YOUR_JWT_TOKEN
```

### 1. Request Booking (Customer)
```bash
POST /v1/bookings/request
```

**Body**:
```json
{
  "service_id": "uuid-of-service",
  "provider_id": "uuid-of-provider",
  "date": "2026-01-15",
  "time_start": "10:00:00",
  "time_end": "11:00:00"
}
```

### 2. Accept Booking (Provider)
```bash
POST /v1/bookings/{booking_id}/accept
```

No request body needed.

### 3. Pay Remaining (Customer)
```bash
POST /v1/bookings/{booking_id}/pay-remaining
```

No request body needed.

---

## Test the Implementation

### Run Unit Tests
```bash
./test-platform-fee.sh
```

Expected output: ✅ All tests PASSED

### Manual API Testing

1. **Create a service** (provider):
```bash
curl -X POST http://localhost:3000/v1/services \
  -H "Authorization: Bearer PROVIDER_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "1 Hour Consultation",
    "description": "Professional consultation service",
    "priceCents": 5000,
    "duration": 60
  }'
```

2. **Request booking** (customer):
```bash
curl -X POST http://localhost:3000/v1/bookings/request \
  -H "Authorization: Bearer CUSTOMER_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "service_id": "SERVICE_ID_FROM_STEP_1",
    "provider_id": "PROVIDER_USER_ID",
    "date": "2026-01-20",
    "time_start": "14:00:00",
    "time_end": "15:00:00"
  }'
```

Response includes:
- `booking.id` - Save this for next steps
- `pricing.deposit_cents` - Amount charged now
- `pricing.service_price_cents` - Amount to pay after acceptance

3. **Accept booking** (provider):
```bash
curl -X POST http://localhost:3000/v1/bookings/BOOKING_ID/accept \
  -H "Authorization: Bearer PROVIDER_JWT"
```

4. **Pay remaining** (customer):
```bash
curl -X POST http://localhost:3000/v1/bookings/BOOKING_ID/pay-remaining \
  -H "Authorization: Bearer CUSTOMER_JWT"
```

---

## Platform Fee Examples

| Service Price | Base Fee | Platform Fee | Net Revenue |
|--------------|----------|--------------|-------------|
| $5.00        | $0.99    | $1.48        | $1.14       |
| $20.00       | $1.60    | $2.56        | $2.19       |
| $50.00       | $4.00    | $5.93        | $5.46       |
| $100.00      | $8.00    | $11.54       | $10.91      |
| $150.00      | $12.00   | $17.15       | $16.35      |

**Formula**: 
- Base Fee = max($0.99, min(8% of price, $12.99))
- Platform Fee = ceil((baseFee + 2.9% * price + $0.30) / 0.971)

This ensures platform nets the base fee after Stripe takes their cut.

---

## Booking States

### Status Field
- `pending` - Deposit paid, awaiting provider acceptance
- `accepted` - Provider accepted, awaiting final payment
- `confirmed` - Final payment completed, booking confirmed
- `declined` - Provider declined the booking
- `cancelled` - Cancelled by customer or provider
- `expired` - Booking expired (not implemented yet)

### Deposit Status
- `unpaid` - Deposit not yet paid
- `paid` - Deposit successfully paid
- `failed` - Deposit payment failed
- `refunded` - Deposit refunded

### Final Status
- `not_started` - Final payment not yet initiated
- `paid` - Final payment successfully completed
- `failed` - Final payment failed
- `refunded` - Final payment refunded

---

## Error Codes

| HTTP Status | Code | Meaning |
|------------|------|---------|
| 400 | invalid_request_error | Missing or invalid fields |
| 400 | service_unavailable | Service is not active |
| 400 | invalid_time_range | End time before start time |
| 400 | invalid_datetime | Requested time in past |
| 400 | invalid_status | Wrong booking status for action |
| 400 | already_paid | Final payment already completed |
| 400 | payment_failed | Stripe payment failed |
| 400 | payment_not_succeeded | Payment not in succeeded state |
| 403 | forbidden | Not authorized for this booking |
| 404 | not_found | Booking or service not found |
| 404 | resource_missing | Resource not found |
| 409 | booking_conflict | Time slot already booked |
| 500 | api_error | Server error |

---

## Common Issues

### "Time already booked" (409)
- Another booking exists for that time slot
- Check availability before requesting
- Time slots are exclusive per provider

### "Payment failed" (400)
- Check Stripe test cards: `4242 4242 4242 4242`
- Verify Stripe API keys are correct
- Check minimum amount ($0.50)

### "Booking status is X, expected Y" (400)
- Booking already processed
- Check current booking status
- May be idempotency - same payment succeeded before

### "Not authorized" (403)
- JWT token doesn't match booking owner
- Provider can only accept their own bookings
- Customer can only pay for their own bookings

---

## Integration Checklist

- [ ] Database migration applied
- [ ] Environment variables configured
- [ ] Server starts without errors
- [ ] Unit tests pass (`./test-platform-fee.sh`)
- [ ] Can create service via API
- [ ] Can request booking (deposit charged)
- [ ] Can accept booking (provider)
- [ ] Can pay remaining (customer)
- [ ] Time conflicts properly blocked
- [ ] Error responses are handled in frontend
- [ ] Stripe dashboard shows transactions

---

## Next Steps

1. **Add Webhook Handlers**: Listen for Stripe events
2. **Add Notifications**: Email/push for status changes
3. **Add Expiration**: Auto-decline pending bookings after X hours
4. **Add Refunds**: Handle cancellation refund logic
5. **Add Provider Payout**: Transfer funds to provider accounts
6. **Add Booking History**: List endpoint for user's bookings
7. **Add Calendar View**: Check availability endpoint

---

## Support

For detailed API documentation, see: [SAFE_V1_TWO_STEP_PAYMENT.md](SAFE_V1_TWO_STEP_PAYMENT.md)

For architecture details, see: [ARCHITECTURE_DIAGRAM.md](ARCHITECTURE_DIAGRAM.md)
