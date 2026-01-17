# Ticket Purchase via Stripe Checkout - Updated for "Pay Online"

## Overview

The ticket checkout route has been updated to support "Pay Online" flow with mobile app deep links, consistent with the booking checkout implementation.

## Endpoint

### POST /v1/checkout/create-session

Creates a Stripe Checkout Session for ticket purchases and returns the hosted payment page URL.

**Request:**
```json
{
  "userId": "user-uuid",
  "eventId": "event-uuid",
  "eventName": "Concert Name",
  "items": [
    {
      "ticketTypeId": "general-admission",
      "ticketTypeName": "General Admission",
      "priceCents": 5000,
      "quantity": 2
    }
  ],
  "connectedAccountId": "acct_...",
  "successUrl": "optional-custom-url",
  "cancelUrl": "optional-custom-url"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "url": "https://checkout.stripe.com/c/pay/cs_...",
    "sessionId": "cs_...",
    "ticketSubtotalCents": 10000,
    "buyerFeeTotalCents": 132,
    "totalChargeCents": 10132,
    "mode": "live",
    "pricingModel": "model_a"
  }
}
```

## Key Changes

### 1. Deep Link URLs

**Success URL (default if not provided):**
```
yardline://payment-success?type=ticket&session_id={CHECKOUT_SESSION_ID}
```

**Cancel URL (default if not provided):**
```
yardline://payment-cancel?type=ticket&eventId={eventId}
```

The `APP_URL_SCHEME` environment variable controls the URL scheme (defaults to `yardline`).

### 2. Response Format

Changed from:
```json
{ "sessionUrl": "...", "sessionId": "..." }
```

To:
```json
{ "url": "...", "sessionId": "..." }
```

This matches the booking checkout format for consistency.

### 3. Session Metadata

Added `type: 'ticket'` to session metadata for webhook routing:
```json
{
  "type": "ticket",
  "user_id": "uuid",
  "event_id": "uuid",
  "pricing_model": "model_a"
}
```

### 4. Custom URLs Still Supported

Clients can override default deep links by providing:
```json
{
  "successUrl": "custom://success?param=value",
  "cancelUrl": "custom://cancel"
}
```

## Mobile App Integration

### Create Checkout Session

```typescript
const response = await fetch('https://api.yardline.app/v1/checkout/create-session', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    userId,
    eventId,
    eventName: 'Summer Concert',
    items: [
      {
        ticketTypeId: 'vip',
        ticketTypeName: 'VIP Pass',
        priceCents: 10000,
        quantity: 1
      }
    ],
    connectedAccountId: hostStripeAccountId
  })
});

const { data } = await response.json();
const { url, sessionId } = data;
```

### Open Checkout in Browser

```typescript
// Open Stripe hosted checkout page
Linking.openURL(url);
```

### Handle Deep Link Return

```typescript
// Register deep link listener
Linking.addEventListener('url', (event) => {
  const parsedUrl = new URL(event.url);
  
  if (parsedUrl.pathname === '//payment-success') {
    const sessionId = parsedUrl.searchParams.get('session_id');
    const type = parsedUrl.searchParams.get('type');
    
    if (type === 'ticket') {
      // Payment successful! Tickets have been issued
      // Fetch tickets from backend
      fetchTickets(sessionId);
    }
  }
  
  if (parsedUrl.pathname === '//payment-cancel') {
    const type = parsedUrl.searchParams.get('type');
    const eventId = parsedUrl.searchParams.get('eventId');
    
    if (type === 'ticket') {
      // User cancelled payment
      showCancellationMessage();
    }
  }
});
```

### Fetch Tickets After Payment

```typescript
// Get tickets by session ID
const response = await fetch(
  `https://api.yardline.app/v1/tickets/by-session/${sessionId}`
);

const { data: tickets } = await response.json();
// tickets = [{ ticketId, ticketNumber, qrToken, ... }]
```

## Webhook Processing

### Events Handled

The webhook processes these events for ticket checkout sessions:

1. **checkout.session.completed**
   - Creates tickets and marks them as `confirmed`
   - Stores tickets with both session ID and payment intent ID
   - Idempotent (safe to retry)

2. **checkout.session.async_payment_succeeded**
   - Same as completed (for delayed payment methods)

3. **checkout.session.async_payment_failed**
   - Payment failed (tickets not created)

### Ticket Creation

When payment succeeds, tickets are created from PaymentIntent metadata:

```typescript
// For each item in items_json
for (const item of items) {
  for (let i = 0; i < item.quantity; i++) {
    const ticket = {
      ticketId: uuidv4(),
      ticketNumber: 'TKT-...',
      qrToken: uuidv4(),
      userId: metadata.user_id,
      eventId: metadata.event_id,
      ticketTypeId: item.ticketTypeId,
      ticketTypeName: item.ticketTypeName,
      priceCents: item.priceCents,
      feesCents: item.buyerFeePerTicket,
      paymentIntentId: paymentIntent.id,
      status: 'confirmed',
      createdAt: new Date().toISOString()
    };
    tickets.push(ticket);
  }
}
```

### Idempotency

Webhook handler uses idempotency key to prevent duplicate ticket creation:
```typescript
const sessionIdempotencyKey = `checkout_${session.id}`;
if (processedPaymentIntents.has(sessionIdempotencyKey)) {
  return; // Already processed
}
```

## Testing

### Create and Complete Checkout

```bash
# Set variables
export API_URL="http://localhost:3000"

# Create checkout session
curl -X POST "$API_URL/v1/checkout/create-session" \\
  -H "Content-Type: application/json" \\
  -d '{
    "userId": "user-uuid",
    "eventId": "event-uuid",
    "eventName": "Test Event",
    "items": [{
      "ticketTypeId": "general",
      "ticketTypeName": "General Admission",
      "priceCents": 2500,
      "quantity": 2
    }],
    "connectedAccountId": "acct_..."
  }' | jq '.'

# Response includes:
# {
#   "success": true,
#   "data": {
#     "url": "https://checkout.stripe.com/...",
#     "sessionId": "cs_..."
#   }
# }

# Open URL in browser, complete payment

# Check tickets were created
curl "$API_URL/v1/tickets/by-session/cs_..." | jq '.'
```

### Verify Deep Links

```bash
# Test success deep link format
echo "yardline://payment-success?type=ticket&session_id=cs_test_abc123"

# Test cancel deep link format  
echo "yardline://payment-cancel?type=ticket&eventId=event-uuid"

# Test opening in simulator (iOS)
xcrun simctl openurl booted "yardline://payment-success?type=ticket&session_id=cs_test_abc123"

# Test opening in emulator (Android)
adb shell am start -a android.intent.action.VIEW -d "yardline://payment-success?type=ticket&session_id=cs_test_abc123"
```

## Security

✅ **Server-side pricing** - All amounts calculated on backend  
✅ **Model A validation** - Ensures correct fee structure  
✅ **Review mode enforcement** - Respects $1.00 limit  
✅ **Webhook verification** - Signature validation required  
✅ **Idempotent processing** - Duplicate webhooks handled safely  
✅ **Connect transfers** - Host receives full ticket price  

## Migration Notes

### Breaking Changes

**Response Format Changed:**
- Old: `data.sessionUrl`
- New: `data.url`

**Update mobile app to use `data.url` instead of `data.sessionUrl`**

### Non-Breaking Changes

- Default success/cancel URLs now use deep links
- Custom URLs still work via `successUrl`/`cancelUrl` parameters
- Session metadata includes `type: 'ticket'` (backward compatible)

### Frontend Migration

```typescript
// Before
const { sessionUrl } = response.data;
Linking.openURL(sessionUrl);

// After
const { url } = response.data;
Linking.openURL(url);
```

## Comparison: PaymentIntent vs Checkout Session

| Feature | PaymentIntent (Old) | Checkout Session (New) |
|---------|---------------------|------------------------|
| Payment page | In-app PaymentSheet | Browser/webview |
| Client SDK | Required | Optional (just open URL) |
| Payment methods | Limited by SDK | All Stripe methods |
| Saved cards | Via customer object | Via Stripe checkout |
| 3D Secure | Manual handling | Automatic |
| Receipt | Manual email | Stripe sends automatically |

## Environment Variables

```bash
# Optional: Mobile app URL scheme (defaults to 'yardline')
export APP_URL_SCHEME=yardline
```

## Monitoring

### Success Logs

```
✅ Created Checkout Session cs_xxx for event event-uuid
   Total: $101.32, Ticket: $100.00, Fee: $1.32

🎟️  Processing ticket checkout session: cs_xxx
✅ Created 2 tickets for checkout session cs_xxx
```

### Ticket Retrieval

```sql
-- Check tickets created for a session
SELECT * FROM tickets 
WHERE payment_intent_id IN (
  SELECT payment_intent 
  FROM stripe_checkout_sessions 
  WHERE id = 'cs_...'
);
```

## Summary

✅ **Updated:** Deep link URLs with `APP_URL_SCHEME`  
✅ **Standardized:** Response uses `url` instead of `sessionUrl`  
✅ **Added:** Session metadata `type: 'ticket'` for routing  
✅ **Enhanced:** Webhook logging for ticket sessions  
✅ **Maintained:** Full backward compatibility with custom URLs  
✅ **Tested:** Idempotent webhook processing  

**Ready for mobile "Pay Online" integration!** 🎟️
