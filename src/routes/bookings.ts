// YardLine Booking System - API Endpoints (Database-backed)
// Replace the booking endpoints section in index.ts with these implementations

// ============================================================================
// BOOKING SYSTEM ENDPOINTS (DATABASE-BACKED)
// ============================================================================

import { Router } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { v4 as uuidv4 } from 'uuid';
import * as db from './db';
import { authenticateUser } from './middleware/auth';

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
      const services = await db.listServices(supabase, providerId as string | undefined);
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
        requestedDate,
        requestedTime,
        customerEmail,
        customerName
      } = req.body;

      const customerId = req.user!.id;

      // Validate required fields
      if (!serviceId || !requestedDate || !requestedTime) {
        return res.status(400).json({
          success: false,
          error: { type: 'invalid_request_error', message: 'Missing required fields: serviceId, requestedDate, requestedTime' }
        });
      }

      // Validate service exists and is active
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

      // Validate date/time is in the future
      const requestedDateTime = new Date(`${requestedDate}T${requestedTime}:00`);
      if (requestedDateTime <= new Date()) {
        return res.status(400).json({
          success: false,
          error: { type: 'invalid_request_error', message: 'Requested time must be in the future' }
        });
      }

      // Calculate server-side pricing (Model A)
      const servicePriceCents = service.price_cents;
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

      // Get provider's connected account ID
      const providerAccountId = await getOrCreateStripeAccountId(
        service.provider_id,
        `provider-${service.provider_id}@yardline.app`,
        `Provider ${service.provider_id}`
      );

      // Create PaymentIntent with capture_method="manual"
      const paymentIntentParams: Stripe.PaymentIntentCreateParams = {
        amount: totalChargeCents,
        currency: 'usd',
        capture_method: 'manual',
        description: `YardLine Booking - ${service.name}`,
        metadata: {
          booking_id: bookingId,
          customer_id: customerId,
          provider_id: service.provider_id,
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
        },
        transfer_data: {
          destination: providerAccountId
        },
        application_fee_amount: servicePriceCents
      };

      if (stripeCustomerId) {
        paymentIntentParams.customer = stripeCustomerId;
      }

      // Create and confirm payment intent
      const idempotencyKey = `booking_${customerId}_${serviceId}_${Date.now()}`;
      const paymentIntent = await stripe.paymentIntents.create(paymentIntentParams, { idempotencyKey });
      
      const confirmedPaymentIntent = await stripe.paymentIntents.confirm(paymentIntent.id, {
        return_url: 'https://yardline.app/bookings/return'
      });

      // Create booking in database
      const booking = await db.createBooking(supabase, {
        bookingId,
        customerId,
        providerId: service.provider_id,
        serviceId,
        serviceName: service.name,
        requestedDate,
        requestedTime,
        paymentIntentId: paymentIntent.id,
        amountTotal: totalChargeCents,
        servicePriceCents,
        platformFeeCents
      });

      console.log(`✅ Created booking ${bookingId} with payment authorization (PaymentIntent: ${paymentIntent.id})`);

      res.json({
        success: true,
        data: {
          booking,
          paymentIntentClientSecret: confirmedPaymentIntent.client_secret,
          requiresAction: confirmedPaymentIntent.status === 'requires_action'
        }
      });
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
      const { customerId, providerId, status } = req.query;
      const userId = req.user!.id;

      // User can only view their own bookings
      const filters: any = { status: status as string | undefined };
      
      if (customerId && customerId === userId) {
        filters.customerId = customerId as string;
      } else if (providerId && providerId === userId) {
        filters.providerId = providerId as string;
      } else {
        // Default to showing user's bookings as customer
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
      try {
        const captureIdempotencyKey = `capture_${id}`;
        const capturedPaymentIntent = await stripe.paymentIntents.capture(
          booking.payment_intent_id!,
          {},
          { idempotencyKey: captureIdempotencyKey }
        );

        console.log(`✅ Booking ${id} accepted and payment captured`);

        res.json({
          success: true,
          data: {
            booking: result.booking,
            paymentIntentStatus: capturedPaymentIntent.status
          }
        });
      } catch (stripeError: any) {
        console.error('Error capturing payment:', stripeError);

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
        try {
          await stripe.paymentIntents.cancel(booking.payment_intent_id);
        } catch (stripeError) {
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

  return router;
}
