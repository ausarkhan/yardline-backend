# YardLine Booking System Implementation

## Overview

Complete implementation of "Request Booking → Provider Accept/Decline → Charge on Accept" flow with backend-enforced payment authorization and capture.

## Core Flow

```
Customer → Request Booking (authorize payment)
         ↓
    Status: PENDING
    Payment: AUTHORIZED
         ↓
    Provider Reviews
         ↓
    ┌─────────┴─────────┐
Accept              Decline
    ↓                   ↓
Capture Payment    Cancel Authorization
Status: CONFIRMED  Status: DECLINED
Payment: CAPTURED  Payment: CANCELED
```

## Database Schema

### Booking Object
```typescript
{
  bookingId: string;           // UUID
  customerId: string;          // User who requested booking
  providerId: string;          // Service provider
  serviceId: string;           // Service being booked
  serviceName: string;         // Service name (for display)
  requestedDate: string;       // ISO 8601 date (e.g., "2026-01-15")
  requestedTime: string;       // Time slot (e.g., "14:00")
  
  // Status fields
  status: 'pending' | 'confirmed' | 'declined' | 'cancelled' | 'expired';
  payment_status: 'none' | 'authorized' | 'captured' | 'canceled' | 'failed';
  
  // Payment tracking
  payment_intent_id: string | null;
  amount_total: number;        // Total amount in cents (audit trail)
  service_price_cents: number; // Service price
  platform_fee_cents: number;  // YardLine fee (Model A pricing)
  
  // Optional fields
  decline_reason?: string;
  
  // Timestamps
  created_at: string;          // ISO 8601
  updated_at: string;          // ISO 8601
}
```

### Service Object
```typescript
{
  serviceId: string;           // UUID
  providerId: string;          // Provider who owns service
  name: string;                // Service name
  description: string;         // Service description
  priceCents: number;          // Service price in cents
  duration: number;            // Duration in minutes
  active: boolean;             // Is service available
}
```

## API Endpoints

### 1. Create Service (Provider)
**POST** `/v1/services`

Create a new service offering.

**Request Body:**
```json
{
  "providerId": "provider-uuid",
  "name": "Lawn Mowing",
  "description": "Professional lawn mowing service",
  "priceCents": 5000,
  "duration": 60
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "serviceId": "service-uuid",
    "providerId": "provider-uuid",
    "name": "Lawn Mowing",
    "description": "Professional lawn mowing service",
    "priceCents": 5000,
    "duration": 60,
    "active": true
  }
}
```

---

### 2. Request Booking (Customer)
**POST** `/v1/bookings`

Customer requests a booking and authorizes payment (does NOT capture).

**Key Features:**
- ✅ Server-side price calculation (Model A)
- ✅ Creates PaymentIntent with `capture_method: "manual"`
- ✅ Authorizes payment (does NOT charge customer yet)
- ✅ Validates service exists and is active
- ✅ Validates requested time is in future
- ✅ Stores `payment_intent_id` for later capture

**Request Body:**
```json
{
  "customerId": "customer-uuid",
  "serviceId": "service-uuid",
  "requestedDate": "2026-01-15",
  "requestedTime": "14:00",
  "customerEmail": "customer@example.com",
  "customerName": "John Doe"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "booking": {
      "bookingId": "booking-uuid",
      "customerId": "customer-uuid",
      "providerId": "provider-uuid",
      "serviceId": "service-uuid",
      "serviceName": "Lawn Mowing",
      "requestedDate": "2026-01-15",
      "requestedTime": "14:00",
      "status": "pending",
      "payment_status": "authorized",
      "payment_intent_id": "pi_xxx",
      "amount_total": 6500,
      "service_price_cents": 5000,
      "platform_fee_cents": 1500,
      "created_at": "2026-01-10T12:00:00.000Z",
      "updated_at": "2026-01-10T12:00:00.000Z"
    },
    "paymentIntentClientSecret": "pi_xxx_secret_yyy",
    "requiresAction": false,
    "mode": "test"
  }
}
```

**Server-Side Logic:**
1. Validates service exists and is active
2. Validates requested time is in future
3. Calculates pricing using Model A formula:
   - Service price: $50.00
   - Platform fee: $15.00 (covers YardLine $0.99 + Stripe fees)
   - Total: $65.00
4. Creates Stripe PaymentIntent with `capture_method: "manual"`
5. Confirms PaymentIntent to authorize (hold funds)
6. Saves booking with status=pending, payment_status=authorized

---

### 3. Accept Booking (Provider)
**POST** `/v1/bookings/:id/accept`

Provider accepts booking and captures payment.

**Key Features:**
- ✅ Enforces idempotency (only pending bookings)
- ✅ Prevents double booking with conflict check
- ✅ Captures PaymentIntent with Stripe idempotency key
- ✅ Updates booking: status=confirmed, payment_status=captured
- ✅ Handles authorization expiry gracefully

**Request Body:**
```json
{
  "providerId": "provider-uuid"
}
```

**Response (Success):**
```json
{
  "success": true,
  "data": {
    "booking": {
      "bookingId": "booking-uuid",
      "status": "confirmed",
      "payment_status": "captured",
      "updated_at": "2026-01-10T12:05:00.000Z",
      ...
    },
    "paymentIntentStatus": "succeeded"
  }
}
```

**Response (Authorization Expired):**
```json
{
  "success": false,
  "error": {
    "type": "payment_expired",
    "message": "Payment authorization has expired. Customer must re-confirm payment.",
    "code": "charge_expired_for_capture"
  }
}
```

**Server-Side Logic:**
1. Verifies provider owns booking
2. Checks status is "pending" (idempotency)
3. Checks for time conflicts with confirmed bookings
4. Captures PaymentIntent (with idempotency key)
5. Updates booking: status=confirmed, payment_status=captured
6. Handles expiry: marks booking as expired if authorization expired

---

### 4. Decline Booking (Provider)
**POST** `/v1/bookings/:id/decline`

Provider declines booking and cancels payment authorization.

**Key Features:**
- ✅ Enforces idempotency (only pending bookings)
- ✅ Cancels Stripe PaymentIntent
- ✅ Updates booking: status=declined, payment_status=canceled
- ✅ Optional decline reason

**Request Body:**
```json
{
  "providerId": "provider-uuid",
  "reason": "Not available at this time"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "booking": {
      "bookingId": "booking-uuid",
      "status": "declined",
      "payment_status": "canceled",
      "decline_reason": "Not available at this time",
      "updated_at": "2026-01-10T12:10:00.000Z",
      ...
    }
  }
}
```

**Server-Side Logic:**
1. Verifies provider owns booking
2. Checks status is "pending"
3. Cancels PaymentIntent (releases hold on funds)
4. Updates booking: status=declined, payment_status=canceled
5. Stores optional decline reason

---

### 5. Cancel Booking (Customer)
**POST** `/v1/bookings/:id/cancel`

Customer cancels their booking request.

**Key Features:**
- ✅ Only allows cancellation if status=pending
- ✅ Cancels payment authorization
- ✅ V1: Disallows cancellation after confirmation (refund policy TBD)

**Request Body:**
```json
{
  "customerId": "customer-uuid",
  "reason": "Changed my mind"
}
```

**Response (Pending Booking):**
```json
{
  "success": true,
  "data": {
    "booking": {
      "bookingId": "booking-uuid",
      "status": "cancelled",
      "payment_status": "canceled",
      "decline_reason": "Changed my mind",
      "updated_at": "2026-01-10T12:15:00.000Z",
      ...
    }
  }
}
```

**Response (Confirmed Booking):**
```json
{
  "success": false,
  "error": {
    "type": "invalid_state",
    "message": "Cannot cancel confirmed booking. Please contact the provider.",
    "currentStatus": "confirmed"
  }
}
```

**Server-Side Logic:**
1. Verifies customer owns booking
2. If status=pending:
   - Cancels PaymentIntent
   - Updates: status=cancelled, payment_status=canceled
3. If status=confirmed:
   - Returns error (V1: no cancellation after confirmation)
   - V2: Could implement refund policy

---

### 6. Get Booking Details
**GET** `/v1/bookings/:id`

Retrieve booking details.

**Response:**
```json
{
  "success": true,
  "data": {
    "bookingId": "booking-uuid",
    "customerId": "customer-uuid",
    "providerId": "provider-uuid",
    ...
  }
}
```

---

### 7. List Bookings
**GET** `/v1/bookings?customerId=xxx` or `/v1/bookings?providerId=xxx&status=pending`

List bookings for customer or provider, optionally filtered by status.

**Query Parameters:**
- `customerId`: Filter by customer
- `providerId`: Filter by provider
- `status`: Filter by status (pending, confirmed, declined, cancelled, expired)

**Response:**
```json
{
  "success": true,
  "data": [
    { "bookingId": "...", ... },
    { "bookingId": "...", ... }
  ]
}
```

---

## Stripe Webhooks (Source of Truth)

The webhook endpoint `/v1/stripe/webhooks` handles payment state changes as the source of truth.

### Webhook Events Handled:

#### `payment_intent.succeeded`
- Updates `payment_status = "captured"`
- For bookings: confirms payment was captured successfully

#### `payment_intent.canceled`
- Updates `payment_status = "canceled"`
- For bookings: confirms authorization was released

#### `payment_intent.payment_failed`
- Updates `payment_status = "failed"`
- Updates `status = "cancelled"` if pending

#### `payment_intent.requires_action`
- Tracks payments requiring customer action (e.g., 3D Secure)

### Idempotency
Webhooks use event-specific keys to prevent duplicate processing:
```typescript
const eventKey = `booking_payment_${paymentIntent.id}_${paymentIntent.status}`;
```

---

## Double Booking Prevention

The `hasConflictingBooking()` function checks for time overlaps:

1. Gets all confirmed bookings for provider
2. Calculates time ranges (start + duration)
3. Checks for overlap: `requestedStart < existingEnd && requestedEnd > existingStart`
4. Prevents accept if conflict exists

**Example:**
```typescript
// Existing booking: 14:00-15:00 (60 min)
// New request: 14:30-15:30 (60 min)
// Result: CONFLICT - provider cannot accept
```

---

## Model A Pricing

Pricing uses the existing Model A formula where buyer pays all fees:

```typescript
// Provider sets service price: $50.00
const servicePriceCents = 5000;

// Calculate platform fee (covers YardLine $0.99 + Stripe fees)
const platformFeeCents = calculateBookingPlatformFee(servicePriceCents);
// Result: ~$1500 ($15.00)

// Total charged to customer
const totalChargeCents = servicePriceCents + platformFeeCents;
// Result: $6500 ($65.00)
```

**In Stripe:**
- Total charge: $65.00
- Provider receives: $50.00 (via Stripe Connect transfer)
- YardLine receives: ~$0.99 (after Stripe takes their cut)
- Stripe fees: ~$2.19 (2.9% + $0.30)

---

## Authorization Expiry Handling

Stripe payment authorizations expire after a certain time (typically 7 days).

**If capture fails due to expiry:**
1. API returns error with code `charge_expired_for_capture`
2. Booking status → `expired`
3. Payment status → `failed`
4. Customer must create a new booking request with fresh authorization

**Response Example:**
```json
{
  "success": false,
  "error": {
    "type": "payment_expired",
    "message": "Payment authorization has expired. Customer must re-confirm payment.",
    "code": "charge_expired_for_capture"
  }
}
```

---

## Testing Guide

### Prerequisites
1. Set up Stripe in test mode
2. Configure webhook endpoint
3. Have test provider and customer IDs

### Test Scenarios

#### Scenario 1: Happy Path (Accept)
```bash
# 1. Create a service
curl -X POST http://localhost:3000/v1/services \
  -H "Content-Type: application/json" \
  -d '{
    "providerId": "provider-1",
    "name": "Lawn Mowing",
    "priceCents": 5000,
    "duration": 60
  }'

# 2. Customer requests booking (authorizes payment)
curl -X POST http://localhost:3000/v1/bookings \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "customer-1",
    "serviceId": "SERVICE_ID_FROM_STEP_1",
    "requestedDate": "2026-01-15",
    "requestedTime": "14:00",
    "customerEmail": "test@example.com",
    "customerName": "Test User"
  }'
# Expected: status=pending, payment_status=authorized

# 3. Provider accepts (captures payment)
curl -X POST http://localhost:3000/v1/bookings/BOOKING_ID/accept \
  -H "Content-Type: application/json" \
  -d '{
    "providerId": "provider-1"
  }'
# Expected: status=confirmed, payment_status=captured
```

#### Scenario 2: Provider Declines
```bash
# After step 2 from above...

# Provider declines
curl -X POST http://localhost:3000/v1/bookings/BOOKING_ID/decline \
  -H "Content-Type: application/json" \
  -d '{
    "providerId": "provider-1",
    "reason": "Not available"
  }'
# Expected: status=declined, payment_status=canceled
```

#### Scenario 3: Customer Cancels
```bash
# After step 2 from above...

# Customer cancels
curl -X POST http://localhost:3000/v1/bookings/BOOKING_ID/cancel \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "customer-1",
    "reason": "Changed my mind"
  }'
# Expected: status=cancelled, payment_status=canceled
```

#### Scenario 4: Double Booking Prevention
```bash
# 1. Create and accept first booking for 14:00-15:00

# 2. Try to create second booking for 14:30-15:30
# (should succeed - status=pending)

# 3. Try to accept second booking
# Expected: 409 Conflict error
```

#### Scenario 5: Idempotency Check
```bash
# Accept the same booking twice
curl -X POST http://localhost:3000/v1/bookings/BOOKING_ID/accept \
  -H "Content-Type: application/json" \
  -d '{"providerId": "provider-1"}'

# Second call:
curl -X POST http://localhost:3000/v1/bookings/BOOKING_ID/accept \
  -H "Content-Type: application/json" \
  -d '{"providerId": "provider-1"}'
# Expected: Second call returns error (not pending)
```

### Stripe Test Cards

Use Stripe test cards to simulate different scenarios:

- **Success:** `4242 4242 4242 4242`
- **Requires authentication:** `4000 0025 0000 3155`
- **Declined:** `4000 0000 0000 9995`

For test cards requiring authentication, handle the `requiresAction` flag in the response.

---

## Frontend Integration

### Customer Flow

```typescript
// 1. Display service with "Request Booking" CTA
// Label: "No charge until accepted"

// 2. Customer selects date/time and requests booking
const response = await fetch('/v1/bookings', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    customerId: currentUserId,
    serviceId: selectedServiceId,
    requestedDate: '2026-01-15',
    requestedTime: '14:00',
    customerEmail: userEmail,
    customerName: userName
  })
});

const { data } = await response.json();
const { booking, paymentIntentClientSecret, requiresAction } = data;

// 3. If requiresAction, handle 3D Secure or other authentication
if (requiresAction) {
  // Use Stripe.js to handle authentication
  const { error } = await stripe.confirmCardPayment(paymentIntentClientSecret);
  if (error) {
    // Handle error
  }
}

// 4. Show booking status as "Pending"
// Display: "Waiting for provider to accept"
```

### Provider Flow

```typescript
// 1. Provider dashboard shows pending requests
const response = await fetch('/v1/bookings?providerId=provider-1&status=pending');
const { data: pendingBookings } = await response.json();

// 2. Display each pending booking with Accept/Decline buttons

// 3. Provider accepts
await fetch(`/v1/bookings/${bookingId}/accept`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ providerId: currentProviderId })
});

// 4. Invalidate queries to refresh UI
queryClient.invalidateQueries(['bookings', 'provider', currentProviderId]);
```

### Real-time Updates

Use webhooks to trigger real-time notifications:

```typescript
// Backend: After webhook updates booking status
socket.emit(`booking:${bookingId}:updated`, booking);

// Frontend: Listen for updates
socket.on(`booking:${bookingId}:updated`, (booking) => {
  // Update UI
  queryClient.setQueryData(['booking', bookingId], booking);
});
```

---

## Security Considerations

1. **Server-side price calculation:** Clients never send amounts
2. **Provider verification:** All accept/decline actions verify ownership
3. **Customer verification:** All cancel actions verify ownership
4. **Idempotency:** Prevents duplicate actions and double-capture
5. **Webhook signature verification:** All webhooks verified with Stripe signature
6. **Review mode:** Limits test charges during app review

---

## Monitoring & Debugging

### Logging
All operations log detailed information:
```
✅ Created booking abc-123 with payment authorization (PaymentIntent: pi_xxx)
   Service: Lawn Mowing, Price: $50.00, Fee: $15.00, Total: $65.00
```

### Error Tracking
Monitor these error types:
- `payment_expired`: Authorization expired before capture
- `booking_conflict`: Double booking attempt
- `permission_denied`: Unauthorized access
- `invalid_state`: Invalid status transition

### Webhook Health
Monitor webhook event processing:
- Check `processedWebhookEvents` set size
- Alert on repeated failures
- Verify webhook signature configuration

---

## Future Enhancements (V2)

1. **Refund Policy**: Allow cancellation after confirmation with refund
2. **Auto-expire**: Automatically expire pending bookings after X hours
3. **Recurring Bookings**: Support weekly/monthly recurring services
4. **Service Packages**: Bundle multiple services together
5. **Dynamic Pricing**: Time-based or demand-based pricing
6. **Provider Calendar**: Block out unavailable times
7. **Customer Reviews**: Rate providers after service completion

---

## Summary

✅ **Complete Implementation:**
- All endpoints: create, accept, decline, cancel
- Server-side pricing with Model A
- Payment authorization → capture flow
- Webhook handlers for payment events
- Double booking prevention
- Idempotency enforcement
- Authorization expiry handling

✅ **Backend-Enforced:**
- No client can bypass pricing
- All state transitions validated
- Ownership verified on every action

✅ **Production Ready:**
- Comprehensive error handling
- Detailed logging
- Stripe test mode support
- Webhook signature verification

**The booking system is fully implemented and ready for testing!** 🎉
