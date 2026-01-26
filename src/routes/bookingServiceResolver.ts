import { DBService } from '../db';

export interface BookingServiceResolutionInput {
  serviceId?: string | null;
  serviceRecord?: DBService | null;
  providerId?: string | null;
  timeStart: string;
  timeEnd?: string | null;
  serviceName?: string | null;
  servicePriceCents?: number | null;
  serviceDurationMinutes?: number | null;
  customPriceCents?: number | null;
}

export interface BookingServiceResolutionData {
  providerId: string;
  servicePriceCents: number;
  calculatedTimeEnd: string;
  serviceId: string | null;
}

export type BookingServiceResolutionResult =
  | { ok: true; data: BookingServiceResolutionData }
  | {
      ok: false;
      error: {
        status: number;
        type: 'invalid_request_error' | 'resource_missing';
        message: string;
      };
    };

const hasValue = (value: unknown) => value !== undefined && value !== null;

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const calculateTimeEnd = (timeStart: string, durationMinutes: number): string => {
  const [hoursStr, minutesStr] = timeStart.split(':');
  const hours = Number(hoursStr);
  const minutes = Number(minutesStr);
  const startMinutes = hours * 60 + minutes;
  const endMinutes = startMinutes + durationMinutes;
  const endHours = Math.floor(endMinutes / 60);
  const endMins = endMinutes % 60;
  return `${String(endHours).padStart(2, '0')}:${String(endMins).padStart(2, '0')}:00`;
};

export function resolveBookingServiceDetails(
  input: BookingServiceResolutionInput
): BookingServiceResolutionResult {
  const {
    serviceId,
    serviceRecord,
    providerId,
    timeStart,
    timeEnd,
    serviceName,
    servicePriceCents,
    serviceDurationMinutes,
    customPriceCents
  } = input;

  if (serviceRecord) {
    if (!serviceRecord.active) {
      return {
        ok: false,
        error: {
          status: 400,
          type: 'invalid_request_error',
          message: 'Service is not available'
        }
      };
    }

    const calculatedTimeEnd = timeEnd || calculateTimeEnd(timeStart, serviceRecord.duration);

    return {
      ok: true,
      data: {
        providerId: serviceRecord.provider_id,
        servicePriceCents: serviceRecord.price_cents,
        calculatedTimeEnd,
        serviceId: serviceRecord.service_id
      }
    };
  }

  const hasAnyFallbackField =
    hasValue(serviceName) || hasValue(servicePriceCents) || hasValue(serviceDurationMinutes);

  if (hasAnyFallbackField) {
    if (!isNonEmptyString(serviceName) || !isPositiveInteger(servicePriceCents) || !isPositiveInteger(serviceDurationMinutes)) {
      return {
        ok: false,
        error: {
          status: 400,
          type: 'invalid_request_error',
          message:
            'Invalid service details. Provide serviceName (non-empty), servicePriceCents (>0 integer), and serviceDurationMinutes (>0 integer)'
        }
      };
    }

    if (!providerId) {
      return {
        ok: false,
        error: {
          status: 400,
          type: 'invalid_request_error',
          message: 'Missing required field: providerId'
        }
      };
    }

    const calculatedTimeEnd = timeEnd || calculateTimeEnd(timeStart, serviceDurationMinutes);

    return {
      ok: true,
      data: {
        providerId,
        servicePriceCents,
        calculatedTimeEnd,
        serviceId: serviceId || null
      }
    };
  }

  if (serviceId) {
    return {
      ok: false,
      error: {
        status: 404,
        type: 'resource_missing',
        message: 'Service not found'
      }
    };
  }

  if (!providerId || !timeEnd || typeof customPriceCents !== 'number') {
    return {
      ok: false,
      error: {
        status: 400,
        type: 'invalid_request_error',
        message: 'For custom bookings: providerId, timeEnd, and priceCents are required'
      }
    };
  }

  return {
    ok: true,
    data: {
      providerId,
      servicePriceCents: customPriceCents,
      calculatedTimeEnd: timeEnd,
      serviceId: null
    }
  };
}