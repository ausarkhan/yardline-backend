# API Changes & Integration Guide

## Summary of Changes

The Stripe Connect API has been updated to support environment-aware account handling. This prevents test mode from reusing live Stripe accounts.

## Changed Endpoints

### POST `/v1/stripe/connect/accounts`

**New Request Body (Enhanced):**
```json
{
  "email": "vendor@example.com",
  "name": "Vendor Name",
  "returnUrl": "https://app.com/stripe/return",
  "refreshUrl": "https://app.com/stripe/refresh",
  "userId": "user_123"  // NEW: Required for account separation
}
```

**New Response (Enhanced):**
```json
{
  "success": true,
  "data": {
    "accountId": "acct_1234567890",
    "onboardingUrl": "https://connect.stripe.com/onboarding/...",
    "mode": "test"  // NEW: Indicates current Stripe mode
  }
}
```

**Changes:**
- `userId` parameter is now required in request body
- Response now includes `mode` field ('test' or 'live')
- Account is automatically created or retrieved based on mode
- If account exists for this user in this mode, it's reused
- If account doesn't exist, a new one is created

**Example Usage:**
```javascript
const response = await fetch('/v1/stripe/connect/accounts', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'vendor@example.com',
    name: 'My Venue',
    userId: 'vendor_abc123',  // Add this!
    returnUrl: 'https://app.com/return',
    refreshUrl: 'https://app.com/refresh'
  })
});

const data = await response.json();
console.log(`Account: ${data.data.accountId}`);
console.log(`Mode: ${data.data.mode}`);  // 'test' or 'live'
console.log(`Onboard at: ${data.data.onboardingUrl}`);
```

---

### GET `/v1/stripe/connect/accounts/:accountId`

**New Response (Enhanced):**
```json
{
  "success": true,
  "data": {
    "accountId": "acct_1234567890",
    "email": "vendor@example.com",
    "name": "Vendor Name",
    "chargesEnabled": true,
    "payoutsEnabled": true,
    "detailsSubmitted": true,
    "status": "active",
    "createdAt": "2024-01-04T10:00:00Z",
    "testStripeAccountId": "acct_1234567890"  // NEW (if in test mode)
    "liveStripeAccountId": "acct_9876543210"  // NEW (if in live mode)
  },
  "mode": "test"  // NEW: Current Stripe mode
}
```

**Changes:**
- Response now includes `mode` field
- Response includes relevant mode-specific account ID
- Helps track which account is active

---

### POST `/v1/stripe/connect/accounts/:accountId/link`

**Request Body (Unchanged):**
```json
{
  "returnUrl": "https://app.com/stripe/return",
  "refreshUrl": "https://app.com/stripe/refresh"
}
```

**New Response (Enhanced):**
```json
{
  "success": true,
  "data": {
    "url": "https://connect.stripe.com/onboarding/..."
  },
  "mode": "test"  // NEW: Current Stripe mode
}
```

**Changes:**
- Response now includes `mode` field
- Onboarding type remains `account_onboarding` (no functional change)
- Same onboarding flow, but with correct environment

---

## NEW Endpoint

### GET `/v1/stripe/mode`

Returns the current Stripe environment mode.

**Request:**
```bash
GET /v1/stripe/mode
```

**Response:**
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

**Use Cases:**
1. Display environment indicator in UI (e.g., "🔴 TEST MODE")
2. Validate that correct secret key is loaded
3. Debug mode-related issues
4. Conditional frontend logic (test vs production flows)

**Example Usage:**
```javascript
const modeResponse = await fetch('/v1/stripe/mode');
const { data } = await modeResponse.json();

if (data.mode === 'test') {
  console.log('⚠️  Running in TEST mode - use test credit cards');
  showTestBanner(true);
} else {
  console.log('🔒 Running in LIVE mode - real charges apply');
  showTestBanner(false);
}
```

---

## Unchanged Endpoints

These endpoints have NO CHANGES:
- `POST /v1/stripe/payment-intents`
- `GET /v1/stripe/payment-intents/:paymentIntentId`
- `POST /v1/stripe/payment-intents/:paymentIntentId/cancel`
- `POST /v1/stripe/refunds`
- `GET /v1/tickets/by-payment/:paymentIntentId`
- `POST /v1/stripe/webhooks`

---

## Migration Guide for Frontend

### Step 1: Update Account Creation Calls

**Before:**
```javascript
const response = await createStripeAccount({
  email: 'vendor@example.com',
  name: 'Venue Name'
  // No userId
});
```

**After:**
```javascript
const response = await createStripeAccount({
  email: 'vendor@example.com',
  name: 'Venue Name',
  userId: 'vendor_xyz123'  // ADD THIS
});
```

### Step 2: Handle Mode in Response

**Before:**
```javascript
const { accountId, onboardingUrl } = response.data;
window.location.href = onboardingUrl;
```

**After:**
```javascript
const { accountId, onboardingUrl, mode } = response.data;

// Optional: Show mode indicator
if (mode === 'test') {
  showWarning('⚠️  TEST MODE - Real SSN not required');
}

window.location.href = onboardingUrl;
```

### Step 3: Add Mode Check (Optional)

```javascript
// At app startup, verify you're in correct mode
async function verifyEnvironment() {
  const response = await fetch('/v1/stripe/mode');
  const { data } = await response.json();
  
  if (process.env.NODE_ENV === 'production' && data.mode === 'test') {
    console.error('⛔ ERROR: Running production frontend with test Stripe key!');
  }
  
  if (process.env.NODE_ENV === 'development' && data.mode === 'live') {
    console.warn('⚠️  WARNING: Running dev frontend with live Stripe key!');
  }
}
```

---

## Key Behaviors

### Test Mode (sk_test_...)
✅ **Onboarding:**
- No real SSN required
- Use test data (SSN 000-00-0000)
- Test business information acceptable

✅ **Testing:**
- No real charges
- Use [test credit cards](https://stripe.com/docs/testing)
- Safe for development

### Live Mode (sk_live_...)
⚠️ **Onboarding:**
- Real SSN/ITIN required
- Real business information
- Identity verification needed

⚠️ **Real Charges:**
- Customer charges are real
- Vendor payouts are real
- Production data only

---

## Account Isolation

### Same User, Different Modes
When a user creates an account in both test and live modes:

| Mode | Account ID | Storage | Purpose |
|------|-----------|---------|---------|
| Test | `acct_test_xxx` | `testStripeAccountId` | Testing & development |
| Live | `acct_live_yyy` | `liveStripeAccountId` | Production payouts |

**Before Fix:**
```
User creates account in Test mode  → Gets acct_1234567890
Switch to Live mode                → Reuses acct_1234567890 ❌
Live onboarding requires real SSN  ❌
```

**After Fix:**
```
User creates account in Test mode  → Gets acct_1234567890
Switch to Live mode                → Creates new acct_9999999 ✅
Live onboarding has separate account ✅
```

---

## Error Handling

### Existing Error Responses (Unchanged)
All error responses maintain the same format:

```json
{
  "success": false,
  "error": {
    "type": "api_error",
    "message": "Error description"
  }
}
```

### New Validation
- `userId` is required in account creation request
- Missing `userId` returns 400 error

---

## Testing Checklist for Frontend Developers

- [ ] Account creation includes `userId` parameter
- [ ] Response includes `mode` field
- [ ] Mode indicator displays correctly
- [ ] Test mode onboarding doesn't require real SSN
- [ ] Switching between test/live creates separate accounts
- [ ] Existing payment flow still works
- [ ] Webhooks still process correctly
- [ ] Refund flow still works

---

## Support & Questions

- **Mode Detection Issues?** Check `/v1/stripe/mode` endpoint
- **Account Creation Failing?** Verify `userId` is provided
- **Still Reusing Accounts?** Restart backend after changing `STRIPE_SECRET_KEY`
- **Need Backend Changes?** See `STRIPE_CONNECT_CHANGES.md`

