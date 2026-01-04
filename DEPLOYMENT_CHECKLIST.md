# Deployment Checklist: Stripe Connect Environment-Aware Accounts

## Pre-Deployment Verification

- [ ] Code changes reviewed in [src/index.ts](src/index.ts)
- [ ] All 7 implementation changes identified and verified
- [ ] TypeScript compiles without errors (`npm run build`)
- [ ] No breaking changes to existing endpoints
- [ ] All documentation files created:
  - [ ] STRIPE_CONNECT_CHANGES.md
  - [ ] DEPLOYMENT_GUIDE.md
  - [ ] API_CHANGES.md
  - [ ] QUICK_REFERENCE.md
  - [ ] IMPLEMENTATION_SUMMARY.md

## Environment Preparation

### Test Environment Setup
- [ ] Verify test Stripe secret key available (sk_test_...)
- [ ] Verify test Stripe webhook secret available (optional)
- [ ] Prepare test environment variables
- [ ] Clear any previous environment variables that might conflict
- [ ] Verify network connectivity to stripe.com

### Live Environment Setup (If Deploying)
- [ ] Verify live Stripe secret key available (sk_live_...)
- [ ] Verify live Stripe webhook secret available
- [ ] Confirm this is separate from test key
- [ ] Double-check you have correct key (not test key)
- [ ] Prepare live environment variables

## Deployment Steps

### 1. Code Deployment
- [ ] Pull latest code with src/index.ts changes
- [ ] Verify file is present: src/index.ts
- [ ] Verify file size (should have ~115 lines of changes)

### 2. Dependency Installation
- [ ] Run: `npm install`
- [ ] Verify stripe@14.10.0 or later is installed
- [ ] Verify express@4.18.2 or later is installed
- [ ] Check for any dependency conflicts

### 3. Build Verification
- [ ] Run: `npm run build`
- [ ] Verify tsc compiles without errors
- [ ] Check dist/ folder has compiled output
- [ ] Verify dist/index.js exists and is valid

### 4. Environment Configuration

#### For Test Environment
```bash
export STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxx
export STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxx  # Optional
export PORT=3000
```
- [ ] Secret key starts with `sk_test_`
- [ ] All environment variables set
- [ ] No spaces in secret keys
- [ ] Keys are not committed to version control

#### For Live Environment (If Applicable)
```bash
export STRIPE_SECRET_KEY=sk_live_xxxxxxxxxxxx
export STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxx  # Optional
export PORT=3000
```
- [ ] Secret key starts with `sk_live_`
- [ ] All environment variables set
- [ ] Keys are not committed to version control
- [ ] Different from test key

### 5. Server Start
- [ ] Run: `npm start` (production) or `npm run dev` (development)
- [ ] Verify server starts without errors
- [ ] Check for any console warnings or errors
- [ ] Confirm listening on correct port (default 3000)

## Post-Deployment Testing

### Immediate Verification
- [ ] Health check endpoint responds:
  ```bash
  curl http://localhost:3000/health
  # Should return: {"status":"healthy",...}
  ```

- [ ] Mode detection endpoint works:
  ```bash
  curl http://localhost:3000/v1/stripe/mode
  # Should return: {"success":true,"data":{"mode":"test",...}}
  ```

- [ ] Root endpoint responds:
  ```bash
  curl http://localhost:3000/
  # Should return: {"status":"ok",...}
  ```

### Stripe Mode Verification
- [ ] Mode correctly detected as "test" (if using test key)
- [ ] `isTestMode` = true in response (if test key)
- [ ] `isLiveMode` = false in response (if test key)

### Account Creation Test
- [ ] Create test account:
  ```bash
  curl -X POST http://localhost:3000/v1/stripe/connect/accounts \
    -H "Content-Type: application/json" \
    -d '{
      "email": "test@example.com",
      "name": "Test Vendor",
      "userId": "test_user_1"
    }'
  ```

- [ ] Response includes `accountId`
- [ ] Response includes `onboardingUrl`
- [ ] Response includes `mode: "test"`
- [ ] accountId starts with "acct_"

### Account Reuse Verification
- [ ] Call account creation again with same `userId`
- [ ] Verify returned `accountId` is identical to first call
- [ ] Confirms account is cached and reused

### Account Link Test
- [ ] Get account from creation response
- [ ] Create account link:
  ```bash
  curl -X POST http://localhost:3000/v1/stripe/connect/accounts/{accountId}/link \
    -H "Content-Type: application/json" \
    -d '{
      "returnUrl": "https://example.com/return",
      "refreshUrl": "https://example.com/refresh"
    }'
  ```

- [ ] Response includes `url`
- [ ] Response includes `mode`
- [ ] URL is valid Stripe onboarding URL

### Onboarding Link Verification
- [ ] Visit returned onboarding URL
- [ ] Verify Stripe Connect page loads
- [ ] Confirm it's the correct mode (test shows demo data)
- [ ] In test mode: No real SSN should be required
- [ ] In test mode: Can use test data to complete onboarding

### Account Retrieval Test
- [ ] Retrieve account from earlier:
  ```bash
  curl http://localhost:3000/v1/stripe/connect/accounts/{accountId}
  ```

- [ ] Response includes all account details
- [ ] Response includes `mode`
- [ ] Status reflects Stripe account state

### Payment Intent Test (Unchanged)
- [ ] Create payment intent still works:
  ```bash
  curl -X POST http://localhost:3000/v1/stripe/payment-intents \
    -H "Content-Type: application/json" \
    -d '{
      "items": [],
      "totalChargeCents": 1000,
      "description": "Test charge"
    }'
  ```

- [ ] Response includes `paymentIntentId`
- [ ] Response includes `clientSecret`
- [ ] Status is "requires_payment_method"

## Mode-Specific Testing

### Test Mode Only (sk_test_...)
- [ ] Onboarding doesn't require real SSN
- [ ] Can complete with test information
- [ ] Test credit cards work
- [ ] No real charges occur

### Mode Switching Test (If Testing Both)
1. [ ] Deploy with test key
2. [ ] Create account, verify test account created
3. [ ] Stop server
4. [ ] Change to live key
5. [ ] Restart server
6. [ ] Verify mode changed to "live"
7. [ ] Create account with same userId
8. [ ] Verify different accountId returned
9. [ ] Confirm two accounts exist (test + live)

## Monitoring & Logs

- [ ] Check server logs for any errors
- [ ] Verify no warnings about deprecated APIs
- [ ] Monitor error rate in requests
- [ ] Check Stripe webhook delivery status
- [ ] No unexpected 500 errors

## Frontend Communication

- [ ] Notify frontend developers of `userId` requirement
- [ ] Update frontend to include `userId` in account creation
- [ ] Update frontend to handle `mode` in responses
- [ ] Test frontend integration with updated API
- [ ] Verify onboarding flow in test mode works

## Rollback Plan

If issues encountered:
- [ ] Stop server
- [ ] Revert to previous src/index.ts
- [ ] Reinstall dependencies: `npm install`
- [ ] Rebuild: `npm run build`
- [ ] Restart server
- [ ] Verify rollback successful

## Documentation Updates

- [ ] README.md updated with new endpoints
- [ ] API documentation updated
- [ ] Developer guide includes new `userId` parameter
- [ ] Deployment runbook includes environment setup
- [ ] Team notified of changes

## Performance Check

- [ ] Account creation response time acceptable (< 1 second)
- [ ] Mode detection is instant (no API call)
- [ ] No memory leaks after extended use
- [ ] In-memory Map doesn't grow unbounded

## Database Migration Plan

For production use, plan to migrate from in-memory to database:
- [ ] Database schema updated with testStripeAccountId, liveStripeAccountId
- [ ] Migration script prepared
- [ ] Rollback strategy defined
- [ ] Test migration in staging first
- [ ] Schedule database migration

## Security Validation

- [ ] Test key not used in live environment
- [ ] Live key not accidentally used in test
- [ ] Webhook signature verification still works
- [ ] No sensitive data logged
- [ ] CORS headers still appropriate

## Final Sign-Off

- [ ] Tech lead review: _______________
- [ ] QA verification complete: _______________
- [ ] Frontend team ready: _______________
- [ ] DevOps approved: _______________
- [ ] All tests passing: _______________

## Post-Deployment Monitoring (24 hours)

- [ ] Monitor error rates
- [ ] Check Stripe dashboard for account activity
- [ ] Verify webhook events processing
- [ ] Monitor server performance
- [ ] Check logs for anomalies
- [ ] Verify no customer complaints
- [ ] Performance metrics stable

## Completion

- [ ] Deployment complete
- [ ] All tests passing
- [ ] Monitoring in place
- [ ] Team notified
- [ ] Documentation updated
- [ ] Ready for production use

---

## Quick Reference

| Step | Command | Expected Result |
|------|---------|-----------------|
| Install | `npm install` | Dependencies installed |
| Build | `npm run build` | No errors |
| Start | `npm start` | Server running on port 3000 |
| Test Mode | `curl /v1/stripe/mode` | `"mode":"test"` |
| Create Account | `curl -X POST /v1/stripe/connect/accounts ...` | Returns accountId and mode |
| Verify | `curl /v1/stripe/connect/accounts/{id}` | Returns account details |

---

## Issues & Resolutions

| Issue | Cause | Solution |
|-------|-------|----------|
| tsc not found | Dependencies not installed | Run `npm install` |
| Wrong mode detected | Old STRIPE_SECRET_KEY cached | Restart server |
| Same account ID in both modes | Server not restarted after key change | Restart server |
| userId not found in request | Request body missing userId | Update frontend code |
| Onboarding requires real SSN | Using live key in test | Verify correct key used |

