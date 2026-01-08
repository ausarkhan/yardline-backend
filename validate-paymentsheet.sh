#!/bin/bash

# Validation script for PaymentSheet implementation with environment-based configuration

echo "🔍 Validating PaymentSheet Implementation..."
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check environment variables
echo "1. Checking Stripe configuration..."

# Determine configuration mode
if [ -n "$STRIPE_ENV" ]; then
  echo -e "${BLUE}ℹ️  Configuration mode: Environment-based (STRIPE_ENV)${NC}"
  echo -e "   STRIPE_ENV = $STRIPE_ENV"
  
  if [ "$STRIPE_ENV" == "test" ]; then
    if [ -z "$STRIPE_TEST_SECRET_KEY" ]; then
      echo -e "${RED}❌ STRIPE_TEST_SECRET_KEY not set${NC}"
      exit 1
    else
      echo -e "${GREEN}✅ STRIPE_TEST_SECRET_KEY is set${NC}"
    fi
    
    if [ -z "$STRIPE_TEST_WEBHOOK_SECRET" ]; then
      echo -e "${YELLOW}⚠️  STRIPE_TEST_WEBHOOK_SECRET not set (recommended)${NC}"
    else
      echo -e "${GREEN}✅ STRIPE_TEST_WEBHOOK_SECRET is set${NC}"
    fi
  elif [ "$STRIPE_ENV" == "live" ]; then
    if [ -z "$STRIPE_LIVE_SECRET_KEY" ]; then
      echo -e "${RED}❌ STRIPE_LIVE_SECRET_KEY not set${NC}"
      exit 1
    else
      echo -e "${GREEN}✅ STRIPE_LIVE_SECRET_KEY is set (LIVE MODE)${NC}"
    fi
    
    if [ -z "$STRIPE_LIVE_WEBHOOK_SECRET" ]; then
      echo -e "${YELLOW}⚠️  STRIPE_LIVE_WEBHOOK_SECRET not set (recommended)${NC}"
    else
      echo -e "${GREEN}✅ STRIPE_LIVE_WEBHOOK_SECRET is set${NC}"
    fi
  else
    echo -e "${RED}❌ STRIPE_ENV must be 'test' or 'live'${NC}"
    exit 1
  fi
else
  echo -e "${BLUE}ℹ️  Configuration mode: Legacy (single STRIPE_SECRET_KEY)${NC}"
  
  if [ -z "$STRIPE_SECRET_KEY" ]; then
    echo -e "${RED}❌ STRIPE_SECRET_KEY not set${NC}"
    exit 1
  else
    if [[ "$STRIPE_SECRET_KEY" == sk_live_* ]]; then
      echo -e "${GREEN}✅ STRIPE_SECRET_KEY is LIVE mode${NC}"
    elif [[ "$STRIPE_SECRET_KEY" == sk_test_* ]]; then
      echo -e "${YELLOW}⚠️  STRIPE_SECRET_KEY is TEST mode${NC}"
    else
      echo -e "${RED}❌ STRIPE_SECRET_KEY has invalid format${NC}"
      exit 1
    fi
  fi

  if [ -z "$STRIPE_WEBHOOK_SECRET" ]; then
    echo -e "${YELLOW}⚠️  STRIPE_WEBHOOK_SECRET not set (recommended)${NC}"
  else
    echo -e "${GREEN}✅ STRIPE_WEBHOOK_SECRET is set${NC}"
  fi
fi

if [ -z "$STRIPE_PUBLISHABLE_KEY" ]; then
  echo -e "${YELLOW}⚠️  STRIPE_PUBLISHABLE_KEY not set (optional)${NC}"
else
  echo -e "${GREEN}✅ STRIPE_PUBLISHABLE_KEY is set${NC}"
fi

echo ""

# Check if server is running
echo "2. Checking if server is running..."
if ! curl -s http://localhost:3000/health > /dev/null 2>&1; then
  echo -e "${RED}❌ Server is not running on port 3000${NC}"
  echo "   Run: npm run dev"
  exit 1
else
  echo -e "${GREEN}✅ Server is running${NC}"
fi

echo ""

# Check Stripe mode endpoint
echo "3. Checking Stripe mode..."
MODE_RESPONSE=$(curl -s http://localhost:3000/v1/stripe/mode)
MODE=$(echo $MODE_RESPONSE | grep -o '"mode":"[^"]*"' | cut -d'"' -f4)
REVIEW_MODE=$(echo $MODE_RESPONSE | grep -o '"reviewMode":[^,}]*' | cut -d':' -f2)
ENV_CONFIGURED=$(echo $MODE_RESPONSE | grep -o '"envConfigured":[^,}]*' | cut -d':' -f2)
WEBHOOK_CONFIGURED=$(echo $MODE_RESPONSE | grep -o '"webhookConfigured":[^,}]*' | cut -d':' -f2)

if [ "$MODE" == "live" ]; then
  echo -e "${GREEN}✅ Stripe mode: LIVE${NC}"
elif [ "$MODE" == "test" ]; then
  echo -e "${YELLOW}⚠️  Stripe mode: TEST${NC}"
else
  echo -e "${RED}❌ Could not detect Stripe mode${NC}"
  exit 1
fi

if [ "$ENV_CONFIGURED" == "true" ]; then
  echo -e "${GREEN}✅ Environment-based configuration: ENABLED${NC}"
else
  echo -e "${YELLOW}ℹ️  Environment-based configuration: DISABLED (using legacy mode)${NC}"
fi

if [ "$WEBHOOK_CONFIGURED" == "true" ]; then
  echo -e "${GREEN}✅ Webhook secret: CONFIGURED${NC}"
else
  echo -e "${YELLOW}⚠️  Webhook secret: NOT CONFIGURED${NC}"
fi

if [ "$REVIEW_MODE" == "true" ]; then
  echo -e "${YELLOW}⚠️  Review mode: ENABLED (charges limited to $1.00)${NC}"
else
  echo -e "${GREEN}✅ Review mode: DISABLED${NC}"
fi

echo ""

# Test payment intent creation
echo "4. Testing payment intent creation..."
PAYMENT_RESPONSE=$(curl -s -X POST http://localhost:3000/v1/payments/create-intent \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test_user",
    "eventId": "test_event",
    "customerEmail": "test@example.com",
    "customerName": "Test User",
    "items": [
      {
        "ticketTypeId": "general",
        "ticketTypeName": "General Admission",
        "priceCents": 5000,
        "quantity": 2
      }
    ]
  }')

if echo "$PAYMENT_RESPONSE" | grep -q '"success":true'; then
  echo -e "${GREEN}✅ Payment intent created successfully${NC}"
  
  # Check for required fields
  if echo "$PAYMENT_RESPONSE" | grep -q '"paymentIntentClientSecret"'; then
    echo -e "${GREEN}   ✅ paymentIntentClientSecret present${NC}"
  else
    echo -e "${RED}   ❌ paymentIntentClientSecret missing${NC}"
  fi
  
  if echo "$PAYMENT_RESPONSE" | grep -q '"customerId"'; then
    echo -e "${GREEN}   ✅ customerId present${NC}"
  else
    echo -e "${RED}   ❌ customerId missing${NC}"
  fi
  
  if echo "$PAYMENT_RESPONSE" | grep -q '"ephemeralKey"'; then
    echo -e "${GREEN}   ✅ ephemeralKey present${NC}"
  else
    echo -e "${RED}   ❌ ephemeralKey missing${NC}"
  fi
  
  # Check fee calculation
  SUBTOTAL=$(echo "$PAYMENT_RESPONSE" | grep -o '"ticketSubtotalCents":[0-9]*' | cut -d':' -f2)
  PLATFORM_FEE=$(echo "$PAYMENT_RESPONSE" | grep -o '"platformFeeTotalCents":[0-9]*' | cut -d':' -f2)
  
  if [ "$SUBTOTAL" == "10000" ] && [ "$PLATFORM_FEE" == "800" ]; then
    echo -e "${GREEN}   ✅ Fee calculation correct (2 × $50 tickets = $100, fee = $8.00)${NC}"
  else
    echo -e "${RED}   ❌ Fee calculation incorrect (subtotal: $SUBTOTAL, fee: $PLATFORM_FEE)${NC}"
  fi
else
  echo -e "${RED}❌ Failed to create payment intent${NC}"
  echo "$PAYMENT_RESPONSE" | jq '.' 2>/dev/null || echo "$PAYMENT_RESPONSE"
  exit 1
fi

echo ""

# Test review mode if enabled
if [ "$REVIEW_MODE" == "true" ]; then
  echo "5. Testing review mode limits..."
  LARGE_CHARGE_RESPONSE=$(curl -s -X POST http://localhost:3000/v1/payments/create-intent \
    -H "Content-Type: application/json" \
    -d '{
      "userId": "test_user",
      "eventId": "test_event",
      "items": [
        {
          "ticketTypeId": "expensive",
          "ticketTypeName": "Expensive Ticket",
          "priceCents": 10000,
          "quantity": 1
        }
      ]
    }')
  
  if echo "$LARGE_CHARGE_RESPONSE" | grep -q '"review_mode_limit_exceeded"'; then
    echo -e "${GREEN}✅ Review mode correctly blocking large charges${NC}"
  else
    echo -e "${RED}❌ Review mode not blocking large charges${NC}"
    exit 1
  fi
fi

echo ""
echo -e "${GREEN}🎉 All validations passed!${NC}"
echo ""
echo "Configuration Summary:"
if [ -n "$STRIPE_ENV" ]; then
  echo "  Mode: Environment-based (STRIPE_ENV=$STRIPE_ENV)"
else
  echo "  Mode: Legacy (single STRIPE_SECRET_KEY)"
fi
echo "  Stripe Mode: $MODE"
echo "  Webhook: $([ "$WEBHOOK_CONFIGURED" == "true" ] && echo "Configured" || echo "Not configured")"
echo "  Review Mode: $([ "$REVIEW_MODE" == "true" ] && echo "Enabled" || echo "Disabled")"
echo ""
echo "Next steps:"
echo "1. Configure webhook in Stripe Dashboard:"
if [ -n "$STRIPE_ENV" ]; then
  echo "   - Test mode: https://dashboard.stripe.com/test/webhooks"
  echo "     → URL: https://staging.yardline.com/v1/stripe/webhooks"
  echo "     → Copy secret to STRIPE_TEST_WEBHOOK_SECRET"
  echo "   - Live mode: https://dashboard.stripe.com/webhooks"
  echo "     → URL: https://api.yardline.com/v1/stripe/webhooks"
  echo "     → Copy secret to STRIPE_LIVE_WEBHOOK_SECRET"
else
  echo "   - URL: https://your-domain.com/v1/stripe/webhooks"
  echo "   - Events: payment_intent.succeeded, payment_intent.payment_failed"
  echo "   - Copy secret to STRIPE_WEBHOOK_SECRET"
fi
echo ""
echo "2. For production deployment:"
if [ -n "$STRIPE_ENV" ]; then
  echo "   - Set STRIPE_ENV=live"
else
  echo "   - Use LIVE Stripe keys (sk_live_...)"
fi
echo "   - Set REVIEW_MODE=false"
echo "   - Configure webhook secret"
echo ""
echo "3. Integrate PaymentSheet in mobile app"
echo "   - See PAYMENTSHEET_IMPLEMENTATION.md for mobile integration guide"
echo "   - See ENVIRONMENT_CONFIG.md for configuration details"
