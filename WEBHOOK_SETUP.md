# Stripe Webhook Configuration Guide

## Webhook Endpoint

**URL Path:** `/v1/stripe/webhooks`

This endpoint is configured following Stripe's official Express.js webhook pattern.

## Implementation Details

### ✅ Correct Configuration

1. **Route Registration Order** (CRITICAL)
   - Webhook route is defined BEFORE `app.use(express.json())`
   - This ensures raw body is preserved for signature verification

2. **Raw Body Parser**
   - Uses `express.raw({ type: 'application/json' })`
   - Preserves raw request body as Buffer for Stripe signature verification

3. **Signature Verification**
   - Always verifies signatures (no unsafe bypass mode)
   - Requires `STRIPE_WEBHOOK_SECRET` environment variable
   - Supports environment-specific secrets (test/live)

4. **Error Handling**
   - Signature failures return 400 status
   - Processing errors return 200 to prevent Stripe retries
   - Comprehensive error logging for debugging

## Environment Variables

### Required Configuration

Choose ONE of these configuration methods:

**Method 1: Simple (Single Environment)**
```bash
STRIPE_SECRET_KEY=sk_test_... or sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

**Method 2: Dual Environment (Recommended)**
```bash
STRIPE_ENV=test  # or 'live'
STRIPE_TEST_SECRET_KEY=sk_test_...
STRIPE_LIVE_SECRET_KEY=sk_live_...
STRIPE_TEST_WEBHOOK_SECRET=whsec_test...
STRIPE_LIVE_WEBHOOK_SECRET=whsec_live...
```

## Testing with Stripe CLI

### 1. Install Stripe CLI
```bash
# macOS
brew install stripe/stripe-cli/stripe

# Other platforms: https://stripe.com/docs/stripe-cli
```

### 2. Login to Stripe
```bash
stripe login
```

### 3. Forward Webhooks Locally
```bash
stripe listen --forward-to localhost:3000/v1/stripe/webhooks
```

This command will output a webhook signing secret like:
```
> Ready! Your webhook signing secret is whsec_xxxxx
```

### 4. Set the Webhook Secret
Copy the secret and add to your `.env` file:
```bash
STRIPE_WEBHOOK_SECRET=whsec_xxxxx
```

### 5. Trigger Test Events
In a separate terminal:
```bash
stripe trigger payment_intent.succeeded
```

### 6. Verify Success
Check your server logs for:
```
=== Stripe Webhook Received ===
✅ Webhook signature verified successfully
Event type: payment_intent.succeeded
💰 Payment succeeded: pi_xxxxx - Amount: 2000
✅ Webhook processed successfully
```

## Production Setup

### 1. Deploy Your Application
Ensure your backend is deployed and accessible at your production domain.

### 2. Configure Stripe Dashboard

1. Go to: https://dashboard.stripe.com/webhooks
2. Click "Add endpoint"
3. Enter your endpoint URL:
   ```
   https://your-production-domain.com/v1/stripe/webhooks
   ```
4. Select events to listen for:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `account.updated`
5. Click "Add endpoint"

### 3. Get Webhook Signing Secret
After creating the endpoint, click on it to view details and reveal the signing secret.

### 4. Configure Production Environment
Add the signing secret to your production environment variables:
```bash
STRIPE_WEBHOOK_SECRET=whsec_...  # For production
```

Or if using dual environment:
```bash
STRIPE_ENV=live
STRIPE_LIVE_WEBHOOK_SECRET=whsec_...
```

## Troubleshooting

### Error: "No stripe-signature header found"

**Cause:** Request is not coming from Stripe or is being proxied incorrectly.

**Solutions:**
- Verify the URL in Stripe Dashboard exactly matches your route
- Check if reverse proxy (nginx, CloudFlare) is stripping headers
- Configure proxy to preserve all headers

### Error: "Webhook signature verification failed"

**Causes & Solutions:**

1. **Wrong webhook secret**
   - Ensure you're using the correct secret for test/live mode
   - Regenerate secret in Stripe Dashboard if needed

2. **Body parser applied before webhook route**
   - ✅ FIXED: Webhook route is now defined before `express.json()`

3. **Request body modified**
   - Check for middleware that modifies request body
   - Verify Content-Type is `application/json`

4. **Proxy/Load Balancer Issues**
   - Ensure raw body is forwarded unchanged
   - Some proxies may modify or buffer the body

### Error: "No webhook secret configured"

**Solution:** Set required environment variables:
```bash
STRIPE_WEBHOOK_SECRET=whsec_...
```

### No Logs Appearing

**Check:**
1. Server is running: `curl http://localhost:3000/health`
2. Correct endpoint URL: `/v1/stripe/webhooks`
3. Stripe CLI is forwarding to correct port
4. Environment variables are loaded

## Webhook Event Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Stripe sends POST to /v1/stripe/webhooks                │
│    - Includes stripe-signature header                       │
│    - Body is raw JSON string                                │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. express.raw() middleware                                 │
│    - Preserves body as Buffer                               │
│    - Does NOT parse JSON                                    │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Webhook handler                                          │
│    - Extracts stripe-signature header                       │
│    - Calls stripe.webhooks.constructEvent()                 │
│    - Verifies signature using raw body + secret             │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Success: Event verified ✅                               │
│    - Process event based on type                            │
│    - Return 200 { received: true }                          │
└─────────────────────────────────────────────────────────────┘
```

## Debugging Logs

The webhook endpoint includes comprehensive logging:

```javascript
=== Stripe Webhook Received ===
Timestamp: 2026-01-08T10:30:00.000Z
Stripe-Signature header present: true
Webhook secret configured: true
Request body type: object
Request body is Buffer: true
Content-Type: application/json
✅ Webhook signature verified successfully
Event type: payment_intent.succeeded
Event ID: evt_xxxxx
Mode: test
Processing event: payment_intent.succeeded
💰 Payment succeeded: pi_xxxxx - Amount: 2000
✅ Webhook processed successfully
```

If verification fails, you'll see detailed error information to help diagnose the issue.

## Security Best Practices

1. **Always verify signatures** - Never disable signature verification in production
2. **Use HTTPS** - Webhooks should only be sent to HTTPS endpoints in production
3. **Rotate secrets** - Periodically rotate webhook signing secrets
4. **Monitor failures** - Set up alerts for webhook failures in Stripe Dashboard
5. **Idempotency** - Handle duplicate webhook deliveries (implemented via `processedPaymentIntents` Set)

## Quick Reference

| Aspect | Configuration |
|--------|---------------|
| Route Path | `/v1/stripe/webhooks` |
| Method | POST |
| Body Parser | `express.raw({ type: 'application/json' })` |
| Headers | `stripe-signature` required |
| Environment Variable | `STRIPE_WEBHOOK_SECRET` |
| Success Response | `200 { received: true }` |
| Failure Response | `400 "Webhook Error: ..."` |

## Support

For issues with webhook delivery or signature verification:
- Check server logs for detailed error messages
- Use `./test-webhook.sh` script for local testing
- Review Stripe Dashboard > Webhooks > Event log for delivery status
- Contact Stripe support if issues persist
