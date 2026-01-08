import express from 'express';
import cors from 'cors';
import Stripe from 'stripe';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const PORT = process.env.PORT || 3000;

// Environment-based Stripe configuration
// Supports two modes:
// 1. Explicit environment selection via STRIPE_ENV (test/live)
// 2. Legacy: Auto-detect from STRIPE_SECRET_KEY prefix
const STRIPE_ENV = process.env.STRIPE_ENV as 'test' | 'live' | undefined;

// Environment-specific keys
const STRIPE_TEST_SECRET_KEY = process.env.STRIPE_TEST_SECRET_KEY;
const STRIPE_LIVE_SECRET_KEY = process.env.STRIPE_LIVE_SECRET_KEY;
const STRIPE_TEST_WEBHOOK_SECRET = process.env.STRIPE_TEST_WEBHOOK_SECRET;
const STRIPE_LIVE_WEBHOOK_SECRET = process.env.STRIPE_LIVE_WEBHOOK_SECRET;

// Legacy single key support (backward compatible)
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// Determine which Stripe key to use
function getStripeSecretKey(): string {
  if (STRIPE_ENV) {
    // Explicit environment mode
    const key = STRIPE_ENV === 'test' ? STRIPE_TEST_SECRET_KEY : STRIPE_LIVE_SECRET_KEY;
    if (!key) {
      throw new Error(`STRIPE_ENV is set to "${STRIPE_ENV}" but STRIPE_${STRIPE_ENV.toUpperCase()}_SECRET_KEY is not configured`);
    }
    return key;
  } else if (STRIPE_SECRET_KEY) {
    // Legacy mode - single key
    return STRIPE_SECRET_KEY;
  } else {
    throw new Error('No Stripe secret key configured. Set STRIPE_ENV + STRIPE_TEST_SECRET_KEY/STRIPE_LIVE_SECRET_KEY, or STRIPE_SECRET_KEY');
  }
}

// Determine which webhook secret to use
function getWebhookSecret(): string | undefined {
  if (STRIPE_ENV) {
    // Explicit environment mode
    return STRIPE_ENV === 'test' ? STRIPE_TEST_WEBHOOK_SECRET : STRIPE_LIVE_WEBHOOK_SECRET;
  } else {
    // Legacy mode
    return STRIPE_WEBHOOK_SECRET;
  }
}

// Detect Stripe mode
function getStripeMode(): 'test' | 'live' {
  if (STRIPE_ENV) {
    return STRIPE_ENV;
  }
  // Legacy: auto-detect from key prefix
  const key = STRIPE_SECRET_KEY;
  if (key?.startsWith('sk_test_')) return 'test';
  if (key?.startsWith('sk_live_')) return 'live';
  return 'test'; // default to test mode
}

const isTestMode = getStripeMode() === 'test';
const isLiveMode = getStripeMode() === 'live';

// Initialize Stripe with the appropriate key
const stripe = new Stripe(getStripeSecretKey(), {
  apiVersion: '2024-11-20.acacia' as any,
});

// Review-safe mode - prevents real charges during App Store review
const REVIEW_MODE = process.env.REVIEW_MODE === 'true';
const REVIEW_MODE_MAX_CHARGE_CENTS = 100; // $1.00 max in review mode

// Calculate platform fee per ticket using the exact formula
// Formula: max(0.99, min(8% of item price AFTER discount, 12.99))
function calculatePlatformFeePerTicket(ticketPriceCents: number): number {
  const eightPercent = Math.round(ticketPriceCents * 0.08);
  const feeCents = Math.max(99, Math.min(eightPercent, 1299));
  return feeCents;
}

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'stripe-signature'],
}));

interface ConnectAccount {
  accountId: string;
  email: string;
  name: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  status: 'pending' | 'restricted' | 'active';
  createdAt: string;
  testStripeAccountId?: string;
  liveStripeAccountId?: string;
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
const processedPaymentIntents: Set<string> = new Set(); // Idempotency tracking for webhook processing

// User records structure to track both test and live Stripe account IDs
interface UserStripeAccounts {
  userId: string;
  testStripeAccountId?: string;
  liveStripeAccountId?: string;
}

const userStripeAccounts: Map<string, UserStripeAccounts> = new Map();

// Helper function to get or create the appropriate Stripe account ID based on mode
async function getOrCreateStripeAccountId(userId: string, email: string, name: string): Promise<string> {
  const mode = getStripeMode();
  
  // Get or initialize user's Stripe accounts
  let userAccounts = userStripeAccounts.get(userId);
  if (!userAccounts) {
    userAccounts = { userId };
    userStripeAccounts.set(userId, userAccounts);
  }

  // Check if we already have an account ID for this mode
  const existingAccountId = mode === 'test' ? userAccounts.testStripeAccountId : userAccounts.liveStripeAccountId;
  if (existingAccountId) {
    return existingAccountId;
  }

  // Create a new Stripe Express account in the appropriate mode
  const account = await stripe.accounts.create({
    type: 'express',
    email,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    business_profile: { name },
  });

  // Store the account ID for this mode
  if (mode === 'test') {
    userAccounts.testStripeAccountId = account.id;
  } else {
    userAccounts.liveStripeAccountId = account.id;
  }
  userStripeAccounts.set(userId, userAccounts);

  return account.id;
}

// Handler function for payment succeeded webhook events
async function handlePaymentSucceeded(paymentIntent: Stripe.PaymentIntent) {
  // Idempotency check - prevent duplicate ticket generation
  if (processedPaymentIntents.has(paymentIntent.id)) {
    console.log(`Payment ${paymentIntent.id} already processed, skipping`);
    return;
  }

  const metadata = paymentIntent.metadata;
  const itemsJson = metadata.items_json;
  if (!itemsJson) return;
  
  try {
    const items = JSON.parse(itemsJson) as Array<{ 
      ticketTypeId: string; 
      ticketTypeName: string; 
      priceCents: number; 
      quantity: number; 
      platformFeeCents: number;
      platformFeePerTicket?: number;
    }>;
    
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
          feesCents: item.platformFeePerTicket || Math.round(item.platformFeeCents / item.quantity),
          paymentIntentId: paymentIntent.id,
          status: 'confirmed',
          createdAt: new Date().toISOString(),
        };
        createdTickets.push(ticket);
      }
    }
    
    tickets.set(paymentIntent.id, createdTickets);
    
    // Mark as processed for idempotency
    processedPaymentIntents.add(paymentIntent.id);
    
    console.log(`Created ${createdTickets.length} tickets for payment ${paymentIntent.id}`);
  } catch (error) {
    console.error('Error creating tickets:', error);
  }
}

// ============================================================================
// STRIPE WEBHOOK ENDPOINT - CRITICAL: Must be defined BEFORE express.json()
// ============================================================================
// This endpoint uses express.raw() to preserve the raw request body needed
// for Stripe signature verification. Follows Stripe's official Express pattern.
// Route: /v1/stripe/webhooks (must match Stripe Dashboard configuration exactly)
// ============================================================================
app.post(
  '/v1/stripe/webhooks',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    // Get the Stripe signature header
    const signature = req.headers['stripe-signature'];
    const webhookSecret = getWebhookSecret();

    // Debug logging for production troubleshooting
    console.log('=== Stripe Webhook Received ===');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Stripe-Signature header present:', !!signature);
    console.log('Webhook secret configured:', !!webhookSecret);
    console.log('Request body type:', typeof req.body);
    console.log('Request body is Buffer:', Buffer.isBuffer(req.body));
    console.log('Content-Type:', req.headers['content-type']);

    // Validate signature header exists
    if (!signature) {
      console.error('❌ Webhook Error: No stripe-signature header found');
      console.error('Available headers:', Object.keys(req.headers));
      return res.status(400).send('Error: No stripe-signature header found');
    }

    // Validate webhook secret is configured
    if (!webhookSecret) {
      console.error('❌ Webhook Error: No webhook secret configured');
      console.error('Set STRIPE_WEBHOOK_SECRET or environment-specific secrets');
      return res.status(500).send('Error: Webhook secret not configured');
    }

    let event: Stripe.Event;

    // Verify the webhook signature
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        signature,
        webhookSecret
      );
      console.log('✅ Webhook signature verified successfully');
      console.log('Event type:', event.type);
      console.log('Event ID:', event.id);
      console.log('Mode:', getStripeMode());
    } catch (err) {
      // Signature verification failed - log detailed error
      console.error('❌ Webhook signature verification failed');
      console.error('Error:', err instanceof Error ? err.message : String(err));
      console.error('Signature header:', signature);
      console.error('Body length:', req.body?.length);
      console.error('Webhook secret (first 10 chars):', webhookSecret.substring(0, 10) + '...');
      
      return res.status(400).send(`Webhook Error: ${err instanceof Error ? err.message : 'Signature verification failed'}`);
    }

    // Handle the verified event
    try {
      console.log(`Processing event: ${event.type}`);
      
      switch (event.type) {
        case 'payment_intent.succeeded':
          const paymentIntent = event.data.object as Stripe.PaymentIntent;
          console.log(`💰 Payment succeeded: ${paymentIntent.id} - Amount: ${paymentIntent.amount}`);
          await handlePaymentSucceeded(paymentIntent);
          break;

        case 'payment_intent.payment_failed':
          const failedPayment = event.data.object as Stripe.PaymentIntent;
          console.log(`❌ Payment failed: ${failedPayment.id}`);
          // Handle payment failure logic here if needed
          break;

        case 'account.updated':
          const account = event.data.object as Stripe.Account;
          console.log(`🔄 Account updated: ${account.id}`);
          const existing = connectAccounts.get(account.id);
          if (existing) {
            existing.chargesEnabled = account.charges_enabled || false;
            existing.payoutsEnabled = account.payouts_enabled || false;
            existing.detailsSubmitted = account.details_submitted || false;
            existing.status = account.charges_enabled && account.payouts_enabled ? 'active' : 'pending';
            connectAccounts.set(account.id, existing);
            console.log(`Account ${account.id} status: ${existing.status}`);
          }
          break;

        default:
          console.log(`ℹ️  Unhandled event type: ${event.type}`);
      }

      // Return 200 to acknowledge receipt of the event
      console.log('✅ Webhook processed successfully');
      return res.json({ received: true, eventId: event.id });
      
    } catch (error) {
      // Event processing failed - log but still return 200 to prevent retries
      console.error('❌ Error processing webhook event:');
      console.error('Event type:', event.type);
      console.error('Event ID:', event.id);
      console.error('Error:', error instanceof Error ? error.message : String(error));
      console.error('Stack:', error instanceof Error ? error.stack : 'N/A');
      
      // Return 200 to prevent Stripe from retrying (event was received and verified)
      return res.status(200).json({ 
        received: true, 
        error: 'Event processing failed',
        eventId: event.id 
      });
    }
  }
);

// Apply JSON body parsing to all other routes
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'yardline-api', version: '1.0.0' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.get('/v1/stripe/mode', (req, res) => {
  const mode = getStripeMode();
  res.json({ 
    success: true, 
    data: { 
      mode, 
      isTestMode, 
      isLiveMode,
      reviewMode: REVIEW_MODE,
      reviewModeMaxChargeCents: REVIEW_MODE ? REVIEW_MODE_MAX_CHARGE_CENTS : null,
      envConfigured: !!STRIPE_ENV,
      stripeEnv: STRIPE_ENV || 'auto-detect',
      webhookConfigured: !!getWebhookSecret()
    } 
  });
});

app.post('/v1/stripe/connect/accounts', async (req, res) => {
  try {
    const { email, name, returnUrl, refreshUrl, userId } = req.body;
    
    // Get or create the appropriate Stripe account for this mode and user
    const accountId = await getOrCreateStripeAccountId(userId || 'default', email, name);
    
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl || 'https://yardline.app/stripe/connect/refresh',
      return_url: returnUrl || 'https://yardline.app/stripe/connect/return',
      type: 'account_onboarding',
    });
    
    const mode = getStripeMode();
    const accountData: ConnectAccount = {
      accountId,
      email,
      name,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    
    // Store mode-specific account IDs
    if (mode === 'test') {
      accountData.testStripeAccountId = accountId;
    } else {
      accountData.liveStripeAccountId = accountId;
    }
    
    connectAccounts.set(accountId, accountData);
    res.json({ success: true, data: { accountId, onboardingUrl: accountLink.url, mode } });
  } catch (error) {
    res.status(500).json({ success: false, error: { type: 'api_error', message: error instanceof Error ? error.message : 'Failed to create account' } });
  }
});

app.get('/v1/stripe/connect/accounts/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    const mode = getStripeMode();
    const account = await stripe.accounts.retrieve(accountId);
    const accountData: ConnectAccount = {
      accountId: account.id,
      email: account.email || '',
      name: account.business_profile?.name || '',
      chargesEnabled: account.charges_enabled || false,
      payoutsEnabled: account.payouts_enabled || false,
      detailsSubmitted: account.details_submitted || false,
      status: account.charges_enabled && account.payouts_enabled ? 'active' : account.requirements?.disabled_reason ? 'restricted' : 'pending',
      createdAt: account.created ? new Date(account.created * 1000).toISOString() : new Date().toISOString(),
    };
    
    // Include mode-specific account IDs
    if (mode === 'test') {
      accountData.testStripeAccountId = accountId;
    } else {
      accountData.liveStripeAccountId = accountId;
    }
    
    connectAccounts.set(accountId, accountData);
    res.json({ success: true, data: accountData, mode });
  } catch (error) {
    res.status(500).json({ success: false, error: { type: 'api_error', message: error instanceof Error ? error.message : 'Failed to get account' } });
  }
});

app.post('/v1/stripe/connect/accounts/:accountId/link', async (req, res) => {
  try {
    const { accountId } = req.params;
    const { returnUrl, refreshUrl } = req.body;
    const mode = getStripeMode();
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl || 'https://yardline.app/stripe/connect/refresh',
      return_url: returnUrl || 'https://yardline.app/stripe/connect/return',
      type: 'account_onboarding',
    });
    res.json({ success: true, data: { url: accountLink.url }, mode });
  } catch (error) {
    res.status(500).json({ success: false, error: { type: 'api_error', message: error instanceof Error ? error.message : 'Failed to create account link' } });
  }
});

// POST /v1/payments/create-intent - PaymentSheet-compatible endpoint
// This endpoint calculates all amounts server-side and supports saved payment methods
app.post('/v1/payments/create-intent', async (req, res) => {
  try {
    const { 
      userId, 
      eventId, 
      items, // Array of { ticketTypeId, ticketTypeName, priceCents, quantity }
      connectedAccountId,
      description,
      customerEmail,
      customerName
    } = req.body;

    // Validate required fields
    if (!userId || !eventId || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: { 
          type: 'invalid_request_error', 
          message: 'Missing required fields: userId, eventId, and items are required' 
        } 
      });
    }

    // Calculate totals server-side
    let ticketSubtotalCents = 0;
    let platformFeeTotalCents = 0;

    const itemsWithFees = items.map((item: any) => {
      const { ticketTypeId, ticketTypeName, priceCents, quantity } = item;
      
      if (!ticketTypeId || !ticketTypeName || typeof priceCents !== 'number' || typeof quantity !== 'number') {
        throw new Error('Invalid item format');
      }

      // Calculate platform fee per ticket using the formula
      const platformFeePerTicket = calculatePlatformFeePerTicket(priceCents);
      const platformFeeCents = platformFeePerTicket * quantity;

      ticketSubtotalCents += priceCents * quantity;
      platformFeeTotalCents += platformFeeCents;

      return {
        ticketTypeId,
        ticketTypeName,
        priceCents,
        quantity,
        platformFeeCents,
        platformFeePerTicket
      };
    });

    const totalChargeCents = ticketSubtotalCents + platformFeeTotalCents;

    // Review mode guardrail - prevent large charges during App Store review
    if (REVIEW_MODE && totalChargeCents > REVIEW_MODE_MAX_CHARGE_CENTS) {
      return res.status(400).json({
        success: false,
        error: {
          type: 'review_mode_error',
          message: `Review mode is enabled. Maximum charge is $${REVIEW_MODE_MAX_CHARGE_CENTS / 100}. Requested: $${totalChargeCents / 100}`,
          code: 'review_mode_limit_exceeded'
        }
      });
    }

    // Minimum charge validation
    if (totalChargeCents < 50) {
      return res.status(400).json({ 
        success: false, 
        error: { 
          type: 'invalid_request_error', 
          message: 'Amount must be at least $0.50 USD', 
          code: 'amount_too_small' 
        } 
      });
    }

    // Create or retrieve Stripe Customer (required for PaymentSheet with saved methods)
    let customerId: string | undefined;
    let ephemeralKeySecret: string | undefined;

    if (customerEmail) {
      // Check if customer already exists
      const customers = await stripe.customers.list({
        email: customerEmail,
        limit: 1
      });

      if (customers.data.length > 0) {
        customerId = customers.data[0].id;
      } else {
        // Create new customer
        const customer = await stripe.customers.create({
          email: customerEmail,
          name: customerName,
          metadata: { userId }
        });
        customerId = customer.id;
      }

      // Generate ephemeral key for PaymentSheet
      const ephemeralKey = await stripe.ephemeralKeys.create(
        { customer: customerId },
        { apiVersion: '2024-11-20.acacia' as any }
      );
      ephemeralKeySecret = ephemeralKey.secret;
    }

    // Create PaymentIntent
    const paymentIntentParams: Stripe.PaymentIntentCreateParams = {
      amount: totalChargeCents,
      currency: 'usd',
      description: description || `YardLine Event Tickets - ${eventId}`,
      metadata: {
        user_id: userId,
        event_id: eventId,
        items_json: JSON.stringify(itemsWithFees),
        ticket_subtotal_cents: String(ticketSubtotalCents),
        platform_fee_total_cents: String(platformFeeTotalCents),
        total_charge_cents: String(totalChargeCents),
        review_mode: String(REVIEW_MODE)
      },
      automatic_payment_methods: { 
        enabled: true,
        allow_redirects: 'never' // Important for in-app payment sheet
      }
    };

    // Add customer if provided
    if (customerId) {
      paymentIntentParams.customer = customerId;
    }

    // Configure Connect transfer if selling on behalf of connected account
    if (connectedAccountId) {
      paymentIntentParams.transfer_data = { 
        destination: connectedAccountId 
      };
      paymentIntentParams.application_fee_amount = platformFeeTotalCents;
      paymentIntentParams.metadata!.connected_account = connectedAccountId;
    }

    // Create payment intent with auto-generated idempotency key
    const idempotencyKey = `payment_${userId}_${eventId}_${Date.now()}`;
    const paymentIntent = await stripe.paymentIntents.create(
      paymentIntentParams, 
      { idempotencyKey }
    );

    // Return PaymentSheet-compatible response
    res.json({ 
      success: true, 
      data: {
        paymentIntentClientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        customerId,
        ephemeralKey: ephemeralKeySecret,
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
        amount: totalChargeCents,
        currency: 'usd',
        ticketSubtotalCents,
        platformFeeTotalCents,
        itemsWithFees,
        mode: getStripeMode(),
        reviewMode: REVIEW_MODE
      }
    });
  } catch (error) {
    console.error('Error creating payment intent:', error);
    res.status(500).json({ 
      success: false, 
      error: { 
        type: 'api_error', 
        message: error instanceof Error ? error.message : 'Failed to create payment intent' 
      } 
    });
  }
});

// Legacy endpoint - kept for backward compatibility but calculates fees server-side now
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

app.listen(PORT, () => {
  console.log(`YardLine API running on port ${PORT}`);
});
