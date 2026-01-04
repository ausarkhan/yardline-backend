# yardline-backend

YardLine Backend API for Stripe Connect with environment-aware account handling.

## ✨ Latest Update: Environment-Aware Stripe Connect Accounts

This backend now implements intelligent Stripe Connect account handling that automatically manages separate test and live accounts, eliminating the issue of test mode requiring real SSN.

### What's Fixed
- ✅ Test mode (sk_test_...) uses separate Stripe accounts from live mode (sk_live_...)
- ✅ Test onboarding no longer requires real SSN
- ✅ Accounts are automatically created/managed based on environment
- ✅ No more accidental reuse of live accounts in test mode

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
```bash
# Test Mode
export STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxx
export STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxx  # Optional

# Live Mode
# export STRIPE_SECRET_KEY=sk_live_xxxxxxxxxxxx
```

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
    "isLiveMode": false
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

### Payment Endpoints
- `POST /v1/stripe/payment-intents` - Create payment intent
- `GET /v1/stripe/payment-intents/:paymentIntentId` - Get payment intent
- `POST /v1/stripe/payment-intents/:paymentIntentId/cancel` - Cancel payment
- `POST /v1/stripe/refunds` - Create refund
- `GET /v1/tickets/by-payment/:paymentIntentId` - Get tickets for payment

### Webhooks
- `POST /v1/stripe/webhooks` - Stripe webhook endpoint

## Documentation

- **[IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md)** - Complete implementation details
- **[STRIPE_CONNECT_CHANGES.md](STRIPE_CONNECT_CHANGES.md)** - Technical implementation specs
- **[DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)** - Step-by-step deployment guide
- **[API_CHANGES.md](API_CHANGES.md)** - Frontend integration guide
- **[QUICK_REFERENCE.md](QUICK_REFERENCE.md)** - Quick reference for developers
- **[DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md)** - Pre/post deployment verification

## Testing

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