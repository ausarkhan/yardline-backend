#!/bin/bash

# Model A Pricing Validation Script
# Validates that YardLine backend correctly implements Model A pricing

set -e

echo "=========================================="
echo "Model A Pricing Validation"
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

# Test cases: Different ticket prices
declare -a test_prices=(1000 2500 5000 10000)
declare -a expected_fees=(158 204 277 431)

echo "Testing Model A fee calculations..."
echo ""

all_passed=true

for i in "${!test_prices[@]}"; do
  price=${test_prices[$i]}
  expected_fee=${expected_fees[$i]}
  
  price_dollars=$(echo "scale=2; $price / 100" | bc)
  expected_fee_dollars=$(echo "scale=2; $expected_fee / 100" | bc)
  
  echo "Test $(($i + 1)): Ticket price \$$price_dollars"
  
  # Create payment intent
  response=$(curl -s -X POST http://localhost:3000/v1/payments/create-intent \
    -H "Content-Type: application/json" \
    -d "{
      \"userId\": \"test_user_$(date +%s)\",
      \"eventId\": \"test_event_$(date +%s)\",
      \"connectedAccountId\": \"acct_test\",
      \"items\": [{
        \"ticketTypeId\": \"test_ticket\",
        \"ticketTypeName\": \"Test Ticket\",
        \"priceCents\": $price,
        \"quantity\": 1
      }]
    }")
  
  # Check if request succeeded
  success=$(echo "$response" | jq -r '.success // false')
  
  if [ "$success" != "true" ]; then
    echo "   ❌ API request failed"
    echo "   Response: $response"
    all_passed=false
    continue
  fi
  
  # Extract values
  pricing_model=$(echo "$response" | jq -r '.data.pricingModel // "unknown"')
  buyer_fee=$(echo "$response" | jq -r '.data.buyerFeeTotalCents // 0')
  ticket_subtotal=$(echo "$response" | jq -r '.data.ticketSubtotalCents // 0')
  total_charge=$(echo "$response" | jq -r '.data.amount // 0')
  
  buyer_fee_dollars=$(echo "scale=2; $buyer_fee / 100" | bc)
  total_dollars=$(echo "scale=2; $total_charge / 100" | bc)
  
  # Calculate expected YardLine net revenue
  # Stripe fee: 2.9% + $0.30
  stripe_fee=$(echo "scale=0; ($total_charge * 0.029 + 30) / 1" | bc)
  yardline_net=$(echo "scale=0; ($buyer_fee - $stripe_fee) / 1" | bc)
  yardline_net_dollars=$(echo "scale=2; $yardline_net / 100" | bc)
  
  echo "   Pricing Model: $pricing_model"
  echo "   Ticket Price: \$$price_dollars"
  echo "   Buyer Fee: \$$buyer_fee_dollars"
  echo "   Total Charge: \$$total_dollars"
  echo "   YardLine Net: \$$yardline_net_dollars"
  
  # Validate pricing model
  if [ "$pricing_model" != "model_a" ]; then
    echo "   ❌ FAIL: Pricing model should be 'model_a', got '$pricing_model'"
    all_passed=false
  fi
  
  # Validate buyer fee is within acceptable range (±2 cents)
  fee_diff=$((buyer_fee - expected_fee))
  if [ $fee_diff -lt -2 ] || [ $fee_diff -gt 2 ]; then
    echo "   ❌ FAIL: Buyer fee should be ~\$$expected_fee_dollars, got \$$buyer_fee_dollars"
    all_passed=false
  else
    echo "   ✅ Buyer fee correct (±2¢ tolerance)"
  fi
  
  # Validate YardLine nets $0.99 (±1 cent)
  if [ $yardline_net -lt 98 ] || [ $yardline_net -gt 100 ]; then
    echo "   ❌ FAIL: YardLine should net \$0.99, got \$$yardline_net_dollars"
    all_passed=false
  else
    echo "   ✅ YardLine nets \$0.99 (±1¢ tolerance)"
  fi
  
  # Validate total = ticket + fee
  expected_total=$((price + buyer_fee))
  if [ $total_charge -ne $expected_total ]; then
    echo "   ❌ FAIL: Total charge incorrect"
    all_passed=false
  else
    echo "   ✅ Total charge correct"
  fi
  
  echo ""
done

echo "=========================================="
if [ "$all_passed" = true ]; then
  echo "✅ ALL TESTS PASSED"
  echo "   Model A pricing is correctly implemented"
  echo ""
  echo "Key Validations:"
  echo "  ✅ Pricing model is 'model_a'"
  echo "  ✅ Buyer fees calculated correctly"
  echo "  ✅ YardLine nets \$0.99 per ticket"
  echo "  ✅ Total charges are accurate"
  exit 0
else
  echo "❌ SOME TESTS FAILED"
  echo "   Review the output above for details"
  exit 1
fi
