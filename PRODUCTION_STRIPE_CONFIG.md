# Production Stripe Configuration (LIVE-ONLY)

## Overview

The YardLine backend is now configured for **LIVE Stripe only** with production safety enforcement. All test mode logic has been removed to prevent accidental use of test keys in production.

## Configuration Requirements

### Required Environment Variable

```bash
STRIPE_LIVE_SECRET_KEY=sk_live_xxxxxxxxxxxxx
```

**CRITICAL:** The server will **crash on startup** if:
- `STRIPE_LIVE_SECRET_KEY` is not set
- The key does not start with `sk_live_`

### Optional Environment Variable

```bash
STRIPE_LIVE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxx
```

This enables webhook signature validation. While optional, it is **strongly recommended** for production.

## Startup Validation

On server startup, the following validations occur:

1. ✅ Check if `STRIPE_LIVE_SECRET_KEY` is configured
2. ✅ Validate the key starts with `sk_live_`
3. ✅ Initialize Stripe client in LIVE mode
4. ✅ Log startup status with Stripe mode

If any validation fails, the server will **immediately crash** with a clear error message.

### Startup Logs

```
============================================================
🚀 YardLine API Server Started
============================================================
📍 Port: 3000
💳 Stripe Mode: LIVE ONLY (sk_live_***)
🔒 Production Safety: Enforced
🔔 Webhook: Configured
📊 Review Mode: DISABLED
============================================================
```

## Production Safety Features

### 1. **No Test Keys**
- Removed all `STRIPE_TEST_SECRET_KEY` logic
- Removed `STRIPE_ENV` switching
- No fallback to test mode

### 2. **Startup Validation**
- Key prefix validation (`sk_live_`)
- Fail-fast on misconfiguration
- Clear error messages

### 3. **Hardened PaymentIntent Creation**

All PaymentIntent operations include:

#### Amount Validation
```typescript
// Validate amount > 0
if (amount <= 0) {
  throw new Error('Amount must be greater than 0');
}
```

#### Currency Enforcement
```typescript
// Currency must be USD
currency: 'usd'
```

#### Client Secret Validation
```typescript
// Always return client_secret
if (!paymentIntent.client_secret) {
  throw new Error('PaymentIntent missing client_secret');
}
```

### 4. **Enhanced Error Logging**

All Stripe API operations now include:

```typescript
try {
  const paymentIntent = await stripe.paymentIntents.create({...});
  console.log(`✅ PaymentIntent created: ${paymentIntent.id}, status=${paymentIntent.status}`);
} catch (stripeError: any) {
  console.error(`❌ Stripe PaymentIntent creation failed:`, {
    error: stripeError.message,
    code: stripeError.code,
    type: stripeError.type,
    amount: totalChargeCents
  });
  throw stripeError;
}
```

### 5. **Observability**

#### PaymentIntent Creation
- ✅ Log creation success with ID and status
- ❌ Log creation failures with full context
- 🔍 Log amount, currency, and metadata

#### PaymentIntent Retrieval
- ✅ Log retrieval success with status
- ❌ Log retrieval failures

#### PaymentIntent Capture
- ✅ Log capture success
- ❌ Log capture failures with context

#### PaymentIntent Cancel
- ✅ Log cancel success
- ❌ Log cancel failures with reason

## Migration from Test/Live Switching

### Old Configuration (REMOVED)

```bash
# ❌ NO LONGER SUPPORTED
STRIPE_ENV=test
STRIPE_TEST_SECRET_KEY=sk_test_...
STRIPE_LIVE_SECRET_KEY=sk_live_...
STRIPE_SECRET_KEY=sk_test_...
```

### New Configuration (REQUIRED)

```bash
# ✅ PRODUCTION CONFIGURATION
STRIPE_LIVE_SECRET_KEY=sk_live_xxxxxxxxxxxxx
STRIPE_LIVE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxx
```

## API Endpoints

### GET /v1/stripe/mode

Returns the current Stripe configuration:

```json
{
  "success": true,
  "data": {
    "mode": "live",
    "isTestMode": false,
    "isLiveMode": true,
    "reviewMode": false,
    "reviewModeMaxChargeCents": null,
    "webhookConfigured": true,
    "message": "Production backend is configured for LIVE Stripe only"
  }
}
```

## Error Messages

### Missing Key

```
❌ FATAL: STRIPE_LIVE_SECRET_KEY is not configured
❌ PRODUCTION REQUIRES: STRIPE_LIVE_SECRET_KEY=sk_live_...
Error: STRIPE_LIVE_SECRET_KEY is required for production. Server cannot start.
```

### Invalid Key Prefix

```
❌ FATAL: STRIPE_LIVE_SECRET_KEY must start with sk_live_
❌ CURRENT KEY PREFIX: sk_test_...
❌ REFUSING TO START WITH NON-LIVE STRIPE KEY
Error: Invalid Stripe key: must be a LIVE key (sk_live_). Server cannot start.
```

## Testing

### Development/Staging

For development or staging environments that need test mode:
- Use a **separate backend instance** with test key configuration
- Do NOT deploy this production-hardened version to test environments

### Production

1. Set `STRIPE_LIVE_SECRET_KEY` with your live key
2. Set `STRIPE_LIVE_WEBHOOK_SECRET` (recommended)
3. Deploy the backend
4. Verify startup logs show "LIVE ONLY"
5. Test with real Stripe payment methods (small amounts)

## Security Considerations

1. **Never commit Stripe keys** to version control
2. **Use environment variables** for all secrets
3. **Rotate keys** if compromised
4. **Monitor Stripe Dashboard** for unusual activity
5. **Enable webhook signature validation** with `STRIPE_LIVE_WEBHOOK_SECRET`

## Monitoring

### Key Metrics to Monitor

1. **PaymentIntent creation success rate**
   - Look for `✅ PaymentIntent created` logs
   
2. **PaymentIntent failures**
   - Look for `❌ Stripe PaymentIntent creation failed` logs
   
3. **Payment capture success**
   - Look for `✅ Payment captured` logs
   
4. **Stripe API errors**
   - Monitor error codes: `card_declined`, `insufficient_funds`, etc.

### Log Patterns

```bash
# Success patterns
grep "✅ PaymentIntent created" logs.txt
grep "✅ Payment captured" logs.txt

# Error patterns
grep "❌ Stripe" logs.txt
grep "FATAL" logs.txt
```

## Support

For issues with Stripe configuration:
1. Check startup logs for validation errors
2. Verify environment variables are set correctly
3. Confirm key starts with `sk_live_`
4. Check [Stripe API Status](https://status.stripe.com/)

## Changelog

### 2026-01-12 - LIVE-Only Enforcement

**Breaking Changes:**
- ❌ Removed `STRIPE_ENV` environment variable
- ❌ Removed `STRIPE_TEST_SECRET_KEY` support
- ❌ Removed `STRIPE_SECRET_KEY` legacy support
- ❌ Removed test/live mode switching
- ❌ Removed auto-detection from key prefix

**New Features:**
- ✅ LIVE-only Stripe mode enforced
- ✅ Startup validation with sk_live_ prefix check
- ✅ Fail-fast on misconfiguration
- ✅ Enhanced logging for all Stripe operations
- ✅ PaymentIntent validation (amount > 0, currency = USD)
- ✅ Client secret validation
- ✅ Comprehensive error logging with context

**Migration Required:**
- Update environment variables to use `STRIPE_LIVE_SECRET_KEY`
- Remove old `STRIPE_ENV`, `STRIPE_TEST_SECRET_KEY`, `STRIPE_SECRET_KEY` variables
- Test startup validation works correctly
