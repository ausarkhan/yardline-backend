# yardline-backend

YardLine Backend API for Stripe Connect with **environment-based Stripe configuration** and **full PaymentSheet support**.

## 🎉 Latest: Environment-Based Stripe Configuration!

The backend now supports **environment-based key selection** via `STRIPE_ENV`, allowing you to configure both test and live credentials simultaneously and switch between them instantly.

### ✨ New Environment Features
- **Environment Selector**: Use `STRIPE_ENV=test` or `STRIPE_ENV=live` to switch modes
- **Separate Credentials**: Configure both test and live keys at once
- **Auto-Select Webhook Secret**: Correct webhook secret used per environment
- **Easy Switching**: Change environment without reconfiguring keys
- **Backward Compatible**: Legacy single-key mode still supported

### ✅ PaymentSheet Features
- **Server-side Fee Calculation**: Platform fee formula `max(0.99, min(8% of price, 12.99))`
- **Customer & Ephemeral Keys**: Full support for saved payment methods
- **Webhook-driven Fulfillment**: Tickets generated only after `payment_intent.succeeded`
- **Idempotency Protection**: Prevents duplicate tickets/orders
- **Review-Safe Guardrail**: `REVIEW_MODE` flag limits charges to $1.00 for App Store review
- **LIVE Mode Ready**: Use `sk_live_` keys for production

📖 **Configuration:** [ENVIRONMENT_CONFIG.md](./ENVIRONMENT_CONFIG.md) | **PaymentSheet:** [PAYMENTSHEET_IMPLEMENTATION.md](./PAYMENTSHEET_IMPLEMENTATION.md) | **Quick Start:** [QUICK_START_GUIDE.md](./QUICK_START_GUIDE.md)

### What's Fixed
- ✅ Test mode (sk_test_...) uses separate Stripe accounts from live mode (sk_live_...)
- ✅ Test onboarding no longer requires real SSN
- ✅ Accounts are automatically created/managed based on environment
- ✅ No more accidental reuse of live accounts in test mode
- ✅ Full PaymentIntents support (no Checkout Sessions)
- ✅ Server-side pricing enforcement - client cannot manipulate amounts

### Key Features
- **Environment Detection**: Automatically detects test vs live mode from secret key
- **Account Separation**: Maintains separate `testStripeAccountId` and `liveStripeAccountId` per user
- **Smart Account Management**: Creates new accounts only when needed, reuses existing ones
- **Mode-Aware Responses**: All API responses include current Stripe mode
- **Backward Compatible**: Existing endpoints continue to work unchanged

## Quick Start

### Setup
```bash
npm install
npm run build
```

### Configure Environment

**Option 1: Environment-Based (Recommended)**
```bash
# Select environment
export STRIPE_ENV=test  # or "live"

# Test mode credentials
export STRIPE_TEST_SECRET_KEY=sk_test_xxxxxxxxxxxx
export STRIPE_TEST_WEBHOOK_SECRET=whsec_test_xxxxxxxxxxxx
export STRIPE_PUBLISHABLE_KEY=pk_test_xxxxxxxxxxxx

# Live mode credentials
export STRIPE_LIVE_SECRET_KEY=sk_live_xxxxxxxxxxxx
export STRIPE_LIVE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxx

# Optional: Review mode (App Store review - limits charges to $1.00)
export REVIEW_MODE=false
```

**Option 2: Legacy Single Key (Backward Compatible)**
```bash
# Single secret key (mode auto-detected from prefix)
export STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxx
export STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxx
export STRIPE_PUBLISHABLE_KEY=pk_test_xxxxxxxxxxxx

# Optional
export REVIEW_MODE=false
```

📖 **See [ENVIRONMENT_CONFIG.md](./ENVIRONMENT_CONFIG.md) for complete configuration guide**

### Run
```bash
npm start          # Production
npm run dev        # Development with hot reload
```

## API Endpoints

### Core Endpoints

#### Create/Get Stripe Connect Account
```bash
POST /v1/stripe/connect/accounts
```
**Request:**
```json
{
  "email": "vendor@example.com",
  "name": "Vendor Name",
  "userId": "vendor_123",
  "returnUrl": "https://app.com/return",
  "refreshUrl": "https://app.com/refresh"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "accountId": "acct_1234567890",
    "onboardingUrl": "https://connect.stripe.com/onboarding/...",
    "mode": "test"
  }
}
```

#### Get Current Stripe Mode
```bash
GET /v1/stripe/mode
```
**Response:**
```json
{
  "success": true,
  "data": {
    "mode": "test",
    "isTestMode": true,
    "isLiveMode": false,
    "reviewMode": false,
    "reviewModeMaxChargeCents": null
  }
}
```

#### Get Account Details
```bash
GET /v1/stripe/connect/accounts/:accountId
```

#### Create Onboarding Link
```bash
POST /v1/stripe/connect/accounts/:accountId/link
```

### Payment Endpoints (PaymentSheet Compatible)

#### **NEW: Create Payment Intent for PaymentSheet**
```bash
POST /v1/payments/create-intent
```
**Request:**
```json
{
  "userId": "user_123",
  "eventId": "event_456",
  "customerEmail": "user@example.com",
  "customerName": "John Doe",
  "connectedAccountId": "acct_xxxxx",
  "items": [
    {
      "ticketTypeId": "general",
      "ticketTypeName": "General Admission",
      "priceCents": 5000,
      "quantity": 2
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "paymentIntentClientSecret": "pi_xxx_secret_yyy",
    "paymentIntentId": "pi_xxxxx",
    "customerId": "cus_xxxxx",
    "ephemeralKey": "ek_live_xxxxx",
    "amount": 10800,
    "ticketSubtotalCents": 10000,
    "platformFeeTotalCents": 800,
    "mode": "live",
    "reviewMode": false
  }
}
```

#### Legacy Payment Endpoints
- `POST /v1/stripe/payment-intents` - Create payment intent (legacy)
- `GET /v1/stripe/payment-intents/:paymentIntentId` - Get payment intent
- `POST /v1/stripe/payment-intents/:paymentIntentId/cancel` - Cancel payment
- `POST /v1/stripe/refunds` - Create refund
- `GET /v1/tickets/by-payment/:paymentIntentId` - Get tickets for payment

### Webhooks
- `POST /v1/stripe/webhooks` - Stripe webhook endpoint

## Documentation

- **[ENVIRONMENT_CONFIG.md](ENVIRONMENT_CONFIG.md)** - **NEW!** Environment-based Stripe configuration guide
- **[PAYMENTSHEET_IMPLEMENTATION.md](PAYMENTSHEET_IMPLEMENTATION.md)** - Complete PaymentSheet integration guide
- **[MOBILE_INTEGRATION_QUICKSTART.md](MOBILE_INTEGRATION_QUICKSTART.md)** - One-page mobile developer guide
- **[IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md)** - Complete implementation details
- **[STRIPE_CONNECT_CHANGES.md](STRIPE_CONNECT_CHANGES.md)** - Technical implementation specs
- **[DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)** - Step-by-step deployment guide
- **[API_CHANGES.md](API_CHANGES.md)** - Frontend integration guide
- **[QUICK_REFERENCE.md](QUICK_REFERENCE.md)** - Quick reference for developers
- **[DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md)** - Pre/post deployment verification

## Testing

### Validate PaymentSheet Implementation
```bash
./validate-paymentsheet.sh
```

### Verify Mode Detection
```bash
curl http://localhost:3000/v1/stripe/mode
```

### Create Account in Test Mode
```bash
curl -X POST http://localhost:3000/v1/stripe/connect/accounts \
  -H "Content-Type: application/json" \
  -d '{
    "email": "vendor@example.com",
    "name": "Test Vendor",
    "userId": "vendor_001"
  }'
```

### Test Onboarding
Visit the returned `onboardingUrl` to complete Stripe Connect onboarding:
- **Test Mode**: No real SSN required, can use test data
- **Live Mode**: Real SSN and verification required

## Architecture

### Core Components
- **Mode Detection**: Automatic detection of test vs live from secret key
- **Account Management**: Separate storage for test and live account IDs
- **Helper Functions**: `getStripeMode()` and `getOrCreateStripeAccountId()`
- **API Responses**: All responses include current mode for clarity

### Data Flow
1. Request arrives with Stripe environment
2. `getStripeMode()` detects current mode from secret key
3. `getOrCreateStripeAccountId()` handles account creation/retrieval
4. Correct account ID returned based on mode
5. Response includes mode information

## Development

### Build
```bash
npm run build
```

### Start with Hot Reload
```bash
npm run dev
```

### Dependencies
- `express` - Web framework
- `stripe` - Stripe SDK
- `cors` - CORS middleware
- `uuid` - Ticket ID generation
- `typescript` - Type safety

## Environment Variables

| Variable | Required | Example | Purpose |
|----------|----------|---------|---------|
| `STRIPE_SECRET_KEY` | Yes | `sk_test_xxxxx` | Stripe authentication |
| `STRIPE_WEBHOOK_SECRET` | No | `whsec_xxxxx` | Webhook signature verification |
| `PORT` | No | `3000` | Server port (default: 3000) |

## Security Notes

- **Never commit secrets** to version control
- **Test keys only** for development/testing
- **Live keys protected** with proper access controls
- **Webhook verification** validates Stripe events
- **CORS enabled** for frontend integration

## Performance

- **Mode Detection**: O(1) - constant time
- **Account Lookup**: O(1) - map-based retrieval
- **Response Time**: < 1s for account creation
- **Memory Usage**: In-memory storage (consider database for production)

## Production Considerations

### Current Limitations
- In-memory storage (lost on restart)
- Single server only (not distributed)

### Recommended Upgrades
- **Database**: Migrate account IDs to persistent database
- **Caching**: Add Redis for distributed caching
- **Monitoring**: Add observability for account operations
- **Audit Logging**: Track account creation and mode changes

## Troubleshooting

### Issue: Wrong mode detected
**Solution**: Check `STRIPE_SECRET_KEY` environment variable
- Test: Should start with `sk_test_`
- Live: Should start with `sk_live_`

### Issue: Same account in both modes
**Solution**: Restart backend after changing `STRIPE_SECRET_KEY`

### Issue: userId not working
**Solution**: Ensure `userId` is included in request body

## Support

For questions about:
- **Implementation**: See [STRIPE_CONNECT_CHANGES.md](STRIPE_CONNECT_CHANGES.md)
- **Deployment**: See [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)
- **Frontend Integration**: See [API_CHANGES.md](API_CHANGES.md)
- **Stripe API**: Visit [Stripe Documentation](https://stripe.com/docs)

## Version

- **API Version**: 1.0.0
- **Node Version**: ≥18
- **Stripe API**: 2024-11-20.acacia