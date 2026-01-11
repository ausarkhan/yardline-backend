// YardLine Safe V1 Two-Step Payment System
// This implements the deposit + final payment flow for service bookings

import { Router, Request, Response } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import * as db from '../db';
import { authenticateUser } from '../middleware/auth';

export function createBookingV1Routes(
  supabase: SupabaseClient,
  stripe: Stripe,
  calcPlatformFeeCents: (priceCents: number) => number
) {
  const router = Router();

  // ============================================================================
  // POST /v1/bookings/request - Request booking with deposit payment
  // ============================================================================
  router.post('/request', authenticateUser(supabase), async (req: Request, res: Response) => {
    try {
      const {
        service_id,
        provider_id,
        date,
        time_start,
        time_end,
        promo_code
      } = req.body;

      const customerId = req.user!.id;

      // Validate required fields
      if (!service_id || !provider_id || !date || !time_start || !time_end) {
        return res.status(400).json({
          error: 'Missing required fields',
          code: 'invalid_request_error',
          message: 'service_id, provider_id, date, time_start, and time_end are required'
        });
      }

      // Validate and fetch service
      const service = await db.getService(supabase, service_id);
      if (!service) {
        return res.status(404).json({
          error: 'Service not found',
          code: 'resource_missing'
        });
      }

      if (!service.active) {
        return res.status(400).json({
          error: 'Service is not available',
          code: 'service_unavailable'
        });
      }

      // Validate provider_id matches service
      if (service.provider_id !== provider_id) {
        return res.status(400).json({
          error: 'Provider ID does not match service',
          code: 'invalid_provider'
        });
      }

      // Validate time_end > time_start
      if (time_start >= time_end) {
        return res.status(400).json({
          error: 'End time must be after start time',
          code: 'invalid_time_range'
        });
      }

      // Validate datetime is in the future
      const requestedDateTime = new Date(`${date}T${time_start}`);
      if (requestedDateTime <= new Date()) {
        return res.status(400).json({
          error: 'Requested time must be in the future',
          code: 'invalid_datetime'
        });
      }

      // Check for time slot conflicts BEFORE creating payment
      const hasConflict = await db.checkBookingConflict(
        supabase,
        provider_id,
        date,
        time_start,
        time_end
      );

      if (hasConflict) {
        return res.status(409).json({
          error: 'Time already booked',
          code: 'booking_conflict',
          message: 'Time already booked'
        });
      }

      // Calculate pricing
      let servicePriceCents = service.price_cents;

      // TODO: Apply promo_code discount if provided
      // For now, we'll use the base price
      if (promo_code) {
        // Placeholder for future promo code logic
        console.log(`Promo code ${promo_code} not yet implemented`);
      }

      // Calculate platform fee using the Safe V1 formula
      const platformFeeCents = calcPlatformFeeCents(servicePriceCents);

      // Validate minimum charge (Stripe requires at least 50 cents)
      if (platformFeeCents < 50) {
        return res.status(400).json({
          error: 'Platform fee is below minimum charge',
          code: 'amount_too_small'
        });
      }

      // Create idempotency key for deposit payment
      const idempotencyKey = `booking_request:${customerId}:${service_id}:${date}:${time_start}-${time_end}`;

      // Create and confirm Stripe PaymentIntent for platform fee deposit ONLY
      let paymentIntent: Stripe.PaymentIntent;
      try {
        paymentIntent = await stripe.paymentIntents.create({
          amount: platformFeeCents,
          currency: 'usd',
          confirm: true, // Auto-confirm for immediate charge
          automatic_payment_methods: {
            enabled: true,
            allow_redirects: 'never' // Prevent redirect-based payment methods
          },
          metadata: {
            type: 'deposit',
            service_id,
            provider_id,
            customer_id: customerId,
            date,
            time_start,
            time_end
          },
          description: `Booking deposit - ${service.name}`
        }, {
          idempotencyKey
        });
      } catch (stripeError: any) {
        console.error('Stripe deposit payment failed:', stripeError);
        return res.status(400).json({
          error: stripeError.message || 'Payment failed',
          code: stripeError.code || 'payment_failed',
          type: 'stripe_error'
        });
      }

      // Verify payment succeeded
      if (paymentIntent.status !== 'succeeded') {
        return res.status(400).json({
          error: `Payment status is ${paymentIntent.status}`,
          code: 'payment_not_succeeded',
          stripe_status: paymentIntent.status
        });
      }

      // Create booking in database
      let booking: db.DBBooking;
      try {
        booking = await db.createBookingWithDeposit(supabase, {
          customerId,
          providerId: provider_id,
          serviceId: service_id,
          date,
          timeStart: time_start,
          timeEnd: time_end,
          servicePriceCents,
          platformFeeCents,
          depositPaymentIntentId: paymentIntent.id
        });
      } catch (dbError: any) {
        // If booking creation fails after payment, we need to handle this carefully
        // In production, you'd want to refund or log this for manual review
        console.error('Booking creation failed after payment:', dbError);
        
        if (dbError.code === 'BOOKING_CONFLICT') {
          return res.status(409).json({
            error: 'Time already booked',
            code: 'booking_conflict',
            message: 'Time already booked',
            payment_intent_id: paymentIntent.id // Include PI ID for potential refund
          });
        }
        
        return res.status(500).json({
          error: 'Failed to create booking after payment',
          code: 'booking_creation_failed',
          payment_intent_id: paymentIntent.id // Include PI ID for potential refund
        });
      }

      // Return success response
      res.json({
        booking: {
          id: booking.id,
          customer_id: booking.customer_id,
          provider_id: booking.provider_id,
          service_id: booking.service_id,
          date: booking.date,
          time_start: booking.time_start,
          time_end: booking.time_end,
          status: booking.status,
          deposit_status: booking.deposit_status,
          final_status: booking.final_status,
          created_at: booking.created_at
        },
        pricing: {
          service_price_cents: servicePriceCents,
          platform_fee_cents: platformFeeCents,
          deposit_cents: platformFeeCents
        },
        stripe: {
          deposit_payment_intent_id: paymentIntent.id
        }
      });
    } catch (error) {
      console.error('Error in /v1/bookings/request:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Internal server error',
        code: 'api_error'
      });
    }
  });

  // ============================================================================
  // POST /v1/bookings/:id/accept - Provider accepts booking
  // ============================================================================
  router.post('/:id/accept', authenticateUser(supabase), async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const providerId = req.user!.id;

      // Accept the booking (includes validation checks)
      let booking: db.DBBooking;
      try {
        booking = await db.acceptBooking(supabase, id, providerId);
      } catch (dbError: any) {
        const statusCode = dbError.statusCode || 500;
        return res.status(statusCode).json({
          error: dbError.message,
          code: dbError.code || 'accept_failed'
        });
      }

      // Return success response with remaining amount to pay
      res.json({
        booking: {
          id: booking.id,
          customer_id: booking.customer_id,
          provider_id: booking.provider_id,
          service_id: booking.service_id,
          date: booking.date,
          time_start: booking.time_start,
          time_end: booking.time_end,
          status: booking.status,
          deposit_status: booking.deposit_status,
          final_status: booking.final_status,
          updated_at: booking.updated_at
        },
        remaining_cents: booking.service_price_cents || 0
      });
    } catch (error) {
      console.error('Error in /v1/bookings/:id/accept:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Internal server error',
        code: 'api_error'
      });
    }
  });

  // ============================================================================
  // POST /v1/bookings/:id/pay-remaining - Customer pays remaining amount
  // ============================================================================
  router.post('/:id/pay-remaining', authenticateUser(supabase), async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const customerId = req.user!.id;

      // Fetch and validate booking
      const booking = await db.getBooking(supabase, id);
      
      if (!booking) {
        return res.status(404).json({
          error: 'Booking not found',
          code: 'not_found'
        });
      }

      if (booking.customer_id !== customerId) {
        return res.status(403).json({
          error: 'You do not own this booking',
          code: 'forbidden'
        });
      }

      if (booking.status !== 'accepted') {
        return res.status(400).json({
          error: `Booking status is ${booking.status}, expected accepted`,
          code: 'invalid_status'
        });
      }

      if (booking.final_status === 'paid') {
        return res.status(400).json({
          error: 'Final payment already completed',
          code: 'already_paid'
        });
      }

      const servicePriceCents = booking.service_price_cents || 0;

      // Validate minimum charge
      if (servicePriceCents < 50) {
        return res.status(400).json({
          error: 'Service price is below minimum charge',
          code: 'amount_too_small'
        });
      }

      // Create idempotency key for final payment
      const idempotencyKey = `booking_final:${id}`;

      // Create and confirm Stripe PaymentIntent for service price
      let paymentIntent: Stripe.PaymentIntent;
      try {
        paymentIntent = await stripe.paymentIntents.create({
          amount: servicePriceCents,
          currency: 'usd',
          confirm: true, // Auto-confirm for immediate charge
          automatic_payment_methods: {
            enabled: true,
            allow_redirects: 'never'
          },
          metadata: {
            type: 'final',
            booking_id: id,
            customer_id: customerId,
            provider_id: booking.provider_id
          },
          description: `Booking final payment - ${id}`
        }, {
          idempotencyKey
        });
      } catch (stripeError: any) {
        console.error('Stripe final payment failed:', stripeError);
        
        // Update booking final_status to failed
        await supabase
          .from('bookings')
          .update({ final_status: 'failed' })
          .eq('id', id);
        
        return res.status(400).json({
          error: stripeError.message || 'Payment failed',
          code: stripeError.code || 'payment_failed',
          type: 'stripe_error'
        });
      }

      // Verify payment succeeded
      if (paymentIntent.status !== 'succeeded') {
        // Update booking final_status to failed
        await supabase
          .from('bookings')
          .update({ final_status: 'failed' })
          .eq('id', id);
        
        return res.status(400).json({
          error: `Payment status is ${paymentIntent.status}`,
          code: 'payment_not_succeeded',
          stripe_status: paymentIntent.status
        });
      }

      // Update booking with final payment
      const updatedBooking = await db.payRemainingBooking(
        supabase,
        id,
        customerId,
        paymentIntent.id
      );

      // Return success response
      res.json({
        booking: {
          id: updatedBooking.id,
          customer_id: updatedBooking.customer_id,
          provider_id: updatedBooking.provider_id,
          service_id: updatedBooking.service_id,
          date: updatedBooking.date,
          time_start: updatedBooking.time_start,
          time_end: updatedBooking.time_end,
          status: updatedBooking.status,
          deposit_status: updatedBooking.deposit_status,
          final_status: updatedBooking.final_status,
          updated_at: updatedBooking.updated_at
        },
        stripe: {
          final_payment_intent_id: paymentIntent.id
        }
      });
    } catch (error) {
      console.error('Error in /v1/bookings/:id/pay-remaining:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Internal server error',
        code: 'api_error'
      });
    }
  });

  return router;
}
