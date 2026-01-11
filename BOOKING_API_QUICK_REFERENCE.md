# YardLine Booking API - Quick Reference

## Authentication

All endpoints require Supabase JWT authentication:
```
Authorization: Bearer <supabase_jwt_token>
```

## Data Types

- **date**: `YYYY-MM-DD` (e.g., `"2026-02-15"`)
- **time**: `HH:MM:SS` or `HH:MM` (e.g., `"10:00:00"` or `"10:00"`)
- **currency**: Integer cents (e.g., `5000` = $50.00)

## Endpoints

### Create Booking
```http
POST /v1/bookings
Content-Type: application/json
Authorization: Bearer <customer_token>

{
  "serviceId": "uuid",           // Required if using service
  "date": "2026-02-15",          // Required: YYYY-MM-DD
  "timeStart": "10:00:00",       // Required: HH:MM:SS
  "timeEnd": "11:00:00",         // Optional if service selected
  "customerEmail": "user@example.com",
  "customerName": "John Doe"
}

// For custom booking without service:
{
  "providerId": "uuid",          // Required for custom
  "date": "2026-02-15",
  "timeStart": "10:00:00",
  "timeEnd": "11:00:00",         // Required for custom
  "priceCents": 5000,            // Required for custom
  "customerEmail": "user@example.com"
}
```

**Success (200):**
```json
{
  "success": true,
  "data": {
    "booking": {
      "id": "uuid",
      "date": "2026-02-15",
      "time_start": "10:00:00",
      "time_end": "11:00:00",
      "status": "pending",
      "payment_status": "authorized",
      "amount_total": 5400,
      "service_price_cents": 5000,
      "platform_fee_cents": 400
    },
    "paymentIntentClientSecret": "pi_xxx_secret_xxx"
  }
}
```

**Conflict (409):**
```json
{
  "success": false,
  "error": {
    "type": "booking_conflict",
    "message": "Time slot already booked"
  }
}
```

### List Bookings
```http
GET /v1/bookings?role=customer&status=pending
Authorization: Bearer <token>
```

**Query Parameters:**
- `role`: `customer` (default) or `provider`
- `status`: Filter by status (optional)

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "date": "2026-02-15",
      "time_start": "10:00:00",
      "time_end": "11:00:00",
      "status": "pending",
      "customer_id": "uuid",
      "provider_id": "uuid",
      ...
    }
  ]
}
```

### Get Booking
```http
GET /v1/bookings/:id
Authorization: Bearer <customer_or_provider_token>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "date": "2026-02-15",
    "time_start": "10:00:00",
    "time_end": "11:00:00",
    "status": "pending",
    ...
  }
}
```

### Accept Booking (Provider)
```http
POST /v1/bookings/:id/accept
Authorization: Bearer <provider_token>
```

**Success (200):**
```json
{
  "success": true,
  "data": {
    "booking": {
      "status": "confirmed",
      "payment_status": "captured",
      ...
    },
    "paymentIntentStatus": "succeeded"
  }
}
```

**Conflict (409):**
```json
{
  "success": false,
  "error": {
    "type": "booking_conflict",
    "message": "You have a conflicting booking at this time. Please decline this request."
  }
}
```

### Decline Booking (Provider)
```http
POST /v1/bookings/:id/decline
Content-Type: application/json
Authorization: Bearer <provider_token>

{
  "reason": "Not available at this time"  // Optional
}
```

**Success (200):**
```json
{
  "success": true,
  "data": {
    "booking": {
      "status": "declined",
      "payment_status": "canceled",
      "decline_reason": "Not available at this time",
      ...
    }
  }
}
```

### Cancel Booking (Customer)
```http
POST /v1/bookings/:id/cancel
Content-Type: application/json
Authorization: Bearer <customer_token>

{
  "reason": "Changed my mind"  // Optional
}
```

**Success (200) - If Pending:**
```json
{
  "success": true,
  "data": {
    "booking": {
      "status": "cancelled",
      "payment_status": "canceled",
      ...
    }
  }
}
```

**Error (400) - If Confirmed:**
```json
{
  "success": false,
  "error": {
    "type": "invalid_state",
    "message": "Cannot cancel confirmed booking. Please contact the provider.",
    "currentStatus": "confirmed"
  }
}
```

## Status Values

### Booking Status
- `pending` - Awaiting provider acceptance
- `confirmed` - Provider accepted
- `declined` - Provider declined
- `cancelled` - Customer cancelled
- `expired` - Payment authorization expired

### Payment Status
- `none` - No payment (free booking or payment disabled)
- `authorized` - Payment authorized, awaiting capture
- `captured` - Payment captured (provider paid)
- `canceled` - Payment cancelled
- `failed` - Payment failed
- `expired` - Authorization expired

## Platform Fee Formula

```
platformFee = max(99¢, min(round(8% × servicePrice), $12.99))
```

**Examples:**
- $10.00 service → $0.99 fee (minimum)
- $50.00 service → $4.00 fee (8%)
- $200.00 service → $12.99 fee (maximum)

## Validation Rules

### Time Validation
- ✅ `time_end` must be greater than `time_start`
- ✅ Booking must be in the future
- ✅ No overlapping bookings for same provider (409 error)

### Authorization
- ✅ Customers can only create/view/cancel their own bookings
- ✅ Providers can only accept/decline their own bookings
- ✅ Both parties can view booking details

## Error Codes

| Code | Type | Description |
|------|------|-------------|
| 400 | invalid_request_error | Missing/invalid fields, validation failure |
| 401 | authentication_error | Missing/invalid auth token |
| 403 | permission_denied | Not authorized to access resource |
| 404 | resource_missing | Booking/service not found |
| 409 | booking_conflict | Time slot already booked |
| 500 | api_error | Server error |

## Testing with cURL

### Create a booking
```bash
curl -X POST http://localhost:3000/v1/bookings \
  -H "Authorization: Bearer <customer_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "serviceId": "service-uuid",
    "date": "2026-02-15",
    "timeStart": "10:00:00",
    "customerEmail": "test@example.com",
    "customerName": "Test User"
  }'
```

### List provider bookings
```bash
curl -X GET "http://localhost:3000/v1/bookings?role=provider&status=pending" \
  -H "Authorization: Bearer <provider_token>"
```

### Accept booking
```bash
curl -X POST http://localhost:3000/v1/bookings/<booking_id>/accept \
  -H "Authorization: Bearer <provider_token>"
```

### Decline booking
```bash
curl -X POST http://localhost:3000/v1/bookings/<booking_id>/decline \
  -H "Authorization: Bearer <provider_token>" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Not available"}'
```

## Notes

- All times are stored without timezone (local time as specified)
- Database uses generated `time_range` column for conflict detection
- Exclusion constraint prevents double-booking at database level
- PaymentIntent is automatically cancelled if booking fails
- Platform fee is calculated server-side (not client-provided)
