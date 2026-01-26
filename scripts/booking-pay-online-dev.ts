import Stripe from 'stripe';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const CUSTOMER_TOKEN = process.env.CUSTOMER_TOKEN;
const PROVIDER_TOKEN = process.env.PROVIDER_TOKEN;
const BOOKING_ID = process.env.BOOKING_ID;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || process.env.STRIPE_LIVE_WEBHOOK_SECRET;

if (!CUSTOMER_TOKEN || !BOOKING_ID) {
  console.error('Missing required env vars: CUSTOMER_TOKEN, BOOKING_ID');
  process.exit(1);
}

if (!WEBHOOK_SECRET) {
  console.error('Missing required env var: WEBHOOK_SECRET (or STRIPE_LIVE_WEBHOOK_SECRET)');
  process.exit(1);
}

async function apiFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${API_BASE_URL}${path}`, options);
  const text = await res.text();
  let json: any = null;
  let isJson = true;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
    isJson = false;
  }
  return { status: res.status, json, isJson, raw: text };
}

function buildWebhookPayload(sessionId: string, paymentStatus: 'paid' | 'unpaid') {
  return JSON.stringify({
    id: `evt_test_${Date.now()}`,
    object: 'event',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: sessionId,
        object: 'checkout.session',
        payment_status: paymentStatus,
        amount_total: 0,
        payment_intent: `pi_test_${Date.now()}`,
        metadata: {
          type: 'booking',
          bookingId: BOOKING_ID
        }
      }
    }
  });
}

async function main() {
  console.log('=== Booking Pay Online Dev Script ===');

  const invalidResp = await apiFetch('/v1/bookings/checkout-session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${CUSTOMER_TOKEN}`
    },
    body: JSON.stringify({})
  });

  console.log('Invalid request response:', invalidResp.status, invalidResp.json);

  if (invalidResp.status < 400) {
    console.error('Expected 4xx response for invalid request.');
    process.exit(1);
  }

  if (!invalidResp.isJson || !invalidResp.json?.error || !invalidResp.json?.message) {
    console.error('Invalid request did not return JSON error/message.');
    process.exit(1);
  }

  // 1) Create checkout session (returns URL)
  const checkoutResp = await apiFetch('/v1/bookings/checkout-session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${CUSTOMER_TOKEN}`
    },
    body: JSON.stringify({ bookingId: BOOKING_ID })
  });

  console.log('Checkout session response:', checkoutResp.status, checkoutResp.json);

  if (!checkoutResp.isJson || !checkoutResp.json?.url || !checkoutResp.json?.sessionId) {
    console.error('Checkout session response is missing JSON url/sessionId.');
    process.exit(1);
  }
  const sessionId = checkoutResp.json?.sessionId;

  if (!sessionId) {
    console.error('Missing sessionId in checkout session response. Abort.');
    process.exit(1);
  }

  // 2) Simulate unpaid webhook (should NOT update booking to requested)
  const unpaidPayload = buildWebhookPayload(sessionId, 'unpaid');
  const unpaidSignature = Stripe.webhooks.generateTestHeaderString({
    payload: unpaidPayload,
    secret: WEBHOOK_SECRET
  });

  const unpaidWebhookResp = await apiFetch('/v1/stripe/webhooks', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': unpaidSignature
    },
    body: unpaidPayload
  });

  console.log('Unpaid webhook response:', unpaidWebhookResp.status, unpaidWebhookResp.json);

  // 3) Provider accept before payment should fail
  if (PROVIDER_TOKEN) {
    const acceptBeforePaid = await apiFetch(`/v1/bookings/${BOOKING_ID}/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${PROVIDER_TOKEN}`
      }
    });
    console.log('Accept before paid:', acceptBeforePaid.status, acceptBeforePaid.json);
  }

  // 4) Simulate paid webhook (should update booking -> requested/pending)
  const paidPayload = buildWebhookPayload(sessionId, 'paid');
  const paidSignature = Stripe.webhooks.generateTestHeaderString({
    payload: paidPayload,
    secret: WEBHOOK_SECRET
  });

  const paidWebhookResp = await apiFetch('/v1/stripe/webhooks', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': paidSignature
    },
    body: paidPayload
  });

  console.log('Paid webhook response:', paidWebhookResp.status, paidWebhookResp.json);

  // 5) Provider accept after payment should succeed (if provided)
  if (PROVIDER_TOKEN) {
    const acceptAfterPaid = await apiFetch(`/v1/bookings/${BOOKING_ID}/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${PROVIDER_TOKEN}`
      }
    });
    console.log('Accept after paid:', acceptAfterPaid.status, acceptAfterPaid.json);
  }
}

main().catch((error) => {
  console.error('Dev script failed:', error);
  process.exit(1);
});
