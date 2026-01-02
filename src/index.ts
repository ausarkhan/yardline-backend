import express from 'express';
import cors from 'cors';
import Stripe from 'stripe';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const PORT = process.env.PORT || 3000;

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-11-20.acacia',
});

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'stripe-signature'],
}));

app.use((req, res, next) => {
  if (req.originalUrl === '/v1/stripe/webhooks') {
    next();
  } else {
    express.json()(req, res, next);
  }
});

interface ConnectAccount {
  accountId: string;
  email: string;
  name: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  status: 'pending' | 'restricted' | 'active';
  createdAt: string;
}

interface Ticket {
  ticketId: string;
  ticketNumber: string;
  qrToken: string;
  userId: string;
  eventId: string;
  ticketTypeId: string;
  ticketTypeName: string;
  priceCents: number;
  feesCents: number;
  paymentIntentId: string;
  status: 'pending' | 'confirmed' | 'used' | 'cancelled';
  createdAt: string;
}

const connectAccounts: Map<string, ConnectAccount> = new Map();
const tickets: Map<string, Ticket[]> = new Map();

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'yardline-api', version: '1.0.0' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.post('/v1/stripe/connect/accounts', async (req, res) => {
  try {
    const { email, name, returnUrl, refreshUrl } = req.body;
    const account = await stripe.accounts.create({
      type: 'express',
      email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_profile: { name },
    });
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: refreshUrl || 'https://yardline.app/stripe/connect/refresh',
      return_url: returnUrl || 'https://yardline.app/stripe/connect/return',
      type: 'account_onboarding',
    });
    connectAccounts.set(account.id, {
      accountId: account.id,
      email,
      name,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    res.json({ success: true, data: { accountId: account.id, onboardingUrl: accountLink.url } });
  } catch (error) {
    res.status(500).json({ success: false, error: { type: 'api_error', message: error instanceof Error ? error.message : 'Failed to create account' } });
  }
});

app.get('/v1/stripe/connect/accounts/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    const account = await stripe.accounts.retrieve(accountId);
    const accountData: ConnectAccount = {
      accountId: account.id,
      email: account.email || '',
      name: account.business_profile?.name || '',
      chargesEnabled: account.charges_enabled || false,
      payoutsEnabled: account.payouts_enabled || false,
      detailsSubmitted: account.details_submitted || false,
      status: account.charges_enabled && account.payouts_enabled ? 'active' : account.requirements?.disabled_reason ? 'restricted' : 'pending',
      createdAt: new Date(account.created * 1000).toISOString(),
    };
    connectAccounts.set(accountId, accountData);
    res.json({ success: true, data: accountData });
  } catch (error) {
    res.status(500).json({ success: false, error: { type: 'api_error', message: error instanceof Error ? error.message : 'Failed to get account' } });
  }
});

app.post('/v1/stripe/connect/accounts/:accountId/link', async (req, res) => {
  try {
    const { accountId } = req.params;
    const { returnUrl, refreshUrl } = req.body;
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl || 'https://yardline.app/stripe/connect/refresh',
      return_url: returnUrl || 'https://yardline.app/stripe/connect/return',
      type: 'account_onboarding',
    });
    res.json({ success: true, data: { url: accountLink.url } });
  } catch (error) {
    res.status(500).json({ success: false, error: { type: 'api_error', message: error instanceof Error ? error.message : 'Failed to create account link' } });
  }
});

app.post('/v1/stripe/payment-intents', async (req, res) => {
  try {
    const { connectedAccountId, items, ticketSubtotalCents, platformFeeTotalCents, totalChargeCents, description, metadata, idempotencyKey } = req.body;
    if (totalChargeCents < 50) {
      return res.status(400).json({ success: false, error: { type: 'invalid_request_error', message: 'Amount must be at least $0.50 USD', code: 'amount_too_small' } });
    }
    const paymentIntentParams: Stripe.PaymentIntentCreateParams = {
      amount: totalChargeCents,
      currency: 'usd',
      description: description || 'YardLine Ticket Purchase',
      metadata: { ...metadata, items_json: JSON.stringify(items), ticket_subtotal_cents: String(ticketSubtotalCents), platform_fee_total_cents: String(platformFeeTotalCents), total_charge_cents: String(totalChargeCents) },
      automatic_payment_methods: { enabled: true },
    };
    if (connectedAccountId) {
      paymentIntentParams.transfer_data = { destination: connectedAccountId };
      paymentIntentParams.application_fee_amount = platformFeeTotalCents;
      paymentIntentParams.metadata!.connected_account = connectedAccountId;
    }
    const paymentIntent = await stripe.paymentIntents.create(paymentIntentParams, idempotencyKey ? { idempotencyKey } : undefined);
    res.json({ success: true, data: { paymentIntentId: paymentIntent.id, clientSecret: paymentIntent.client_secret, amount: paymentIntent.amount, currency: paymentIntent.currency, status: paymentIntent.status } });
  } catch (error) {
    res.status(500).json({ success: false, error: { type: 'api_error', message: error instanceof Error ? error.message : 'Failed to create payment intent' } });
  }
});

app.get('/v1/stripe/payment-intents/:paymentIntentId', async (req, res) => {
  try {
    const { paymentIntentId } = req.params;
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    res.json({ success: true, data: { paymentIntentId: paymentIntent.id, clientSecret: paymentIntent.client_secret, amount: paymentIntent.amount, currency: paymentIntent.currency, status: paymentIntent.status, transferData: paymentIntent.transfer_data, applicationFeeAmount: paymentIntent.application_fee_amount } });
  } catch (error) {
    res.status(500).json({ success: false, error: { type: 'api_error', message: error instanceof Error ? error.message : 'Failed to get payment intent' } });
  }
});

app.post('/v1/stripe/payment-intents/:paymentIntentId/cancel', async (req, res) => {
  try {
    const { paymentIntentId } = req.params;
    const paymentIntent = await stripe.paymentIntents.cancel(paymentIntentId);
    res.json({ success: true, data: { status: paymentIntent.status } });
  } catch (error) {
    res.status(500).json({ success: false, error: { type: 'api_error', message: error instanceof Error ? error.message : 'Failed to cancel payment intent' } });
  }
});

app.post('/v1/stripe/refunds', async (req, res) => {
  try {
    const { paymentIntentId, amount, reason } = req.body;
    const refundParams: Stripe.RefundCreateParams = { payment_intent: paymentIntentId, reverse_transfer: true, refund_application_fee: true };
    if (amount) refundParams.amount = amount;
    if (reason) refundParams.reason = reason;
    const refund = await stripe.refunds.create(refundParams);
    res.json({ success: true, data: { refundId: refund.id, status: refund.status } });
  } catch (error) {
    res.status(500).json({ success: false, error: { type: 'api_error', message: error instanceof Error ? error.message : 'Failed to create refund' } });
  }
});

app.get('/v1/tickets/by-payment/:paymentIntentId', (req, res) => {
  const { paymentIntentId } = req.params;
  const paymentTickets = tickets.get(paymentIntentId) || [];
  res.json({ success: true, data: paymentTickets });
});

app.post('/v1/stripe/webhooks', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'] as string;
  let event: Stripe.Event;
  try {
    if (WEBHOOK_SECRET) {
      event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
    } else {
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    return res.status(400).send('Webhook signature verification failed');
  }
  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentSucceeded(event.data.object as Stripe.PaymentIntent);
        break;
      case 'payment_intent.payment_failed':
        console.log('Payment failed:', (event.data.object as Stripe.PaymentIntent).id);
        break;
      case 'account.updated':
        const account = event.data.object as Stripe.Account;
        const existing = connectAccounts.get(account.id);
        if (existing) {
          existing.chargesEnabled = account.charges_enabled || false;
          existing.payoutsEnabled = account.payouts_enabled || false;
          existing.detailsSubmitted = account.details_submitted || false;
          existing.status = account.charges_enabled && account.payouts_enabled ? 'active' : 'pending';
          connectAccounts.set(account.id, existing);
        }
        break;
    }
    res.json({ received: true });
  } catch (error) {
    res.status(500).json({ error: 'Webhook handler failed' });
  }
});

async function handlePaymentSucceeded(paymentIntent: Stripe.PaymentIntent) {
  const metadata = paymentIntent.metadata;
  const itemsJson = metadata.items_json;
  if (!itemsJson) return;
  try {
    const items = JSON.parse(itemsJson) as Array<{ ticketTypeId: string; ticketTypeName: string; priceCents: number; quantity: number; platformFeeCents: number }>;
    const createdTickets: Ticket[] = [];
    for (const item of items) {
      for (let i = 0; i < item.quantity; i++) {
        const ticket: Ticket = {
          ticketId: uuidv4(),
          ticketNumber: `TKT-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
          qrToken: uuidv4(),
          userId: metadata.user_id || 'unknown',
          eventId: metadata.event_id || 'unknown',
          ticketTypeId: item.ticketTypeId,
          ticketTypeName: item.ticketTypeName,
          priceCents: item.priceCents,
          feesCents: Math.round(item.platformFeeCents / item.quantity),
          paymentIntentId: paymentIntent.id,
          status: 'confirmed',
          createdAt: new Date().toISOString(),
        };
        createdTickets.push(ticket);
      }
    }
    tickets.set(paymentIntent.id, createdTickets);
  } catch (error) {
    console.error('Error creating tickets:', error);
  }
}

app.listen(PORT, () => {
  console.log(`YardLine API running on port ${PORT}`);
});
