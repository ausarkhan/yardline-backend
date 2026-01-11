#!/bin/bash
# Validation script for Safe V1 Two-Step Payment Implementation
# This script checks that all required components are in place

echo "=================================================="
echo "Safe V1 Two-Step Payment - Implementation Validator"
echo "=================================================="
echo ""

ERRORS=0
WARNINGS=0

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

check_pass() {
    echo -e "${GREEN}✓${NC} $1"
}

check_fail() {
    echo -e "${RED}✗${NC} $1"
    ((ERRORS++))
}

check_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
    ((WARNINGS++))
}

# Check files exist
echo "Checking Files..."
echo "-------------------"

if [ -f "migrations/003_two_step_payment.sql" ]; then
    check_pass "Migration file exists"
else
    check_fail "Migration file missing: migrations/003_two_step_payment.sql"
fi

if [ -f "src/routes/bookings-v1.ts" ]; then
    check_pass "Bookings V1 routes file exists"
else
    check_fail "Routes file missing: src/routes/bookings-v1.ts"
fi

if [ -f "test-platform-fee.sh" ]; then
    check_pass "Test script exists"
else
    check_fail "Test script missing: test-platform-fee.sh"
fi

if [ -f "SAFE_V1_TWO_STEP_PAYMENT.md" ]; then
    check_pass "API documentation exists"
else
    check_warn "API documentation missing: SAFE_V1_TWO_STEP_PAYMENT.md"
fi

if [ -f "SAFE_V1_QUICKSTART.md" ]; then
    check_pass "Quick start guide exists"
else
    check_warn "Quick start guide missing: SAFE_V1_QUICKSTART.md"
fi

echo ""
echo "Checking Code Implementation..."
echo "-------------------------------"

# Check calcPlatformFeeCents function exists
if grep -q "function calcPlatformFeeCents" src/index.ts; then
    check_pass "calcPlatformFeeCents function defined in index.ts"
else
    check_fail "calcPlatformFeeCents function not found in index.ts"
fi

# Check routes are imported
if grep -q "import { createBookingV1Routes }" src/index.ts; then
    check_pass "Bookings V1 routes imported in index.ts"
else
    check_fail "Bookings V1 routes not imported in index.ts"
fi

# Check routes are mounted
if grep -q "app.use('/v1/bookings', bookingV1Router)" src/index.ts; then
    check_pass "Bookings V1 routes mounted in index.ts"
else
    check_fail "Bookings V1 routes not mounted in index.ts"
fi

# Check db.ts has new functions
if grep -q "function createBookingWithDeposit" src/db.ts; then
    check_pass "createBookingWithDeposit function exists in db.ts"
else
    check_fail "createBookingWithDeposit function missing in db.ts"
fi

if grep -q "function acceptBooking" src/db.ts; then
    check_pass "acceptBooking function exists in db.ts"
else
    check_fail "acceptBooking function missing in db.ts"
fi

if grep -q "function payRemainingBooking" src/db.ts; then
    check_pass "payRemainingBooking function exists in db.ts"
else
    check_fail "payRemainingBooking function missing in db.ts"
fi

# Check DBBooking interface updated
if grep -q "deposit_payment_intent_id" src/db.ts; then
    check_pass "DBBooking interface includes deposit_payment_intent_id"
else
    check_fail "DBBooking interface missing deposit_payment_intent_id"
fi

if grep -q "final_payment_intent_id" src/db.ts; then
    check_pass "DBBooking interface includes final_payment_intent_id"
else
    check_fail "DBBooking interface missing final_payment_intent_id"
fi

echo ""
echo "Checking Migration..."
echo "---------------------"

if grep -q "ADD COLUMN IF NOT EXISTS deposit_payment_intent_id" migrations/003_two_step_payment.sql; then
    check_pass "Migration adds deposit_payment_intent_id column"
else
    check_fail "Migration missing deposit_payment_intent_id column"
fi

if grep -q "ADD COLUMN IF NOT EXISTS final_payment_intent_id" migrations/003_two_step_payment.sql; then
    check_pass "Migration adds final_payment_intent_id column"
else
    check_fail "Migration missing final_payment_intent_id column"
fi

if grep -q "'accepted'" migrations/003_two_step_payment.sql; then
    check_pass "Migration adds 'accepted' status"
else
    check_fail "Migration missing 'accepted' status"
fi

echo ""
echo "Checking API Endpoints..."
echo "-------------------------"

# Check endpoint implementations
if grep -q "router.post('/request'" src/routes/bookings-v1.ts; then
    check_pass "POST /v1/bookings/request endpoint exists"
else
    check_fail "POST /v1/bookings/request endpoint missing"
fi

if grep -q "router.post('/:id/accept'" src/routes/bookings-v1.ts; then
    check_pass "POST /v1/bookings/:id/accept endpoint exists"
else
    check_fail "POST /v1/bookings/:id/accept endpoint missing"
fi

if grep -q "router.post('/:id/pay-remaining'" src/routes/bookings-v1.ts; then
    check_pass "POST /v1/bookings/:id/pay-remaining endpoint exists"
else
    check_fail "POST /v1/bookings/:id/pay-remaining endpoint missing"
fi

echo ""
echo "Checking Dependencies..."
echo "------------------------"

if [ -f "package.json" ]; then
    if grep -q '"express"' package.json; then
        check_pass "Express dependency found"
    else
        check_fail "Express dependency missing"
    fi
    
    if grep -q '"stripe"' package.json; then
        check_pass "Stripe dependency found"
    else
        check_fail "Stripe dependency missing"
    fi
    
    if grep -q '"@supabase/supabase-js"' package.json; then
        check_pass "Supabase dependency found"
    else
        check_fail "Supabase dependency missing"
    fi
else
    check_fail "package.json not found"
fi

echo ""
echo "Running Unit Tests..."
echo "---------------------"

if [ -x "test-platform-fee.sh" ]; then
    if ./test-platform-fee.sh > /dev/null 2>&1; then
        check_pass "Platform fee calculation tests pass"
    else
        check_fail "Platform fee calculation tests failed"
        echo "   Run './test-platform-fee.sh' for details"
    fi
else
    check_warn "Test script not executable (chmod +x test-platform-fee.sh)"
fi

echo ""
echo "=================================================="
echo "Validation Complete"
echo "=================================================="
echo ""

if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}✓ All critical checks passed!${NC}"
    echo ""
    echo "Next Steps:"
    echo "1. Apply migration: migrations/003_two_step_payment.sql"
    echo "2. Configure environment variables (SUPABASE_URL, STRIPE_SECRET_KEY, etc.)"
    echo "3. Start server: npm run dev"
    echo "4. Test API endpoints (see SAFE_V1_QUICKSTART.md)"
    echo ""
    exit 0
else
    echo -e "${RED}✗ Found $ERRORS critical error(s)${NC}"
    if [ $WARNINGS -gt 0 ]; then
        echo -e "${YELLOW}⚠ Found $WARNINGS warning(s)${NC}"
    fi
    echo ""
    echo "Please fix the errors above before proceeding."
    echo ""
    exit 1
fi
