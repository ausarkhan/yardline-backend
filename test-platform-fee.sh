#!/bin/bash
# Test script for calcPlatformFeeCents function
# Tests the Safe V1 platform fee calculation with various service prices

echo "==================================="
echo "Testing calcPlatformFeeCents"
echo "==================================="
echo ""

# Test cases: service price in cents -> expected platform fee
# Formula: platformFee = ceil((baseFee + 0.029 * price + 30) / (1 - 0.029))
# where baseFee = max(99, min(round(0.08 * price), 1299))

cat << 'EOF' > /tmp/test-platform-fee.js
// Platform fee calculation function (copied from implementation)
function calcPlatformFeeCents(pCents) {
  const stripeFeePercent = 0.029;
  const stripeFeeFixedCents = 30;
  
  // Base platform fee: min $0.99, max $12.99, 8% of service price
  const baseFeeCents = Math.max(99, Math.min(Math.round(0.08 * pCents), 1299));
  
  // Gross up to cover Stripe processing fees
  const platformFeeCents = Math.ceil(
    (baseFeeCents + stripeFeePercent * pCents + stripeFeeFixedCents) / (1 - stripeFeePercent)
  );
  
  return platformFeeCents;
}

// Validation function to check if fee covers costs
function validateFee(pCents, platformFeeCents) {
  const stripeFeeOnPlatform = Math.round(platformFeeCents * 0.029 + 30);
  const baseFee = Math.max(99, Math.min(Math.round(0.08 * pCents), 1299));
  const stripeOnService = Math.round(pCents * 0.029 + 30);
  const netRevenue = platformFeeCents - stripeFeeOnPlatform;
  const targetRevenue = baseFee;
  
  return {
    pCents,
    platformFeeCents,
    baseFee,
    stripeFeeOnPlatform,
    netRevenue,
    targetRevenue,
    deficit: targetRevenue - netRevenue,
    covers: netRevenue >= (targetRevenue - 1) // Allow 1 cent rounding tolerance
  };
}

// Test cases
const testCases = [
  { price: 500, description: "$5.00 service" },
  { price: 2000, description: "$20.00 service" },
  { price: 10000, description: "$100.00 service" },
  { price: 1000, description: "$10.00 service" },
  { price: 5000, description: "$50.00 service" },
  { price: 15000, description: "$150.00 service (should cap at $12.99 base)" }
];

console.log("Test Results:");
console.log("=".repeat(100));
console.log("");

let allPassed = true;

testCases.forEach(tc => {
  const fee = calcPlatformFeeCents(tc.price);
  const validation = validateFee(tc.price, fee);
  
  console.log(`Test: ${tc.description}`);
  console.log(`  Service Price: $${(tc.price/100).toFixed(2)}`);
  console.log(`  Base Fee Target: $${(validation.baseFee/100).toFixed(2)}`);
  console.log(`  Platform Fee Charged: $${(fee/100).toFixed(2)}`);
  console.log(`  Stripe Fee on Platform: $${(validation.stripeFeeOnPlatform/100).toFixed(2)}`);
  console.log(`  Net Revenue: $${(validation.netRevenue/100).toFixed(2)}`);
  console.log(`  Deficit: ${validation.deficit} cents`);
  console.log(`  ✓ Covers Target: ${validation.covers ? 'YES' : 'NO'}`);
  
  if (!validation.covers) {
    console.log(`  ❌ FAILED: Net revenue does not cover target base fee`);
    allPassed = false;
  } else {
    console.log(`  ✅ PASSED`);
  }
  console.log("");
});

console.log("=".repeat(100));
console.log("");

if (allPassed) {
  console.log("✅ All tests PASSED");
  process.exit(0);
} else {
  console.log("❌ Some tests FAILED");
  process.exit(1);
}
EOF

# Run the tests
node /tmp/test-platform-fee.js

exit_code=$?
rm /tmp/test-platform-fee.js
exit $exit_code
