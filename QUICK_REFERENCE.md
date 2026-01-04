# Quick Reference: Environment-Aware Stripe Connect

## The Problem
Backend was reusing a **live Stripe account** when running in **test mode**, forcing test onboarding to request real SSN.

## The Solution
Implemented environment-aware account handling with separate test and live accounts per user.

---

## Implementation Summary

### Code Changes in `src/index.ts`

#### 1. Detect Stripe Mode (Lines 16-21)
```typescript
const isTestMode = process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_') || false;
const isLiveMode = process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') || false;

function getStripeMode(): 'test' | 'live' {
  return isTestMode ? 'test' : 'live';
}
```

#### 2. Track Separate Accounts (Lines 73-77)
```typescript
interface UserStripeAccounts {
  userId: string;
  testStripeAccountId?: string;
  liveStripeAccountId?: string;
}
```

#### 3. Get/Create Correct Account (Lines 79-114)
```typescript
async function getOrCreateStripeAccountId(
  userId: string,
  email: string,
  name: string
): Promise<string>
```
- Checks if user has account for current mode
- Reuses existing account if available
- Creates new account in correct mode if needed

#### 4. Updated Endpoints
- `POST /v1/stripe/connect/accounts` - Uses helper, accepts userId, returns mode
- `GET /v1/stripe/connect/accounts/:accountId` - Returns mode info
- `POST /v1/stripe/connect/accounts/:accountId/link` - Returns mode info
- `GET /v1/stripe/mode` - **NEW** - Returns current Stripe mode

---

## What Changed in Responses

### Before
```json
{
  "success": true,
  "data": {
    "accountId": "acct_123",
    "onboardingUrl": "https://..."
  }
}
```

### After
```json
{
  "success": true,
  "data": {
    "accountId": "acct_123",
    "onboardingUrl": "https://...",
    "mode": "test"  // ← NEW
  }
}
```

---

## Test Mode vs Live Mode

| Aspect | Test Mode (sk_test_) | Live Mode (sk_live_) |
|--------|---------------------|----------------------|
| **Secret Key** | sk_test_... | sk_live_... |
| **Account Created** | acct_test_xxx | acct_live_yyy |
| **Storage Field** | testStripeAccountId | liveStripeAccountId |
| **Onboarding** | No real SSN | Real SSN required |
| **Charges** | Simulate only | Real transactions |
| **Use Case** | Development | Production |

---

## For Backend Developers

### 1. Deploy Changes
```bash
cd /workspaces/yardline-backend
npm install && npm run build
export STRIPE_SECRET_KEY=sk_test_...
npm run start
```

### 2. Verify Mode Detection
```bash
curl http://localhost:3000/v1/stripe/mode
```

### 3. Create Test Account
```bash
curl -X POST http://localhost:3000/v1/stripe/connect/accounts \
  -H "Content-Type: application/json" \
  -d '{
    "email": "vendor@example.com",
    "name": "Test Vendor",
    "userId": "vendor_001"
  }'
```

---

## For Frontend Developers

### 1. Add userId to Account Creation
```javascript
await fetch('/v1/stripe/connect/accounts', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'vendor@example.com',
    name: 'Venue',
    userId: 'user_123'  // ← ADD THIS
  })
});
```

### 2. Use Mode in Response
```javascript
const response = await createAccount({...});
const { accountId, onboardingUrl, mode } = response.data;

if (mode === 'test') {
  console.log('ℹ️  Test mode - no real charges');
}
```

### 3. Show Mode Indicator (Optional)
```javascript
const modeResponse = await fetch('/v1/stripe/mode');
const { data: { mode } } = await modeResponse.json();

if (mode === 'test') {
  document.body.classList.add('test-mode');  // Style accordingly
}
```

---

## Expected Test Results

### Test 1: Mode Detection
```bash
$ curl http://localhost:3000/v1/stripe/mode
{"success":true,"data":{"mode":"test","isTestMode":true,"isLiveMode":false}}
✅ Pass
```

### Test 2: Account Creation in Test Mode
```bash
$ curl -X POST http://localhost:3000/v1/stripe/connect/accounts \
  -H "Content-Type: application/json" \
  -d '{"email":"v@ex.com","name":"Venue","userId":"user1"}'
{
  "success": true,
  "data": {
    "accountId": "acct_1Abc2Def3Ghi",
    "onboardingUrl": "https://connect.stripe.com/...",
    "mode": "test"
  }
}
✅ Pass
```

### Test 3: Account Reuse (Same userId)
```bash
# Call same endpoint again with same userId
$ curl -X POST http://localhost:3000/v1/stripe/connect/accounts \
  -H "Content-Type: application/json" \
  -d '{"email":"v@ex.com","name":"Venue","userId":"user1"}'
{
  "success": true,
  "data": {
    "accountId": "acct_1Abc2Def3Ghi",  // ← SAME ID
    "onboardingUrl": "https://connect.stripe.com/...",
    "mode": "test"
  }
}
✅ Pass - Account was reused, not recreated
```

### Test 4: Account Separation (Test vs Live)
1. Switch to live key: `export STRIPE_SECRET_KEY=sk_live_...`
2. Restart backend
3. Create account with same userId:
```bash
$ curl -X POST http://localhost:3000/v1/stripe/connect/accounts \
  -H "Content-Type: application/json" \
  -d '{"email":"v@ex.com","name":"Venue","userId":"user1"}'
{
  "success": true,
  "data": {
    "accountId": "acct_2Xyz9Uvw4Rst",  // ← DIFFERENT ID!
    "onboardingUrl": "https://connect.stripe.com/...",
    "mode": "live"
  }
}
✅ Pass - New account created for live mode
```

### Test 5: Onboarding Flow
Visit the `onboardingUrl` from Test 2:
- ✅ Stripe onboarding opens
- ✅ No real SSN request (test mode behavior)
- ✅ Can use test business info
- ✅ Can use test bank account (routing: 110000000)

---

## Database Schema (Future Migration)

When moving to persistent storage, add to user/provider table:

```sql
ALTER TABLE users ADD COLUMN testStripeAccountId VARCHAR(255);
ALTER TABLE users ADD COLUMN liveStripeAccountId VARCHAR(255);

-- Create index for faster lookups
CREATE INDEX idx_test_stripe_account ON users(testStripeAccountId);
CREATE INDEX idx_live_stripe_account ON users(liveStripeAccountId);
```

Update `getOrCreateStripeAccountId()` to:
- Query database instead of Map
- Save results to database instead of Map
- Persist across server restarts

---

## Files Modified
- ✅ [src/index.ts](src/index.ts) - Main implementation

## Documentation Added
- ✅ [STRIPE_CONNECT_CHANGES.md](STRIPE_CONNECT_CHANGES.md) - Technical details
- ✅ [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) - Deployment & testing
- ✅ [API_CHANGES.md](API_CHANGES.md) - Frontend integration guide
- ✅ [QUICK_REFERENCE.md](QUICK_REFERENCE.md) - This file

---

## Key Takeaways

1. **Test & Live are Separate**: Each user now has separate accounts for test and live modes
2. **No More Real SSN in Test**: Test mode onboarding no longer requires real SSN
3. **Automatic Account Management**: Backend creates/reuses accounts intelligently
4. **Frontend Change**: Add `userId` to account creation request
5. **Mode Detection**: New `/v1/stripe/mode` endpoint for debugging

---

## Next Steps

1. Deploy backend changes
2. Verify mode detection works
3. Update frontend to include `userId`
4. Test onboarding flow in test mode (no real SSN)
5. Verify account separation between modes
6. Plan database migration for production

