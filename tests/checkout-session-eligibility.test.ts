import test from 'node:test';
import assert from 'node:assert/strict';
import { createCheckoutSessionHandler } from '../src/routes/bookings';

type TestResponse = {
  statusCode: number;
  body?: any;
};

const createRes = (): { res: any; response: TestResponse } => {
  const response: TestResponse = { statusCode: 200 };
  const res = {
    status(code: number) {
      response.statusCode = code;
      return this;
    },
    json(payload: any) {
      response.body = payload;
      return this;
    }
  };
  return { res, response };
};

const createSupabaseMock = () =>
  ({
    from: () => ({
      update: () => ({
        eq: async () => ({ error: null })
      })
    })
  }) as any;

const createStripeMock = (url = 'https://checkout.example/session', id = 'cs_test_123') =>
  ({
    checkout: {
      sessions: {
        create: async () => ({ url, id }),
        retrieve: async () => ({ url, id })
      }
    }
  }) as any;

const createBooking = (overrides: Partial<any> = {}) => ({
  id: 'booking-1',
  customer_id: 'user-1',
  provider_id: 'provider-1',
  service_id: null,
  service_name: 'Training Session',
  status: 'pending',
  payment_status: 'none',
  stripe_checkout_session_id: null,
  amount_total: 5000,
  service_price_cents: 4500,
  platform_fee_cents: 500,
  deposit_status: 'unpaid',
  ...overrides
});

test('checkout-session allows payment_status "none"', async () => {
  const booking = createBooking({ payment_status: 'none' });
  const handler = createCheckoutSessionHandler({
    supabase: createSupabaseMock(),
    stripe: createStripeMock(),
    getOrCreateStripeAccountId: async () => 'acct_123',
    dbClient: {
      getBooking: async () => booking,
      getService: async () => ({ name: 'Training Session' } as any)
    }
  });

  const { res, response } = createRes();
  await handler({ body: { bookingId: booking.id }, user: { id: booking.customer_id } } as any, res);

  assert.equal(response.statusCode, 200);
  assert.ok(response.body.url);
  assert.ok(response.body.sessionId);
});

test('checkout-session allows payment_status "unpaid"', async () => {
  const booking = createBooking({ payment_status: 'unpaid' });
  const handler = createCheckoutSessionHandler({
    supabase: createSupabaseMock(),
    stripe: createStripeMock('https://checkout.example/unpaid', 'cs_unpaid'),
    getOrCreateStripeAccountId: async () => 'acct_123',
    dbClient: {
      getBooking: async () => booking,
      getService: async () => ({ name: 'Training Session' } as any)
    }
  });

  const { res, response } = createRes();
  await handler({ body: { bookingId: booking.id }, user: { id: booking.customer_id } } as any, res);

  assert.equal(response.statusCode, 200);
  assert.ok(response.body.url);
  assert.ok(response.body.sessionId);
});

test('checkout-session rejects payment_status "paid"', async () => {
  const booking = createBooking({ payment_status: 'paid' });
  const handler = createCheckoutSessionHandler({
    supabase: createSupabaseMock(),
    stripe: createStripeMock(),
    getOrCreateStripeAccountId: async () => 'acct_123',
    dbClient: {
      getBooking: async () => booking,
      getService: async () => ({ name: 'Training Session' } as any)
    }
  });

  const { res, response } = createRes();
  await handler({ body: { bookingId: booking.id }, user: { id: booking.customer_id } } as any, res);

  assert.equal(response.statusCode, 409);
  assert.equal(response.body.error, 'ALREADY_PAID');
});

test('checkout-session returns 404 for missing booking', async () => {
  const handler = createCheckoutSessionHandler({
    supabase: createSupabaseMock(),
    stripe: createStripeMock(),
    getOrCreateStripeAccountId: async () => 'acct_123',
    dbClient: {
      getBooking: async () => null,
      getService: async () => ({ name: 'Training Session' } as any)
    }
  });

  const { res, response } = createRes();
  await handler({ body: { bookingId: 'missing-booking' }, user: { id: 'user-1' } } as any, res);

  assert.equal(response.statusCode, 404);
  assert.equal(response.body.error, 'BOOKING_NOT_FOUND');
});

test('checkout-session returns 400 when bookingId missing', async () => {
  const handler = createCheckoutSessionHandler({
    supabase: createSupabaseMock(),
    stripe: createStripeMock(),
    getOrCreateStripeAccountId: async () => 'acct_123',
    dbClient: {
      getBooking: async () => null,
      getService: async () => ({ name: 'Training Session' } as any)
    }
  });

  const { res, response } = createRes();
  await handler({ body: {}, user: { id: 'user-1' } } as any, res);

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, 'INVALID_REQUEST');
});
