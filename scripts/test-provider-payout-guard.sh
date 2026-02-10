#!/usr/bin/env bash
set -euo pipefail

API_URL=${API_URL:-http://localhost:3000}
AUTH_TOKEN=${AUTH_TOKEN:?Set AUTH_TOKEN to a valid customer bearer token}
BOOKING_ID_ENABLED=${BOOKING_ID_ENABLED:?Set BOOKING_ID_ENABLED to a booking with an enabled provider}
BOOKING_ID_DISABLED=${BOOKING_ID_DISABLED:?Set BOOKING_ID_DISABLED to a booking with an incomplete provider}

printf "\n== Enabled provider checkout (should succeed) ==\n"
curl -s -X POST "$API_URL/v1/bookings/checkout-session" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"bookingId\":\"$BOOKING_ID_ENABLED\"}" | cat

printf "\n\n== Disabled provider checkout (should return 400 + PROVIDER_PAYOUT_SETUP_REQUIRED) ==\n"
curl -s -X POST "$API_URL/v1/bookings/checkout-session" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"bookingId\":\"$BOOKING_ID_DISABLED\"}" | cat

printf "\n"
