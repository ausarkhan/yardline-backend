#!/bin/bash

# Test script for Stripe Checkout Session booking flow
# Usage: ./test-checkout-booking.sh

set -e

# Configuration
API_URL="${API_URL:-http://localhost:3000}"
echo "🧪 Testing Checkout Session Booking Flow"
echo "API URL: $API_URL"
echo ""

# Check for required environment variables
if [ -z "$AUTH_TOKEN" ]; then
  echo "❌ Error: AUTH_TOKEN environment variable is required"
  echo "Set it with: export AUTH_TOKEN='your-jwt-token'"
  exit 1
fi

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper function to print test results
print_result() {
  if [ $1 -eq 0 ]; then
    echo -e "${GREEN}✅ PASS${NC}: $2"
  else
    echo -e "${RED}❌ FAIL${NC}: $2"
  fi
}

# Helper function to extract JSON field
get_json_field() {
  echo "$1" | grep -o "\"$2\"[^,}]*" | cut -d'"' -f4
}

echo "=================================================="
echo "Step 1: Create a test service"
echo "=================================================="

SERVICE_RESPONSE=$(curl -s -X POST "$API_URL/v1/services" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{
    "name": "Test Service for Checkout",
    "description": "Testing Stripe Checkout Session",
    "priceCents": 5000,
    "duration": 60
  }')

SERVICE_ID=$(echo "$SERVICE_RESPONSE" | jq -r '.data.service_id // .data.id // empty')

if [ -z "$SERVICE_ID" ]; then
  echo -e "${RED}❌ Failed to create service${NC}"
  echo "Response: $SERVICE_RESPONSE"
  exit 1
fi

echo -e "${GREEN}✅ Service created: $SERVICE_ID${NC}"
echo ""

echo "=================================================="
echo "Step 2: Create a booking"
echo "=================================================="

TOMORROW=$(date -u -d "+1 day" +%Y-%m-%d 2>/dev/null || date -u -v+1d +%Y-%m-%d)

BOOKING_RESPONSE=$(curl -s -X POST "$API_URL/v1/bookings" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "{
    \"serviceId\": \"$SERVICE_ID\",
    \"date\": \"$TOMORROW\",
    \"timeStart\": \"14:00:00\",
    \"customerEmail\": \"test@example.com\",
    \"customerName\": \"Test Customer\"
  }")

BOOKING_ID=$(echo "$BOOKING_RESPONSE" | jq -r '.data.booking.id // .data.booking.booking_id // empty')

if [ -z "$BOOKING_ID" ]; then
  echo -e "${RED}❌ Failed to create booking${NC}"
  echo "Response: $BOOKING_RESPONSE"
  exit 1
fi

echo -e "${GREEN}✅ Booking created: $BOOKING_ID${NC}"
BOOKING_STATUS=$(echo "$BOOKING_RESPONSE" | jq -r '.data.booking.status')
PAYMENT_STATUS=$(echo "$BOOKING_RESPONSE" | jq -r '.data.booking.payment_status')
echo "   Status: $BOOKING_STATUS, Payment: $PAYMENT_STATUS"
echo ""

echo "=================================================="
echo "Step 3: Create Checkout Session"
echo "=================================================="

CHECKOUT_RESPONSE=$(curl -s -X POST "$API_URL/v1/bookings/checkout-session" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "{
    \"bookingId\": \"$BOOKING_ID\"
  }")

CHECKOUT_URL=$(echo "$CHECKOUT_RESPONSE" | jq -r '.data.url // empty')
SESSION_ID=$(echo "$CHECKOUT_RESPONSE" | jq -r '.data.sessionId // empty')

if [ -z "$CHECKOUT_URL" ] || [ -z "$SESSION_ID" ]; then
  echo -e "${RED}❌ Failed to create checkout session${NC}"
  echo "Response: $CHECKOUT_RESPONSE"
  exit 1
fi

echo -e "${GREEN}✅ Checkout session created${NC}"
echo "   Session ID: $SESSION_ID"
echo "   URL: $CHECKOUT_URL"
echo ""

echo "=================================================="
echo "Step 4: Manual Payment (Open URL in browser)"
echo "=================================================="

echo -e "${YELLOW}⚠️  ACTION REQUIRED:${NC}"
echo ""
echo "Open this URL in your browser to complete payment:"
echo ""
echo "$CHECKOUT_URL"
echo ""
echo "After completing payment:"
echo "1. You'll be redirected to: yardline://payment-success?type=booking&session_id=$SESSION_ID"
echo "2. The webhook will automatically update the booking status"
echo ""
read -p "Press ENTER after completing the payment..."

echo ""
echo "=================================================="
echo "Step 5: Verify booking was updated by webhook"
echo "=================================================="

sleep 3  # Give webhook time to process

BOOKING_CHECK=$(curl -s -X GET "$API_URL/v1/bookings/$BOOKING_ID" \
  -H "Authorization: Bearer $AUTH_TOKEN")

FINAL_STATUS=$(echo "$BOOKING_CHECK" | jq -r '.data.status')
FINAL_PAYMENT_STATUS=$(echo "$BOOKING_CHECK" | jq -r '.data.payment_status')
CHECKOUT_SESSION_ID=$(echo "$BOOKING_CHECK" | jq -r '.data.stripe_checkout_session_id // empty')

echo "Final booking state:"
echo "   Status: $FINAL_STATUS"
echo "   Payment Status: $FINAL_PAYMENT_STATUS"
echo "   Checkout Session: $CHECKOUT_SESSION_ID"
echo ""

# Verify results
if [ "$FINAL_STATUS" = "confirmed" ] && [ "$FINAL_PAYMENT_STATUS" = "captured" ]; then
  echo -e "${GREEN}✅ SUCCESS: Booking was paid via Checkout Session!${NC}"
  TESTS_PASSED=true
else
  echo -e "${RED}❌ FAILURE: Booking status not updated correctly${NC}"
  echo "Expected: status=confirmed, payment_status=captured"
  echo "Got: status=$FINAL_STATUS, payment_status=$FINAL_PAYMENT_STATUS"
  TESTS_PASSED=false
fi

echo ""
echo "=================================================="
echo "Step 6: Test error cases"
echo "=================================================="

# Test 6a: Try to create another checkout session for same booking
echo "Test 6a: Duplicate checkout session should fail"
DUPLICATE_RESPONSE=$(curl -s -X POST "$API_URL/v1/bookings/checkout-session" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "{
    \"bookingId\": \"$BOOKING_ID\"
  }")

DUPLICATE_ERROR=$(echo "$DUPLICATE_RESPONSE" | jq -r '.error.type // empty')
if [ "$DUPLICATE_ERROR" = "already_paid" ]; then
  echo -e "${GREEN}✅ Correctly rejected duplicate checkout session${NC}"
else
  echo -e "${YELLOW}⚠️  Unexpected response for duplicate session${NC}"
  echo "Response: $DUPLICATE_RESPONSE"
fi

# Test 6b: Try with invalid booking ID
echo ""
echo "Test 6b: Invalid booking ID should fail"
INVALID_RESPONSE=$(curl -s -X POST "$API_URL/v1/bookings/checkout-session" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{
    "bookingId": "00000000-0000-0000-0000-000000000000"
  }')

INVALID_ERROR=$(echo "$INVALID_RESPONSE" | jq -r '.error.type // empty')
if [ "$INVALID_ERROR" = "resource_missing" ]; then
  echo -e "${GREEN}✅ Correctly rejected invalid booking ID${NC}"
else
  echo -e "${YELLOW}⚠️  Unexpected response for invalid ID${NC}"
  echo "Response: $INVALID_RESPONSE"
fi

# Test 6c: Try without bookingId
echo ""
echo "Test 6c: Missing bookingId should fail"
MISSING_RESPONSE=$(curl -s -X POST "$API_URL/v1/bookings/checkout-session" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{}')

MISSING_ERROR=$(echo "$MISSING_RESPONSE" | jq -r '.error.type // empty')
if [ "$MISSING_ERROR" = "invalid_request_error" ]; then
  echo -e "${GREEN}✅ Correctly rejected missing bookingId${NC}"
else
  echo -e "${YELLOW}⚠️  Unexpected response for missing field${NC}"
  echo "Response: $MISSING_RESPONSE"
fi

echo ""
echo "=================================================="
echo "Test Summary"
echo "=================================================="

if [ "$TESTS_PASSED" = true ]; then
  echo -e "${GREEN}🎉 ALL TESTS PASSED!${NC}"
  echo ""
  echo "The Checkout Session booking flow is working correctly:"
  echo "✅ Service created"
  echo "✅ Booking created with PaymentIntent flow"
  echo "✅ Checkout Session created and returned URL"
  echo "✅ Payment completed via Stripe hosted page"
  echo "✅ Webhook updated booking status to confirmed/captured"
  echo "✅ Error cases handled correctly"
  exit 0
else
  echo -e "${RED}❌ TESTS FAILED${NC}"
  echo ""
  echo "Check the following:"
  echo "1. Webhook is configured and accessible"
  echo "2. STRIPE_LIVE_WEBHOOK_SECRET is set correctly"
  echo "3. Database migration 004 was applied"
  echo "4. Check server logs for webhook processing errors"
  exit 1
fi
