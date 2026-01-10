#!/bin/bash

# YardLine Booking System Test Script
# This script tests the complete booking flow with authorization and capture

set -e

API_URL="${API_URL:-http://localhost:3000}"
PROVIDER_ID="test-provider-1"
CUSTOMER_ID="test-customer-1"

echo "🧪 YardLine Booking System Tests"
echo "================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test 1: Create a service
echo -e "${BLUE}Test 1: Create Service${NC}"
SERVICE_RESPONSE=$(curl -s -X POST "$API_URL/v1/services" \
  -H "Content-Type: application/json" \
  -d "{
    \"providerId\": \"$PROVIDER_ID\",
    \"name\": \"Test Lawn Mowing\",
    \"description\": \"Professional lawn mowing service\",
    \"priceCents\": 5000,
    \"duration\": 60
  }")

SERVICE_ID=$(echo "$SERVICE_RESPONSE" | grep -o '"serviceId":"[^"]*' | cut -d'"' -f4)

if [ -z "$SERVICE_ID" ]; then
  echo -e "${RED}❌ Failed to create service${NC}"
  echo "$SERVICE_RESPONSE"
  exit 1
fi

echo -e "${GREEN}✅ Service created: $SERVICE_ID${NC}"
echo ""

# Test 2: Customer requests booking (authorize payment)
echo -e "${BLUE}Test 2: Request Booking (Authorize Payment)${NC}"
BOOKING_RESPONSE=$(curl -s -X POST "$API_URL/v1/bookings" \
  -H "Content-Type: application/json" \
  -d "{
    \"customerId\": \"$CUSTOMER_ID\",
    \"serviceId\": \"$SERVICE_ID\",
    \"requestedDate\": \"2026-01-15\",
    \"requestedTime\": \"14:00\",
    \"customerEmail\": \"test@example.com\",
    \"customerName\": \"Test User\"
  }")

BOOKING_ID=$(echo "$BOOKING_RESPONSE" | grep -o '"bookingId":"[^"]*' | cut -d'"' -f4)
BOOKING_STATUS=$(echo "$BOOKING_RESPONSE" | grep -o '"status":"[^"]*' | cut -d'"' -f4 | head -1)
PAYMENT_STATUS=$(echo "$BOOKING_RESPONSE" | grep -o '"payment_status":"[^"]*' | cut -d'"' -f4)

if [ -z "$BOOKING_ID" ]; then
  echo -e "${RED}❌ Failed to create booking${NC}"
  echo "$BOOKING_RESPONSE"
  exit 1
fi

if [ "$BOOKING_STATUS" != "pending" ]; then
  echo -e "${RED}❌ Expected status 'pending', got '$BOOKING_STATUS'${NC}"
  exit 1
fi

if [ "$PAYMENT_STATUS" != "authorized" ] && [ "$PAYMENT_STATUS" != "none" ]; then
  echo -e "${RED}⚠️  Expected payment_status 'authorized' or 'none', got '$PAYMENT_STATUS'${NC}"
  echo "    (This may be OK if payment requires action)"
fi

echo -e "${GREEN}✅ Booking created: $BOOKING_ID${NC}"
echo -e "   Status: $BOOKING_STATUS"
echo -e "   Payment Status: $PAYMENT_STATUS"
echo ""

# Test 3: Get booking details
echo -e "${BLUE}Test 3: Get Booking Details${NC}"
GET_RESPONSE=$(curl -s "$API_URL/v1/bookings/$BOOKING_ID")

GET_STATUS=$(echo "$GET_RESPONSE" | grep -o '"status":"[^"]*' | cut -d'"' -f4 | head -1)

if [ "$GET_STATUS" != "pending" ]; then
  echo -e "${RED}❌ Expected status 'pending', got '$GET_STATUS'${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Booking retrieved successfully${NC}"
echo ""

# Test 4: List provider bookings
echo -e "${BLUE}Test 4: List Provider Bookings${NC}"
LIST_RESPONSE=$(curl -s "$API_URL/v1/bookings?providerId=$PROVIDER_ID&status=pending")

BOOKING_COUNT=$(echo "$LIST_RESPONSE" | grep -o '"bookingId"' | wc -l)

if [ "$BOOKING_COUNT" -lt 1 ]; then
  echo -e "${RED}❌ Expected at least 1 booking, found $BOOKING_COUNT${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Found $BOOKING_COUNT pending booking(s)${NC}"
echo ""

# Test 5: Provider accepts booking (capture payment)
echo -e "${BLUE}Test 5: Provider Accepts Booking (Capture Payment)${NC}"
ACCEPT_RESPONSE=$(curl -s -X POST "$API_URL/v1/bookings/$BOOKING_ID/accept" \
  -H "Content-Type: application/json" \
  -d "{
    \"providerId\": \"$PROVIDER_ID\"
  }")

ACCEPT_STATUS=$(echo "$ACCEPT_RESPONSE" | grep -o '"status":"[^"]*' | cut -d'"' -f4 | head -1)
ACCEPT_PAYMENT=$(echo "$ACCEPT_RESPONSE" | grep -o '"payment_status":"[^"]*' | cut -d'"' -f4)

if [ "$ACCEPT_STATUS" != "confirmed" ]; then
  echo -e "${RED}❌ Expected status 'confirmed', got '$ACCEPT_STATUS'${NC}"
  echo "$ACCEPT_RESPONSE"
  exit 1
fi

if [ "$ACCEPT_PAYMENT" != "captured" ]; then
  echo -e "${RED}❌ Expected payment_status 'captured', got '$ACCEPT_PAYMENT'${NC}"
  echo "$ACCEPT_RESPONSE"
  exit 1
fi

echo -e "${GREEN}✅ Booking accepted and payment captured${NC}"
echo -e "   Status: $ACCEPT_STATUS"
echo -e "   Payment Status: $ACCEPT_PAYMENT"
echo ""

# Test 6: Try to accept again (should fail - idempotency)
echo -e "${BLUE}Test 6: Test Idempotency (Accept Again)${NC}"
IDEMPOTENCY_RESPONSE=$(curl -s -X POST "$API_URL/v1/bookings/$BOOKING_ID/accept" \
  -H "Content-Type: application/json" \
  -d "{
    \"providerId\": \"$PROVIDER_ID\"
  }")

if echo "$IDEMPOTENCY_RESPONSE" | grep -q '"success":false'; then
  echo -e "${GREEN}✅ Idempotency enforced (cannot accept twice)${NC}"
else
  echo -e "${RED}❌ Idempotency check failed (should not allow second accept)${NC}"
  exit 1
fi
echo ""

# Test 7: Create and decline booking
echo -e "${BLUE}Test 7: Create and Decline Booking${NC}"
BOOKING2_RESPONSE=$(curl -s -X POST "$API_URL/v1/bookings" \
  -H "Content-Type: application/json" \
  -d "{
    \"customerId\": \"$CUSTOMER_ID\",
    \"serviceId\": \"$SERVICE_ID\",
    \"requestedDate\": \"2026-01-16\",
    \"requestedTime\": \"15:00\",
    \"customerEmail\": \"test@example.com\",
    \"customerName\": \"Test User\"
  }")

BOOKING2_ID=$(echo "$BOOKING2_RESPONSE" | grep -o '"bookingId":"[^"]*' | cut -d'"' -f4)

if [ -z "$BOOKING2_ID" ]; then
  echo -e "${RED}❌ Failed to create second booking${NC}"
  exit 1
fi

DECLINE_RESPONSE=$(curl -s -X POST "$API_URL/v1/bookings/$BOOKING2_ID/decline" \
  -H "Content-Type: application/json" \
  -d "{
    \"providerId\": \"$PROVIDER_ID\",
    \"reason\": \"Not available\"
  }")

DECLINE_STATUS=$(echo "$DECLINE_RESPONSE" | grep -o '"status":"[^"]*' | cut -d'"' -f4 | head -1)
DECLINE_PAYMENT=$(echo "$DECLINE_RESPONSE" | grep -o '"payment_status":"[^"]*' | cut -d'"' -f4)

if [ "$DECLINE_STATUS" != "declined" ]; then
  echo -e "${RED}❌ Expected status 'declined', got '$DECLINE_STATUS'${NC}"
  exit 1
fi

if [ "$DECLINE_PAYMENT" != "canceled" ]; then
  echo -e "${RED}❌ Expected payment_status 'canceled', got '$DECLINE_PAYMENT'${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Booking declined and payment canceled${NC}"
echo ""

# Test 8: Create and customer cancels
echo -e "${BLUE}Test 8: Customer Cancels Booking${NC}"
BOOKING3_RESPONSE=$(curl -s -X POST "$API_URL/v1/bookings" \
  -H "Content-Type: application/json" \
  -d "{
    \"customerId\": \"$CUSTOMER_ID\",
    \"serviceId\": \"$SERVICE_ID\",
    \"requestedDate\": \"2026-01-17\",
    \"requestedTime\": \"16:00\",
    \"customerEmail\": \"test@example.com\",
    \"customerName\": \"Test User\"
  }")

BOOKING3_ID=$(echo "$BOOKING3_RESPONSE" | grep -o '"bookingId":"[^"]*' | cut -d'"' -f4)

if [ -z "$BOOKING3_ID" ]; then
  echo -e "${RED}❌ Failed to create third booking${NC}"
  exit 1
fi

CANCEL_RESPONSE=$(curl -s -X POST "$API_URL/v1/bookings/$BOOKING3_ID/cancel" \
  -H "Content-Type: application/json" \
  -d "{
    \"customerId\": \"$CUSTOMER_ID\",
    \"reason\": \"Changed my mind\"
  }")

CANCEL_STATUS=$(echo "$CANCEL_RESPONSE" | grep -o '"status":"[^"]*' | cut -d'"' -f4 | head -1)
CANCEL_PAYMENT=$(echo "$CANCEL_RESPONSE" | grep -o '"payment_status":"[^"]*' | cut -d'"' -f4)

if [ "$CANCEL_STATUS" != "cancelled" ]; then
  echo -e "${RED}❌ Expected status 'cancelled', got '$CANCEL_STATUS'${NC}"
  exit 1
fi

if [ "$CANCEL_PAYMENT" != "canceled" ]; then
  echo -e "${RED}❌ Expected payment_status 'canceled', got '$CANCEL_PAYMENT'${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Booking cancelled by customer${NC}"
echo ""

# Summary
echo "================================"
echo -e "${GREEN}✅ All tests passed!${NC}"
echo ""
echo "Summary:"
echo "  - Service created: $SERVICE_ID"
echo "  - Booking accepted: $BOOKING_ID (status: confirmed, payment: captured)"
echo "  - Booking declined: $BOOKING2_ID (status: declined, payment: canceled)"
echo "  - Booking cancelled: $BOOKING3_ID (status: cancelled, payment: canceled)"
echo ""
echo "Next steps:"
echo "  1. Test with real Stripe test mode"
echo "  2. Configure Stripe webhooks"
echo "  3. Test webhook delivery"
echo "  4. Test double booking prevention"
echo "  5. Test authorization expiry handling"
