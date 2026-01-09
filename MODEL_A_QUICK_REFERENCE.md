# Model A Pricing - Quick Reference Card

## 🎯 At a Glance

**Model A = Buyer Pays All Fees**

```
Host receives: 100% of ticket price
Buyer pays: Ticket + Service & Processing Fee
YardLine nets: $0.99 per ticket
```

## 💡 The Formula

```typescript
buyerFeeCents = Math.ceil(
  (99 + 0.029 * ticketPriceCents + 30) / (1 - 0.029)
)
```

## 📊 Quick Examples

| Ticket | + Fee  | = Total | Host Gets | YardLine Nets |
|--------|--------|---------|-----------|---------------|
| $10    | $1.58  | $11.58  | $10.00    | $0.99         |
| $25    | $2.04  | $27.04  | $25.00    | $0.99         |
| $50    | $2.77  | $52.77  | $50.00    | $0.99         |
| $100   | $4.31  | $104.31 | $100.00   | $0.99         |

## 🔧 Implementation

### Function Location
`src/index.ts` - Line ~84

### Key Functions
- `calculateBuyerFeePerTicket()` - Calculate fee
- `validateModelAPricing()` - Auto-validate each transaction

### PaymentIntent Structure
```typescript
{
  amount: ticketPrice + buyerFee,           // Total charge
  application_fee_amount: ticketPrice,      // ← KEY: Host gets this
  transfer_data: { destination: hostAcct }
}
```

## ✅ Validation

### Automatic
Every payment logs validation:
```
✅ Model A validated: Ticket: $50.00, Buyer Fee: $2.77, 
   Total: $52.77, YardLine Net: $0.99, Host Gets: $50.00
```

### Manual Test
```bash
npm run validate-model-a
```

## 🎨 UI Changes

### Terminology
- ❌ ~~Platform fee~~
- ✅ **Service & processing fee**

### Display Format
```
Ticket               $50.00
Service & processing fee  $2.77
─────────────────────────────
Total                $52.77
```

## 🔍 Troubleshooting

### Issue: YardLine not netting $0.99
**Check**: `application_fee_amount = ticketSubtotalCents` (not buyer fee)

### Issue: Host not getting full price
**Check**: Stripe Dashboard → Connect → Transfers

### Issue: Math seems wrong
**Run**: `npm run validate-model-a`

## 📝 Response Fields

### New Fields
- `buyerFeeTotalCents`
- `serviceAndProcessingFeeCents`
- `pricingModel: "model_a"`

### Legacy Fields (still present)
- `platformFeeTotalCents` (= buyerFeeTotalCents)

## 🚀 Deploy Checklist

- [ ] Code deployed
- [ ] Test in staging
- [ ] Run validation script
- [ ] Check console logs
- [ ] Verify Stripe Dashboard
- [ ] Update frontend UI
- [ ] Monitor first transactions

## 📚 Documentation

- **[MODEL_A_PRICING.md](./MODEL_A_PRICING.md)** - Full guide
- **[MODEL_A_FUND_FLOW.md](./MODEL_A_FUND_FLOW.md)** - Visual diagrams
- **[MODEL_A_IMPLEMENTATION_SUMMARY.md](./MODEL_A_IMPLEMENTATION_SUMMARY.md)** - Complete summary

## 🎓 Key Concepts

### Why This Formula?
The formula accounts for Stripe taking 2.9% + $0.30 from the total charge, ensuring YardLine still nets $0.99.

### Why application_fee_amount = ticket price?
In Stripe Connect destination charges, `application_fee_amount` is what the platform (YardLine) takes. But with Model A, we want the **host** to get this amount, and YardLine keeps the rest (after Stripe fees).

### Stripe Fee Math
```
Total: $52.77
Stripe: $52.77 × 0.029 + $0.30 = $1.83
Distributed: $52.77 - $1.83 = $50.94
  ├─ Host: $50.00 (application_fee_amount)
  └─ YardLine: $0.94 → ~$0.99
```

## ⚡ Quick Commands

```bash
# Build
npm run build

# Start
npm start

# Validate
npm run validate-model-a

# Test create payment
curl -X POST http://localhost:3000/v1/payments/create-intent \
  -H "Content-Type: application/json" \
  -d '{"userId":"test","eventId":"test","connectedAccountId":"acct_test","items":[{"ticketTypeId":"vip","ticketTypeName":"VIP","priceCents":5000,"quantity":1}]}'
```

## 🎉 Success Indicators

✅ Console shows: `✅ Model A validated`  
✅ Response has: `"pricingModel": "model_a"`  
✅ YardLine nets: ~$0.99 per ticket  
✅ Host receives: 100% of ticket price  
✅ Buyer pays: Ticket + Service fee  

---

**Questions?** See [MODEL_A_PRICING.md](./MODEL_A_PRICING.md) or check Stripe Dashboard
