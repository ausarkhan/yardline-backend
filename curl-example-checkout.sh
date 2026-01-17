#!/bin/bash

# Quick test: Create a Checkout Session for an existing booking
# Usage: ./curl-example-checkout.sh <booking_id>

BOOKING_ID="${1}"
API_URL="${API_URL:-http://localhost:3000}"

if [ -z "$BOOKING_ID" ]; then
  echo "Usage: $0 <booking_id>"
  echo ""
  echo "Example:"
  echo "  export AUTH_TOKEN='your-jwt-token'"
  echo "  $0 'a1b2c3d4-5678-90ab-cdef-1234567890ab'"
  exit 1
fi

if [ -z "$AUTH_TOKEN" ]; then
  echo "Error: AUTH_TOKEN environment variable is required"
  echo "Set it with: export AUTH_TOKEN='your-jwt-token'"
  exit 1
fi

echo "Creating Checkout Session for booking: $BOOKING_ID"
echo ""

curl -X POST "$API_URL/v1/bookings/checkout-session" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "{
    \"bookingId\": \"$BOOKING_ID\"
  }" \
  | jq '.'

echo ""
echo "If successful, open the 'url' field in a browser to complete payment"
