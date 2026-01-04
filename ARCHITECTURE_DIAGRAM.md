# Architecture Diagram: Environment-Aware Stripe Connect

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Frontend Application                          │
│  (Next.js / React)                                              │
│                                                                   │
│  POST /v1/stripe/connect/accounts                               │
│  + email, name, userId, returnUrl, refreshUrl                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  YardLine Backend API                            │
│  (Express.js + TypeScript)                                      │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Environment Detection                                    │   │
│  │ ┌─────────────────────────────────────────────────────┐ │   │
│  │ │ process.env.STRIPE_SECRET_KEY                       │ │   │
│  │ │ ├─ sk_test_... → Test Mode                          │ │   │
│  │ │ └─ sk_live_... → Live Mode                          │ │   │
│  │ └─────────────────────────────────────────────────────┘ │   │
│  │ getStripeMode() → 'test' | 'live'                       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                    │
│                              ▼                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Account Management                                       │   │
│  │ ┌─────────────────────────────────────────────────────┐ │   │
│  │ │ getOrCreateStripeAccountId(userId, email, name)    │ │   │
│  │ │                                                      │ │   │
│  │ │ 1. Detect mode (test/live)                          │ │   │
│  │ │ 2. Check UserStripeAccounts Map                     │ │   │
│  │ │ 3. If exists: Return cached account ID              │ │   │
│  │ │ 4. If not: Create new Stripe account                │ │   │
│  │ │ 5. Store in appropriate field:                      │ │   │
│  │ │    - testStripeAccountId OR                         │ │   │
│  │ │    - liveStripeAccountId                            │ │   │
│  │ └─────────────────────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                    │
│                              ▼                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ In-Memory Storage (UserStripeAccounts)                  │   │
│  │                                                          │   │
│  │ Map<userId, {                                            │   │
│  │   userId: string,                                        │   │
│  │   testStripeAccountId?: string,   // acct_test_xxx      │   │
│  │   liveStripeAccountId?: string    // acct_live_yyy      │   │
│  │ }>                                                        │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                    │
│                              ▼                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ API Response                                             │   │
│  │ {                                                        │   │
│  │   "success": true,                                       │   │
│  │   "data": {                                              │   │
│  │     "accountId": "acct_1234567890",                      │   │
│  │     "onboardingUrl": "https://connect.stripe.com/...",  │   │
│  │     "mode": "test"   ← Mode indicator                    │   │
│  │   }                                                      │   │
│  │ }                                                        │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Stripe API                                    │
│                                                                   │
│  ┌─────────────────────┐      ┌─────────────────────┐            │
│  │   Test Environment  │      │  Live Environment   │            │
│  │   (sk_test_...)     │      │  (sk_live_...)      │            │
│  │                     │      │                     │            │
│  │ • Test accounts     │      │ • Live accounts     │            │
│  │ • No real charges   │      │ • Real charges      │            │
│  │ • Test data OK      │      │ • Real data needed  │            │
│  │ • No real SSN       │      │ • SSN verification  │            │
│  │                     │      │                     │            │
│  │ acct_test_abc123    │      │ acct_live_xyz789    │            │
│  │ (Same user, test)   │      │ (Same user, live)   │            │
│  └─────────────────────┘      └─────────────────────┘            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Request Flow Diagram

```
REQUEST: Create Stripe Connect Account
│
├─ User Data: email, name, userId
│
▼
GET STRIPE MODE
├─ Read: process.env.STRIPE_SECRET_KEY
├─ Check prefix: sk_test_ OR sk_live_
└─ Result: 'test' OR 'live'
│
▼
LOOKUP EXISTING ACCOUNT
├─ userStripeAccounts.get(userId)
│
├─ IF mode === 'test':
│  └─ Check: testStripeAccountId
│
├─ IF mode === 'live':
│  └─ Check: liveStripeAccountId
│
└─ Result: Found OR Not Found
│
▼
DECISION POINT
│
├─ IF Found:
│  └─ Return cached accountId
│
└─ IF Not Found:
   │
   ▼
   CREATE NEW ACCOUNT
   ├─ stripe.accounts.create({
   │  type: 'express',
   │  email,
   │  capabilities: {...},
   │  business_profile: {name}
   │ })
   │
   ▼
   STORE ACCOUNT ID
   ├─ IF mode === 'test':
   │  └─ userAccounts.testStripeAccountId = accountId
   │
   └─ IF mode === 'live':
      └─ userAccounts.liveStripeAccountId = accountId
│
▼
CREATE ONBOARDING LINK
├─ stripe.accountLinks.create({
│  account: accountId,
│  type: 'account_onboarding',
│  refresh_url, return_url
│ })
│
▼
RESPONSE
└─ {
   "success": true,
   "data": {
     "accountId": accountId,
     "onboardingUrl": link.url,
     "mode": mode
   }
  }
```

---

## Data Structure Evolution

### Initial Request
```
{
  email: "vendor@example.com",
  name: "Venue Name",
  userId: "vendor_001",
  returnUrl: "https://...",
  refreshUrl: "https://..."
}
```

### Mode Detection
```
STRIPE_SECRET_KEY = "sk_test_1234567890"
                                │
                                ▼
                    getStripeMode() = 'test'
```

### Account Lookup
```
UserStripeAccounts Map:
{
  "vendor_001": {
    userId: "vendor_001",
    testStripeAccountId: "acct_test_abc123",    ← Return this
    liveStripeAccountId: undefined              ← Not yet created
  }
}
```

### Response to Frontend
```json
{
  "success": true,
  "data": {
    "accountId": "acct_test_abc123",
    "onboardingUrl": "https://connect.stripe.com/onboarding/...",
    "mode": "test"
  }
}
```

---

## Mode Separation Visualization

```
┌────────────────────────────────────┐
│ USER: "vendor_001"                 │
├────────────────────────────────────┤
│                                    │
│  TEST MODE                         │
│  (sk_test_...)                     │
│  │                                 │
│  └─→ testStripeAccountId           │
│      = "acct_test_abc123"           │
│      │                             │
│      └─→ Onboarding (No real SSN)  │
│          Test data accepted        │
│                                    │
├────────────────────────────────────┤
│                                    │
│  LIVE MODE                         │
│  (sk_live_...)                     │
│  │                                 │
│  └─→ liveStripeAccountId           │
│      = "acct_live_xyz789"          │
│      │                             │
│      └─→ Onboarding (Real SSN)     │
│          Real verification needed  │
│                                    │
└────────────────────────────────────┘
```

---

## Decision Tree: Account Handling

```
Request arrives
│
▼
Is userId provided?
├─ YES → Continue
└─ NO → Use 'default' userId
│
▼
What is the Stripe mode?
├─ TEST (sk_test_)
│  │
│  ▼
│  Does user have testStripeAccountId?
│  ├─ YES → Return it
│  └─ NO → Create new test account, store, return
│
└─ LIVE (sk_live_)
   │
   ▼
   Does user have liveStripeAccountId?
   ├─ YES → Return it
   └─ NO → Create new live account, store, return
```

---

## File Structure After Implementation

```
yardline-backend/
├── src/
│   └── index.ts                      ← Main implementation (MODIFIED)
│
├── package.json                      ← Dependencies (UNCHANGED)
├── tsconfig.json                     ← TypeScript config (UNCHANGED)
├── README.md                         ← Updated with new features
│
├── Documentation (NEW):
├── IMPLEMENTATION_SUMMARY.md         ← Complete overview
├── STRIPE_CONNECT_CHANGES.md        ← Technical specs
├── DEPLOYMENT_GUIDE.md              ← Deployment instructions
├── API_CHANGES.md                   ← Frontend integration
├── QUICK_REFERENCE.md               ← Developer quick help
├── DEPLOYMENT_CHECKLIST.md          ← Verification steps
├── COMPLETION_SUMMARY.md            ← This project summary
│
├── validate-implementation.sh        ← Validation script
│
└── .git/                             ← Version control
```

---

## Data Flow: Complete Lifecycle

```
┌──────────────┐
│   START      │
│  New Request │
└──────────────┘
      │
      ▼
┌────────────────────────────┐
│ 1. RECEIVE REQUEST         │
│ ├─ email                   │
│ ├─ name                    │
│ ├─ userId                  │
│ ├─ returnUrl               │
│ └─ refreshUrl              │
└────────────────────────────┘
      │
      ▼
┌────────────────────────────┐
│ 2. DETECT ENVIRONMENT      │
│ ├─ Read STRIPE_SECRET_KEY  │
│ ├─ Parse prefix            │
│ └─ Determine: test | live  │
└────────────────────────────┘
      │
      ▼
┌────────────────────────────┐
│ 3. CHECK CACHE             │
│ ├─ userStripeAccounts      │
│ ├─ Mode-specific field     │
│ └─ Found? Yes/No           │
└────────────────────────────┘
      │
      ├─ YES ──────────────┐
      │                    │
      │              ┌─────────────┐
      │              │ Return ID   │
      │              │ (Cached)    │
      │              └─────────────┘
      │
      └─ NO ───────────────┐
                           │
                     ┌─────────────────────────┐
                     │ 4. CREATE ACCOUNT       │
                     │ ├─ Call Stripe API      │
                     │ ├─ type: 'express'      │
                     │ └─ Get accountId        │
                     └─────────────────────────┘
                           │
                           ▼
                     ┌─────────────────────────┐
                     │ 5. STORE ACCOUNT ID     │
                     │ ├─ Mode: test?          │
                     │ ├─ Store in             │
                     │ │  testStripeAccountId  │
                     │ └─ Or                   │
                     │    liveStripeAccountId  │
                     └─────────────────────────┘
      │
      └──────────────────────┘
               │
               ▼
┌────────────────────────────┐
│ 6. CREATE ONBOARDING LINK  │
│ ├─ account: accountId      │
│ ├─ type: 'account_boarding'│
│ └─ Get onboarding URL      │
└────────────────────────────┘
      │
      ▼
┌────────────────────────────┐
│ 7. BUILD RESPONSE          │
│ ├─ success: true           │
│ ├─ accountId               │
│ ├─ onboardingUrl           │
│ └─ mode: 'test'|'live'     │
└────────────────────────────┘
      │
      ▼
┌──────────────┐
│    END       │
│  Send JSON   │
└──────────────┘
```

---

## Comparison: Before vs After

```
BEFORE IMPLEMENTATION:
┌─────────────────────────┐
│ Create Account (Test)   │
├─────────────────────────┤
│ Same logic for all keys │
├─────────────────────────┤
│ Get: acct_1234567890    │ ← Live account!
│      (Not a test acct)  │
├─────────────────────────┤
│ Onboarding requires     │
│ real SSN ❌             │
└─────────────────────────┘


AFTER IMPLEMENTATION:
┌──────────────────────────┐
│ Create Account (Test)    │
├──────────────────────────┤
│ sk_test_ detected ✓      │
├──────────────────────────┤
│ Get: acct_test_abc123    │ ← Test account!
│      (Correct mode!)     │
├──────────────────────────┤
│ Onboarding accepts test  │
│ data, no real SSN ✓      │
└──────────────────────────┘

┌──────────────────────────┐
│ Create Account (Live)    │
├──────────────────────────┤
│ sk_live_ detected ✓      │
├──────────────────────────┤
│ Get: acct_live_xyz789    │ ← Live account!
│      (Different acct!)   │
├──────────────────────────┤
│ Onboarding requires real │
│ verification ✓           │
└──────────────────────────┘
```

