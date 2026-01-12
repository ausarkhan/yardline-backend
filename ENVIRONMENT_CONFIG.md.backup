# Environment-Based Stripe Configuration

## Overview

The backend now supports **environment-based Stripe key selection** via the `STRIPE_ENV` variable. This allows you to configure both test and live credentials simultaneously and switch between them easily.

---

## Configuration Modes

### Mode 1: Environment-Based (Recommended)

Use `STRIPE_ENV` to explicitly select test or live mode with separate credentials.

```bash
# Select environment (test or live)
export STRIPE_ENV=test  # or "live"

# Test mode credentials
export STRIPE_TEST_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxxx
export STRIPE_TEST_WEBHOOK_SECRET=whsec_test_xxxxxxxxxxxxxxxxxxxxx

# Live mode credentials
export STRIPE_LIVE_SECRET_KEY=sk_live_xxxxxxxxxxxxxxxxxxxxx
export STRIPE_LIVE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxx

# Optional: Review mode for App Store review
export REVIEW_MODE=false
```

**Benefits:**
- ✅ Both test and live credentials configured at once
- ✅ Easy environment switching (just change `STRIPE_ENV`)
- ✅ No need to reconfigure keys when switching
- ✅ Correct webhook secret automatically selected
- ✅ Ideal for staging/production deployments

### Mode 2: Legacy Single Key (Backward Compatible)

Use a single `STRIPE_SECRET_KEY` and the backend auto-detects mode from the key prefix.

```bash
# Single secret key (mode auto-detected from sk_test_ or sk_live_ prefix)
export STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxxx

# Single webhook secret
export STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxx

# Optional
export REVIEW_MODE=false
```

**Benefits:**
- ✅ Backward compatible with existing setups
- ✅ Simpler for development/testing
- ✅ Auto-detects test/live from key prefix

---

## Environment Variable Reference

### Primary Configuration (Mode 1)

| Variable | Required | Description |
|----------|----------|-------------|
| `STRIPE_ENV` | Yes* | Environment selector: `test` or `live` |
| `STRIPE_TEST_SECRET_KEY` | Yes* | Stripe secret key for test mode (starts with `sk_test_`) |
| `STRIPE_LIVE_SECRET_KEY` | Yes* | Stripe secret key for live mode (starts with `sk_live_`) |
| `STRIPE_TEST_WEBHOOK_SECRET` | Recommended | Webhook signing secret for test mode (starts with `whsec_`) |
| `STRIPE_LIVE_WEBHOOK_SECRET` | Recommended | Webhook signing secret for live mode (starts with `whsec_`) |

*Required if using environment-based mode

### Legacy Configuration (Mode 2)

| Variable | Required | Description |
|----------|----------|-------------|
| `STRIPE_SECRET_KEY` | Yes* | Single Stripe secret key (mode auto-detected) |
| `STRIPE_WEBHOOK_SECRET` | Recommended | Webhook signing secret |

*Required if NOT using environment-based mode

### Optional Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `STRIPE_PUBLISHABLE_KEY` | - | Publishable key returned in API responses |
| `REVIEW_MODE` | `false` | Enable App Store review mode (limits charges to $1.00) |
| `PORT` | `3000` | Server port |

---

## Configuration Examples

### Development (Test Mode)

**Option 1: Environment-Based**
```bash
export STRIPE_ENV=test
export STRIPE_TEST_SECRET_KEY=sk_test_51Abc...
export STRIPE_TEST_WEBHOOK_SECRET=whsec_abc123...
export STRIPE_PUBLISHABLE_KEY=pk_test_51Abc...
export REVIEW_MODE=false
```

**Option 2: Legacy**
```bash
export STRIPE_SECRET_KEY=sk_test_51Abc...
export STRIPE_WEBHOOK_SECRET=whsec_abc123...
export STRIPE_PUBLISHABLE_KEY=pk_test_51Abc...
export REVIEW_MODE=false
```

### Staging (Test Mode with Live Keys Available)

```bash
# Currently use test mode
export STRIPE_ENV=test

# But have both configured for easy switching
export STRIPE_TEST_SECRET_KEY=sk_test_51Abc...
export STRIPE_TEST_WEBHOOK_SECRET=whsec_test_abc123...
export STRIPE_LIVE_SECRET_KEY=sk_live_51Xyz...
export STRIPE_LIVE_WEBHOOK_SECRET=whsec_xyz789...

export STRIPE_PUBLISHABLE_KEY=pk_test_51Abc...
export REVIEW_MODE=false
```

### Production (Live Mode)

```bash
# Use live mode
export STRIPE_ENV=live

# Both test and live credentials available
export STRIPE_TEST_SECRET_KEY=sk_test_51Abc...
export STRIPE_TEST_WEBHOOK_SECRET=whsec_test_abc123...
export STRIPE_LIVE_SECRET_KEY=sk_live_51Xyz...
export STRIPE_LIVE_WEBHOOK_SECRET=whsec_xyz789...

export STRIPE_PUBLISHABLE_KEY=pk_live_51Xyz...
export REVIEW_MODE=false
```

### App Store Review (Live Mode, Restricted)

```bash
export STRIPE_ENV=live
export STRIPE_TEST_SECRET_KEY=sk_test_51Abc...
export STRIPE_TEST_WEBHOOK_SECRET=whsec_test_abc123...
export STRIPE_LIVE_SECRET_KEY=sk_live_51Xyz...
export STRIPE_LIVE_WEBHOOK_SECRET=whsec_xyz789...
export STRIPE_PUBLISHABLE_KEY=pk_live_51Xyz...
export REVIEW_MODE=true  # ← Limits charges to $1.00
```

---

## Switching Environments

### Environment-Based Mode

Simply change `STRIPE_ENV` and restart the server:

```bash
# Switch from test to live
export STRIPE_ENV=live
npm restart

# Switch back to test
export STRIPE_ENV=test
npm restart
```

No need to change any other variables!

### Legacy Mode

Change `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`:

```bash
# Switch to test
export STRIPE_SECRET_KEY=sk_test_51Abc...
export STRIPE_WEBHOOK_SECRET=whsec_test_abc123...
npm restart

# Switch to live
export STRIPE_SECRET_KEY=sk_live_51Xyz...
export STRIPE_WEBHOOK_SECRET=whsec_xyz789...
npm restart
```

---

## Verification

### Check Current Mode

```bash
curl http://localhost:3000/v1/stripe/mode
```

**Response (Environment-Based Mode):**
```json
{
  "success": true,
  "data": {
    "mode": "test",
    "isTestMode": true,
    "isLiveMode": false,
    "reviewMode": false,
    "reviewModeMaxChargeCents": null,
    "envConfigured": true,
    "stripeEnv": "test",
    "webhookConfigured": true
  }
}
```

**Response (Legacy Mode):**
```json
{
  "success": true,
  "data": {
    "mode": "test",
    "isTestMode": true,
    "isLiveMode": false,
    "reviewMode": false,
    "reviewModeMaxChargeCents": null,
    "envConfigured": false,
    "stripeEnv": "auto-detect",
    "webhookConfigured": true
  }
}
```

### Field Descriptions

| Field | Description |
|-------|-------------|
| `mode` | Current Stripe mode: `test` or `live` |
| `isTestMode` | Boolean: true if in test mode |
| `isLiveMode` | Boolean: true if in live mode |
| `reviewMode` | Boolean: true if review mode enabled |
| `reviewModeMaxChargeCents` | Max charge in cents when review mode enabled (100 = $1.00) |
| `envConfigured` | Boolean: true if using `STRIPE_ENV` (environment-based mode) |
| `stripeEnv` | Current environment selector or "auto-detect" |
| `webhookConfigured` | Boolean: true if webhook secret is configured |

---

## Webhook Configuration

### Environment-Based Mode

You need **TWO** webhook endpoints in the Stripe Dashboard:

#### Test Mode Webhook
1. Go to [Stripe Dashboard (Test Mode)](https://dashboard.stripe.com/test/webhooks)
2. Create endpoint: `https://staging.yardline.com/v1/stripe/webhooks`
3. Select events: `payment_intent.succeeded`, `payment_intent.payment_failed`
4. Copy signing secret → `STRIPE_TEST_WEBHOOK_SECRET`

#### Live Mode Webhook
1. Go to [Stripe Dashboard (Live Mode)](https://dashboard.stripe.com/webhooks)
2. Create endpoint: `https://api.yardline.com/v1/stripe/webhooks`
3. Select events: `payment_intent.succeeded`, `payment_intent.payment_failed`
4. Copy signing secret → `STRIPE_LIVE_WEBHOOK_SECRET`

### Legacy Mode

Create ONE webhook endpoint matching your current mode:

1. Go to Stripe Dashboard (Test or Live mode)
2. Create endpoint: `https://api.yardline.com/v1/stripe/webhooks`
3. Select events: `payment_intent.succeeded`, `payment_intent.payment_failed`
4. Copy signing secret → `STRIPE_WEBHOOK_SECRET`

---

## Webhook Signature Verification

The backend automatically selects the correct webhook secret based on the environment:

```typescript
// Environment-based mode
if (STRIPE_ENV === 'test') {
  // Uses STRIPE_TEST_WEBHOOK_SECRET
} else if (STRIPE_ENV === 'live') {
  // Uses STRIPE_LIVE_WEBHOOK_SECRET
}

// Legacy mode
// Uses STRIPE_WEBHOOK_SECRET
```

**Webhook logs show which mode was used:**
```
Webhook verified for test mode: payment_intent.succeeded
Webhook verified for live mode: payment_intent.succeeded
```

**If webhook secret not configured:**
```
⚠️  Webhook signature verification disabled - set STRIPE_WEBHOOK_SECRET
```

---

## Error Handling

### Missing Secret Key

```
Error: STRIPE_ENV is set to "live" but STRIPE_LIVE_SECRET_KEY is not configured
```

**Solution**: Set the required secret key:
```bash
export STRIPE_LIVE_SECRET_KEY=sk_live_xxxxx
```

### Missing Webhook Secret

Webhook signature verification will fail:
```
Webhook signature verification failed
```

**Solution**: Configure webhook secret for your environment:
```bash
# Environment-based mode
export STRIPE_TEST_WEBHOOK_SECRET=whsec_test_xxxxx
export STRIPE_LIVE_WEBHOOK_SECRET=whsec_xxxxx

# OR legacy mode
export STRIPE_WEBHOOK_SECRET=whsec_xxxxx
```

### Wrong Environment

If `STRIPE_ENV=live` but using test webhook:
```
Webhook signature verification failed
```

**Solution**: Ensure webhook was created in the correct Stripe Dashboard mode (test vs live).

---

## Migration Guide

### From Legacy to Environment-Based

**Before (Legacy):**
```bash
export STRIPE_SECRET_KEY=sk_test_51Abc...
export STRIPE_WEBHOOK_SECRET=whsec_abc123...
```

**After (Environment-Based):**
```bash
export STRIPE_ENV=test
export STRIPE_TEST_SECRET_KEY=sk_test_51Abc...
export STRIPE_TEST_WEBHOOK_SECRET=whsec_abc123...
export STRIPE_LIVE_SECRET_KEY=sk_live_51Xyz...
export STRIPE_LIVE_WEBHOOK_SECRET=whsec_xyz789...

# Remove old variables (optional, backward compatibility maintained)
unset STRIPE_SECRET_KEY
unset STRIPE_WEBHOOK_SECRET
```

**Benefits:**
- Can switch between test/live instantly
- No need to change keys when switching environments
- Both webhooks configured and working

---

## Docker / Container Configuration

### Using Environment Variables

```dockerfile
# Dockerfile
ENV STRIPE_ENV=test
ENV STRIPE_TEST_SECRET_KEY=${STRIPE_TEST_SECRET_KEY}
ENV STRIPE_TEST_WEBHOOK_SECRET=${STRIPE_TEST_WEBHOOK_SECRET}
ENV STRIPE_LIVE_SECRET_KEY=${STRIPE_LIVE_SECRET_KEY}
ENV STRIPE_LIVE_WEBHOOK_SECRET=${STRIPE_LIVE_WEBHOOK_SECRET}
```

### Using Docker Compose

```yaml
# docker-compose.yml
version: '3.8'
services:
  api:
    image: yardline-backend
    environment:
      STRIPE_ENV: test
      STRIPE_TEST_SECRET_KEY: ${STRIPE_TEST_SECRET_KEY}
      STRIPE_TEST_WEBHOOK_SECRET: ${STRIPE_TEST_WEBHOOK_SECRET}
      STRIPE_LIVE_SECRET_KEY: ${STRIPE_LIVE_SECRET_KEY}
      STRIPE_LIVE_WEBHOOK_SECRET: ${STRIPE_LIVE_WEBHOOK_SECRET}
      REVIEW_MODE: false
```

### Using .env File

```bash
# .env
STRIPE_ENV=test
STRIPE_TEST_SECRET_KEY=sk_test_51Abc...
STRIPE_TEST_WEBHOOK_SECRET=whsec_test_abc123...
STRIPE_LIVE_SECRET_KEY=sk_live_51Xyz...
STRIPE_LIVE_WEBHOOK_SECRET=whsec_xyz789...
REVIEW_MODE=false
```

**Load with:**
```bash
source .env
npm start
```

---

## Best Practices

### ✅ Do

- **Use environment-based mode** for staging/production
- **Configure both test and live credentials** in production (for easy rollback)
- **Set webhook secrets** for signature verification
- **Use different webhook URLs** for test vs live (e.g., staging.yardline.com vs api.yardline.com)
- **Enable review mode** during App Store review
- **Verify mode** after deployment: `GET /v1/stripe/mode`
- **Log webhook events** to debug issues

### ❌ Don't

- **Don't hardcode keys** in source code
- **Don't commit .env files** to version control
- **Don't skip webhook signature verification** in production
- **Don't use test keys** in production
- **Don't forget to disable review mode** after App Store approval
- **Don't mix test/live webhooks** (use correct webhook secret for each mode)

---

## Troubleshooting

### Issue: "No Stripe secret key configured"

**Cause**: Neither `STRIPE_ENV` + environment-specific keys nor `STRIPE_SECRET_KEY` is set.

**Solution**: Configure environment variables:
```bash
# Option 1: Environment-based
export STRIPE_ENV=test
export STRIPE_TEST_SECRET_KEY=sk_test_xxxxx

# Option 2: Legacy
export STRIPE_SECRET_KEY=sk_test_xxxxx
```

### Issue: Webhook signature verification fails

**Cause**: Wrong webhook secret for the environment.

**Solution**: 
1. Check current mode: `GET /v1/stripe/mode`
2. Ensure webhook secret matches:
   - Test mode → `STRIPE_TEST_WEBHOOK_SECRET` (or `STRIPE_WEBHOOK_SECRET` in legacy mode)
   - Live mode → `STRIPE_LIVE_WEBHOOK_SECRET` (or `STRIPE_WEBHOOK_SECRET` in legacy mode)
3. Verify webhook was created in correct Stripe Dashboard mode

### Issue: "envConfigured": false but using STRIPE_ENV

**Cause**: `STRIPE_ENV` is set but environment-specific keys are missing.

**Solution**: Set the required keys:
```bash
export STRIPE_TEST_SECRET_KEY=sk_test_xxxxx
export STRIPE_LIVE_SECRET_KEY=sk_live_xxxxx
```

### Issue: Mode detection shows wrong mode

**Cause**: Using legacy mode and key prefix doesn't match expected mode.

**Solution**: Switch to environment-based mode or verify key prefix:
- Test keys start with `sk_test_`
- Live keys start with `sk_live_`

---

## Summary

| Feature | Environment-Based | Legacy |
|---------|-------------------|--------|
| **Configuration** | `STRIPE_ENV` + separate keys | Single `STRIPE_SECRET_KEY` |
| **Mode Switching** | Change `STRIPE_ENV` only | Change all keys |
| **Webhook Secrets** | Separate test/live secrets | Single secret |
| **Best For** | Production, Staging | Development, Simple setups |
| **Backward Compatible** | Yes | Yes |

**Recommendation**: Use **environment-based mode** for production deployments to enable easy environment switching and proper webhook configuration.

---

## Quick Reference

```bash
# Check current configuration
curl http://localhost:3000/v1/stripe/mode

# Environment-based setup (recommended)
export STRIPE_ENV=test
export STRIPE_TEST_SECRET_KEY=sk_test_xxxxx
export STRIPE_TEST_WEBHOOK_SECRET=whsec_test_xxxxx
export STRIPE_LIVE_SECRET_KEY=sk_live_xxxxx
export STRIPE_LIVE_WEBHOOK_SECRET=whsec_xxxxx

# Legacy setup (backward compatible)
export STRIPE_SECRET_KEY=sk_test_xxxxx
export STRIPE_WEBHOOK_SECRET=whsec_xxxxx

# Optional
export STRIPE_PUBLISHABLE_KEY=pk_test_xxxxx
export REVIEW_MODE=false
export PORT=3000

# Start server
npm start
```

---

**Ready to use!** 🚀
