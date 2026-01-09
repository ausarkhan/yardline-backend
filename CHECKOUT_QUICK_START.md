# Checkout Sessions - Quick Start

## Create a Checkout Session

```bash
curl -X POST http://localhost:3000/v1/checkout/create-session \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_123",
    "eventId": "event_456",
    "eventName": "Summer Concert",
    "connectedAccountId": "acct_1234567890",
    "items": [
      {
        "ticketTypeId": "vip",
        "ticketTypeName": "VIP Ticket",
        "priceCents": 5000,
        "quantity": 1
      }
    ],
    "successUrl": "https://myapp.com/success?session_id={CHECKOUT_SESSION_ID}",
    "cancelUrl": "https://myapp.com/cancel"
  }'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "sessionId": "cs_test_abc123",
    "sessionUrl": "https://checkout.stripe.com/c/pay/cs_test_abc123",
    "ticketSubtotalCents": 5000,
    "buyerFeeTotalCents": 277,
    "totalChargeCents": 5277,
    "pricingModel": "model_a"
  }
}
```

## Redirect to Checkout

```javascript
// Get sessionUrl from API response
window.location.href = data.sessionUrl;
```

## Handle Success

After payment, user is redirected to your `successUrl`:

```javascript
// Extract session_id from URL
const params = new URLSearchParams(window.location.search);
const sessionId = params.get('session_id');

// Fetch session details
const response = await fetch(`/v1/checkout/session/${sessionId}`);
const { data } = await response.json();

if (data.paymentStatus === 'paid') {
  console.log('Payment successful!');
  console.log('Tickets:', data.tickets);
}
```

## Get Tickets

```bash
# By checkout session ID
curl http://localhost:3000/v1/tickets/by-session/cs_test_abc123

# By payment intent ID
curl http://localhost:3000/v1/tickets/by-payment/pi_abc123
```

## Webhook Setup

1. **Add webhook endpoint** in Stripe Dashboard
2. **URL**: `https://your-domain.com/v1/stripe/webhooks`
3. **Events**: Select `checkout.session.completed`
4. **Get secret**: Copy webhook signing secret
5. **Set env var**: `STRIPE_TEST_WEBHOOK_SECRET=whsec_...`

## Key Points

✅ Tickets created **only after** `checkout.session.completed` webhook  
✅ Payment status must be **`paid`** to create tickets  
✅ Host receives **100% of ticket price**  
✅ YardLine nets **$0.99 per ticket**  
✅ Buyer pays **ticket + service & processing fee**  

## Flow Diagram

```
1. Create Session → API returns sessionUrl
2. Redirect User → Stripe hosted checkout page
3. User Pays → Stripe processes payment
4. Webhook Sent → checkout.session.completed
5. Verify Status → payment_status === 'paid'
6. Create Tickets → Store in database
7. User Returns → Display tickets in app
```

## Test with Stripe CLI

```bash
# Listen for webhooks
stripe listen --forward-to localhost:3000/v1/stripe/webhooks

# Create test session
curl -X POST http://localhost:3000/v1/checkout/create-session \
  -H "Content-Type: application/json" \
  -d @test-session.json

# Complete checkout with test card: 4242 4242 4242 4242
```

## Pricing Example

**Ticket: $50.00**
```
Ticket price:             $50.00
Service & processing fee:  $2.77
─────────────────────────────────
Total charge:             $52.77

After payment:
- Stripe fee:  $1.53 (2.9% + $0.30)
- Host gets:  $51.25 (via transfer)
- YardLine:    $0.99 (application_fee)
```

## Resources

- **Full Guide**: [CHECKOUT_SESSIONS.md](./CHECKOUT_SESSIONS.md)
- **Model A Pricing**: [MODEL_A_PRICING.md](./MODEL_A_PRICING.md)
- **Stripe Docs**: [Checkout Sessions](https://stripe.com/docs/payments/checkout)
