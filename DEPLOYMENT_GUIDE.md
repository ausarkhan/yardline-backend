# Deployment & Testing Guide

## Pre-Deployment Checklist

### Code Review
- ✅ Environment detection logic added (lines 16-21)
- ✅ UserStripeAccounts interface created (lines 73-77)
- ✅ getOrCreateStripeAccountId() helper implemented (lines 79-114)
- ✅ Account creation endpoint updated (lines 137-165)
- ✅ Account retrieval endpoint updated (lines 167-195)
- ✅ Account link endpoint updated (lines 197-211)
- ✅ New `/v1/stripe/mode` endpoint added (lines 130-133)

### Key Files Modified
- `/workspaces/yardline-backend/src/index.ts` - Main implementation

## Deployment Steps

### 1. Build the Backend
```bash
npm install
npm run build
```

### 2. Test Environment Variables
Ensure you have the correct Stripe secret key set:

**For Test Environment:**
```bash
export STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxx
export STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxx  # Optional
```

**For Live Environment:**
```bash
export STRIPE_SECRET_KEY=sk_live_xxxxxxxxxxxx
export STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxx  # Optional
```

### 3. Start the Server
```bash
npm run dev    # Development with hot reload
npm run start  # Production mode
```

## Testing Verification

### Step 1: Verify Mode Detection
```bash
curl http://localhost:3000/v1/stripe/mode
```

**Expected Response (Test Mode):**
```json
{
  "success": true,
  "data": {
    "mode": "test",
    "isTestMode": true,
    "isLiveMode": false
  }
}
```

### Step 2: Create Test Account in Test Mode
```bash
curl -X POST http://localhost:3000/v1/stripe/connect/accounts \
  -H "Content-Type: application/json" \
  -d '{
    "email": "vendor1@example.com",
    "name": "Test Vendor",
    "userId": "vendor_001",
    "returnUrl": "https://example.com/return",
    "refreshUrl": "https://example.com/refresh"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "accountId": "acct_1234567890",
    "onboardingUrl": "https://connect.stripe.com/onboarding/...",
    "mode": "test"
  }
}
```

### Step 3: Test Onboarding Link
The returned `onboardingUrl` should open Stripe's Express onboarding:
- For **test mode**: Should allow test account details without requiring real SSN
- Should ask for business information (EIN, address)
- Banking details should accept test bank information

### Step 4: Verify No Account Reuse
1. Call the account creation endpoint again with same userId and test mode key:
```bash
curl -X POST http://localhost:3000/v1/stripe/connect/accounts \
  -H "Content-Type: application/json" \
  -d '{
    "email": "vendor1@example.com",
    "name": "Test Vendor",
    "userId": "vendor_001"
  }'
```

2. Verify the returned `accountId` is **identical** to the first call
3. This confirms the account is cached and not being recreated

### Step 5: Switch to Live Mode and Test Account Separation
1. Update environment variable:
```bash
export STRIPE_SECRET_KEY=sk_live_xxxxxxxxxxxx
```

2. Restart the backend

3. Verify mode changed:
```bash
curl http://localhost:3000/v1/stripe/mode
# Should return mode: "live"
```

4. Create account with same userId but live mode:
```bash
curl -X POST http://localhost:3000/v1/stripe/connect/accounts \
  -H "Content-Type: application/json" \
  -d '{
    "email": "vendor1@example.com",
    "name": "Test Vendor",
    "userId": "vendor_001"
  }'
```

5. **Verify** the returned `accountId` is **different** from the test mode account
   - Test mode: `acct_test_xxx`
   - Live mode: `acct_live_xxx`
   - They should be completely different accounts

### Step 6: Verify Onboarding Behavior
**Test Mode Onboarding:**
- Opens without requiring real SSN
- Allows completion with test data
- Perfect for development/testing

**Live Mode Onboarding:**
- Requires real business verification
- Asks for actual SSN or ITIN
- Requires valid bank account information

## Expected Behavior After Fix

| Scenario | Before Fix | After Fix |
|----------|-----------|-----------|
| Create account in test mode | ✗ Might reuse live account | ✓ Creates test account |
| Test onboarding | ✗ Requires real SSN | ✓ Allows test data |
| Switch to live mode | ✗ Reuses same account | ✓ Creates separate live account |
| Account separation | ✗ Mixed test/live | ✓ Complete separation |

## Troubleshooting

### Issue: Mode detection not working
**Solution:** Verify `STRIPE_SECRET_KEY` environment variable
- Should start with `sk_test_` or `sk_live_`
- Check: `echo $STRIPE_SECRET_KEY`

### Issue: Same account ID returned in both modes
**Solution:** Ensure backend was restarted after changing `STRIPE_SECRET_KEY`
- Environment variables are read at startup
- Need full restart to pick up new key

### Issue: Onboarding still requires real SSN in test mode
**Solution:** Confirm account was created in test mode
- Check via API: `GET /v1/stripe/mode`
- Verify account_id prefix matches mode (test accounts have different prefix)

### Issue: Frontend not receiving mode information
**Solution:** Updated response format includes `mode` field
- Update frontend to handle new response structure
- Example: `response.data.mode` will be 'test' or 'live'

## Database Migration (Future)

Current implementation uses in-memory storage. For production:

1. Add columns to user/provider table:
   ```sql
   ALTER TABLE users ADD COLUMN testStripeAccountId VARCHAR(255);
   ALTER TABLE users ADD COLUMN liveStripeAccountId VARCHAR(255);
   ```

2. Update `getOrCreateStripeAccountId()` to use database:
   ```typescript
   // Query database instead of Map
   const userAccounts = await database.getUserStripeAccounts(userId);
   // Save to database instead of Map
   await database.updateUserStripeAccount(userId, mode, accountId);
   ```

3. Benefits:
   - Persist accounts across server restarts
   - Prevent duplicate account creation
   - Scale to multiple servers
   - Enable account recovery

## Support

For questions about:
- **Stripe API**: See [Stripe Connect Documentation](https://stripe.com/docs/connect)
- **Test Mode**: See [Stripe Testing Guide](https://stripe.com/docs/testing)
- **Implementation Details**: Check `STRIPE_CONNECT_CHANGES.md`
