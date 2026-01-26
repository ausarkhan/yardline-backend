import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBookingServiceDetails } from '../src/routes/bookingServiceResolver';

test('creates booking with fallback service fields when serviceId is missing', () => {
  const result = resolveBookingServiceDetails({
    serviceId: null,
    serviceRecord: null,
    providerId: 'provider-123',
    timeStart: '10:00',
    serviceName: 'Personal Training',
    servicePriceCents: 5000,
    serviceDurationMinutes: 60
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.data.providerId, 'provider-123');
  assert.equal(result.data.servicePriceCents, 5000);
  assert.equal(result.data.calculatedTimeEnd, '11:00:00');
  assert.equal(result.data.serviceId, null);
});