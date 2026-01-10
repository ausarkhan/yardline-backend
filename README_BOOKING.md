# YardLine Booking System - Production Backend

Complete backend implementation for YardLine service bookings with **Request → Provider Accept/Decline → Charge on Accept** flow.

## Architecture

- **Backend**: Node.js + Express + TypeScript
- **Database**: Supabase PostgreSQL with Row Level Security
- **Payments**: Stripe with manual capture (authorization → capture flow)
- **Hosting**: Railway
- **Authentication**: Supabase Auth (JWT tokens)

## Features

✅ **Payment Authorization & Capture**
- Customer authorizes payment on booking request (no charge)
- Provider accepts → payment captured
- Provider declines or customer cancels → authorization released

✅ **Database-Level Safety**
- PostgreSQL exclusion constraint prevents double bookings
- Server-side price calculation only
- Transaction-safe booking acceptance
- Row Level Security (RLS) for data access control

✅ **Stripe Integration**
- Manual capture PaymentIntents
- Webhook-based payment reconciliation
- Idempotent webhook processing
- Connect Express for provider payouts

✅ **Security**
- JWT authentication on all booking endpoints
- Ownership verification (provider/customer)
- No client-side price manipulation
- Webhook signature verification

---

## Environment Variables

### Required Variables

```bash
# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...  # Service role key (bypasses RLS for admin operations)

# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_...  # Or use environment-specific keys below
STRIPE_WEBHOOK_SECRET=whsec_...

# Optional: Environment-specific Stripe keys
STRIPE_ENV=test  # or 'live'
STRIPE_TEST_SECRET_KEY=sk_test_...
STRIPE_LIVE_SECRET_KEY=sk_live_...
STRIPE_TEST_WEBHOOK_SECRET=whsec_...
STRIPE_LIVE_WEBHOOK_SECRET=whsec_...

# Server Configuration
PORT=3000
REVIEW_MODE=false  # Set to 'true' during app store review (limits charges to $1)
```

### Railway Environment Variables

Set these in your Railway project dashboard:
1. Go to your project → Variables tab
2. Add all variables from above
3. Redeploy after adding variables

---

## Installation & Setup

### 1. Install Dependencies

```bash
npm install
```

This installs:
- `express` - Web framework
- `@supabase/supabase-js` - Supabase client
- `stripe` - Stripe SDK
- `cors` - CORS middleware
- `uuid` - UUID generation
- TypeScript and type definitions

### 2. Run Database Migration

Before running the backend, you MUST run the database migration to create the required tables and constraints.

```bash
# Option 1: Supabase Dashboard
# 1. Go to https://app.supabase.com → Your Project → SQL Editor
# 2. Copy contents of migrations/001_booking_system.sql
# 3. Paste and run

# Option 2: psql command line
psql $SUPABASE_URL -f migrations/001_booking_system.sql
```

See `migrations/MIGRATION_GUIDE.md` for detailed instructions.

### 3. Configure Stripe Webhooks

#### Development (Local Testing)
```bash
# Install Stripe CLI
brew install stripe/stripe-brew/stripe

# Login
stripe login

# Forward webhooks to local server
stripe listen --forward-to http://localhost:3000/v1/stripe/webhooks

# Copy the webhook signing secret and add to .env
# whsec_...
```

#### Production (Railway)
1. Go to Stripe Dashboard → Developers → Webhooks
2. Click "Add endpoint"
3. URL: `https://your-railway-app.up.railway.app/v1/stripe/webhooks`
4. Select events:
   - `payment_intent.succeeded`
   - `payment_intent.canceled`
   - `payment_intent.payment_failed`
   - `payment_intent.requires_action`
5. Copy signing secret to Railway environment variable `STRIPE_WEBHOOK_SECRET`

### 4. Run Locally

```bash
# Development mode (auto-reload on changes)
npm run dev

# Production build
npm run build
npm start
```

Server starts on `http://localhost:3000`

---

## API Documentation

### Authentication

All booking endpoints require authentication. Include JWT token in headers:

```bash
Authorization: Bearer <supabase-jwt-token>
```

Get JWT token from Supabase Auth:
```typescript
const { data: { session } } = await supabase.auth.getSession();
const token = session?.access_token;
```

### Service Endpoints

#### Create Service (Provider)
```bash
POST /v1/services
Authorization: Bearer <token>
Content-Type: application/json

{
  "providerId": "uuid",
  "name": "Lawn Mowing",
  "description": "Professional lawn mowing service",
  "priceCents": 5000,
  "duration": 60
}
```

#### Get Service
```bash
GET /v1/services/:serviceId
```

#### List Services
```bash
GET /v1/services?providerId=<uuid>
```

### Booking Endpoints

#### Request Booking (Customer)
```bash
POST /v1/bookings
Authorization: Bearer <token>
Content-Type: application/json

{
  "customerId": "uuid",
  "serviceId": "uuid",
  "requestedDate": "2026-01-15",
  "requestedTime": "14:00",
  "customerEmail": "customer@example.com",
  "customerName": "John Doe"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "booking": {
      "booking_id": "uuid",
      "status": "pending",
      "payment_status": "authorized",
      "payment_intent_id": "pi_xxx",
      ...
    },
    "paymentIntentClientSecret": "pi_xxx_secret_yyy",
    "requiresAction": false
  }
}
```

#### Accept Booking (Provider)
```bash
POST /v1/bookings/:id/accept
Authorization: Bearer <token>
Content-Type: application/json

{
  "providerId": "uuid"
}
```

**Response (Success):**
```json
{
  "success": true,
  "data": {
    "booking": {
      "status": "confirmed",
      "payment_status": "captured",
      ...
    }
  }
}
```

**Response (Conflict):**
```json
{
  "success": false,
  "error": {
    "type": "booking_conflict",
    "message": "Time slot already booked"
  }
}
```

#### Decline Booking (Provider)
```bash
POST /v1/bookings/:id/decline
Authorization: Bearer <token>
Content-Type: application/json

{
  "providerId": "uuid",
  "reason": "Not available"
}
```

#### Cancel Booking (Customer)
```bash
POST /v1/bookings/:id/cancel
Authorization: Bearer <token>
Content-Type: application/json

{
  "customerId": "uuid",
  "reason": "Changed plans"
}
```

#### Get Booking
```bash
GET /v1/bookings/:id
Authorization: Bearer <token>
```

#### List Bookings
```bash
# Customer bookings
GET /v1/bookings?customerId=<uuid>
Authorization: Bearer <token>

# Provider bookings
GET /v1/bookings?providerId=<uuid>&status=pending
Authorization: Bearer <token>
```

---

## Testing

### Stripe Test Cards

Use these test cards in Stripe test mode:

| Card Number | Scenario |
|------------|----------|
| 4242 4242 4242 4242 | Successful payment |
| 4000 0025 0000 3155 | Requires 3D Secure authentication |
| 4000 0000 0000 9995 | Declined payment |

All test cards:
- Expiry: Any future date (e.g., 12/34)
- CVC: Any 3 digits (e.g., 123)
- ZIP: Any 5 digits (e.g., 12345)

### Test Script

Run the automated test script:

```bash
# Make sure server is running first
npm run dev

# In another terminal
chmod +x test-booking-system.sh
./test-booking-system.sh
```

### Manual Testing Flow

1. **Create a service**
```bash
curl -X POST http://localhost:3000/v1/services \
  -H "Content-Type: application/json" \
  -d '{
    "providerId": "provider-1",
    "name": "Test Service",
    "priceCents": 5000,
    "duration": 60
  }'
```

2. **Request booking (customer)**
```bash
curl -X POST http://localhost:3000/v1/bookings \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "customer-1",
    "serviceId": "SERVICE_ID_FROM_STEP_1",
    "requestedDate": "2026-01-20",
    "requestedTime": "14:00",
    "customerEmail": "test@example.com",
    "customerName": "Test User"
  }'
```

3. **Accept booking (provider)**
```bash
curl -X POST http://localhost:3000/v1/bookings/BOOKING_ID/accept \
  -H "Content-Type: application/json" \
  -d '{"providerId": "provider-1"}'
```

4. **Verify webhook events**
Check server logs for webhook processing:
```
✅ Booking payment authorized (webhook)
✅ Booking payment captured (webhook)
```

---

## Deployment to Railway

### Step 1: Connect Repository

1. Go to [railway.app](https://railway.app)
2. Create new project → Deploy from GitHub
3. Select your `yardline-backend` repository
4. Railway will auto-detect Node.js and start building

### Step 2: Configure Environment Variables

In Railway dashboard → Variables tab, add:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
PORT=3000
REVIEW_MODE=false
```

### Step 3: Configure Build Settings

Railway should auto-detect, but verify:
- **Build Command**: `npm run build`
- **Start Command**: `npm start`
- **Root Directory**: `/`

### Step 4: Deploy

Railway will automatically deploy on push to main branch.

Get your app URL from Railway dashboard (e.g., `https://yardline-backend-production.up.railway.app`)

### Step 5: Configure Stripe Production Webhook

1. Stripe Dashboard → Webhooks → Add endpoint
2. URL: `https://your-railway-url.up.railway.app/v1/stripe/webhooks`
3. Select events (see above)
4. Update `STRIPE_WEBHOOK_SECRET` in Railway with signing secret

### Step 6: Test Production

```bash
# Health check
curl https://your-railway-url.up.railway.app/health

# Create booking
curl -X POST https://your-railway-url.up.railway.app/v1/bookings \
  -H "Content-Type: application/json" \
  -d '{ ... }'
```

---

## Security Considerations

### Database Security
- ✅ Row Level Security (RLS) enabled on all tables
- ✅ Customers can only access their bookings
- ✅ Providers can only access their bookings
- ✅ Service role key used only for admin operations

### API Security
- ✅ JWT authentication required on all booking endpoints
- ✅ Ownership verification on accept/decline/cancel
- ✅ Server-side price calculation only
- ✅ Rate limiting recommended (add express-rate-limit)
- ✅ CORS properly configured

### Payment Security
- ✅ Webhook signature verification
- ✅ Idempotent operations
- ✅ No PCI data stored
- ✅ Stripe handles all payment data

### Production Recommendations
1. Add rate limiting: `npm install express-rate-limit`
2. Add request validation: `npm install joi`
3. Add logging: `npm install winston`
4. Add monitoring: Sentry, DataDog, or LogRocket
5. Enable HTTPS only (Railway does this automatically)
6. Rotate secrets regularly
7. Monitor Stripe webhooks for failures

---

## Troubleshooting

### Error: "No file system provider found"
This is a dev container issue. Run git commands directly in terminal:
```bash
git add -A
git commit -m "message"
git push
```

### Error: "relation bookings does not exist"
Run the database migration first:
```bash
psql $SUPABASE_URL -f migrations/001_booking_system.sql
```

### Error: "SUPABASE_URL not configured"
Add environment variables to `.env` file or Railway dashboard.

### Error: "charge_expired_for_capture"
Payment authorization expired (typically after 7 days). Customer must create new booking.

### Webhook not receiving events
1. Verify webhook URL is correct
2. Check webhook signing secret matches
3. Test with Stripe CLI: `stripe trigger payment_intent.succeeded`
4. Check server logs for signature errors

### Double booking still happening
1. Verify migration created exclusion constraint:
```sql
SELECT conname FROM pg_constraint WHERE conname = 'no_double_booking';
```
2. Check time_start/time_end are populated correctly
3. Verify status is 'pending' or 'confirmed' when checking

---

## Support & Documentation

- **Full API Docs**: See `BOOKING_SYSTEM.md`
- **Quick Reference**: See `BOOKING_API_REFERENCE.md`
- **Implementation Details**: See `BOOKING_IMPLEMENTATION_SUMMARY.md`
- **Deployment Checklist**: See `DEPLOYMENT_CHECKLIST_BOOKING.md`
- **Migration Guide**: See `migrations/MIGRATION_GUIDE.md`

---

## License

Proprietary - YardLine Inc.
