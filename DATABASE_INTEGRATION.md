# Database Integration Guide

This guide explains how to integrate the database-backed booking system into the existing index.ts file.

## Overview

The database-backed implementation provides:
- ✅ Supabase PostgreSQL storage (replaces in-memory Maps)
- ✅ Database-level double booking prevention (exclusion constraints)
- ✅ JWT authentication on all booking endpoints
- ✅ Transaction-safe booking acceptance
- ✅ Row Level Security (RLS)

## Integration Steps

### Step 1: Run Database Migration

**CRITICAL**: Run this BEFORE deploying the new code:

```bash
# Copy migration SQL to Supabase SQL Editor and run it
# Or use psql:
psql $DATABASE_URL -f migrations/001_booking_system.sql
```

This creates:
- `services` table
- Updates `bookings` table with payment columns
- Adds exclusion constraint for double booking prevention
- Sets up RLS policies

### Step 2: Install Dependencies

```bash
npm install @supabase/supabase-js
```

### Step 3: Add Environment Variables

Add to `.env` or Railway:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Step 4: Replace Booking Endpoints in index.ts

#### Option A: Use the Routes Module (Recommended)

Add near the top of index.ts (after Supabase initialization):

```typescript
import { createBookingRoutes } from './routes/bookings';

// ... existing code ...

// Mount booking routes
app.use('/v1', createBookingRoutes(
  supabase,
  stripe,
  calculateBookingPlatformFee,
  getOrCreateStripeAccountId,
  REVIEW_MODE,
  REVIEW_MODE_MAX_CHARGE_CENTS
));
```

Then **DELETE** the old booking endpoints section (lines ~1314-1958 in current file):
- DELETE: `POST /v1/services`
- DELETE: `GET /v1/services/:serviceId`
- DELETE: `GET /v1/services`
- DELETE: `POST /v1/bookings`
- DELETE: `GET /v1/bookings/:id`
- DELETE: `GET /v1/bookings`
- DELETE: `POST /v1/bookings/:id/accept`
- DELETE: `POST /v1/bookings/:id/decline`
- DELETE: `POST /v1/bookings/:id/cancel`

#### Option B: Manual Integration

If you prefer to keep endpoints in index.ts, follow these steps:

1. **Import database helpers at top**:
```typescript
import * as db from './db';
import { authenticateUser } from './middleware/auth';
```

2. **Replace each booking endpoint** with the database-backed version from `src/routes/bookings.ts`

3. **Add authentication middleware** to all booking endpoints:
```typescript
app.post('/v1/bookings', authenticateUser(supabase), async (req, res) => {
  // req.user.id is now available
  // ...
});
```

4. **Replace in-memory operations** with database calls:
```typescript
// OLD (in-memory):
const service = services.get(serviceId);

// NEW (database):
const service = await db.getService(supabase, serviceId);
```

### Step 5: Update Webhook Handlers

The webhook handlers are already updated in the current index.ts. They now call:
- `db.getBooking()` instead of `bookings.get()`
- `db.updateBookingStatus()` instead of `bookings.set()`

Verify these changes are in place.

### Step 6: Remove In-Memory Storage

After confirming database integration works, remove these lines from index.ts:

```typescript
// DELETE these lines:
const bookings: Map<string, Booking> = new Map();
const services: Map<string, Service> = new Map();
const providerBookings: Map<string, Set<string>> = new Map();
const customerBookings: Map<string, Set<string>> = new Map();
```

Keep these (used for tickets/Connect accounts):
```typescript
const connectAccounts: Map<string, ConnectAccount> = new Map();
const tickets: Map<string, Ticket[]> = new Map();
const processedPaymentIntents: Set<string> = new Set();
const processedWebhookEvents: Set<string> = new Set();
```

## Testing the Integration

### 1. Test Database Connection

Add a health check endpoint:

```typescript
app.get('/health/db', async (req, res) => {
  try {
    const { data, error } = await supabase.from('services').select('count');
    if (error) throw error;
    res.json({ success: true, database: 'connected' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Database connection failed' });
  }
});
```

Test it:
```bash
curl http://localhost:3000/health/db
```

### 2. Test Service Creation

```bash
# Get JWT token from Supabase Auth first
TOKEN="your-jwt-token"

curl -X POST http://localhost:3000/v1/services \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Service",
    "priceCents": 5000,
    "duration": 60
  }'
```

### 3. Test Booking Creation

```bash
curl -X POST http://localhost:3000/v1/bookings \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "serviceId": "SERVICE_ID_FROM_ABOVE",
    "requestedDate": "2026-01-20",
    "requestedTime": "14:00",
    "customerEmail": "test@example.com",
    "customerName": "Test User"
  }'
```

### 4. Verify Database Storage

Check Supabase dashboard:
1. Go to Table Editor
2. View `services` table - should see your test service
3. View `bookings` table - should see your test booking
4. Check `status` = 'pending' and `payment_status` = 'authorized'

### 5. Test Double Booking Prevention

Try to create overlapping booking:

```bash
# Create another booking for same provider at overlapping time
curl -X POST http://localhost:3000/v1/bookings \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "serviceId": "SAME_SERVICE_ID",
    "requestedDate": "2026-01-20",
    "requestedTime": "14:30",  # Overlaps with 14:00 booking
    ...
  }'

# Try to accept both bookings
# Second accept should fail with 409 Conflict
```

### 6. Test Webhook Integration

```bash
# Use Stripe CLI to test
stripe listen --forward-to localhost:3000/v1/stripe/webhooks
stripe trigger payment_intent.succeeded
```

Check logs for:
```
✅ Booking payment captured (webhook)
```

## Common Issues

### Issue: "Authentication required"

**Cause**: Missing or invalid JWT token

**Fix**: Get token from Supabase Auth:
```typescript
const { data: { session } } = await supabase.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'password'
});
const token = session.access_token;
```

### Issue: "Service not found" even though it exists

**Cause**: RLS policy blocking access

**Fix**: Temporarily disable RLS for testing:
```sql
ALTER TABLE services DISABLE ROW LEVEL SECURITY;
```

Or ensure service is marked `active = true`.

### Issue: "conflicting key value violates exclusion constraint"

**Cause**: Double booking detected by database (THIS IS GOOD!)

**Fix**: This is working correctly. Provider should decline one of the bookings.

### Issue: "relation services does not exist"

**Cause**: Migration not run

**Fix**: Run the migration SQL file first.

## Deployment Checklist

Before deploying to Railway:

- [ ] Database migration completed successfully
- [ ] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set in Railway
- [ ] All environment variables configured
- [ ] Local testing passed (all endpoints work)
- [ ] Double booking prevention tested
- [ ] Webhook events processing correctly
- [ ] Authentication working on all endpoints
- [ ] RLS policies tested
- [ ] Old in-memory code removed
- [ ] Dependencies installed (`@supabase/supabase-js`)

## Rollback Plan

If issues occur after deployment:

### Quick Rollback (Code Only)
1. Revert to previous git commit
2. Redeploy to Railway
3. Old code will continue using in-memory storage

### Full Rollback (Code + Database)
1. Revert code
2. Run rollback SQL (see migrations/MIGRATION_GUIDE.md)
3. Database returns to previous state

## Production Recommendations

### 1. Add Database Indices

Already included in migration, but verify:
```sql
CREATE INDEX IF NOT EXISTS bookings_provider_status_idx ON bookings(provider_id, status);
CREATE INDEX IF NOT EXISTS bookings_customer_status_idx ON bookings(customer_id, status);
CREATE INDEX IF NOT EXISTS bookings_payment_intent_idx ON bookings(payment_intent_id);
```

### 2. Monitor Database Performance

Watch for:
- Slow queries (use Supabase dashboard)
- Connection pool exhaustion
- Lock contention on bookings table

### 3. Add Connection Pooling

Supabase handles this automatically with connection pooler URL:
```
postgres://postgres:[password]@aws-0-us-west-1.pooler.supabase.com:6543/postgres
```

### 4. Set up Database Backups

Supabase provides automatic backups, but verify:
1. Go to Project Settings → Backup
2. Verify daily backups enabled
3. Test restore process

### 5. Add Logging

Use winston or pino for structured logging:
```typescript
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

// Log database operations
logger.info('Booking created', { bookingId, customerId, providerId });
```

## Next Steps

After successful integration:

1. ✅ Deploy to Railway
2. ✅ Test production environment
3. ✅ Monitor error rates
4. ✅ Set up alerts for booking conflicts
5. ✅ Monitor payment capture success rate
6. ✅ Review Supabase logs regularly
7. ✅ Optimize queries if needed
8. ✅ Consider adding caching (Redis) for frequently accessed services

## Support

- **Database Issues**: Check Supabase dashboard logs
- **Authentication Issues**: Verify JWT tokens in jwt.io
- **Payment Issues**: Check Stripe dashboard
- **API Errors**: Check Railway logs

## Summary

The database integration provides:
- ✅ Persistent storage (no more data loss on restart)
- ✅ Database-enforced double booking prevention
- ✅ Proper authentication and authorization
- ✅ Production-ready scalability
- ✅ Row Level Security
- ✅ Transaction safety

**You're ready for production!** 🚀
