# Backend Quick Reference - Environment-Based Stripe Keys

## 🎯 Configuration Cheat Sheet

### Environment-Based Mode (Recommended)
```bash
# Choose environment
export STRIPE_ENV=test          # or "live"

# Test credentials
export STRIPE_TEST_SECRET_KEY=sk_test_xxxxx
export STRIPE_TEST_WEBHOOK_SECRET=whsec_test_xxxxx

# Live credentials
export STRIPE_LIVE_SECRET_KEY=sk_live_xxxxx
export STRIPE_LIVE_WEBHOOK_SECRET=whsec_xxxxx

# Optional
export STRIPE_PUBLISHABLE_KEY=pk_test_xxxxx
export REVIEW_MODE=false
```

**Switch environments:** Just change `STRIPE_ENV=live` and restart!

### Legacy Mode (Backward Compatible)
```bash
export STRIPE_SECRET_KEY=sk_test_xxxxx
export STRIPE_WEBHOOK_SECRET=whsec_xxxxx
export STRIPE_PUBLISHABLE_KEY=pk_test_xxxxx
export REVIEW_MODE=false
```

---

## 🔑 API Endpoints

### Check Configuration
```bash
GET /v1/stripe/mode
```

### Create Payment Intent (PaymentSheet)
```bash
POST /v1/payments/create-intent
```
**Request:**
```json
{
  "userId": "user_123",
  "eventId": "event_456",
  "customerEmail": "user@example.com",
  "items": [
    {"ticketTypeId": "general", "ticketTypeName": "General", "priceCents": 5000, "quantity": 2}
  ]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "paymentIntentClientSecret": "pi_xxx_secret_yyy",
    "customerId": "cus_xxxxx",
    "ephemeralKey": "ek_live_xxxxx",
    "amount": 10800
  }
}
```

### Get Tickets
```bash
GET /v1/tickets/by-payment/:paymentIntentId
```

### Webhook Handler
```bash
POST /v1/stripe/webhooks
```

---

## 💰 Platform Fee Formula

```
platformFee = max(0.99, min(8% of ticketPrice, 12.99))
```

| Price | Fee |
|-------|-----|
| $5 | $0.99 |
| $50 | $4.00 |
| $100 | $8.00 |
| $200 | $12.99 |

---

## ✅ Validation

```bash
# Validate configuration
./validate-paymentsheet.sh

# Check mode
curl http://localhost:3000/v1/stripe/mode
```

---

## 🔄 Environment Switching

### Environment-Based
```bash
export STRIPE_ENV=live  # Switch to live
pm2 restart app
```

### Legacy
```bash
export STRIPE_SECRET_KEY=sk_live_xxxxx
export STRIPE_WEBHOOK_SECRET=whsec_xxxxx
pm2 restart app
```

---

## 🪝 Webhook Configuration

### Test Mode
- URL: `https://dashboard.stripe.com/test/webhooks`
- Endpoint: `https://staging.yardline.com/v1/stripe/webhooks`
- Events: `payment_intent.succeeded`, `payment_intent.payment_failed`
- Secret → `STRIPE_TEST_WEBHOOK_SECRET`

### Live Mode
- URL: `https://dashboard.stripe.com/webhooks`
- Endpoint: `https://api.yardline.com/v1/stripe/webhooks`
- Events: `payment_intent.succeeded`, `payment_intent.payment_failed`
- Secret → `STRIPE_LIVE_WEBHOOK_SECRET`

---

## ✨ Key Features

- ✅ Environment-based key selection (`STRIPE_ENV`)
- ✅ Server-side fee calculation (no client manipulation)
- ✅ PaymentSheet support (Apple Pay, cards, Klarna)
- ✅ Customer & Ephemeral Key generation
- ✅ Webhook signature verification (per environment)
- ✅ Idempotency protection
- ✅ Review mode ($1.00 limit for App Store)
- ✅ Backward compatible (legacy single key mode)

---

## 📚 Documentation

- [BACKEND_CONFIGURATION_SUMMARY.md](./BACKEND_CONFIGURATION_SUMMARY.md) - Complete summary
- [ENVIRONMENT_CONFIG.md](./ENVIRONMENT_CONFIG.md) - Configuration guide
- [PAYMENTSHEET_IMPLEMENTATION.md](./PAYMENTSHEET_IMPLEMENTATION.md) - PaymentSheet guide
- [MOBILE_INTEGRATION_QUICKSTART.md](./MOBILE_INTEGRATION_QUICKSTART.md) - Mobile guide

---

## 🚀 Production Checklist

- [ ] Set `STRIPE_ENV=live`
- [ ] Configure `STRIPE_LIVE_SECRET_KEY`
- [ ] Configure `STRIPE_LIVE_WEBHOOK_SECRET`
- [ ] Set `REVIEW_MODE=false`
- [ ] Create webhook in Live Dashboard
- [ ] Test payment with small amount
- [ ] Verify webhook receives events
- [ ] Run `./validate-paymentsheet.sh`

---

**Ready to deploy!** 🎉
