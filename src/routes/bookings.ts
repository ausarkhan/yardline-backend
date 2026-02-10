// YardLine Booking System - API Endpoints (Database-backed)
// Replace the booking endpoints section in index.ts with these implementations

// ============================================================================
// BOOKING SYSTEM ENDPOINTS (DATABASE-BACKED)
// ============================================================================

import { Request, Response, Router } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { v4 as uuidv4 } from 'uuid';
import * as db from '../db';
import { authenticateUser } from '../middleware/auth';
import { resolveBookingServiceDetails } from './bookingServiceResolver';
import {
  getOrCreateProviderStripeAccountId,
  getStripeAccountStatus,
  isStripeAccountReady
} from '../stripeConnect';

const isValidUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const parseIsoDate = (value: string): Date | null => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const toDateString = (date: Date): string => date.toISOString().slice(0, 10);
const toTimeString = (date: Date): string => date.toISOString().slice(11, 19);

type CheckoutSessionDbClient = Pick<typeof db, 'getBooking' | 'getService'>;

const normalizePaymentStatus = (status: unknown): string | null => {
  if (typeof status !== 'string') return null;
  return status.trim().toLowerCase();
};

const isPaidPaymentStatus = (status: unknown): boolean => {
  const normalized = normalizePaymentStatus(status);
  if (!normalized) return false;
  return normalized === 'paid' || normalized === 'captured';
};

export function createCheckoutSessionHandler(params: {
  supabase: SupabaseClient;
  stripe: Stripe;
  dbClient?: CheckoutSessionDbClient;
  now?: () => Date;
}) {
  const { supabase, stripe } = params;
  const dbClient = params.dbClient ?? db;
  const now = params.now ?? (() => new Date());

  const logCheckoutDecision = (payload: {
    bookingId?: string | null;
    paymentStatus?: unknown;
    depositStatus?: unknown;
    rejectionReason?: string | null;
  }) => {
    console.log(
      JSON.stringify({
        event: 'booking.checkout_session.eligibility',
        bookingId: payload.bookingId ?? null,
        payment_status: payload.paymentStatus ?? null,
        deposit_status: payload.depositStatus ?? null,
        rejection_reason: payload.rejectionReason ?? null
      })
    );
  };

  return async (req: Request, res: Response) => {
    try {
      const { bookingId, serviceName: requestServiceName } = req.body;
      const userId = req.user?.id;
      const correlationId =
        (typeof req.headers['x-request-id'] === 'string' && req.headers['x-request-id']) ||
        (typeof req.headers['x-correlation-id'] === 'string' && req.headers['x-correlation-id']) ||
        uuidv4();

      const stripeEnv = process.env.STRIPE_ENV;
      const isLive = stripeEnv === 'live';
      const isTest = stripeEnv === 'test';
      const appUrlScheme = process.env.APP_URL_SCHEME;
      const stripeSecretKey = isLive
        ? process.env.STRIPE_LIVE_SECRET_KEY
        : isTest
          ? process.env.STRIPE_TEST_SECRET_KEY
          : undefined;
      const webhookSecret = isLive
        ? process.env.STRIPE_LIVE_WEBHOOK_SECRET
        : isTest
          ? process.env.STRIPE_TEST_WEBHOOK_SECRET
          : undefined;

      console.log('[STRIPE_ENV_RESOLVED]', {
        stripeEnv,
        hasLiveKey: !!process.env.STRIPE_LIVE_SECRET_KEY,
        hasLiveWebhook: !!process.env.STRIPE_LIVE_WEBHOOK_SECRET
      });

      const missingEnvMessages: string[] = [];
      if (!stripeEnv) missingEnvMessages.push('Missing STRIPE_ENV');
      if (stripeEnv && stripeEnv !== 'live' && stripeEnv !== 'test') {
        missingEnvMessages.push('Invalid STRIPE_ENV (expected "live" or "test")');
      }
      if (!stripeSecretKey) {
        missingEnvMessages.push(
          stripeEnv === 'test' ? 'Missing STRIPE_TEST_SECRET_KEY' : 'Missing STRIPE_LIVE_SECRET_KEY'
        );
      }
      if (!appUrlScheme) missingEnvMessages.push('Missing APP_URL_SCHEME');
      if (!webhookSecret) {
        missingEnvMessages.push(
          stripeEnv === 'test'
            ? 'Missing STRIPE_TEST_WEBHOOK_SECRET'
            : 'Missing STRIPE_LIVE_WEBHOOK_SECRET'
        );
      }

      if (missingEnvMessages.length > 0) {
        console.error('[BOOKING_CHECKOUT_ENV_MISSING]', {
          correlationId,
          bookingId: typeof bookingId === 'string' ? bookingId : null,
          userId,
          stripeEnv,
          missing: missingEnvMessages
        });
        return res.status(500).json({
          code: 'BOOKING_CHECKOUT_ENV_MISSING',
          message: missingEnvMessages.join('; ')
        });
      }

      if (!bookingId || typeof bookingId !== 'string') {
        logCheckoutDecision({
          bookingId: typeof bookingId === 'string' ? bookingId : null,
          rejectionReason: 'missing_booking_id'
        });
        return res.status(400).json({
          error: 'INVALID_REQUEST',
          message: 'Missing or invalid required field: bookingId'
        });
      }

      console.log('[BOOKING_CHECKOUT_REQUEST]', { bookingId, userId, correlationId });

      const booking = await dbClient.getBooking(supabase, bookingId);
      if (!booking) {
        logCheckoutDecision({ bookingId, rejectionReason: 'booking_not_found' });
        return res.status(404).json({
          error: 'BOOKING_NOT_FOUND',
          message: 'Booking not found'
        });
      }

      const paymentStatus = booking.payment_status ?? null;
      const depositStatus = (booking as any).deposit_status ?? null;

      if (booking.customer_id !== userId) {
        logCheckoutDecision({
          bookingId,
          paymentStatus,
          depositStatus,
          rejectionReason: 'forbidden_user'
        });
        return res.status(403).json({
          error: 'FORBIDDEN',
          message: 'You do not have permission to pay for this booking'
        });
      }

      if (isPaidPaymentStatus(paymentStatus)) {
        logCheckoutDecision({
          bookingId,
          paymentStatus,
          depositStatus,
          rejectionReason: 'payment_status_paid'
        });
        return res.status(409).json({
          error: 'ALREADY_PAID',
          message: 'Booking payment already completed'
        });
      }

      if (booking.stripe_checkout_session_id) {
        const existingSession = await stripe.checkout.sessions.retrieve(
          booking.stripe_checkout_session_id
        );

        if (!existingSession.url || !existingSession.id) {
          console.error('[BOOKING_CHECKOUT_ERROR]', {
            error: 'Stripe checkout session missing url or id',
            sessionId: existingSession.id,
            url: existingSession.url
          });
          logCheckoutDecision({
            bookingId,
            paymentStatus,
            depositStatus,
            rejectionReason: 'existing_session_invalid'
          });
          return res.status(500).json({
            error: 'STRIPE_SESSION_INVALID',
            message: 'Stripe session missing url or id'
          });
        }

        if (!bookingId || !existingSession.url) {
          logCheckoutDecision({
            bookingId,
            paymentStatus,
            depositStatus,
            rejectionReason: 'existing_session_missing_url'
          });
          return res.status(500).json({
            error: 'BOOKING_CHECKOUT_INVALID',
            message: 'Stripe session missing url'
          });
        }

        const existingSessionExpiresAt =
          typeof existingSession.expires_at === 'number'
            ? new Date(existingSession.expires_at * 1000)
            : null;

        if (!existingSessionExpiresAt || existingSessionExpiresAt > now()) {
          logCheckoutDecision({
            bookingId,
            paymentStatus,
            depositStatus,
            rejectionReason: null
          });
          console.log('[BOOKING_CHECKOUT_SUCCESS]', { bookingId, sessionId: existingSession.id });
          return res.status(200).json({
            url: existingSession.url,
            sessionId: existingSession.id,
            bookingId
          });
        }
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
        logCheckoutDecision({
          bookingId,
          paymentStatus,
          depositStatus,
          rejectionReason: 'invalid_total_cents'
        });
        return res.status(400).json({
          error: 'INVALID_REQUEST',
          message: 'Booking totalCents must be an integer'
        });
      }

      if (totalCents < 50) {
        logCheckoutDecision({
          bookingId,
          paymentStatus,
          depositStatus,
          rejectionReason: 'total_cents_too_low'
        });
        return res.status(400).json({
          error: 'INVALID_REQUEST',
          message: 'Booking totalCents must be at least 50'
        });
      }

      const displayName = (typeof requestServiceName === 'string' ? requestServiceName : undefined) ??
        ((booking as any).service_name as string | undefined) ??
        'Booking Service';
      const normalizedDisplayName = displayName.trim();

      if (!normalizedDisplayName) {
        logCheckoutDecision({
          bookingId,
          paymentStatus,
          depositStatus,
          rejectionReason: 'missing_service_name'
        });
        return res.status(400).json({
          error: 'INVALID_REQUEST',
          message: 'serviceName is missing or invalid'
        });
      }

      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'usd',
              unit_amount: totalCents,
              product_data: {
                name: normalizedDisplayName
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
          serviceName: normalizedDisplayName
        }
      };

      // Use provider's single Stripe Connect account (destination charges)
      let providerStripeAccountId: string | null = null;

      if (booking.provider_id) {
        providerStripeAccountId = await getOrCreateProviderStripeAccountId({
          supabase,
          stripe,
          providerId: booking.provider_id
        });

        const accountStatus = await getStripeAccountStatus(stripe, providerStripeAccountId);
        if (!isStripeAccountReady(accountStatus)) {
          return res.status(400).json({
            code: 'PROVIDER_PAYOUT_SETUP_REQUIRED',
            message: 'Provider must complete payout setup to accept online payments.'
          });
        }
      }

      let applicationFeeAmount: number | null = null;
      if (providerStripeAccountId) {
        const platformFeeCents =
          booking.platform_fee_cents ??
          (booking as any).platformFeeCents ??
          null;
        const applicationFee = typeof platformFeeCents === 'number' ? platformFeeCents : Number(platformFeeCents);
        applicationFeeAmount = Number.isInteger(applicationFee) && applicationFee > 0 ? applicationFee : null;

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
            service_name: normalizedDisplayName
          },
          ...(applicationFeeAmount !== null
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
            service_name: normalizedDisplayName
          }
        };
      }

      console.log('[BOOKING_CHECKOUT_STRIPE_PARAMS]', {
        correlationId,
        bookingId,
        userId,
        providerId: booking.provider_id,
        amountCents: totalCents,
        currency: sessionParams.line_items?.[0]?.price_data?.currency,
        success_url: sessionParams.success_url,
        cancel_url: sessionParams.cancel_url,
        destinationAccountId: providerStripeAccountId,
        application_fee_amount: applicationFeeAmount
      });

      let session: Stripe.Checkout.Session;
      try {
        session = await stripe.checkout.sessions.create(sessionParams);
      } catch (err: any) {
        console.error('[BOOKING_CHECKOUT_STRIPE_ERROR]', {
          correlationId,
          bookingId,
          userId,
          providerId: booking.provider_id,
          message: err?.message,
          type: err?.type,
          code: err?.code,
          param: err?.param,
          statusCode: err?.statusCode,
          requestId: err?.requestId,
          raw: err
        });

        return res.status(500).json({
          code: 'BOOKING_CHECKOUT_FAILED',
          message: err?.message || 'Stripe Checkout creation failed'
        });
      }

      if (!session.url || !session.id) {
        console.error('[BOOKING_CHECKOUT_ERROR]', {
          error: 'Stripe checkout session missing url or id',
          sessionId: session.id,
          url: session.url
        });
        logCheckoutDecision({
          bookingId,
          paymentStatus,
          depositStatus,
          rejectionReason: 'stripe_session_invalid'
        });
        return res.status(500).json({
          error: 'STRIPE_SESSION_INVALID',
          message: 'Stripe session missing url or id'
        });
      }

      if (!bookingId || !session.url) {
        logCheckoutDecision({
          bookingId,
          paymentStatus,
          depositStatus,
          rejectionReason: 'stripe_session_missing_url'
        });
        return res.status(500).json({
          error: 'BOOKING_CHECKOUT_INVALID',
          message: 'Stripe session missing url'
        });
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
        logCheckoutDecision({
          bookingId,
          paymentStatus,
          depositStatus,
          rejectionReason: 'persist_checkout_session_failed'
        });
        return res.status(500).json({
          error: 'BOOKING_CHECKOUT_PERSIST_FAILED',
          message: 'Failed to persist checkout session'
        });
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

      console.log('[BOOKING_CHECKOUT_SUCCESS]', { bookingId, sessionId: session.id });
      logCheckoutDecision({
        bookingId,
        paymentStatus,
        depositStatus,
        rejectionReason: null
      });

      return res.status(200).json({
        url: session.url,
        sessionId: session.id,
        bookingId
      });
    } catch (error) {
      console.error('[BOOKING_CHECKOUT_ERROR]', {
        error,
        stack: error instanceof Error ? error.stack : undefined
      });
      return res.status(500).json({
        error: 'BOOKING_CHECKOUT_FAILED',
        message: 'Failed to create checkout session'
      });
    }
  };
}

export function createBookingRoutes(
  supabase: SupabaseClient,
  stripe: Stripe,
  calculateBookingPlatformFee: (priceCents: number) => number,
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


  // POST /v1/bookings/pay-online - Create booking + Stripe Checkout Session (single call)
  router.post(
    '/bookings/pay-online',
    authenticateUser(supabase, { responseFormat: 'simple' }),
    async (req, res) => {
    try {
      const {
        providerUserId,
        serviceId,
        serviceName,
        servicePriceCents,
        serviceDurationMinutes,
        startTime,
        endTime
      } = req.body;

      const customerUserId = req.user!.id;

      if (!providerUserId || typeof providerUserId !== 'string' || !isValidUuid(providerUserId)) {
        return res.status(400).json({
          error: 'INVALID_REQUEST',
          message: 'providerUserId must be a valid UUID'
        });
      }

      if (!serviceId || typeof serviceId !== 'string' || serviceId.trim().length === 0) {
        return res.status(400).json({
          error: 'INVALID_REQUEST',
          message: 'serviceId must be a non-empty string'
        });
      }

      if (!serviceName || typeof serviceName !== 'string' || serviceName.trim().length === 0) {
        return res.status(400).json({
          error: 'INVALID_REQUEST',
          message: 'serviceName must be a non-empty string'
        });
      }

      if (!Number.isInteger(servicePriceCents) || servicePriceCents <= 0) {
        return res.status(400).json({
          error: 'INVALID_REQUEST',
          message: 'servicePriceCents must be a positive integer'
        });
      }

      if (!Number.isInteger(serviceDurationMinutes) || serviceDurationMinutes <= 0) {
        return res.status(400).json({
          error: 'INVALID_REQUEST',
          message: 'serviceDurationMinutes must be a positive integer'
        });
      }

      if (!startTime || typeof startTime !== 'string' || !endTime || typeof endTime !== 'string') {
        return res.status(400).json({
          error: 'INVALID_REQUEST',
          message: 'startTime and endTime must be valid ISO strings'
        });
      }

      const startDate = parseIsoDate(startTime);
      const endDate = parseIsoDate(endTime);

      if (!startDate || !endDate) {
        return res.status(400).json({
          error: 'INVALID_REQUEST',
          message: 'startTime and endTime must be valid ISO strings'
        });
      }

      if (endDate <= startDate) {
        return res.status(400).json({
          error: 'INVALID_REQUEST',
          message: 'endTime must be after startTime'
        });
      }

      const startDateStr = toDateString(startDate);
      const endDateStr = toDateString(endDate);

      if (startDateStr !== endDateStr) {
        return res.status(400).json({
          error: 'INVALID_REQUEST',
          message: 'startTime and endTime must be on the same day'
        });
      }

      const { data: providerUser, error: providerUserError } = await supabase.auth.admin.getUserById(
        providerUserId
      );

      if (providerUserError || !providerUser?.user) {
        return res.status(400).json({
          error: 'INVALID_PROVIDER',
          message: 'providerUserId must reference an existing user'
        });
      }

      const timeStart = toTimeString(startDate);
      const timeEnd = toTimeString(endDate);
      const platformFeeCents = calculateBookingPlatformFee(servicePriceCents);
      const totalChargeCents = servicePriceCents + platformFeeCents;

      const insertPayload = {
        customer_id: customerUserId,
        provider_id: providerUserId,
        service_id: isValidUuid(serviceId) ? serviceId : null,
        service_name: serviceName.trim(),
        date: startDateStr,
        time_start: timeStart,
        time_end: timeEnd,
        status: 'pending',
        payment_status: 'none',
        payment_intent_id: null,
        amount_total: totalChargeCents,
        service_price_cents: servicePriceCents,
        platform_fee_cents: platformFeeCents
      };

      const { data: booking, error: bookingError } = await supabase
        .from('bookings')
        .insert(insertPayload)
        .select()
        .single();

      if (bookingError) {
        if (bookingError.code === '23P01' || bookingError.message?.includes('no_double_booking')) {
          return res.status(409).json({
            error: 'BOOKING_CONFLICT',
            message: 'Time slot already booked'
          });
        }
        console.error('[BOOKING_PAY_ONLINE_ERROR] Failed to create booking:', bookingError);
        return res.status(500).json({
          error: 'BOOKING_CREATE_FAILED',
          message: 'Booking pay online failed'
        });
      }

      if (!booking?.id) {
        console.error('[BOOKING_PAY_ONLINE_ERROR] Booking creation failed: missing booking id');
        return res.status(500).json({
          error: 'BOOKING_CREATE_FAILED',
          message: 'Booking pay online failed'
        });
      }

      const bookingId = booking.id as string;

      console.log('[BOOKING_CHECKOUT_REQUEST]', { bookingId, userId: customerUserId });

      const appUrlScheme = process.env.APP_URL_SCHEME || 'yardline';
      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'usd',
              unit_amount: totalChargeCents,
              product_data: {
                name: serviceName.trim()
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
          providerUserId,
          customerUserId
        }
      };

      const providerStripeAccountId = await getOrCreateProviderStripeAccountId({
        supabase,
        stripe,
        providerId: providerUserId
      });

      const accountStatus = await getStripeAccountStatus(stripe, providerStripeAccountId);
      if (!isStripeAccountReady(accountStatus)) {
        return res.status(400).json({
          code: 'PROVIDER_PAYOUT_SETUP_REQUIRED',
          message: 'Provider must complete payout setup to accept online payments.'
        });
      }

      sessionParams.payment_intent_data = {
        transfer_data: {
          destination: providerStripeAccountId
        },
        metadata: {
          type: 'booking',
          bookingId,
          providerUserId,
          customerUserId
        },
        ...(platformFeeCents > 0 ? { application_fee_amount: platformFeeCents } : {})
      };

      const session = await stripe.checkout.sessions.create(sessionParams);

      if (!session.url || !session.id) {
        console.error('[BOOKING_PAY_ONLINE_ERROR] Stripe checkout session missing url or id');
        return res.status(500).json({
          error: 'STRIPE_SESSION_INVALID',
          message: 'Stripe session missing url or id'
        });
      }

      if (!bookingId || !session.url) {
        console.error('[BOOKING_PAY_ONLINE_ERROR] Missing bookingId or session url');
        return res.status(500).json({
          error: 'BOOKING_CHECKOUT_INVALID',
          message: 'Booking pay online failed'
        });
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
      }

      console.log('[BOOKING_PAY_ONLINE_CHECKOUT]', bookingId, session.id);
      console.log('[BOOKING_CHECKOUT_SUCCESS]', { bookingId, sessionId: session.id });

      return res.status(200).json({
        bookingId,
        sessionId: session.id,
        url: session.url
      });
    } catch (error) {
      console.error('[BOOKING_CHECKOUT_ERROR]', {
        error,
        stack: error instanceof Error ? error.stack : undefined
      });
      return res.status(500).json({
        error: 'BOOKING_CHECKOUT_FAILED',
        message: 'Booking pay online failed'
      });
    }
  });
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
  router.post(
    '/bookings/checkout-session',
    authenticateUser(supabase, { responseFormat: 'simple' }),
    createCheckoutSessionHandler({
      supabase,
      stripe
    })
  );

  return router;
}
