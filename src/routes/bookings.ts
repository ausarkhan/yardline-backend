// YardLine Booking System - API Endpoints (Database-backed)
// Replace the booking endpoints section in index.ts with these implementations

// ============================================================================
// BOOKING SYSTEM ENDPOINTS (DATABASE-BACKED)
// ============================================================================

import { Router } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { v4 as uuidv4 } from 'uuid';
import * as db from '../db';
import { authenticateUser } from '../middleware/auth';

export function createBookingRoutes(
  supabase: SupabaseClient,
  stripe: Stripe,
  calculateBookingPlatformFee: (priceCents: number) => number,
  getOrCreateStripeAccountId: (userId: string, email: string, name: string) => Promise<string>,
  REVIEW_MODE: boolean,
  REVIEW_MODE_MAX_CHARGE_CENTS: number
) {
  const router = Router();

  // POST /v1/services - Create a service (provider only)
  router.post('/services', authenticateUser(supabase), async (req, res) => {
    try {
      const { name, description, priceCents, duration } = req.body;
      const providerId = req.user!.id;

      if (!name || typeof priceCents !== 'number' || typeof duration !== 'number') {
        return res.status(400).json({
          success: false,
          error: { type: 'invalid_request_error', message: 'Missing required fields: name, priceCents, duration' }
        });
      }

      const service = await db.createService(supabase, providerId, name, description || '', priceCents, duration);

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
  router.get('/services/:serviceId', async (req, res) => {
    try {
      const { serviceId } = req.params;
      const service = await db.getService(supabase, serviceId);

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
  router.get('/services', async (req, res) => {
    try {
      const { providerId } = req.query;
      const providerIdStr = typeof providerId === 'string' ? providerId : undefined;
      const services = await db.listServices(supabase, providerIdStr);
      res.json({ success: true, data: services });
    } catch (error) {
      console.error('Error listing services:', error);
      res.status(500).json({
        success: false,
        error: { type: 'api_error', message: error instanceof Error ? error.message : 'Failed to list services' }
      });
    }
  });

  // POST /v1/bookings - Create booking request with payment authorization (customer)
  router.post('/bookings', authenticateUser(supabase), async (req, res) => {
    try {
      const {
        serviceId,
        date, // YYYY-MM-DD
        timeStart, // HH:MM:SS or HH:MM
        timeEnd, // HH:MM:SS or HH:MM (optional if service selected)
        customerEmail,
        customerName
      } = req.body;

      const customerId = req.user!.id;

      // Validate required fields
      if (!date || !timeStart) {
        return res.status(400).json({
          success: false,
          error: { type: 'invalid_request_error', message: 'Missing required fields: date, timeStart' }
        });
      }

      let providerId: string;
      let servicePriceCents: number;
      let calculatedTimeEnd: string;

      // If service is selected, get service details and calculate end time
      if (serviceId) {
        const service = await db.getService(supabase, serviceId);
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

        providerId = service.provider_id;
        servicePriceCents = service.price_cents;

        // Calculate end time from service duration if not provided
        if (timeEnd) {
          calculatedTimeEnd = timeEnd;
        } else {
          // Parse time and add duration
          const [hours, minutes] = timeStart.split(':').map(Number);
          const startMinutes = hours * 60 + minutes;
          const endMinutes = startMinutes + service.duration;
          const endHours = Math.floor(endMinutes / 60);
          const endMins = endMinutes % 60;
          calculatedTimeEnd = `${String(endHours).padStart(2, '0')}:${String(endMins).padStart(2, '0')}:00`;
        }
      } else {
        // For custom bookings without service, require providerId, timeEnd, and priceCents
        const { providerId: customProviderId, priceCents } = req.body;
        if (!customProviderId || !timeEnd || typeof priceCents !== 'number') {
          return res.status(400).json({
            success: false,
            error: { type: 'invalid_request_error', message: 'For custom bookings: providerId, timeEnd, and priceCents are required' }
          });
        }
        providerId = customProviderId;
        servicePriceCents = priceCents;
        calculatedTimeEnd = timeEnd;
      }

      // Validate time_end > time_start
      if (timeStart >= calculatedTimeEnd) {
        return res.status(400).json({
          success: false,
          error: { type: 'invalid_request_error', message: 'End time must be after start time' }
        });
      }

      // Validate date/time is in the future
      const requestedDateTime = new Date(`${date}T${timeStart}`);
      if (requestedDateTime <= new Date()) {
        return res.status(400).json({
          success: false,
          error: { type: 'invalid_request_error', message: 'Requested time must be in the future' }
        });
      }

      // Check for booking conflicts BEFORE creating payment
      const hasConflict = await db.checkBookingConflict(
        supabase,
        providerId,
        date,
        timeStart,
        calculatedTimeEnd
      );

      if (hasConflict) {
        return res.status(409).json({
          success: false,
          error: {
            type: 'booking_conflict',
            message: 'Time slot already booked'
          }
        });
      }

      // Calculate server-side pricing with platform fee formula
      // platformFee = max(99, min(round(0.08 * price_after_discount), 1299))
      const platformFeeCents = Math.max(99, Math.min(Math.round(0.08 * servicePriceCents), 1299));
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

      // Validate amount > 0 (production safety)
      if (totalChargeCents <= 0) {
        console.error(`❌ Invalid total charge: ${totalChargeCents} cents`);
        return res.status(400).json({
          error: 'Total charge must be greater than 0',
          code: 'invalid_amount'
        });
      }

      // Create or retrieve Stripe Customer
      console.log(`Looking up or creating Stripe customer for email: ${customerEmail}`);
      let stripeCustomerId: string | undefined;
      if (customerEmail) {
        try {
          const customers = await stripe.customers.list({
            email: customerEmail,
            limit: 1
          });

          if (customers.data.length > 0) {
            stripeCustomerId = customers.data[0].id;
            console.log(`✅ Found existing Stripe customer: ${stripeCustomerId}`);
          } else {
            const customer = await stripe.customers.create({
              email: customerEmail,
              name: customerName,
              metadata: { customerId }
            });
            stripeCustomerId = customer.id;
            console.log(`✅ Created new Stripe customer: ${stripeCustomerId}`);
          }
        } catch (stripeError: any) {
          console.error(`❌ Failed to create/retrieve Stripe customer:`, {
            error: stripeError.message,
            code: stripeError.code
          });
          throw stripeError;
        }
      }

      // Get provider's connected account ID
      const providerAccountId = await getOrCreateStripeAccountId(
        providerId,
        `provider-${providerId}@yardline.app`,
        `Provider ${providerId}`
      );

      // Create PaymentIntent with capture_method="manual"
      console.log(`Creating PaymentIntent: amount=${totalChargeCents} cents, provider=${providerAccountId}`);
      const paymentIntentParams: Stripe.PaymentIntentCreateParams = {
        amount: totalChargeCents,
        currency: 'usd', // Enforce USD only
        capture_method: 'manual',
        description: `YardLine Booking - ${date} ${timeStart}`,
        metadata: {
          customer_id: customerId,
          provider_id: providerId,
          service_id: serviceId || 'custom',
          service_price_cents: String(servicePriceCents),
          platform_fee_cents: String(platformFeeCents),
          total_charge_cents: String(totalChargeCents),
          date: date,
          time_start: timeStart,
          time_end: calculatedTimeEnd,
          pricing_model: 'model_a',
          review_mode: String(REVIEW_MODE)
        },
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: 'never'
        },
        transfer_data: {
          destination: providerAccountId
        },
        application_fee_amount: platformFeeCents
      };

      if (stripeCustomerId) {
        paymentIntentParams.customer = stripeCustomerId;
      }

      // Create and confirm payment intent
      const idempotencyKey = `booking_${customerId}_${date}_${timeStart}_${Date.now()}`;
      let paymentIntent: Stripe.PaymentIntent;
      let confirmedPaymentIntent: Stripe.PaymentIntent;
      
      try {
        paymentIntent = await stripe.paymentIntents.create(paymentIntentParams, { idempotencyKey });
        console.log(`✅ PaymentIntent created: ${paymentIntent.id}, status=${paymentIntent.status}`);

        // Production safety: always return client_secret
        if (!paymentIntent.client_secret) {
          console.error(`❌ PaymentIntent ${paymentIntent.id} missing client_secret`);
          throw new Error('PaymentIntent created but client_secret is missing');
        }

        confirmedPaymentIntent = await stripe.paymentIntents.confirm(paymentIntent.id, {
          return_url: 'https://yardline.app/bookings/return'
        });
        console.log(`✅ PaymentIntent confirmed: ${confirmedPaymentIntent.id}, status=${confirmedPaymentIntent.status}`);
      } catch (stripeError: any) {
        // Log and rethrow Stripe API errors
        console.error(`❌ Stripe PaymentIntent creation/confirmation failed:`, {
          error: stripeError.message,
          code: stripeError.code,
          type: stripeError.type,
          amount: totalChargeCents
        });
        throw stripeError;
      }

      // Create booking in database
      try {
        const booking = await db.createBooking(supabase, {
          customerId,
          providerId,
          serviceId: serviceId || null,
          date,
          timeStart,
          timeEnd: calculatedTimeEnd,
          paymentIntentId: paymentIntent.id,
          amountTotal: totalChargeCents,
          servicePriceCents,
          platformFeeCents
        });

        console.log(`✅ Created booking ${booking.id} with payment authorization (PaymentIntent: ${paymentIntent.id})`);

        res.json({
          success: true,
          data: {
            booking,
            paymentIntentClientSecret: confirmedPaymentIntent.client_secret,
            requiresAction: confirmedPaymentIntent.status === 'requires_action'
          }
        });
      } catch (dbError: any) {
        // Handle conflict from database constraint
        if (dbError.code === 'BOOKING_CONFLICT' || dbError.statusCode === 409) {
          // Cancel the payment intent since we can't create the booking
          console.log(`Canceling PaymentIntent ${paymentIntent.id} due to booking conflict`);
          try {
            await stripe.paymentIntents.cancel(paymentIntent.id);
            console.log(`✅ PaymentIntent ${paymentIntent.id} canceled successfully`);
          } catch (stripeError: any) {
            console.error(`❌ Error canceling PaymentIntent ${paymentIntent.id}:`, {
              error: stripeError.message,
              code: stripeError.code
            });
          }
          
          return res.status(409).json({
            success: false,
            error: {
              type: 'booking_conflict',
              message: 'Time slot already booked'
            }
          });
        }
        throw dbError;
      }
    } catch (error: any) {
      console.error('Error creating booking:', error);
      res.status(500).json({
        success: false,
        error: { type: 'api_error', message: error.message || 'Failed to create booking' }
      });
    }
  });

  // GET /v1/bookings/:id - Get booking details
  router.get('/bookings/:id', authenticateUser(supabase), async (req, res) => {
    try {
      const { id } = req.params;
      const booking = await db.getBooking(supabase, id);

      if (!booking) {
        return res.status(404).json({
          success: false,
          error: { type: 'resource_missing', message: 'Booking not found' }
        });
      }

      // Verify user has access (customer or provider)
      if (booking.customer_id !== req.user!.id && booking.provider_id !== req.user!.id) {
        return res.status(403).json({
          success: false,
          error: { type: 'permission_denied', message: 'You do not have permission to view this booking' }
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

  // GET /v1/bookings - List bookings
  router.get('/bookings', authenticateUser(supabase), async (req, res) => {
    try {
      const { role, status } = req.query;
      const userId = req.user!.id;

      // User specifies role: 'customer' or 'provider'
      const filters: {
        customerId?: string;
        providerId?: string;
        status?: string;
      } = {};

      if (status && typeof status === 'string') {
        filters.status = status;
      }
      
      if (role === 'customer') {
        filters.customerId = userId;
      } else if (role === 'provider') {
        filters.providerId = userId;
      } else {
        // Default to customer bookings if no role specified
        filters.customerId = userId;
      }

      const bookings = await db.listBookings(supabase, filters);
      res.json({ success: true, data: bookings });
    } catch (error) {
      console.error('Error listing bookings:', error);
      res.status(500).json({
        success: false,
        error: { type: 'api_error', message: error instanceof Error ? error.message : 'Failed to list bookings' }
      });
    }
  });

  // POST /v1/bookings/:id/accept - Provider accepts booking
  router.post('/bookings/:id/accept', authenticateUser(supabase), async (req, res) => {
    try {
      const { id } = req.params;
      const providerId = req.user!.id;

      const booking = await db.getBooking(supabase, id);
      if (!booking) {
        return res.status(404).json({
          success: false,
          error: { type: 'resource_missing', message: 'Booking not found' }
        });
      }

      // Verify provider owns this booking
      if (booking.provider_id !== providerId) {
        return res.status(403).json({
          success: false,
          error: { type: 'permission_denied', message: 'You do not have permission to accept this booking' }
        });
      }

      // Use transaction-based accept with conflict check
      const result = await db.acceptBookingTransaction(supabase, id);

      if (!result.success) {
        if (result.conflict) {
          return res.status(409).json({
            success: false,
            error: {
              type: 'booking_conflict',
              message: 'You have a conflicting booking at this time. Please decline this request.'
            }
          });
        }
        return res.status(400).json({
          success: false,
          error: {
            type: 'invalid_state',
            message: result.error || 'Cannot accept booking'
          }
        });
      }

      // Capture the PaymentIntent
      console.log(`Capturing payment for booking ${id}, PaymentIntent: ${booking.payment_intent_id}`);
      try {
        const captureIdempotencyKey = `capture_${id}`;
        const capturedPaymentIntent = await stripe.paymentIntents.capture(
          booking.payment_intent_id!,
          {},
          { idempotencyKey: captureIdempotencyKey }
        );

        console.log(`✅ Booking ${id} accepted and payment captured: ${capturedPaymentIntent.id}, status=${capturedPaymentIntent.status}`);

        res.json({
          success: true,
          data: {
            booking: result.booking,
            paymentIntentStatus: capturedPaymentIntent.status
          }
        });
      } catch (stripeError: any) {
        console.error(`❌ Error capturing payment for booking ${id}:`, {
          error: stripeError.message,
          code: stripeError.code,
          type: stripeError.type,
          paymentIntent: booking.payment_intent_id
        });

        // Handle authorization expiry
        if (stripeError.code === 'charge_expired_for_capture') {
          await db.updateBookingStatus(supabase, id, 'expired', 'failed');

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
        await db.updateBookingPaymentStatus(supabase, id, 'failed');

        return res.status(400).json({
          success: false,
          error: {
            type: 'payment_error',
            message: stripeError.message || 'Failed to capture payment',
            code: stripeError.code
          }
        });
      }
    } catch (error: any) {
      console.error('Error accepting booking:', error);
      res.status(500).json({
        success: false,
        error: { type: 'api_error', message: error.message || 'Failed to accept booking' }
      });
    }
  });

  // POST /v1/bookings/:id/decline - Provider declines booking
  router.post('/bookings/:id/decline', authenticateUser(supabase), async (req, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const providerId = req.user!.id;

      const booking = await db.getBooking(supabase, id);
      if (!booking) {
        return res.status(404).json({
          success: false,
          error: { type: 'resource_missing', message: 'Booking not found' }
        });
      }

      // Verify provider owns this booking
      if (booking.provider_id !== providerId) {
        return res.status(403).json({
          success: false,
          error: { type: 'permission_denied', message: 'You do not have permission to decline this booking' }
        });
      }

      // Enforce idempotency
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
        console.log(`Canceling PaymentIntent ${booking.payment_intent_id} for declined booking ${id}`);
        try {
          await stripe.paymentIntents.cancel(booking.payment_intent_id);
          console.log(`✅ PaymentIntent ${booking.payment_intent_id} canceled successfully`);
        } catch (stripeError: any) {
          console.error(`❌ Error canceling PaymentIntent ${booking.payment_intent_id}:`, {
            error: stripeError.message,
            code: stripeError.code
          });
          console.error('Error canceling payment intent:', stripeError);
        }
      }

      // Update booking status
      const updatedBooking = await db.updateBookingStatus(supabase, id, 'declined', 'canceled', reason);

      console.log(`✅ Booking ${id} declined by provider`);

      res.json({ success: true, data: { booking: updatedBooking } });
    } catch (error) {
      console.error('Error declining booking:', error);
      res.status(500).json({
        success: false,
        error: { type: 'api_error', message: error instanceof Error ? error.message : 'Failed to decline booking' }
      });
    }
  });

  // POST /v1/bookings/:id/cancel - Customer cancels booking
  router.post('/bookings/:id/cancel', authenticateUser(supabase), async (req, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const customerId = req.user!.id;

      const booking = await db.getBooking(supabase, id);
      if (!booking) {
        return res.status(404).json({
          success: false,
          error: { type: 'resource_missing', message: 'Booking not found' }
        });
      }

      // Verify customer owns this booking
      if (booking.customer_id !== customerId) {
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
          } catch (stripeError) {
            console.error('Error canceling payment intent:', stripeError);
          }
        }

        const updatedBooking = await db.updateBookingStatus(supabase, id, 'cancelled', 'canceled', reason);

        console.log(`✅ Booking ${id} cancelled by customer`);

        res.json({ success: true, data: { booking: updatedBooking } });
      } else if (booking.status === 'confirmed') {
        // V1: Disallow cancellation after confirmation
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

  // POST /v1/bookings/checkout-session - Create Stripe Checkout Session for existing booking
  router.post('/bookings/checkout-session', authenticateUser(supabase), async (req, res) => {
    try {
      const { bookingId } = req.body;
      const userId = req.user!.id;

      // Validate bookingId
      if (!bookingId) {
        return res.status(400).json({
          success: false,
          error: { type: 'invalid_request_error', message: 'Missing required field: bookingId' }
        });
      }

      // Load booking from database
      const booking = await db.getBooking(supabase, bookingId);
      if (!booking) {
        return res.status(404).json({
          success: false,
          error: { type: 'resource_missing', message: 'Booking not found' }
        });
      }

      // Authorization: verify user owns this booking (as customer)
      if (booking.customer_id !== userId) {
        return res.status(403).json({
          success: false,
          error: { type: 'permission_denied', message: 'You do not have permission to pay for this booking' }
        });
      }

      // Validate booking is payable
      if (booking.status === 'cancelled' || booking.status === 'declined') {
        return res.status(400).json({
          success: false,
          error: {
            type: 'invalid_state',
            message: `Cannot create checkout session for ${booking.status} booking`,
            currentStatus: booking.status
          }
        });
      }

      // Check if already paid via checkout session
      if (booking.stripe_checkout_session_id) {
        return res.status(400).json({
          success: false,
          error: {
            type: 'already_paid',
            message: 'Booking already has a checkout session',
            sessionId: booking.stripe_checkout_session_id
          }
        });
      }

      // Calculate amount server-side (do not accept from client)
      const totalChargeCents = booking.amount_total || 0;

      // Validate amount
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

      // Get service details for description
      let serviceName = 'Service';
      if (booking.service_id) {
        const service = await db.getService(supabase, booking.service_id);
        if (service) {
          serviceName = service.name;
        }
      }

      // Get APP_URL_SCHEME from environment (default to 'yardline')
      // Production uses 'yardline://', dev/preview uses 'vibecode://'
      const APP_URL_SCHEME = process.env.APP_URL_SCHEME || 'yardline';

      // Create Stripe Checkout Session
      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        mode: 'payment',
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: `YardLine Booking: ${serviceName}`,
                description: `${booking.date} at ${booking.time_start}`,
              },
              unit_amount: totalChargeCents,
            },
            quantity: 1,
          },
        ],
        metadata: {
          bookingId: booking.id,
          type: 'booking',
          customerId: booking.customer_id,
          providerId: booking.provider_id,
          serviceId: booking.service_id || '',
          date: booking.date,
          timeStart: booking.time_start,
          mode: 'live'
        },
        success_url: `${APP_URL_SCHEME}://payment-success?type=booking&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${APP_URL_SCHEME}://payment-cancel?type=booking&bookingId=${booking.id}`,
      };

      // If provider has connected account, configure transfer
      if (booking.provider_id) {
        try {
          const providerAccountId = await getOrCreateStripeAccountId(
            booking.provider_id,
            `provider-${booking.provider_id}@yardline.app`,
            `Provider ${booking.provider_id}`
          );

          // Configure Connect transfer (Model A: provider gets service price)
          sessionParams.payment_intent_data = {
            transfer_data: {
              destination: providerAccountId
            },
            application_fee_amount: booking.service_price_cents || 0,
            metadata: sessionParams.metadata
          };
        } catch (connectError) {
          console.error('Error setting up Connect transfer for booking checkout:', connectError);
          // Continue without Connect transfer - payment will still work
        }
      }

      // Create session with idempotency
      const idempotencyKey = `checkout_booking_${bookingId}_${Date.now()}`;
      const session = await stripe.checkout.sessions.create(sessionParams, { idempotencyKey });

      console.log(`✅ Created Checkout Session ${session.id} for booking ${bookingId}`);
      console.log(`   Amount: $${(totalChargeCents / 100).toFixed(2)}, Service: ${serviceName}`);

      res.json({
        success: true,
        data: {
          url: session.url,
          sessionId: session.id
        }
      });
    } catch (error: any) {
      console.error('Error creating checkout session for booking:', error);
      res.status(500).json({
        success: false,
        error: { type: 'api_error', message: error.message || 'Failed to create checkout session' }
      });
    }
  });

  return router;
}
