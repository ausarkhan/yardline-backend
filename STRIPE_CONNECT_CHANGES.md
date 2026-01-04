# Stripe Connect Environment-Aware Account Handling

## Overview
This update implements environment-aware Stripe Connect account handling to prevent reusing live Stripe accounts when running in test mode.

## Key Changes

### 1. Stripe Mode Detection
- Added detection of Stripe mode (test vs live) based on the secret key prefix:
  - `sk_test_...` = Test mode
  - `sk_live_...` = Live mode
- Added `getStripeMode()` function that returns 'test' | 'live'

### 2. Data Structure Updates
- **ConnectAccount interface**: Added optional fields:
  - `testStripeAccountId?: string` - Stores test mode account ID
  - `liveStripeAccountId?: string` - Stores live mode account ID

- **New UserStripeAccounts interface**: Tracks both test and live account IDs per user
  ```typescript
  interface UserStripeAccounts {
    userId: string;
    testStripeAccountId?: string;
    liveStripeAccountId?: string;
  }
  ```

- **New userStripeAccounts Map**: In-memory storage for user Stripe account mappings

### 3. Core Logic: getOrCreateStripeAccountId()
This helper function ensures environment-aware account creation:
1. Detects current Stripe mode from secret key
2. Checks if user already has an account ID for that mode
3. If account exists, returns it (avoids reuse across modes)
4. If not, creates a new Stripe Express account in the appropriate mode
5. Stores the account ID for future use

```typescript
async function getOrCreateStripeAccountId(userId: string, email: string, name: string): Promise<string>
```

### 4. Updated Endpoints

#### POST `/v1/stripe/connect/accounts`
- Now accepts optional `userId` parameter in request body
- Uses `getOrCreateStripeAccountId()` to get/create the correct account for the mode
- Returns response with `mode` field indicating current Stripe mode
- Stores mode-specific account IDs

#### GET `/v1/stripe/connect/accounts/:accountId`
- Returns account data with mode information
- Stores mode-specific account ID when retrieved

#### POST `/v1/stripe/connect/accounts/:accountId/link`
- Now returns response with `mode` field
- Maintains existing account_onboarding type (no change)

#### NEW: GET `/v1/stripe/mode`
- Returns current Stripe mode for debugging/verification
- Useful for confirming test vs live environment at runtime
- Response format:
  ```json
  {
    "success": true,
    "data": {
      "mode": "test" | "live",
      "isTestMode": boolean,
      "isLiveMode": boolean
    }
  }
  ```

## Expected Behavior

### Test Mode (sk_test_...)
- Separate account created for testing
- Onboarding allows full testing without real SSN
- Account ID stored in `testStripeAccountId`
- Test accounts never reused when switching modes

### Live Mode (sk_live_...)
- Separate account for production
- Onboarding requires real verification
- Account ID stored in `liveStripeAccountId`
- Live accounts never accidentally used in test mode

## Important Notes

1. **Backwards Compatible**: Existing endpoints continue to work
2. **Account Separation**: Test and live accounts are completely separate
3. **Persistent Storage**: Current implementation uses in-memory storage (Map)
   - For production, migrate to persistent database storage
   - Implement with fields: `testStripeAccountId` and `liveStripeAccountId` on user/provider record

4. **Account Onboarding**: The `type: "account_onboarding"` setting is maintained and unchanged

## Testing

1. Verify current mode:
   ```bash
   curl http://localhost:3000/v1/stripe/mode
   ```

2. Create account in test mode:
   ```bash
   curl -X POST http://localhost:3000/v1/stripe/connect/accounts \
     -H "Content-Type: application/json" \
     -d '{
       "email": "test@example.com",
       "name": "Test Event",
       "userId": "user123"
     }'
   ```

3. Switch to live mode and verify:
   - Update `STRIPE_SECRET_KEY` to live key
   - Restart backend
   - Create account again - should create new live account, not reuse test account

## Migration to Database

For production use, implement persistent storage:

```typescript
// In your database schema
interface User {
  id: string;
  testStripeAccountId?: string;
  liveStripeAccountId?: string;
  // ... other fields
}
```

Update `getOrCreateStripeAccountId()` to:
1. Query database for existing account IDs
2. Save new account IDs to database
3. Implement proper error handling for database operations
