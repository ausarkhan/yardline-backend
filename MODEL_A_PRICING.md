# Model A Pricing Implementation

## Overview

YardLine now uses **Model A pricing** where the buyer pays all fees, ensuring:
- ✅ Host receives **100% of ticket price**
- ✅ Buyer pays **service & processing fee** (covers YardLine $0.99 + Stripe fees)
- ✅ YardLine nets exactly **$0.99 per ticket** after Stripe fees

## Fee Structure

### Buyer Pays
- **Ticket Price**: Set by host
- **Service & Processing Fee**: Calculated to cover:
  - YardLine platform fee: **$0.99**
  - Stripe processing fee: **2.9% + $0.30**

### Host Receives
- **100% of ticket price** (no deductions)

### YardLine Revenue
- **$0.99 per ticket** (net after Stripe fees)

## Fee Calculation Formula

```typescript
buyerFeeCents = Math.ceil(
  (99 + 0.029 * ticketPriceCents + 30) / (1 - 0.029)
)
```

### Why This Formula?

The formula ensures YardLine nets exactly $0.99 after Stripe takes their cut:

1. **Stripe Fee**: `2.9% + $0.30` on total charge
2. **YardLine Revenue**: `$0.99` after Stripe fees
3. **Calculation**: `(99 + 0.029 × ticketPrice + 30) / (1 - 0.029)`

### Example Calculations

| Ticket Price | Buyer Fee | Total Charge | Stripe Fee | YardLine Net | Host Gets |
|--------------|-----------|--------------|------------|--------------|-----------|
| $10.00 | $1.58 | $11.58 | $0.64 | $0.99 | $10.00 |
| $25.00 | $2.04 | $27.04 | $1.08 | $0.99 | $25.00 |
| $50.00 | $2.77 | $52.77 | $1.83 | $0.99 | $50.00 |
| $100.00 | $4.31 | $104.31 | $3.33 | $0.99 | $100.00 |

## Stripe PaymentIntent Structure

### Model A Configuration

```typescript
{
  amount: ticketSubtotalCents + buyerFeeTotalCents,  // Total buyer pays
  application_fee_amount: ticketSubtotalCents,        // Host receives full ticket price
  transfer_data: {
    destination: connectedAccountId  // Host's Stripe Connect account
  }
}
```

### Fund Flow

```
Buyer pays: $52.77
├─ Stripe takes: $1.83 (2.9% + $0.30)
├─ Host receives: $50.00 (via transfer_data)
└─ YardLine receives: $0.99 (amount - stripe_fee - host_payout)
```

## API Response Format

### Create Payment Intent Response

```json
{
  "success": true,
  "data": {
    "paymentIntentClientSecret": "pi_xxx_secret_xxx",
    "amount": 5277,
    "ticketSubtotalCents": 5000,
    "buyerFeeTotalCents": 277,
    "serviceAndProcessingFeeCents": 277,
    "pricingModel": "model_a",
    "itemsWithFees": [
      {
        "ticketTypeId": "vip",
        "priceCents": 5000,
        "quantity": 1,
        "buyerFeePerTicket": 277
      }
    ]
  }
}
```

## UI/UX Requirements

### Checkout Display

**✅ Correct:**
```
Ticket (1x VIP)           $50.00
Service & processing fee   $2.77
─────────────────────────────────
Total                     $52.77
```

**❌ Incorrect:**
```
Ticket                    $50.00
Platform fee               $2.77  ← Wrong terminology
─────────────────────────────────
Total                     $52.77
```

### Key Changes
- Replace **"Platform fee"** with **"Service & processing fee"**
- Remove tooltips that imply fees are charged to the host
- Clearly show fees are added to buyer's total

## Validation

### Server-Side Validation

The backend automatically validates Model A pricing:

```typescript
function validateModelAPricing(ticketPriceCents: number, buyerFeeCents: number) {
  const totalChargeCents = ticketPriceCents + buyerFeeCents;
  const stripeFeesCents = Math.round(totalChargeCents * 0.029 + 30);
  const yardlineRevenueCents = buyerFeeCents - stripeFeesCents;
  
  // Validate YardLine gets $0.99 (allow 1 cent tolerance for rounding)
  const isValid = Math.abs(yardlineRevenueCents - 99) <= 1;
  
  return {
    isValid,
    yardlineRevenue: yardlineRevenueCents,
    hostPayout: ticketPriceCents,
    buyerTotal: totalChargeCents
  };
}
```

### Testing

Run the validation script:

```bash
npm run validate-model-a
```

Or test manually:

```bash
curl -X POST http://localhost:3000/v1/payments/create-intent \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test_user",
    "eventId": "test_event",
    "connectedAccountId": "acct_xxxxx",
    "items": [
      {
        "ticketTypeId": "general",
        "ticketTypeName": "General Admission",
        "priceCents": 5000,
        "quantity": 1
      }
    ]
  }'
```

Expected response should show `pricingModel: "model_a"` and proper fee calculations.

## Migration from Old Model

### What Changed

**Before (Old Model):**
- Platform fee: 8% of ticket price (capped $0.99-$12.99)
- Host paid fees from ticket revenue
- `application_fee_amount = platformFeeTotalCents`

**After (Model A):**
- Buyer fee: Calculated to net YardLine $0.99 after Stripe
- Host receives 100% of ticket price
- `application_fee_amount = ticketSubtotalCents`

### Backward Compatibility

The implementation maintains backward compatibility:
- Legacy field names (`platformFeeCents`) are still populated
- Old endpoints continue to work
- Responses include both old and new field names

### Key Code Changes

1. **Fee calculation**: `calculateBuyerFeePerTicket()` replaces `calculatePlatformFeePerTicket()`
2. **PaymentIntent structure**: `application_fee_amount` now equals ticket subtotal (not fee total)
3. **Metadata**: Added `pricing_model: "model_a"` and `buyer_fee_total_cents`

## Consistency Across Product

### Event Tickets ✅
- Model A pricing implemented
- Server-side fee calculation
- Proper PaymentIntent structure

### Service Bookings ✅
- Uses same fee calculation logic
- Same `calculateBuyerFeePerTicket()` function
- Consistent user experience

### Both Use:
- Same Model A formula
- Same validation logic
- Same terminology ("Service & processing fee")

## Troubleshooting

### Issue: YardLine not netting $0.99

**Check:**
1. Verify `application_fee_amount = ticketSubtotalCents` (not buyerFeeTotalCents)
2. Ensure using Connect with destination charges
3. Check validation output in server logs

### Issue: Host not receiving full ticket price

**Check:**
1. Verify `transfer_data.destination` is set to host's account
2. Ensure `application_fee_amount` equals ticket subtotal
3. Check Stripe Dashboard → Connect → Transfers

### Issue: Fee calculation seems wrong

**Run validation:**
```bash
# Check server logs for validation output
docker logs yardline-backend | grep "Model A validated"
```

Look for: `✅ Model A validated: Ticket: $X.XX, Buyer Fee: $Y.YY, YardLine Net: $0.99`

## References

- [ENVIRONMENT_CONFIG.md](./ENVIRONMENT_CONFIG.md) - Environment setup
- [PAYMENTSHEET_IMPLEMENTATION.md](./PAYMENTSHEET_IMPLEMENTATION.md) - PaymentSheet integration
- [Stripe Connect Destination Charges](https://stripe.com/docs/connect/destination-charges) - Official docs
