import express from 'express';
import cors from 'cors';
import Stripe from 'stripe';
import { v4 as uuidv4 } from 'uuid';
import { createClient } from '@supabase/supabase-js';
import * as db from './db';
import { authenticateUser, optionalAuth } from './middleware/auth';
import { createBookingRoutes } from './routes/bookings';
import { createBookingV1Routes } from './routes/bookings-v1';

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase configuration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured');
}

// Initialize Supabase client with service role key (bypasses RLS for admin operations)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// ============================================================================
// STRIPE LIVE-ONLY CONFIGURATION (PRODUCTION SAFETY)
// ============================================================================
// This backend enforces LIVE Stripe only. No test keys, no fallbacks.
// If misconfigured, the server will crash on startup with a clear error.
// ============================================================================

const STRIPE_LIVE_SECRET_KEY = process.env.STRIPE_LIVE_SECRET_KEY;
const STRIPE_LIVE_WEBHOOK_SECRET = process.env.STRIPE_LIVE_WEBHOOK_SECRET;

// Validate and get Stripe LIVE secret key - fail fast if misconfigured
function getStripeLiveSecretKey(): string {
  const key = STRIPE_LIVE_SECRET_KEY;
  
  if (!key) {
    console.error('❌ FATAL: STRIPE_LIVE_SECRET_KEY is not configured');
    console.error('❌ PRODUCTION REQUIRES: STRIPE_LIVE_SECRET_KEY=sk_live_...');
    throw new Error('STRIPE_LIVE_SECRET_KEY is required for production. Server cannot start.');
  }
  
  // Validate key prefix to ensure it's a LIVE key
  if (!key.startsWith('sk_live_')) {
    console.error('❌ FATAL: STRIPE_LIVE_SECRET_KEY must start with sk_live_');
    console.error(`❌ CURRENT KEY PREFIX: ${key.substring(0, 8)}...`);
    console.error('❌ REFUSING TO START WITH NON-LIVE STRIPE KEY');
    throw new Error('Invalid Stripe key: must be a LIVE key (sk_live_). Server cannot start.');
  }
  
  console.log('✅ Stripe LIVE mode validated: key prefix verified');
  return key;
}

// Get webhook secret (optional but recommended)
function getWebhookSecret(): string | undefined {
  if (STRIPE_LIVE_WEBHOOK_SECRET) {
    console.log('✅ Stripe webhook secret configured');
  } else {
    console.warn('⚠️  WARNING: STRIPE_LIVE_WEBHOOK_SECRET not configured - webhook signature validation disabled');
  }
  return STRIPE_LIVE_WEBHOOK_SECRET;
}

// Initialize Stripe with LIVE key only - fail fast on error
let stripe: Stripe;
try {
  const liveKey = getStripeLiveSecretKey();
  stripe = new Stripe(liveKey, {
    apiVersion: '2024-11-20.acacia' as any,
  });
  console.log('✅ Stripe client initialized in LIVE mode');
} catch (error) {
  console.error('❌ FATAL: Failed to initialize Stripe client');
  console.error('❌ ERROR:', error instanceof Error ? error.message : String(error));
  throw error; // Crash the server - do not continue with misconfigured Stripe
}

// Review-safe mode - prevents real charges during App Store review
const REVIEW_MODE = process.env.REVIEW_MODE === 'true';
const REVIEW_MODE_MAX_CHARGE_CENTS = 100; // $1.00 max in review mode

// ============================================================================
// MODEL A PRICING: Buyer Pays All Fees
// ============================================================================
// Host receives 100% of ticket price
// Buyer pays: $0.99 YardLine fee + Stripe processing fees (2.9% + $0.30)
// Formula ensures YardLine nets exactly $0.99 after Stripe takes their cut
// ============================================================================
function calculateBuyerFeePerTicket(ticketPriceCents: number): number {
  // Model A formula: buyerFee = (99 + 0.029 * ticketPrice + 30) / (1 - 0.029)
  // This ensures YardLine nets $0.99 after Stripe takes 2.9% + $0.30
  const buyerFeeCents = Math.ceil(
    (99 + 0.029 * ticketPriceCents + 30) / (1 - 0.029)
  );
  return buyerFeeCents;
}

// Validation function to verify Model A pricing math
function validateModelAPricing(ticketPriceCents: number, buyerFeeCents: number): {
  isValid: boolean;
  yardlineRevenue: number;
  hostPayout: number;
  buyerTotal: number;
  stripeFeesApprox: number;
  details: string;
} {
  const totalChargeCents = ticketPriceCents + buyerFeeCents;
  
  // Stripe takes 2.9% + $0.30 from the total charge
  const stripeFeesCents = Math.round(totalChargeCents * 0.029 + 30);
  
  // In Connect with destination charge:
  // - Host receives ticketPriceCents (the application_fee_amount goes to host)
  // - YardLine receives buyerFeeCents - stripeFeesCents
  const yardlineRevenueCents = buyerFeeCents - stripeFeesCents;
  
  // Validate YardLine gets $0.99 (allow 1 cent tolerance for rounding)
  const isValid = Math.abs(yardlineRevenueCents - 99) <= 1;
  
  return {
    isValid,
    yardlineRevenue: yardlineRevenueCents,
    hostPayout: ticketPriceCents,
    buyerTotal: totalChargeCents,
    stripeFeesApprox: stripeFeesCents,
    details: `Ticket: $${(ticketPriceCents/100).toFixed(2)}, Buyer Fee: $${(buyerFeeCents/100).toFixed(2)}, Total: $${(totalChargeCents/100).toFixed(2)}, YardLine Net: $${(yardlineRevenueCents/100).toFixed(2)}, Host Gets: $${(ticketPriceCents/100).toFixed(2)}`
  };
}

// ============================================================================
// BOOKING SYSTEM HELPERS
// ============================================================================

// Calculate platform fee for bookings with Stripe processing fee gross-up
// This implements the Safe V1 two-step payment fee calculation
function calcPlatformFeeCents(pCents: number): number {
  // Get Stripe fee configuration from environment (with defaults)
  const stripeFeePercent = parseFloat(process.env.STRIPE_FEE_PERCENT || '0.029');
  const stripeFeeFixedCents = parseInt(process.env.STRIPE_FEE_FIXED_CENTS || '30', 10);
  
  // Base platform fee: min $0.99, max $12.99, 8% of service price
  const baseFeeCents = Math.max(99, Math.min(Math.round(0.08 * pCents), 1299));
  
  // Gross up to cover Stripe processing fees
  // Formula: platformFee = ceil((baseFee + stripePct * price + stripeFixed) / (1 - stripePct))
  const platformFeeCents = Math.ceil(
    (baseFeeCents + stripeFeePercent * pCents + stripeFeeFixedCents) / (1 - stripeFeePercent)
  );
  
  return platformFeeCents;
}

// Legacy function kept for backward compatibility
function calculateBookingPlatformFee(servicePriceCents: number): number {
  return calcPlatformFeeCents(servicePriceCents);
}

// Database-backed conflict checking is now handled in db.ts
// This function is kept for backward compatibility but delegates to database
async function hasConflictingBooking(providerId: string, date: string, timeStart: string, timeEnd: string, excludeBookingId?: string): Promise<boolean> {
  return await db.checkBookingConflict(supabase, providerId, date, timeStart, timeEnd, excludeBookingId);
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

// Booking system types for service requests
type BookingStatus = 'pending' | 'confirmed' | 'declined' | 'cancelled' | 'expired';
type PaymentStatus = 'none' | 'authorized' | 'captured' | 'canceled' | 'failed';

interface Booking {
  bookingId: string;
  customerId: string;
  providerId: string;
  serviceId: string;
  serviceName: string;
  requestedDate: string; // ISO 8601 date string
  requestedTime: string; // Time slot (e.g., "14:00")
  status: BookingStatus;
  payment_status: PaymentStatus;
  payment_intent_id: string | null;
  amount_total: number; // Amount in cents for audit trail
  service_price_cents: number;
  platform_fee_cents: number;
  decline_reason?: string;
  created_at: string;
  updated_at: string;
}

interface Service {
  serviceId: string;
  providerId: string;
  name: string;
  description: string;
  priceCents: number;
  duration: number; // Duration in minutes
  active: boolean;
}

// Keep in-memory storage for Connect accounts and tickets (these can be migrated to DB later)
const connectAccounts: Map<string, ConnectAccount> = new Map();
const tickets: Map<string, Ticket[]> = new Map();
const processedPaymentIntents: Set<string> = new Set(); // Idempotency tracking for webhook processing
const processedWebhookEvents: Set<string> = new Set(); // Track processed webhook event IDs for idempotency

// Note: Bookings and Services are now stored in Supabase database, not in-memory

// User records structure to track Stripe account IDs (LIVE only)
interface UserStripeAccounts {
  userId: string;
  liveStripeAccountId?: string;
}

const userStripeAccounts: Map<string, UserStripeAccounts> = new Map();

// Helper function to get or create Stripe Connect account (LIVE mode only)
async function getOrCreateStripeAccountId(userId: string, email: string, name: string): Promise<string> {
  // Get or initialize user's Stripe account
  let userAccounts = userStripeAccounts.get(userId);
  if (!userAccounts) {
    userAccounts = { userId };
    userStripeAccounts.set(userId, userAccounts);
  }

  // Check if we already have a LIVE account ID
  if (userAccounts.liveStripeAccountId) {
    return userAccounts.liveStripeAccountId;
  }

  // Create a new Stripe Express account in LIVE mode
  console.log(`Creating Stripe Connect account for user ${userId} (LIVE mode)`);
  try {
    const account = await stripe.accounts.create({
      type: 'express',
      email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_profile: { name },
    });

    // Store the LIVE account ID
    userAccounts.liveStripeAccountId = account.id;
    userStripeAccounts.set(userId, userAccounts);
    
    console.log(`✅ Created Stripe Connect account: ${account.id} for user ${userId}`);
    return account.id;
  } catch (error) {
    console.error(`❌ Failed to create Stripe Connect account for user ${userId}:`, error);
    throw error;
  }
}

// Handler function for checkout session completed webhook events
async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  console.log(`Processing checkout session: ${session.id}`);
  console.log(`Payment status: ${session.payment_status}`);
  
  // CRITICAL: Only process if payment is confirmed
  if (session.payment_status !== 'paid') {
    console.log(`⚠️  Checkout session ${session.id} not paid yet (status: ${session.payment_status}), skipping`);
    return;
  }

  // Idempotency check - prevent duplicate processing
  const sessionIdempotencyKey = `checkout_${session.id}`;
  if (processedPaymentIntents.has(sessionIdempotencyKey)) {
    console.log(`Checkout session ${session.id} already processed, skipping`);
    return;
  }

  // Check if this is a booking checkout session
  const sessionMetadata = session.metadata || {};
  if (sessionMetadata.type === 'booking') {
    console.log(`🛒 Processing booking checkout session: ${session.id}`);
    await handleBookingCheckoutSessionCompleted(session);
    // Mark as processed
    processedPaymentIntents.add(sessionIdempotencyKey);
    return;
  }

  // Otherwise, process as ticket purchase (existing logic)
  console.log(`🎟️  Processing ticket checkout session: ${session.id}`);
  
  // Get the PaymentIntent to access metadata
  const paymentIntentId = session.payment_intent as string;
  if (!paymentIntentId) {
    console.error(`No payment intent found for checkout session ${session.id}`);
    return;
  }

  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    const metadata = paymentIntent.metadata;
    const itemsJson = metadata.items_json;
    
    if (!itemsJson) {
      console.error(`No items_json in metadata for payment intent ${paymentIntentId}`);
      return;
    }
    
    const items = JSON.parse(itemsJson) as Array<{ 
      ticketTypeId: string; 
      ticketTypeName: string; 
      priceCents: number; 
      quantity: number; 
      buyerFeeCents?: number;
      buyerFeePerTicket?: number;
      platformFeeCents?: number;
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
          feesCents: item.buyerFeePerTicket || item.platformFeePerTicket || Math.round((item.buyerFeeCents || item.platformFeeCents || 0) / item.quantity),
          paymentIntentId: paymentIntentId,
          status: 'confirmed',
          createdAt: new Date().toISOString(),
        };
        createdTickets.push(ticket);
      }
    }
    
    // Store tickets with both checkout session ID and payment intent ID
    tickets.set(paymentIntentId, createdTickets);
    tickets.set(session.id, createdTickets);
    
    // Mark as processed for idempotency
    processedPaymentIntents.add(sessionIdempotencyKey);
    processedPaymentIntents.add(paymentIntentId);
    
    console.log(`✅ Created ${createdTickets.length} tickets for checkout session ${session.id}`);
  } catch (error) {
    console.error('Error creating tickets from checkout session:', error);
  }
}

// Handler function for booking checkout session completed
async function handleBookingCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  const metadata = session.metadata || {};
  const bookingId = metadata.bookingId;

  if (!bookingId) {
    console.error(`No bookingId in metadata for checkout session ${session.id}`);
    return;
  }

  // Idempotency check
  const eventKey = `booking_checkout_${session.id}`;
  if (processedWebhookEvents.has(eventKey)) {
    console.log(`Booking checkout session ${session.id} already processed, skipping`);
    return;
  }

  try {
    // Load booking
    const booking = await db.getBooking(supabase, bookingId);
    if (!booking) {
      console.error(`Booking ${bookingId} not found for checkout session ${session.id}`);
      return;
    }

    // Check if already paid
    if (booking.stripe_checkout_session_id === session.id) {
      console.log(`Booking ${bookingId} already marked paid with session ${session.id}`);
      processedWebhookEvents.add(eventKey);
      return;
    }

    // Get payment intent ID
    const paymentIntentId = session.payment_intent as string;

    // Update booking to paid status
    const { error: updateError } = await supabase
      .from('bookings')
      .update({
        status: 'confirmed',
        payment_status: 'captured',
        stripe_checkout_session_id: session.id,
        payment_intent_id: paymentIntentId || booking.payment_intent_id,
        updated_at: new Date().toISOString()
      })
      .eq('id', bookingId);

    if (updateError) {
      console.error(`Failed to update booking ${bookingId}:`, updateError);
      throw updateError;
    }

    console.log(`✅ Booking ${bookingId} marked as paid via checkout session ${session.id}`);
    console.log(`   Payment Intent: ${paymentIntentId}, Amount: $${((session.amount_total || 0) / 100).toFixed(2)}`);

    // Mark as processed
    processedWebhookEvents.add(eventKey);
  } catch (error) {
    console.error(`Error processing booking checkout session ${session.id}:`, error);
    throw error; // Let webhook handler retry
  }
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
      buyerFeeCents?: number;
      buyerFeePerTicket?: number;
      // Legacy field names
      platformFeeCents?: number;
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
          feesCents: item.buyerFeePerTicket || item.platformFeePerTicket || Math.round((item.buyerFeeCents || item.platformFeeCents || 0) / item.quantity),
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

// Handler function for booking payment events
async function handleBookingPaymentEvent(paymentIntent: Stripe.PaymentIntent) {
  // Check if this payment intent is associated with a booking
  const bookingId = paymentIntent.metadata.booking_id;
  if (!bookingId) {
    // Not a booking payment, skip
    return;
  }

  // Idempotency check using event-specific tracking
  const eventKey = `booking_payment_${paymentIntent.id}_${paymentIntent.status}`;
  if (processedWebhookEvents.has(eventKey)) {
    console.log(`Booking payment event ${eventKey} already processed, skipping`);
    return;
  }

  try {
    const booking = await db.getBooking(supabase, bookingId);
    if (!booking) {
      console.error(`Booking ${bookingId} not found for payment intent ${paymentIntent.id}`);
      return;
    }

    // Update booking payment status based on payment intent status
    let newPaymentStatus: db.DBBooking['payment_status'] | null = null;
    let newStatus: db.DBBooking['status'] | null = null;

    switch (paymentIntent.status) {
      case 'requires_capture':
        // Payment authorized successfully
        if (booking.payment_status !== 'authorized') {
          newPaymentStatus = 'authorized';
          console.log(`✅ Booking ${bookingId} payment authorized (webhook)`);
        }
        break;

      case 'succeeded':
        // Payment captured successfully
        if (booking.payment_status !== 'captured') {
          newPaymentStatus = 'captured';
          if (booking.status === 'pending') {
            newStatus = 'confirmed';
          }
          console.log(`✅ Booking ${bookingId} payment captured (webhook)`);
        }
        break;

      case 'canceled':
        // Payment canceled
        if (booking.payment_status !== 'canceled') {
          newPaymentStatus = 'canceled';
          if (booking.status === 'pending') {
            newStatus = 'cancelled';
          }
          console.log(`✅ Booking ${bookingId} payment canceled (webhook)`);
        }
        break;

      case 'requires_payment_method':
      case 'processing':
        // Payment in progress or requires action
        console.log(`ℹ️  Booking ${bookingId} payment status: ${paymentIntent.status}`);
        break;

      default:
        console.log(`⚠️  Unhandled payment intent status for booking ${bookingId}: ${paymentIntent.status}`);
    }

    // Update database if status changed
    if (newPaymentStatus || newStatus) {
      await db.updateBookingStatus(
        supabase,
        bookingId,
        newStatus || booking.status,
        newPaymentStatus || booking.payment_status
      );
    }

    // Mark event as processed
    processedWebhookEvents.add(eventKey);
  } catch (error) {
    console.error(`Error processing booking payment event for ${bookingId}:`, error);
    throw error; // Let webhook handler retry
  }
}

// Handler function for payment failure events (bookings)
async function handleBookingPaymentFailed(paymentIntent: Stripe.PaymentIntent) {
  const bookingId = paymentIntent.metadata.booking_id;
  if (!bookingId) {
    // Not a booking payment, skip
    return;
  }

  // Idempotency check
  const eventKey = `booking_payment_failed_${paymentIntent.id}`;
  if (processedWebhookEvents.has(eventKey)) {
    console.log(`Booking payment failed event ${eventKey} already processed, skipping`);
    return;
  }

  try {
    const booking = await db.getBooking(supabase, bookingId);
    if (!booking) {
      console.error(`Booking ${bookingId} not found for failed payment ${paymentIntent.id}`);
      return;
    }

    // Update booking to reflect payment failure
    const newStatus = booking.status === 'pending' ? 'cancelled' : booking.status;
    await db.updateBookingStatus(supabase, bookingId, newStatus, 'failed');

    console.log(`❌ Booking ${bookingId} payment failed (webhook)`);

    // Mark event as processed
    processedWebhookEvents.add(eventKey);
  } catch (error) {
    console.error(`Error processing booking payment failure for ${bookingId}:`, error);
    throw error; // Let webhook handler retry
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
      console.log('Mode: LIVE');
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
        case 'checkout.session.completed':
          const session = event.data.object as Stripe.Checkout.Session;
          console.log(`🛒 Checkout session completed: ${session.id}`);
          await handleCheckoutSessionCompleted(session);
          break;

        case 'payment_intent.succeeded':
          const paymentIntent = event.data.object as Stripe.PaymentIntent;
          console.log(`💰 Payment succeeded: ${paymentIntent.id} - Amount: ${paymentIntent.amount}`);
          // Handle both ticket purchases and bookings
          await handlePaymentSucceeded(paymentIntent);
          await handleBookingPaymentEvent(paymentIntent);
          break;

        case 'payment_intent.canceled':
          const canceledPayment = event.data.object as Stripe.PaymentIntent;
          console.log(`🚫 Payment canceled: ${canceledPayment.id}`);
          await handleBookingPaymentEvent(canceledPayment);
          break;

        case 'payment_intent.payment_failed':
          const failedPayment = event.data.object as Stripe.PaymentIntent;
          console.log(`❌ Payment failed: ${failedPayment.id}`);
          await handleBookingPaymentFailed(failedPayment);
          break;

        case 'payment_intent.requires_action':
          const requiresActionPayment = event.data.object as Stripe.PaymentIntent;
          console.log(`🔐 Payment requires action: ${requiresActionPayment.id}`);
          await handleBookingPaymentEvent(requiresActionPayment);
          break;

        case 'checkout.session.async_payment_succeeded':
          const asyncSuccessSession = event.data.object as Stripe.Checkout.Session;
          console.log(`✅ Async payment succeeded for session: ${asyncSuccessSession.id}`);
          // Process same as completed (payment is now confirmed)
          if (asyncSuccessSession.metadata?.type === 'booking') {
            await handleBookingCheckoutSessionCompleted(asyncSuccessSession);
          } else {
            await handleCheckoutSessionCompleted(asyncSuccessSession);
          }
          break;

        case 'checkout.session.async_payment_failed':
          const asyncFailedSession = event.data.object as Stripe.Checkout.Session;
          console.log(`❌ Async payment failed for session: ${asyncFailedSession.id}`);
          // Mark booking as payment failed if it's a booking session
          if (asyncFailedSession.metadata?.type === 'booking' && asyncFailedSession.metadata?.bookingId) {
            const failedBookingId = asyncFailedSession.metadata.bookingId;
            try {
              await supabase
                .from('bookings')
                .update({
                  payment_status: 'failed',
                  updated_at: new Date().toISOString()
                })
                .eq('id', failedBookingId);
              console.log(`Marked booking ${failedBookingId} payment as failed`);
            } catch (error) {
              console.error(`Error marking booking ${failedBookingId} as failed:`, error);
            }
          }
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

// ============================================================================
// PAYMENT INTENT HELPER
// ============================================================================
async function createPaymentIntent(params: {
  amount: number;
  currency?: string;
  metadata?: Record<string, string>;
}): Promise<{ clientSecret: string }> {
  const { amount, currency = 'usd', metadata = {} } = params;

  const paymentIntent = await stripe.paymentIntents.create({
    amount,
    currency,
    metadata,
    automatic_payment_methods: { enabled: true },
  });

  return { clientSecret: paymentIntent.client_secret! };
}

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'yardline-api', version: '1.0.0' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.post('/v1/stripe/payment-intent', async (req, res) => {
  try {
    console.log('💳 PaymentIntent endpoint hit');

    const { amount, currency = 'usd', metadata } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const result = await createPaymentIntent({
      amount,
      currency,
      metadata,
    });

    return res.json({
      clientSecret: result.clientSecret,
    });
  } catch (err: any) {
    console.error('❌ PaymentIntent error:', err.message);
    return res.status(500).json({ error: 'Payment initialization failed' });
  }
});

app.get('/v1/stripe/mode', (req, res) => {
  res.json({ 
    success: true, 
    data: { 
      mode: 'live',
      isTestMode: false,
      isLiveMode: true,
      reviewMode: REVIEW_MODE,
      reviewModeMaxChargeCents: REVIEW_MODE ? REVIEW_MODE_MAX_CHARGE_CENTS : null,
      webhookConfigured: !!getWebhookSecret(),
      message: 'Production backend is configured for LIVE Stripe only'
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
    
    const accountData: ConnectAccount = {
      accountId,
      email,
      name,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      status: 'pending',
      createdAt: new Date().toISOString(),
      liveStripeAccountId: accountId
    };
    
    connectAccounts.set(accountId, accountData);
    res.json({ success: true, data: { accountId, onboardingUrl: accountLink.url } });
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
      createdAt: account.created ? new Date(account.created * 1000).toISOString() : new Date().toISOString(),
      liveStripeAccountId: accountId
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

// POST /v1/checkout/create-session - Create Stripe Checkout Session with Model A pricing
// This endpoint uses Checkout Sessions for a hosted payment experience
app.post('/v1/checkout/create-session', async (req, res) => {
  try {
    const { 
      userId, 
      eventId, 
      eventName,
      items, // Array of { ticketTypeId, ticketTypeName, priceCents, quantity }
      connectedAccountId
    } = req.body;

    // Validate required fields
    if (!userId || !eventId || !items || !Array.isArray(items) || items.length === 0 || !connectedAccountId) {
      return res.status(400).json({ 
        success: false, 
        error: { 
          type: 'invalid_request_error', 
          message: 'Missing required fields: userId, eventId, items, and connectedAccountId are required' 
        } 
      });
    }

    // Calculate totals server-side using Model A pricing
    let ticketSubtotalCents = 0;
    let buyerFeeTotalCents = 0;

    const itemsWithFees = items.map((item: any) => {
      const { ticketTypeId, ticketTypeName, priceCents, quantity } = item;
      
      if (!ticketTypeId || !ticketTypeName || typeof priceCents !== 'number' || typeof quantity !== 'number') {
        throw new Error('Invalid item format');
      }

      // Calculate buyer fee per ticket (covers YardLine $0.99 + Stripe fees)
      const buyerFeePerTicket = calculateBuyerFeePerTicket(priceCents);
      const buyerFeeCents = buyerFeePerTicket * quantity;

      // Validate the pricing model for each ticket
      const validation = validateModelAPricing(priceCents, buyerFeePerTicket);
      if (!validation.isValid) {
        console.warn(`⚠️  Model A validation warning: ${validation.details}`);
      } else {
        console.log(`✅ Model A validated: ${validation.details}`);
      }

      ticketSubtotalCents += priceCents * quantity;
      buyerFeeTotalCents += buyerFeeCents;

      return {
        ticketTypeId,
        ticketTypeName,
        priceCents,
        quantity,
        buyerFeeCents,
        buyerFeePerTicket
      };
    });

    const totalChargeCents = ticketSubtotalCents + buyerFeeTotalCents;

    // Review mode guardrail
    if (REVIEW_MODE && totalChargeCents > REVIEW_MODE_MAX_CHARGE_CENTS) {
      return res.status(400).json({
        success: false,
        error: {
          type: 'review_mode_error',
          message: `Review mode is enabled. Maximum charge is $${REVIEW_MODE_MAX_CHARGE_CENTS / 100}`,
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

    // Create line items for Checkout
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
    
    // Add ticket line items
    for (const item of itemsWithFees) {
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: item.ticketTypeName,
            description: `${eventName || 'Event'} - ${item.ticketTypeName}`,
          },
          unit_amount: item.priceCents,
        },
        quantity: item.quantity,
      });
    }

    // Add service & processing fee as a single line item
    lineItems.push({
      price_data: {
        currency: 'usd',
        product_data: {
          name: 'Service & processing fee',
          description: 'Covers platform services and payment processing',
        },
        unit_amount: buyerFeeTotalCents,
      },
      quantity: 1,
    });

    // Get APP_URL_SCHEME from environment (default to 'yardline')
    // Production uses 'yardline://', dev/preview uses 'vibecode://'
    const APP_URL_SCHEME = process.env.APP_URL_SCHEME || 'yardline';

    // Create Checkout Session with Model A pricing structure
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      success_url: `${APP_URL_SCHEME}://payment-success?type=ticket&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL_SCHEME}://payment-cancel?type=ticket&eventId=${eventId}`,
      payment_intent_data: {
        application_fee_amount: 99, // YardLine nets exactly $0.99 per ticket (in cents)
        transfer_data: {
          destination: connectedAccountId, // Host receives ticket price
        },
        metadata: {
          user_id: userId,
          event_id: eventId,
          pricing_model: 'model_a',
          ticket_subtotal_cents: String(ticketSubtotalCents),
          buyer_fee_total_cents: String(buyerFeeTotalCents),
          total_charge_cents: String(totalChargeCents),
          items_json: JSON.stringify(itemsWithFees),
          review_mode: String(REVIEW_MODE)
        },
      },
      metadata: {
        type: 'ticket',
        user_id: userId,
        event_id: eventId,
        pricing_model: 'model_a',
      },
    });

    console.log(`✅ Created Checkout Session ${session.id} for event ${eventId}`);
    console.log(`   Total: $${(totalChargeCents / 100).toFixed(2)}, Ticket: $${(ticketSubtotalCents / 100).toFixed(2)}, Fee: $${(buyerFeeTotalCents / 100).toFixed(2)}`);

    res.json({ 
      success: true, 
      data: {
        url: session.url,
        sessionId: session.id,
        ticketSubtotalCents,
        buyerFeeTotalCents,
        totalChargeCents,
        mode: 'live',
        pricingModel: 'model_a'
      }
    });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    res.status(500).json({ 
      success: false, 
      error: { 
        type: 'api_error', 
        message: error instanceof Error ? error.message : 'Failed to create checkout session' 
      } 
    });
  }
});

// GET /v1/checkout/session/:sessionId - Retrieve and verify Checkout Session
// Used after checkout success to verify payment and retrieve order details
app.get('/v1/checkout/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    // Retrieve the checkout session
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['payment_intent', 'line_items'],
    });

    // Get tickets if they've been created
    const sessionTickets = tickets.get(sessionId) || [];
    const paymentIntentId = session.payment_intent as string;
    const paymentIntentTickets = paymentIntentId ? tickets.get(paymentIntentId) || [] : [];
    const allTickets = [...sessionTickets, ...paymentIntentTickets];

    res.json({
      success: true,
      data: {
        sessionId: session.id,
        paymentStatus: session.payment_status,
        paymentIntentId: paymentIntentId,
        customerEmail: session.customer_details?.email,
        amountTotal: session.amount_total,
        currency: session.currency,
        metadata: session.metadata,
        tickets: allTickets,
        ticketsCreated: allTickets.length > 0,
        mode: 'live'
      }
    });
  } catch (error) {
    console.error('Error retrieving checkout session:', error);
    res.status(500).json({ 
      success: false, 
      error: { 
        type: 'api_error', 
        message: error instanceof Error ? error.message : 'Failed to retrieve checkout session' 
      } 
    });
  }
});

// POST /v1/checkout/session - Alias for create-session endpoint
// Frontend calls this instead of /v1/checkout/create-session
app.post('/v1/checkout/session', async (req, res) => {
  try {
    const { 
      userId, 
      eventId, 
      eventName,
      items, // Array of { ticketTypeId, ticketTypeName, priceCents, quantity }
      connectedAccountId
    } = req.body;

    // Validate required fields
    if (!userId || !eventId || !items || !Array.isArray(items) || items.length === 0 || !connectedAccountId) {
      return res.status(400).json({ 
        success: false, 
        error: { 
          type: 'invalid_request_error', 
          message: 'Missing required fields: userId, eventId, items, and connectedAccountId are required' 
        } 
      });
    }

    // Calculate totals server-side using Model A pricing
    let ticketSubtotalCents = 0;
    let buyerFeeTotalCents = 0;

    const itemsWithFees = items.map((item: any) => {
      const { ticketTypeId, ticketTypeName, priceCents, quantity } = item;
      
      if (!ticketTypeId || !ticketTypeName || typeof priceCents !== 'number' || typeof quantity !== 'number') {
        throw new Error('Invalid item format');
      }

      // Calculate buyer fee per ticket (covers YardLine $0.99 + Stripe fees)
      const buyerFeePerTicket = calculateBuyerFeePerTicket(priceCents);
      const buyerFeeCents = buyerFeePerTicket * quantity;

      // Validate the pricing model for each ticket
      const validation = validateModelAPricing(priceCents, buyerFeePerTicket);
      if (!validation.isValid) {
        console.warn(`⚠️  Model A validation warning: ${validation.details}`);
      } else {
        console.log(`✅ Model A validated: ${validation.details}`);
      }

      ticketSubtotalCents += priceCents * quantity;
      buyerFeeTotalCents += buyerFeeCents;

      return {
        ticketTypeId,
        ticketTypeName,
        priceCents,
        quantity,
        buyerFeeCents,
        buyerFeePerTicket
      };
    });

    const totalChargeCents = ticketSubtotalCents + buyerFeeTotalCents;

    // Review mode guardrail
    if (REVIEW_MODE && totalChargeCents > REVIEW_MODE_MAX_CHARGE_CENTS) {
      return res.status(400).json({
        success: false,
        error: {
          type: 'review_mode_error',
          message: `Review mode is enabled. Maximum charge is $${REVIEW_MODE_MAX_CHARGE_CENTS / 100}`,
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

    // Create line items for Checkout
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
    
    // Add ticket line items
    for (const item of itemsWithFees) {
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: item.ticketTypeName,
            description: `${eventName || 'Event'} - ${item.ticketTypeName}`,
          },
          unit_amount: item.priceCents,
        },
        quantity: item.quantity,
      });
    }

    // Add service & processing fee as a single line item
    lineItems.push({
      price_data: {
        currency: 'usd',
        product_data: {
          name: 'Service & processing fee',
          description: 'Covers platform services and payment processing',
        },
        unit_amount: buyerFeeTotalCents,
      },
      quantity: 1,
    });

    // Get APP_URL_SCHEME from environment (default to 'yardline')
    // Production uses 'yardline://', dev/preview uses 'vibecode://'
    const APP_URL_SCHEME = process.env.APP_URL_SCHEME || 'yardline';

    // Create Checkout Session with Model A pricing structure
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      success_url: `${APP_URL_SCHEME}://payment-success?type=ticket&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL_SCHEME}://payment-cancel?type=ticket&eventId=${eventId}`,
      payment_intent_data: {
        application_fee_amount: 99, // YardLine nets exactly $0.99 per ticket (in cents)
        transfer_data: {
          destination: connectedAccountId, // Host receives ticket price
        },
        metadata: {
          user_id: userId,
          event_id: eventId,
          pricing_model: 'model_a',
          ticket_subtotal_cents: String(ticketSubtotalCents),
          buyer_fee_total_cents: String(buyerFeeTotalCents),
          total_charge_cents: String(totalChargeCents),
          items_json: JSON.stringify(itemsWithFees),
          review_mode: String(REVIEW_MODE)
        },
      },
      metadata: {
        type: 'ticket',
        user_id: userId,
        event_id: eventId,
        pricing_model: 'model_a',
      },
    });

    console.log(`✅ Created Checkout Session ${session.id} for event ${eventId} (via /v1/checkout/session)`);
    console.log(`   Total: $${(totalChargeCents / 100).toFixed(2)}, Ticket: $${(ticketSubtotalCents / 100).toFixed(2)}, Fee: $${(buyerFeeTotalCents / 100).toFixed(2)}`);

    res.json({ 
      success: true, 
      data: {
        url: session.url,
        sessionId: session.id,
        ticketSubtotalCents,
        buyerFeeTotalCents,
        totalChargeCents,
        mode: 'live',
        pricingModel: 'model_a'
      }
    });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    res.status(500).json({ 
      success: false, 
      error: { 
        type: 'api_error', 
        message: error instanceof Error ? error.message : 'Failed to create checkout session' 
      } 
    });
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

    // Calculate totals server-side using Model A pricing
    let ticketSubtotalCents = 0;
    let buyerFeeTotalCents = 0;

    const itemsWithFees = items.map((item: any) => {
      const { ticketTypeId, ticketTypeName, priceCents, quantity } = item;
      
      if (!ticketTypeId || !ticketTypeName || typeof priceCents !== 'number' || typeof quantity !== 'number') {
        throw new Error('Invalid item format');
      }

      // Calculate buyer fee per ticket (covers YardLine $0.99 + Stripe fees)
      const buyerFeePerTicket = calculateBuyerFeePerTicket(priceCents);
      const buyerFeeCents = buyerFeePerTicket * quantity;

      // Validate the pricing model for each ticket
      const validation = validateModelAPricing(priceCents, buyerFeePerTicket);
      if (!validation.isValid) {
        console.warn(`⚠️  Model A validation warning: ${validation.details}`);
      } else {
        console.log(`✅ Model A validated: ${validation.details}`);
      }

      ticketSubtotalCents += priceCents * quantity;
      buyerFeeTotalCents += buyerFeeCents;

      return {
        ticketTypeId,
        ticketTypeName,
        priceCents,
        quantity,
        buyerFeeCents,
        buyerFeePerTicket,
        // Legacy field names for backward compatibility
        platformFeeCents: buyerFeeCents,
        platformFeePerTicket: buyerFeePerTicket
      };
    });

    const totalChargeCents = ticketSubtotalCents + buyerFeeTotalCents;

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

    // Create PaymentIntent with Model A structure
    const paymentIntentParams: Stripe.PaymentIntentCreateParams = {
      amount: totalChargeCents, // Buyer pays: ticket price + buyer fee
      currency: 'usd',
      description: description || `YardLine Event Tickets - ${eventId}`,
      metadata: {
        user_id: userId,
        event_id: eventId,
        items_json: JSON.stringify(itemsWithFees),
        ticket_subtotal_cents: String(ticketSubtotalCents),
        buyer_fee_total_cents: String(buyerFeeTotalCents),
        // Legacy field names for compatibility
        platform_fee_total_cents: String(buyerFeeTotalCents),
        total_charge_cents: String(totalChargeCents),
        pricing_model: 'model_a',
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
    // MODEL A: application_fee_amount = ticketSubtotal (host receives 100% of ticket price)
    // Buyer fee covers Stripe fees + YardLine revenue
    if (connectedAccountId) {
      paymentIntentParams.transfer_data = { 
        destination: connectedAccountId 
      };
      // Host receives the full ticket price (this is transferred to their account)
      paymentIntentParams.application_fee_amount = ticketSubtotalCents;
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
        buyerFeeTotalCents,
        // Legacy field names for backward compatibility
        platformFeeTotalCents: buyerFeeTotalCents,
        serviceAndProcessingFeeCents: buyerFeeTotalCents,
        itemsWithFees,
        mode: 'live',
        reviewMode: REVIEW_MODE,
        pricingModel: 'model_a'
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

// Unified payment intent endpoint - handles both simple and complex formats
app.post('/v1/stripe/payment-intents', async (req, res) => {
  try {
    console.log("💳 HIT /v1/stripe/payment-intents", req.body);
    
    const { 
      amount, 
      currency, 
      description, 
      metadata,
      // Legacy format fields
      connectedAccountId, 
      items, 
      ticketSubtotalCents, 
      platformFeeTotalCents, 
      buyerFeeTotalCents, 
      totalChargeCents, 
      idempotencyKey 
    } = req.body;

    // Determine if this is simple or complex format
    const isSimpleFormat = amount !== undefined && totalChargeCents === undefined;
    
    if (isSimpleFormat) {
      // Simple format: { amount, currency?, description?, metadata? }
      
      // Validate amount is an integer in cents and > 0
      if (!amount || typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
        console.error('❌ Invalid amount:', amount);
        return res.status(400).json({ 
          error: 'Invalid amount - must be an integer in cents greater than 0' 
        });
      }

      const paymentIntentParams: Stripe.PaymentIntentCreateParams = {
        amount,
        currency: currency || 'usd',
        description: description || 'YardLine Payment',
        metadata: metadata || {},
        automatic_payment_methods: { enabled: true },
      };

      const paymentIntent = await stripe.paymentIntents.create(paymentIntentParams);
      
      console.log(`✅ PI created: ${paymentIntent.id}`);
      
      return res.json({
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        status: paymentIntent.status,
      });
    } else {
      // Legacy complex format for booking system
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
      
      // Use buyerFeeTotalCents if provided, otherwise fall back to platformFeeTotalCents
      const feeTotalCents = buyerFeeTotalCents || platformFeeTotalCents;
      
      const paymentIntentParams: Stripe.PaymentIntentCreateParams = {
        amount: totalChargeCents,
        currency: 'usd',
        description: description || 'YardLine Ticket Purchase',
        metadata: { 
          ...metadata, 
          items_json: JSON.stringify(items), 
          ticket_subtotal_cents: String(ticketSubtotalCents), 
          buyer_fee_total_cents: String(feeTotalCents),
          platform_fee_total_cents: String(feeTotalCents),
          total_charge_cents: String(totalChargeCents),
          pricing_model: 'model_a'
        },
        automatic_payment_methods: { enabled: true },
      };
      
      if (connectedAccountId) {
        paymentIntentParams.transfer_data = { destination: connectedAccountId };
        paymentIntentParams.application_fee_amount = ticketSubtotalCents;
        paymentIntentParams.metadata!.connected_account = connectedAccountId;
      }
      
      const paymentIntent = await stripe.paymentIntents.create(
        paymentIntentParams, 
        idempotencyKey ? { idempotencyKey } : undefined
      );
      
      console.log(`✅ PI created: ${paymentIntent.id}`);
      
      return res.json({ 
        success: true, 
        data: { 
          paymentIntentId: paymentIntent.id, 
          clientSecret: paymentIntent.client_secret, 
          amount: paymentIntent.amount, 
          currency: paymentIntent.currency, 
          status: paymentIntent.status 
        } 
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Payment initialization failed';
    console.error('❌ Stripe PaymentIntent error:', errorMessage);
    
    return res.status(500).json({ 
      error: 'Payment initialization failed'
    });
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

app.get('/v1/tickets/by-session/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const sessionTickets = tickets.get(sessionId) || [];
  res.json({ success: true, data: sessionTickets });
});

// ============================================================================
// OLD IN-MEMORY SERVICE ENDPOINTS (DEPRECATED - COMMENTED OUT)
// These have been replaced by database-backed routes in bookingRouter
// ============================================================================
/*
// POST /v1/services - Create a service (provider only)
app.post('/v1/services', (req, res) => {
  try {
    const { providerId, name, description, priceCents, duration } = req.body;

    if (!providerId || !name || typeof priceCents !== 'number' || typeof duration !== 'number') {
      return res.status(400).json({
        success: false,
        error: { type: 'invalid_request_error', message: 'Missing required fields: providerId, name, priceCents, duration' }
      });
    }

    const serviceId = uuidv4();
    const service: Service = {
      serviceId,
      providerId,
      name,
      description: description || '',
      priceCents,
      duration,
      active: true
    };

    services.set(serviceId, service);

    res.json({ success: true, data: service });
  } catch (error) {
    console.error('Error creating service:', error);
    res.status(500).json({
      success: false,
      error: { type: 'api_error', message: error instanceof Error ? error.message : 'Failed to create service' }
    });
  }
});

// GET /v1/services/:serviceId - Get service details
app.get('/v1/services/:serviceId', (req, res) => {
  try {
    const { serviceId } = req.params;
    const service = services.get(serviceId);

    if (!service) {
      return res.status(404).json({
        success: false,
        error: { type: 'resource_missing', message: 'Service not found' }
      });
    }

    res.json({ success: true, data: service });
  } catch (error) {
    console.error('Error retrieving service:', error);
    res.status(500).json({
      success: false,
      error: { type: 'api_error', message: error instanceof Error ? error.message : 'Failed to retrieve service' }
    });
  }
});

// GET /v1/services - List services by provider
app.get('/v1/services', (req, res) => {
  try {
    const { providerId } = req.query;

    let serviceList = Array.from(services.values());

    if (providerId) {
      serviceList = serviceList.filter(s => s.providerId === providerId);
    }

    res.json({ success: true, data: serviceList });
  } catch (error) {
    console.error('Error listing services:', error);
    res.status(500).json({
      success: false,
      error: { type: 'api_error', message: error instanceof Error ? error.message : 'Failed to list services' }
    });
  }
});
*/
// END OF OLD IN-MEMORY SERVICE ENDPOINTS

// ============================================================================
// BOOKING SYSTEM ENDPOINTS (DATABASE-BACKED)
// ============================================================================

// Mount the database-backed booking routes
const bookingRouter = createBookingRoutes(
  supabase,
  stripe,
  calculateBookingPlatformFee,
  getOrCreateStripeAccountId,
  REVIEW_MODE,
  REVIEW_MODE_MAX_CHARGE_CENTS
);
app.use('/v1', bookingRouter);

// Mount Safe V1 Two-Step Payment routes
const bookingV1Router = createBookingV1Routes(
  supabase,
  stripe,
  calcPlatformFeeCents
);
app.use('/v1/bookings', bookingV1Router);

// OLD IN-MEMORY BOOKING ENDPOINTS (DEPRECATED - COMMENTED OUT)
// The following endpoints have been replaced by database-backed routes above
/*
// POST /v1/bookings - Create booking request with payment authorization (customer)
app.post('/v1/bookings', async (req, res) => {
  try {
    const {
      customerId,
      serviceId,
      requestedDate,
      requestedTime,
      customerEmail,
      customerName
    } = req.body;

    // Validate required fields
    if (!customerId || !serviceId || !requestedDate || !requestedTime) {
      return res.status(400).json({
        success: false,
        error: { type: 'invalid_request_error', message: 'Missing required fields: customerId, serviceId, requestedDate, requestedTime' }
      });
    }

    // Validate service exists and is active
    const service = services.get(serviceId);
    if (!service) {
      return res.status(404).json({
        success: false,
        error: { type: 'resource_missing', message: 'Service not found' }
      });
    }

    if (!service.active) {
      return res.status(400).json({
        success: false,
        error: { type: 'invalid_request_error', message: 'Service is not available' }
      });
    }

    // Validate date/time is in the future
    const requestedDateTime = new Date(`${requestedDate}T${requestedTime}:00`);
    if (requestedDateTime <= new Date()) {
      return res.status(400).json({
        success: false,
        error: { type: 'invalid_request_error', message: 'Requested time must be in the future' }
      });
    }

    // Calculate server-side pricing (Model A)
    const servicePriceCents = service.priceCents;
    const platformFeeCents = calculateBookingPlatformFee(servicePriceCents);
    const totalChargeCents = servicePriceCents + platformFeeCents;

    // Minimum charge validation
    if (totalChargeCents < 50) {
      return res.status(400).json({
        success: false,
        error: { type: 'invalid_request_error', message: 'Amount must be at least $0.50 USD', code: 'amount_too_small' }
      });
    }

    // Review mode guardrail
    if (REVIEW_MODE && totalChargeCents > REVIEW_MODE_MAX_CHARGE_CENTS) {
      return res.status(400).json({
        success: false,
        error: {
          type: 'review_mode_error',
          message: `Review mode is enabled. Maximum charge is $${REVIEW_MODE_MAX_CHARGE_CENTS / 100}`,
          code: 'review_mode_limit_exceeded'
        }
      });
    }

    // Create booking ID
    const bookingId = uuidv4();

    // Create or retrieve Stripe Customer
    let stripeCustomerId: string | undefined;
    if (customerEmail) {
      const customers = await stripe.customers.list({
        email: customerEmail,
        limit: 1
      });

      if (customers.data.length > 0) {
        stripeCustomerId = customers.data[0].id;
      } else {
        const customer = await stripe.customers.create({
          email: customerEmail,
          name: customerName,
          metadata: { customerId }
        });
        stripeCustomerId = customer.id;
      }
    }

    // Create PaymentIntent with capture_method="manual" for authorization only
    const paymentIntentParams: Stripe.PaymentIntentCreateParams = {
      amount: totalChargeCents,
      currency: 'usd',
      capture_method: 'manual', // CRITICAL: Only authorize, don't capture until provider accepts
      description: `YardLine Booking - ${service.name}`,
      metadata: {
        booking_id: bookingId,
        customer_id: customerId,
        provider_id: service.providerId,
        service_id: serviceId,
        service_name: service.name,
        service_price_cents: String(servicePriceCents),
        platform_fee_cents: String(platformFeeCents),
        total_charge_cents: String(totalChargeCents),
        requested_date: requestedDate,
        requested_time: requestedTime,
        pricing_model: 'model_a',
        review_mode: String(REVIEW_MODE)
      },
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never'
      }
    };

    if (stripeCustomerId) {
      paymentIntentParams.customer = stripeCustomerId;
    }

    // Get provider's connected account ID for transfer configuration
    const providerAccountId = await getOrCreateStripeAccountId(
      service.providerId,
      `provider-${service.providerId}@yardline.app`,
      `Provider ${service.providerId}`
    );

    // Configure Stripe Connect transfer (Model A: provider gets service price)
    paymentIntentParams.transfer_data = {
      destination: providerAccountId
    };
    paymentIntentParams.application_fee_amount = servicePriceCents;
    paymentIntentParams.metadata!.connected_account = providerAccountId;

    // Create payment intent with idempotency
    const idempotencyKey = `booking_${customerId}_${serviceId}_${Date.now()}`;
    const paymentIntent = await stripe.paymentIntents.create(
      paymentIntentParams,
      { idempotencyKey }
    );

    // Confirm the payment intent to authorize (but not capture)
    const confirmedPaymentIntent = await stripe.paymentIntents.confirm(paymentIntent.id, {
      return_url: 'https://yardline.app/bookings/return' // Required for some payment methods
    });

    // Create booking record with pending status and authorized payment
    const now = new Date().toISOString();
    const booking: Booking = {
      bookingId,
      customerId,
      providerId: service.providerId,
      serviceId,
      serviceName: service.name,
      requestedDate,
      requestedTime,
      status: 'pending',
      payment_status: confirmedPaymentIntent.status === 'requires_capture' ? 'authorized' : 'none',
      payment_intent_id: paymentIntent.id,
      amount_total: totalChargeCents,
      service_price_cents: servicePriceCents,
      platform_fee_cents: platformFeeCents,
      created_at: now,
      updated_at: now
    };

    // Store booking
    bookings.set(bookingId, booking);

    // Index by provider and customer
    if (!providerBookings.has(service.providerId)) {
      providerBookings.set(service.providerId, new Set());
    }
    providerBookings.get(service.providerId)!.add(bookingId);

    if (!customerBookings.has(customerId)) {
      customerBookings.set(customerId, new Set());
    }
    customerBookings.get(customerId)!.add(bookingId);

    console.log(`✅ Created booking ${bookingId} with payment authorization (PaymentIntent: ${paymentIntent.id})`);
    console.log(`   Service: ${service.name}, Price: $${(servicePriceCents/100).toFixed(2)}, Fee: $${(platformFeeCents/100).toFixed(2)}, Total: $${(totalChargeCents/100).toFixed(2)}`);

    res.json({
      success: true,
      data: {
        booking,
        paymentIntentClientSecret: confirmedPaymentIntent.client_secret,
        requiresAction: confirmedPaymentIntent.status === 'requires_action',
        mode: 'live'
      }
    });
  } catch (error) {
    console.error('Error creating booking:', error);
    res.status(500).json({
      success: false,
      error: { type: 'api_error', message: error instanceof Error ? error.message : 'Failed to create booking' }
    });
  }
});

// GET /v1/bookings/:id - Get booking details
app.get('/v1/bookings/:id', (req, res) => {
  try {
    const { id } = req.params;
    const booking = bookings.get(id);

    if (!booking) {
      return res.status(404).json({
        success: false,
        error: { type: 'resource_missing', message: 'Booking not found' }
      });
    }

    res.json({ success: true, data: booking });
  } catch (error) {
    console.error('Error retrieving booking:', error);
    res.status(500).json({
      success: false,
      error: { type: 'api_error', message: error instanceof Error ? error.message : 'Failed to retrieve booking' }
    });
  }
});

// GET /v1/bookings - List bookings (by customer or provider)
app.get('/v1/bookings', (req, res) => {
  try {
    const { customerId, providerId, status } = req.query;

    let bookingIds: Set<string> | undefined;

    if (customerId) {
      bookingIds = customerBookings.get(customerId as string);
    } else if (providerId) {
      bookingIds = providerBookings.get(providerId as string);
    }

    if (!bookingIds) {
      return res.json({ success: true, data: [] });
    }

    let bookingList = Array.from(bookingIds).map(id => bookings.get(id)).filter(b => b !== undefined) as Booking[];

    // Filter by status if provided
    if (status) {
      bookingList = bookingList.filter(b => b.status === status);
    }

    // Sort by creation date (newest first)
    bookingList.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    res.json({ success: true, data: bookingList });
  } catch (error) {
    console.error('Error listing bookings:', error);
    res.status(500).json({
      success: false,
      error: { type: 'api_error', message: error instanceof Error ? error.message : 'Failed to list bookings' }
    });
  }
});

// POST /v1/bookings/:id/accept - Provider accepts booking and captures payment
app.post('/v1/bookings/:id/accept', async (req, res) => {
  try {
    const { id } = req.params;
    const { providerId } = req.body;

    if (!providerId) {
      return res.status(400).json({
        success: false,
        error: { type: 'invalid_request_error', message: 'Missing required field: providerId' }
      });
    }

    // Get booking
    const booking = bookings.get(id);
    if (!booking) {
      return res.status(404).json({
        success: false,
        error: { type: 'resource_missing', message: 'Booking not found' }
      });
    }

    // Verify provider owns this booking
    if (booking.providerId !== providerId) {
      return res.status(403).json({
        success: false,
        error: { type: 'permission_denied', message: 'You do not have permission to accept this booking' }
      });
    }

    // Enforce idempotency: only allow if status is pending
    if (booking.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: {
          type: 'invalid_state',
          message: `Cannot accept booking in ${booking.status} status`,
          currentStatus: booking.status
        }
      });
    }

    // Check for double booking conflicts
    const service = services.get(booking.serviceId);
    if (!service) {
      return res.status(404).json({
        success: false,
        error: { type: 'resource_missing', message: 'Service not found' }
      });
    }

    const hasConflict = hasConflictingBooking(
      booking.providerId,
      booking.requestedDate,
      booking.requestedTime,
      service.duration,
      booking.bookingId
    );

    if (hasConflict) {
      return res.status(409).json({
        success: false,
        error: {
          type: 'booking_conflict',
          message: 'You have a conflicting booking at this time. Please decline this request.'
        }
      });
    }

    // Capture the PaymentIntent
    if (!booking.payment_intent_id) {
      return res.status(400).json({
        success: false,
        error: { type: 'invalid_state', message: 'No payment intent associated with this booking' }
      });
    }

    try {
      // Use idempotency key to prevent double capture
      const captureIdempotencyKey = `capture_${booking.bookingId}`;
      const capturedPaymentIntent = await stripe.paymentIntents.capture(
        booking.payment_intent_id,
        {},
        { idempotencyKey: captureIdempotencyKey }
      );

      // Update booking status
      booking.status = 'confirmed';
      booking.payment_status = 'captured';
      booking.updated_at = new Date().toISOString();
      bookings.set(id, booking);

      console.log(`✅ Booking ${id} accepted and payment captured (PaymentIntent: ${booking.payment_intent_id})`);

      res.json({
        success: true,
        data: {
          booking,
          paymentIntentStatus: capturedPaymentIntent.status
        }
      });
    } catch (stripeError: any) {
      console.error('Error capturing payment:', stripeError);

      // Handle authorization expiry
      if (stripeError.code === 'charge_expired_for_capture') {
        booking.status = 'expired';
        booking.payment_status = 'failed';
        booking.updated_at = new Date().toISOString();
        bookings.set(id, booking);

        return res.status(400).json({
          success: false,
          error: {
            type: 'payment_expired',
            message: 'Payment authorization has expired. Customer must re-confirm payment.',
            code: 'charge_expired_for_capture'
          }
        });
      }

      // Other payment errors
      booking.payment_status = 'failed';
      booking.updated_at = new Date().toISOString();
      bookings.set(id, booking);

      return res.status(400).json({
        success: false,
        error: {
          type: 'payment_error',
          message: stripeError.message || 'Failed to capture payment',
          code: stripeError.code
        }
      });
    }
  } catch (error) {
    console.error('Error accepting booking:', error);
    res.status(500).json({
      success: false,
      error: { type: 'api_error', message: error instanceof Error ? error.message : 'Failed to accept booking' }
    });
  }
});

// POST /v1/bookings/:id/decline - Provider declines booking and cancels payment authorization
app.post('/v1/bookings/:id/decline', async (req, res) => {
  try {
    const { id } = req.params;
    const { providerId, reason } = req.body;

    if (!providerId) {
      return res.status(400).json({
        success: false,
        error: { type: 'invalid_request_error', message: 'Missing required field: providerId' }
      });
    }

    // Get booking
    const booking = bookings.get(id);
    if (!booking) {
      return res.status(404).json({
        success: false,
        error: { type: 'resource_missing', message: 'Booking not found' }
      });
    }

    // Verify provider owns this booking
    if (booking.providerId !== providerId) {
      return res.status(403).json({
        success: false,
        error: { type: 'permission_denied', message: 'You do not have permission to decline this booking' }
      });
    }

    // Enforce idempotency: only allow if status is pending
    if (booking.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: {
          type: 'invalid_state',
          message: `Cannot decline booking in ${booking.status} status`,
          currentStatus: booking.status
        }
      });
    }

    // Cancel the PaymentIntent
    if (booking.payment_intent_id) {
      try {
        await stripe.paymentIntents.cancel(booking.payment_intent_id);
        console.log(`✅ Canceled PaymentIntent ${booking.payment_intent_id} for booking ${id}`);
      } catch (stripeError) {
        console.error('Error canceling payment intent:', stripeError);
        // Continue with booking update even if cancel fails (might already be canceled)
      }
    }

    // Update booking status
    booking.status = 'declined';
    booking.payment_status = 'canceled';
    if (reason) {
      booking.decline_reason = reason;
    }
    booking.updated_at = new Date().toISOString();
    bookings.set(id, booking);

    console.log(`✅ Booking ${id} declined by provider`);

    res.json({
      success: true,
      data: { booking }
    });
  } catch (error) {
    console.error('Error declining booking:', error);
    res.status(500).json({
      success: false,
      error: { type: 'api_error', message: error instanceof Error ? error.message : 'Failed to decline booking' }
    });
  }
});

// POST /v1/bookings/:id/cancel - Customer cancels booking
app.post('/v1/bookings/:id/cancel', async (req, res) => {
  try {
    const { id } = req.params;
    const { customerId, reason } = req.body;

    if (!customerId) {
      return res.status(400).json({
        success: false,
        error: { type: 'invalid_request_error', message: 'Missing required field: customerId' }
      });
    }

    // Get booking
    const booking = bookings.get(id);
    if (!booking) {
      return res.status(404).json({
        success: false,
        error: { type: 'resource_missing', message: 'Booking not found' }
      });
    }

    // Verify customer owns this booking
    if (booking.customerId !== customerId) {
      return res.status(403).json({
        success: false,
        error: { type: 'permission_denied', message: 'You do not have permission to cancel this booking' }
      });
    }

    // Handle cancellation based on current status
    if (booking.status === 'pending') {
      // Cancel authorization
      if (booking.payment_intent_id) {
        try {
          await stripe.paymentIntents.cancel(booking.payment_intent_id);
          console.log(`✅ Canceled PaymentIntent ${booking.payment_intent_id} for booking ${id}`);
        } catch (stripeError) {
          console.error('Error canceling payment intent:', stripeError);
          // Continue with booking update even if cancel fails
        }
      }

      booking.status = 'cancelled';
      booking.payment_status = 'canceled';
      if (reason) {
        booking.decline_reason = reason;
      }
      booking.updated_at = new Date().toISOString();
      bookings.set(id, booking);

      console.log(`✅ Booking ${id} cancelled by customer`);

      res.json({
        success: true,
        data: { booking }
      });
    } else if (booking.status === 'confirmed') {
      // V1: Disallow cancellation after confirmation
      // V2: Could implement refund policy here
      return res.status(400).json({
        success: false,
        error: {
          type: 'invalid_state',
          message: 'Cannot cancel confirmed booking. Please contact the provider.',
          currentStatus: booking.status
        }
      });
    } else {
      return res.status(400).json({
        success: false,
        error: {
          type: 'invalid_state',
          message: `Cannot cancel booking in ${booking.status} status`,
          currentStatus: booking.status
        }
      });
    }
  } catch (error) {
    console.error('Error canceling booking:', error);
    res.status(500).json({
      success: false,
      error: { type: 'api_error', message: error instanceof Error ? error.message : 'Failed to cancel booking' }
    });
  }
});
*/
// END OF OLD IN-MEMORY BOOKING ENDPOINTS

app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('🚀 YardLine API Server Started');
  console.log('='.repeat(60));
  console.log(`📍 Port: ${PORT}`);
  console.log(`💳 Stripe Mode: LIVE ONLY (sk_live_***)`);
  console.log(`🔒 Production Safety: Enforced`);
  console.log(`🔔 Webhook: ${getWebhookSecret() ? 'Configured' : 'Not configured'}`);
  console.log(`📊 Review Mode: ${REVIEW_MODE ? 'ENABLED' : 'DISABLED'}`);
  console.log('='.repeat(60));
});
