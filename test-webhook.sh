#!/bin/bash

# Stripe Webhook Test Script
# This script helps verify the webhook endpoint is correctly configured

echo "=========================================="
echo "Stripe Webhook Configuration Test"
echo "=========================================="
echo ""

# Check if server is running
echo "1. Checking if server is running..."
if curl -s http://localhost:3000/health > /dev/null 2>&1; then
    echo "✅ Server is running"
else
    echo "❌ Server is not running on port 3000"
    echo "   Start the server with: npm run dev"
    exit 1
fi
echo ""

# Check webhook endpoint responds
echo "2. Testing webhook endpoint..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST http://localhost:3000/v1/stripe/webhooks \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}')

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "400" ]; then
    echo "✅ Webhook endpoint responds (expects 400 without signature)"
    echo "   Response: $BODY"
else
    echo "⚠️  Unexpected HTTP code: $HTTP_CODE"
    echo "   Response: $BODY"
fi
echo ""

# Check environment variables
echo "3. Checking environment configuration..."
echo "   (Run this manually to see your actual env vars)"
echo ""
echo "   Required environment variables:"
echo "   - STRIPE_SECRET_KEY or STRIPE_TEST_SECRET_KEY/STRIPE_LIVE_SECRET_KEY"
echo "   - STRIPE_WEBHOOK_SECRET or STRIPE_TEST_WEBHOOK_SECRET/STRIPE_LIVE_WEBHOOK_SECRET"
echo ""

# Instructions for Stripe CLI testing
echo "=========================================="
echo "Next Steps for Production Verification:"
echo "=========================================="
echo ""
echo "1. Forward webhooks from Stripe CLI:"
echo "   stripe listen --forward-to localhost:3000/v1/stripe/webhooks"
echo ""
echo "2. In another terminal, trigger a test event:"
echo "   stripe trigger payment_intent.succeeded"
echo ""
echo "3. Watch server logs for:"
echo "   ✅ 'Webhook signature verified successfully'"
echo "   ✅ 'Event type: payment_intent.succeeded'"
echo "   ✅ 'Webhook processed successfully'"
echo ""
echo "4. Production Stripe Dashboard Setup:"
echo "   - Go to: https://dashboard.stripe.com/webhooks"
echo "   - Add endpoint: https://your-domain.com/v1/stripe/webhooks"
echo "   - Select events: payment_intent.succeeded, account.updated"
echo "   - Copy the webhook signing secret to your environment variables"
echo ""
echo "=========================================="
