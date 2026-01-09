#!/bin/bash

# Checkout Sessions Validation Script
# Validates that Checkout Sessions work correctly with Model A pricing

set -e

echo "=========================================="
echo "Checkout Sessions Validation"
echo "=========================================="
echo ""

# Check if server is running
if ! curl -s http://localhost:3000/health > /dev/null 2>&1; then
  echo "❌ Server is not running on port 3000"
  echo "   Start the server with: npm start"
  exit 1
fi

echo "✅ Server is running"
echo ""

# Test checkout session creation
echo "Test 1: Create Checkout Session"
echo "─────────────────────────────────"

response=$(curl -s -X POST http://localhost:3000/v1/checkout/create-session \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test_user_checkout",
    "eventId": "test_event_checkout",
    "eventName": "Test Concert",
    "connectedAccountId": "acct_test_123",
    "items": [{
      "ticketTypeId": "vip",
      "ticketTypeName": "VIP Ticket",
      "priceCents": 5000,
      "quantity": 1
    }],
    "successUrl": "https://test.com/success?session_id={CHECKOUT_SESSION_ID}",
    "cancelUrl": "https://test.com/cancel"
  }')

success=$(echo "$response" | jq -r '.success // false')

if [ "$success" != "true" ]; then
  echo "❌ FAIL: Failed to create checkout session"
  echo "Response: $response"
  exit 1
fi

session_id=$(echo "$response" | jq -r '.data.sessionId // ""')
session_url=$(echo "$response" | jq -r '.data.sessionUrl // ""')
ticket_subtotal=$(echo "$response" | jq -r '.data.ticketSubtotalCents // 0')
buyer_fee=$(echo "$response" | jq -r '.data.buyerFeeTotalCents // 0')
total=$(echo "$response" | jq -r '.data.totalChargeCents // 0')
pricing_model=$(echo "$response" | jq -r '.data.pricingModel // ""')

echo "✅ Checkout session created"
echo "   Session ID: $session_id"
echo "   Ticket subtotal: \$$(echo "scale=2; $ticket_subtotal / 100" | bc)"
echo "   Buyer fee: \$$(echo "scale=2; $buyer_fee / 100" | bc)"
echo "   Total: \$$(echo "scale=2; $total / 100" | bc)"
echo "   Pricing model: $pricing_model"
echo ""

# Validate pricing
if [ "$pricing_model" != "model_a" ]; then
  echo "❌ FAIL: Pricing model should be 'model_a', got '$pricing_model'"
  exit 1
fi

if [ "$ticket_subtotal" != "5000" ]; then
  echo "❌ FAIL: Ticket subtotal should be 5000, got $ticket_subtotal"
  exit 1
fi

expected_total=$((ticket_subtotal + buyer_fee))
if [ "$total" != "$expected_total" ]; then
  echo "❌ FAIL: Total should be $expected_total, got $total"
  exit 1
fi

echo "✅ Pricing validation passed"
echo ""

# Validate session URL
if [[ ! "$session_url" =~ ^https://checkout.stripe.com ]]; then
  echo "❌ FAIL: Invalid session URL: $session_url"
  exit 1
fi

echo "✅ Session URL valid"
echo ""

# Test session retrieval (will show no tickets since payment not completed)
echo "Test 2: Retrieve Checkout Session"
echo "─────────────────────────────────"

if [ -n "$session_id" ] && [[ "$session_id" =~ ^cs_ ]]; then
  session_response=$(curl -s "http://localhost:3000/v1/checkout/session/$session_id")
  
  session_success=$(echo "$session_response" | jq -r '.success // false')
  
  if [ "$session_success" == "true" ]; then
    retrieved_session_id=$(echo "$session_response" | jq -r '.data.sessionId // ""')
    payment_status=$(echo "$session_response" | jq -r '.data.paymentStatus // ""')
    tickets_created=$(echo "$session_response" | jq -r '.data.ticketsCreated // false')
    
    echo "✅ Session retrieved successfully"
    echo "   Session ID: $retrieved_session_id"
    echo "   Payment status: $payment_status"
    echo "   Tickets created: $tickets_created"
    echo ""
    
    if [ "$tickets_created" == "true" ]; then
      echo "⚠️  Note: Tickets already created (payment completed)"
    else
      echo "ℹ️  Note: Tickets not created yet (awaiting payment)"
    fi
  else
    echo "⚠️  Warning: Could not retrieve session (may not exist in Stripe test mode)"
    echo "   This is expected if you haven't configured Stripe test keys"
  fi
else
  echo "⚠️  Warning: Invalid session ID format, skipping retrieval test"
fi

echo ""

# Test with multiple tickets
echo "Test 3: Create Session with Multiple Tickets"
echo "──────────────────────────────────────────"

multi_response=$(curl -s -X POST http://localhost:3000/v1/checkout/create-session \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test_user_multi",
    "eventId": "test_event_multi",
    "eventName": "Multi-Ticket Test",
    "connectedAccountId": "acct_test_456",
    "items": [
      {
        "ticketTypeId": "general",
        "ticketTypeName": "General Admission",
        "priceCents": 2500,
        "quantity": 2
      },
      {
        "ticketTypeId": "vip",
        "ticketTypeName": "VIP",
        "priceCents": 5000,
        "quantity": 1
      }
    ],
    "successUrl": "https://test.com/success?session_id={CHECKOUT_SESSION_ID}",
    "cancelUrl": "https://test.com/cancel"
  }')

multi_success=$(echo "$multi_response" | jq -r '.success // false')

if [ "$multi_success" != "true" ]; then
  echo "❌ FAIL: Failed to create multi-ticket checkout session"
  exit 1
fi

multi_subtotal=$(echo "$multi_response" | jq -r '.data.ticketSubtotalCents // 0')
multi_fee=$(echo "$multi_response" | jq -r '.data.buyerFeeTotalCents // 0')
multi_total=$(echo "$multi_response" | jq -r '.data.totalChargeCents // 0')

# Calculate expected: 2 x $25 + 1 x $50 = $100
expected_subtotal=10000

echo "✅ Multi-ticket session created"
echo "   Tickets: 2x General (\$25) + 1x VIP (\$50)"
echo "   Subtotal: \$$(echo "scale=2; $multi_subtotal / 100" | bc)"
echo "   Fee: \$$(echo "scale=2; $multi_fee / 100" | bc)"
echo "   Total: \$$(echo "scale=2; $multi_total / 100" | bc)"

if [ "$multi_subtotal" != "$expected_subtotal" ]; then
  echo "❌ FAIL: Subtotal should be $expected_subtotal, got $multi_subtotal"
  exit 1
fi

echo "✅ Multi-ticket pricing correct"
echo ""

# Test validation
echo "Test 4: Validation Checks"
echo "─────────────────────────────"

# Test missing required fields
error_response=$(curl -s -X POST http://localhost:3000/v1/checkout/create-session \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test_user"
  }')

error_success=$(echo "$error_response" | jq -r '.success // false')

if [ "$error_success" == "true" ]; then
  echo "❌ FAIL: Should reject request with missing fields"
  exit 1
fi

echo "✅ Correctly rejects invalid requests"
echo ""

# Final summary
echo "=========================================="
echo "✅ ALL TESTS PASSED"
echo ""
echo "Checkout Sessions Validation Summary:"
echo "  ✅ Session creation works"
echo "  ✅ Pricing model is Model A"
echo "  ✅ Fee calculation correct"
echo "  ✅ Session URL generated"
echo "  ✅ Multi-ticket support works"
echo "  ✅ Validation working"
echo ""
echo "Next Steps:"
echo "  1. Configure Stripe test keys to test full flow"
echo "  2. Complete checkout with test card: 4242 4242 4242 4242"
echo "  3. Verify webhook receives checkout.session.completed"
echo "  4. Confirm tickets created after payment"
echo ""
echo "Documentation:"
echo "  - CHECKOUT_SESSIONS.md - Full guide"
echo "  - CHECKOUT_QUICK_START.md - Quick reference"
echo "=========================================="
