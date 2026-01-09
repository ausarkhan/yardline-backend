# Stripe Checkout Sessions - Model A Pricing

## Overview

YardLine now supports **Stripe Checkout Sessions** for event ticket purchases, providing a hosted payment experience while maintaining Model A pricing where buyers pay all fees.

## Key Features

✅ **Hosted Checkout Experience** - Stripe-hosted payment page  
✅ **Model A Pricing** - Buyer pays all fees, host receives 100% of ticket price  
✅ **Payment Confirmation** - Tickets only created after payment is confirmed  
✅ **Connect Integration** - Proper fund routing to event hosts  
✅ **YardLine Revenue** - Exactly $0.99 per ticket after Stripe fees  

## Pricing Structure

### Buyer Pays
- **Ticket Price**: Set by host
- **Service & Processing Fee**: Calculated to cover Stripe fees + YardLine revenue

### Fund Distribution
```
Buyer pays:    $52.77 (ticket + fee)
├─ Stripe fee:  $1.53 (2.9% + $0.30)
├─ Host gets:  $51.25 (transferred via Connect)
└─ YardLine:    $0.99 (application_fee_amount)
```

## API Endpoints

### 1. Create Checkout Session

**POST** `/v1/checkout/create-session`

Creates a Stripe Checkout Session for event ticket purchase.

**Request:**
```json
{
  "userId": "user_123",
  "eventId": "evt_456",
  "eventName": "Summer Concert 2026",
  "connectedAccountId": "acct_host_789",
  "items": [
    {
      "ticketTypeId": "vip",
      "ticketTypeName": "VIP Admission",
      "priceCents": 5000,
      "quantity": 2
    }
  ],
  "successUrl": "https://myapp.com/success?session_id={CHECKOUT_SESSION_ID}",
  "cancelUrl": "https://myapp.com/cancel"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "sessionId": "cs_test_...",
    "sessionUrl": "https://checkout.stripe.com/c/pay/cs_test_...",
    "ticketSubtotalCents": 10000,
    "buyerFeeTotalCents": 316,
    "totalChargeCents": 10316,
    "mode": "test",
    "pricingModel": "model_a"
  }
}
```

**Next Steps:**
1. Redirect user to `sessionUrl` for checkout
2. User completes payment on Stripe's hosted page
3. Stripe redirects to `successUrl` with `session_id` parameter
4. Your app retrieves session to confirm payment

### 2. Retrieve Checkout Session

**GET** `/v1/checkout/session/:sessionId`

Retrieves checkout session details and ticket information after payment.

**Response:**
```json
{
  "success": true,
  "data": {
    "sessionId": "cs_test_...",
    "paymentStatus": "paid",
    "paymentIntentId": "pi_...",
    "customerEmail": "buyer@example.com",
    "amountTotal": 10316,
    "currency": "usd",
    "tickets": [
      {
        "ticketId": "...",
        "ticketNumber": "TKT-...",
        "qrToken": "...",
        "ticketTypeName": "VIP Admission",
        "priceCents": 5000,
        "status": "confirmed"
      }
    ],
    "ticketsCreated": true,
    "mode": "test"
  }
}
```

### 3. Get Tickets by Session

**GET** `/v1/tickets/by-session/:sessionId`

Retrieves all tickets associated with a checkout session.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "ticketId": "...",
      "ticketNumber": "TKT-...",
      "qrToken": "...",
      "userId": "user_123",
      "eventId": "evt_456",
      "ticketTypeId": "vip",
      "ticketTypeName": "VIP Admission",
      "priceCents": 5000,
      "feesCents": 158,
      "paymentIntentId": "pi_...",
      "status": "confirmed",
      "createdAt": "2026-01-09T..."
    }
  ]
}
```

## Implementation Details

### Checkout Session Configuration

```typescript
const session = await stripe.checkout.sessions.create({
  mode: 'payment',
  line_items: [
    // Ticket line items
    {
      price_data: {
        currency: 'usd',
        product_data: {
          name: 'VIP Admission',
          description: 'Summer Concert 2026 - VIP Admission',
        },
        unit_amount: 5000, // $50.00
      },
      quantity: 2,
    },
    // Service & processing fee
    {
      price_data: {
        currency: 'usd',
        product_data: {
          name: 'Service & processing fee',
          description: 'Covers platform services and payment processing',
        },
        unit_amount: 316, // Calculated buyer fee
      },
      quantity: 1,
    }
  ],
  payment_intent_data: {
    application_fee_amount: 99, // YardLine nets $0.99 per ticket
    transfer_data: {
      destination: 'acct_host_789', // Host's Connect account
    },
    metadata: {
      user_id: 'user_123',
      event_id: 'evt_456',
      pricing_model: 'model_a',
      ticket_subtotal_cents: '10000',
      buyer_fee_total_cents: '316',
      items_json: '[...]'
    }
  },
  success_url: 'https://myapp.com/success?session_id={CHECKOUT_SESSION_ID}',
  cancel_url: 'https://myapp.com/cancel'
});
```

### Webhook Handling

The backend listens for `checkout.session.completed` events:

```typescript
case 'checkout.session.completed':
  const session = event.data.object;
  
  // CRITICAL: Only create tickets if payment is confirmed
  if (session.payment_status === 'paid') {
    // Retrieve PaymentIntent to get metadata
    const paymentIntent = await stripe.paymentIntents.retrieve(
      session.payment_intent
    );
    
    // Create tickets from metadata
    await createTicketsFromMetadata(paymentIntent.metadata);
  }
  break;
```

### Ticket Creation Flow

1. **User initiates checkout** → Backend creates Checkout Session
2. **User redirected to Stripe** → Completes payment on Stripe's page
3. **Payment succeeds** → Stripe sends `checkout.session.completed` webhook
4. **Webhook verified** → Backend checks `payment_status === 'paid'`
5. **Tickets created** → Only after payment confirmation
6. **User redirected back** → App retrieves session and displays tickets

## Fee Calculation

### Model A Formula

```typescript
function calculateBuyerFeePerTicket(ticketPriceCents: number): number {
  const buyerFeeCents = Math.ceil(
    (99 + 0.029 * ticketPriceCents + 30) / (1 - 0.029)
  );
  return buyerFeeCents;
}
```

### Examples

| Ticket Price | Buyer Fee | Total | Host Gets | YardLine Nets |
|--------------|-----------|-------|-----------|---------------|
| $10.00 | $1.58 | $11.58 | $10.51 | $0.99 |
| $25.00 | $2.04 | $27.04 | $25.91 | $0.99 |
| $50.00 | $2.77 | $52.77 | $51.25 | $0.99 |
| $100.00 | $4.31 | $104.31 | $102.78 | $0.99 |

## Integration Guide

### Step 1: Create Checkout Session

```typescript
const response = await fetch('https://api.yardline.com/v1/checkout/create-session', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    userId: currentUser.id,
    eventId: event.id,
    eventName: event.name,
    connectedAccountId: event.host.stripeAccountId,
    items: [
      {
        ticketTypeId: 'general',
        ticketTypeName: 'General Admission',
        priceCents: 2500,
        quantity: 2
      }
    ],
    successUrl: `${window.location.origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${window.location.origin}/checkout/cancel`
  })
});

const { data } = await response.json();

// Redirect to Stripe Checkout
window.location.href = data.sessionUrl;
```

### Step 2: Handle Success

After successful payment, Stripe redirects to `successUrl`:

```typescript
// On your success page
const urlParams = new URLSearchParams(window.location.search);
const sessionId = urlParams.get('session_id');

// Retrieve session details and tickets
const response = await fetch(`https://api.yardline.com/v1/checkout/session/${sessionId}`);
const { data } = await response.json();

if (data.paymentStatus === 'paid' && data.ticketsCreated) {
  // Display tickets to user
  console.log('Tickets:', data.tickets);
  
  // Navigate to "My Tickets" or show success message
  showSuccessMessage(data.tickets);
}
```

### Step 3: Webhook Configuration

Configure webhook in Stripe Dashboard:
- **URL**: `https://api.yardline.com/v1/stripe/webhooks`
- **Events**: `checkout.session.completed`
- **Secret**: Store in `STRIPE_TEST_WEBHOOK_SECRET` / `STRIPE_LIVE_WEBHOOK_SECRET`

## Security & Best Practices

### ✅ DO

- **Verify payment status** before showing tickets
- **Use webhook** for ticket creation (not redirect)
- **Check session** server-side after redirect
- **Store webhook secret** securely
- **Validate session ID** from user input

### ❌ DON'T

- **Don't create tickets** on redirect alone
- **Don't trust client-side** payment status
- **Don't skip webhook** signature verification
- **Don't expose** sensitive keys
- **Don't issue tickets** before `payment_status === 'paid'`

## Testing

### Test Mode

1. Use test API keys
2. Create checkout session in test mode
3. Use Stripe test card: `4242 4242 4242 4242`
4. Complete checkout flow
5. Verify tickets created

### Test Cards

- **Success**: `4242 4242 4242 4242`
- **Decline**: `4000 0000 0000 0002`
- **3D Secure**: `4000 0027 6000 3184`

### Webhook Testing

```bash
# Forward webhooks to local dev
stripe listen --forward-to localhost:3000/v1/stripe/webhooks

# Trigger test checkout.session.completed event
stripe trigger checkout.session.completed
```

## Troubleshooting

### Issue: Tickets not appearing

**Check:**
1. Webhook received and processed successfully
2. `payment_status === 'paid'` in session
3. No errors in server logs during ticket creation
4. Session ID matches in database

**Solution:**
```bash
# Check webhook logs
curl https://api.yardline.com/v1/checkout/session/cs_test_...

# Verify payment status
```

### Issue: Payment succeeded but webhook not received

**Check:**
1. Webhook endpoint URL is correct
2. Webhook secret is configured
3. Firewall allows Stripe IPs
4. Endpoint returns 200 status

**Solution:**
- Check Stripe Dashboard → Webhooks → Events
- Look for failed delivery attempts
- Resend webhook manually for testing

### Issue: Wrong amount charged

**Check:**
1. Fee calculation is using Model A formula
2. Line items sum correctly
3. No duplicate fees added

**Solution:**
- Review server logs for fee calculation
- Verify `buyerFeeCents` matches expected
- Check line items in Stripe Dashboard

## Comparison: Checkout vs PaymentIntent

| Feature | Checkout Sessions | PaymentIntent (Current) |
|---------|------------------|------------------------|
| **UI** | Stripe-hosted page | Custom in-app UI |
| **Mobile** | Web redirect | Native PaymentSheet |
| **Saved Cards** | Supported | Supported |
| **Apple Pay** | Supported | Supported |
| **Google Pay** | Supported | Supported |
| **Setup Time** | Faster (no UI) | More control |
| **Branding** | Limited | Full control |
| **Best For** | Web, quick setup | Mobile apps, custom UX |

## Migration Notes

### From PaymentIntent to Checkout

The backend supports **both** methods:
- **Checkout Sessions**: `/v1/checkout/create-session` (new)
- **PaymentIntent**: `/v1/payments/create-intent` (existing)

Choose based on your needs:
- **Web app** → Use Checkout Sessions (easier)
- **Mobile app** → Use PaymentIntent with PaymentSheet (better UX)
- **Both** → Support both endpoints

No breaking changes - existing PaymentIntent flow continues to work.

## Resources

- [Stripe Checkout Documentation](https://stripe.com/docs/payments/checkout)
- [Checkout Session API](https://stripe.com/docs/api/checkout/sessions)
- [Connect with Checkout](https://stripe.com/docs/connect/collect-then-transfer-guide)
- [Webhook Best Practices](https://stripe.com/docs/webhooks/best-practices)

## Summary

✅ **Checkout Sessions implemented** with Model A pricing  
✅ **Host receives 100%** of ticket price via Connect  
✅ **YardLine nets $0.99** per ticket (application_fee_amount)  
✅ **Tickets created** only after payment confirmation  
✅ **Webhook-driven** fulfillment for security  
✅ **Backward compatible** with existing PaymentIntent flow  

The Checkout Session flow provides a hosted payment experience while maintaining the same Model A pricing guarantees as the PaymentIntent flow.
