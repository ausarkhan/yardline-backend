#!/bin/bash
# Test Stripe PaymentSheet Flow for Booking System

# Color codes for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

API_URL="${API_URL:-http://localhost:3000}"
CUSTOMER_TOKEN="${CUSTOMER_TOKEN:-your-test-customer-jwt}"

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}PaymentSheet Booking Flow Test${NC}"
echo -e "${BLUE}================================${NC}"
echo ""

# Step 1: Request booking (get PaymentIntent client_secret)
echo -e "${YELLOW}Step 1: POST /v1/bookings/request${NC}"
echo "Creating PaymentIntent for deposit..."
echo ""

BOOKING_REQUEST=$(cat <<EOF
{
  "service_id": "test-service-id",
  "provider_id": "test-provider-id",
  "date": "2026-01-15",
  "time_start": "14:00",
  "time_end": "15:00"
}
EOF
)

echo "Request Body:"
echo "$BOOKING_REQUEST" | jq '.'
echo ""

RESPONSE=$(curl -s -X POST "$API_URL/v1/bookings/request" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -d "$BOOKING_REQUEST")

echo "Response:"
echo "$RESPONSE" | jq '.'
echo ""

# Extract values for next step
CLIENT_SECRET=$(echo "$RESPONSE" | jq -r '.paymentIntentClientSecret // empty')
PAYMENT_INTENT_ID=$(echo "$RESPONSE" | jq -r '.paymentIntentId // empty')
SERVICE_ID=$(echo "$RESPONSE" | jq -r '.bookingDraft.service_id // empty')
PROVIDER_ID=$(echo "$RESPONSE" | jq -r '.bookingDraft.provider_id // empty')
DATE=$(echo "$RESPONSE" | jq -r '.bookingDraft.date // empty')
TIME_START=$(echo "$RESPONSE" | jq -r '.bookingDraft.time_start // empty')
TIME_END=$(echo "$RESPONSE" | jq -r '.bookingDraft.time_end // empty')
SERVICE_PRICE=$(echo "$RESPONSE" | jq -r '.bookingDraft.service_price_cents // empty')
PLATFORM_FEE=$(echo "$RESPONSE" | jq -r '.bookingDraft.platform_fee_cents // empty')

if [ -z "$CLIENT_SECRET" ]; then
  echo -e "${RED}❌ Failed to get client_secret${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Got client_secret: ${CLIENT_SECRET:0:20}...${NC}"
echo -e "${GREEN}✓ Got payment_intent_id: $PAYMENT_INTENT_ID${NC}"
echo ""

# Step 2: Simulate PaymentSheet
echo -e "${YELLOW}Step 2: [Mobile App] Present PaymentSheet${NC}"
echo "The mobile app would now:"
echo "  1. Initialize Stripe PaymentSheet with client_secret"
echo "  2. Show card/Apple Pay UI to user"
echo "  3. User confirms payment"
echo "  4. PaymentSheet returns success"
echo ""
echo -e "${BLUE}In this test, assume payment confirmed successfully...${NC}"
echo ""

# Step 3: Confirm booking
echo -e "${YELLOW}Step 3: POST /v1/bookings/confirm-deposit${NC}"
echo "Confirming booking after PaymentSheet success..."
echo ""

CONFIRM_REQUEST=$(cat <<EOF
{
  "payment_intent_id": "$PAYMENT_INTENT_ID",
  "service_id": "$SERVICE_ID",
  "provider_id": "$PROVIDER_ID",
  "date": "$DATE",
  "time_start": "$TIME_START",
  "time_end": "$TIME_END",
  "service_price_cents": $SERVICE_PRICE,
  "platform_fee_cents": $PLATFORM_FEE
}
EOF
)

echo "Request Body:"
echo "$CONFIRM_REQUEST" | jq '.'
echo ""

CONFIRM_RESPONSE=$(curl -s -X POST "$API_URL/v1/bookings/confirm-deposit" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -d "$CONFIRM_REQUEST")

echo "Response:"
echo "$CONFIRM_RESPONSE" | jq '.'
echo ""

BOOKING_ID=$(echo "$CONFIRM_RESPONSE" | jq -r '.booking.id // empty')

if [ -n "$BOOKING_ID" ]; then
  echo -e "${GREEN}✓ Booking created successfully!${NC}"
  echo -e "${GREEN}  Booking ID: $BOOKING_ID${NC}"
  echo -e "${GREEN}  Status: $(echo "$CONFIRM_RESPONSE" | jq -r '.booking.status')${NC}"
  echo -e "${GREEN}  Deposit Status: $(echo "$CONFIRM_RESPONSE" | jq -r '.booking.deposit_status')${NC}"
else
  echo -e "${RED}❌ Failed to create booking${NC}"
  exit 1
fi

echo ""
echo -e "${BLUE}================================${NC}"
echo -e "${GREEN}✓ PaymentSheet Flow Complete!${NC}"
echo -e "${BLUE}================================${NC}"
echo ""
echo "Summary:"
echo "  • PaymentIntent created with client_secret"
echo "  • Mobile app collects payment via PaymentSheet"
echo "  • Booking confirmed after payment success"
echo "  • Deposit status: paid"
echo ""
