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
import { resolveBookingServiceDetails } from './bookingServiceResolver';

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

  // POST /v1/bookings - Create booking request (no charge until accepted)
  router.post('/bookings', authenticateUser(supabase), async (req, res) => {
    try {
      const {
        serviceId,
        date, // YYYY-MM-DD
        timeStart, // HH:MM:SS or HH:MM
        timeEnd, // HH:MM:SS or HH:MM (optional if service selected)
        customerEmail,
        customerName,
        providerId: requestProviderId,
        serviceName,
        servicePriceCents,
        serviceDurationMinutes,
        priceCents
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
      let resolvedServicePriceCents: number;
      let calculatedTimeEnd: string;
      let resolvedServiceId: string | null;

      const serviceRecord = serviceId ? await db.getService(supabase, serviceId) : null;

      const resolution = resolveBookingServiceDetails({
        serviceId,
        serviceRecord,
        providerId: requestProviderId,
        timeStart,
        timeEnd,
        serviceName,
        servicePriceCents,
        serviceDurationMinutes,
        customPriceCents: priceCents
      });

      if (!resolution.ok) {
        return res.status(resolution.error.status).json({
          success: false,
          error: { type: resolution.error.type, message: resolution.error.message }
        });
      }

      providerId = resolution.data.providerId;
      resolvedServicePriceCents = resolution.data.servicePriceCents;
      calculatedTimeEnd = resolution.data.calculatedTimeEnd;
      resolvedServiceId = resolution.data.serviceId;

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
      const platformFeeCents = Math.max(99, Math.min(Math.round(0.08 * resolvedServicePriceCents), 1299));
      const totalChargeCents = resolvedServicePriceCents + platformFeeCents;

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

      // Create booking in database (no charge at request time)
      try {
        const booking = await db.createBooking(supabase, {
          customerId,
          providerId,
          serviceId: resolvedServiceId,
          date,
          timeStart,
          timeEnd: calculatedTimeEnd,
          paymentIntentId: null,
          amountTotal: totalChargeCents,
          servicePriceCents: resolvedServicePriceCents,
          platformFeeCents
        });

        console.log(`✅ Created booking ${booking.id} (awaiting customer payment)`);

        res.json({
          success: true,
          data: { booking }
        });
      } catch (dbError: any) {
        // Handle conflict from database constraint
        if (dbError.code === 'BOOKING_CONFLICT' || dbError.statusCode === 409) {
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

      // Require payment before provider acceptance
      if (booking.payment_status !== 'captured') {
        return res.status(409).json({
          success: false,
          error: {
            type: 'invalid_state',
            message: 'Booking payment must be completed before acceptance'
          }
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

      res.json({
        success: true,
        data: {
          booking: result.booking
        }
      });
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

      if (booking.payment_status !== 'captured') {
        return res.status(409).json({
          success: false,
          error: {
            type: 'invalid_state',
            message: 'Booking payment must be completed before decline'
          }
        });
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
      if (booking.status === 'pending' || booking.status === 'checkout_created') {
        // Cancel authorization
        if (booking.payment_intent_id) {
          try {
            await stripe.paymentIntents.cancel(booking.payment_intent_id);
          } catch (stripeError) {
            console.error('Error canceling payment intent:', stripeError);
          }
        }

        const updatedBooking = await db.updateBookingStatus(
          supabase,
          id,
          'cancelled',
          booking.payment_status === 'none' ? 'none' : 'canceled',
          reason
        );

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

      if (!bookingId || typeof bookingId !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid required field: bookingId' });
      }

      const booking = await db.getBooking(supabase, bookingId);
      if (!booking) {
        return res.status(404).json({ error: 'Booking not found' });
      }

      if (booking.customer_id !== userId) {
        return res.status(403).json({ error: 'You do not have permission to pay for this booking' });
      }

      if (booking.status !== 'checkout_created') {
        return res.status(409).json({
          error: 'Payment is only available for unpaid bookings.'
        });
      }

      if (booking.payment_status === 'captured') {
        return res.status(409).json({
          error: 'Booking payment already completed',
          code: 'already_paid'
        });
      }

      if (booking.stripe_checkout_session_id) {
        const existingSession = await stripe.checkout.sessions.retrieve(
          booking.stripe_checkout_session_id
        );

        if (!existingSession.url || !existingSession.id) {
          console.error('Existing checkout session missing url or id', {
            sessionId: existingSession.id,
            url: existingSession.url
          });
          return res.status(500).json({ error: 'Stripe checkout session missing url or id' });
        }

        return res.json({
          success: true,
          data: {
            url: existingSession.url,
            sessionId: existingSession.id
          }
        });
      }

      const totalFromComponents =
        (booking.service_price_cents ?? 0) + (booking.platform_fee_cents ?? 0);
      const totalCentsRaw =
        booking.amount_total ??
        (booking as any).total_cents ??
        (booking as any).totalCents ??
        totalFromComponents;

      const totalCents = typeof totalCentsRaw === 'number' ? totalCentsRaw : Number(totalCentsRaw);

      if (!Number.isInteger(totalCents)) {
        return res.status(400).json({ error: 'Booking totalCents must be an integer' });
      }

      if (totalCents < 50) {
        return res.status(400).json({ error: 'Booking totalCents must be at least 50' });
      }

      let serviceName = (booking as any).service_name as string | undefined;
      if (!serviceName && booking.service_id) {
        const service = await db.getService(supabase, booking.service_id);
        if (service) {
          serviceName = service.name;
        }
      }
      if (!serviceName || typeof serviceName !== 'string') {
        return res.status(400).json({ error: 'Booking serviceName is missing or invalid' });
      }

      const appUrlScheme = process.env.APP_URL_SCHEME || 'yardline';
      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'usd',
              unit_amount: totalCents,
              product_data: {
                name: serviceName
              }
            },
            quantity: 1
          }
        ],
        success_url: `${appUrlScheme}://payment-success?type=booking&session_id={CHECKOUT_SESSION_ID}&booking_id=${bookingId}`,
        cancel_url: `${appUrlScheme}://payment-cancel?type=booking&booking_id=${bookingId}`,
        metadata: {
          type: 'booking',
          bookingId,
          userId: booking.customer_id,
          providerId: booking.provider_id,
          serviceName
        }
      };

      // Use the same Stripe Connect pattern as ticket checkout (destination charges)
      let providerStripeAccountId: string | null =
        (booking as any).provider_stripe_account_id ||
        (booking as any).providerStripeAccountId ||
        null;

      if (!providerStripeAccountId && booking.provider_id) {
        providerStripeAccountId = await getOrCreateStripeAccountId(
          booking.provider_id,
          `provider-${booking.provider_id}@yardline.app`,
          `Provider ${booking.provider_id}`
        );
      }

      if (providerStripeAccountId) {
        const platformFeeCents =
          booking.platform_fee_cents ??
          (booking as any).platformFeeCents ??
          null;
        const applicationFee = typeof platformFeeCents === 'number' ? platformFeeCents : Number(platformFeeCents);

        sessionParams.payment_intent_data = {
          transfer_data: {
            destination: providerStripeAccountId
          },
          metadata: {
            booking_id: bookingId,
            bookingId,
            type: 'booking',
            customer_id: booking.customer_id,
            provider_id: booking.provider_id,
            service_name: serviceName
          },
          ...(Number.isInteger(applicationFee) && applicationFee > 0
            ? { application_fee_amount: applicationFee }
            : {})
        };
      } else {
        sessionParams.payment_intent_data = {
          metadata: {
            booking_id: bookingId,
            bookingId,
            type: 'booking',
            customer_id: booking.customer_id,
            provider_id: booking.provider_id,
            service_name: serviceName
          }
        };
      }

      const session = await stripe.checkout.sessions.create(sessionParams);

      if (!session.url || !session.id) {
        console.error('Checkout session missing url or id', { sessionId: session.id, url: session.url });
        return res.status(500).json({ error: 'Stripe checkout session missing url or id' });
      }

      const { error: updateError } = await supabase
        .from('bookings')
        .update({
          stripe_checkout_session_id: session.id,
          updated_at: new Date().toISOString()
        })
        .eq('id', bookingId);

      if (updateError) {
        console.error('Failed to store checkout session ID on booking:', updateError);
        return res.status(500).json({ error: 'Failed to persist checkout session' });
      }

      console.log(
        JSON.stringify({
          event: 'booking.checkout_session.created',
          bookingId,
          amountCents: totalCents,
          sessionId: session.id,
          url: session.url
        })
      );

      res.json({
        success: true,
        data: {
          url: session.url,
          sessionId: session.id
        }
      });
    } catch (error) {
      const stripeError = error as any;
      console.error('Error creating checkout session for booking:', {
        message: stripeError?.message,
        type: stripeError?.type,
        code: stripeError?.code,
        raw: stripeError?.raw
      });
      res.status(500).json({ error: 'Failed to create checkout session' });
    }
  });

  return router;
}
