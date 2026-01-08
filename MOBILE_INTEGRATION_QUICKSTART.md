# PaymentSheet Quick Start for Mobile Developers

## 🚀 One-Page Integration Guide

### Backend Endpoint
```
POST https://api.yardline.com/v1/payments/create-intent
```

### Request Format
```json
{
  "userId": "user_123",
  "eventId": "event_456",
  "customerEmail": "user@example.com",
  "customerName": "John Doe",
  "items": [
    {
      "ticketTypeId": "general",
      "ticketTypeName": "General Admission",
      "priceCents": 5000,
      "quantity": 2
    }
  ]
}
```

### Response Format
```json
{
  "success": true,
  "data": {
    "paymentIntentClientSecret": "pi_xxx_secret_yyy",
    "paymentIntentId": "pi_xxxxx",
    "customerId": "cus_xxxxx",
    "ephemeralKey": "ek_live_xxxxx",
    "amount": 10800,
    "ticketSubtotalCents": 10000,
    "platformFeeTotalCents": 800
  }
}
```

---

## iOS Integration (Swift)

```swift
import StripePaymentSheet

func checkout() async {
    // 1. Call your backend
    let response = try await createPaymentIntent(
        userId: user.id,
        eventId: event.id,
        items: cartItems,
        customerEmail: user.email,
        customerName: user.name
    )
    
    // 2. Configure PaymentSheet
    var config = PaymentSheet.Configuration()
    config.merchantDisplayName = "YardLine"
    config.customer = .init(
        id: response.customerId,
        ephemeralKeySecret: response.ephemeralKey
    )
    config.applePay = .init(
        merchantId: "merchant.com.yardline",
        merchantCountryCode: "US"
    )
    
    // 3. Present PaymentSheet
    let sheet = PaymentSheet(
        paymentIntentClientSecret: response.paymentIntentClientSecret,
        configuration: config
    )
    
    let result = await sheet.present(from: viewController)
    
    // 4. Handle result
    switch result {
    case .completed:
        await fetchTickets(paymentIntentId: response.paymentIntentId)
    case .canceled:
        showMessage("Payment canceled")
    case .failed(let error):
        showError("Payment failed: \(error)")
    }
}
```

---

## Android Integration (Kotlin)

```kotlin
import com.stripe.android.paymentsheet.PaymentSheet

suspend fun checkout() {
    // 1. Call your backend
    val response = createPaymentIntent(
        userId = user.id,
        eventId = event.id,
        items = cartItems,
        customerEmail = user.email,
        customerName = user.name
    )
    
    // 2. Configure PaymentSheet
    val customerConfig = PaymentSheet.CustomerConfiguration(
        id = response.customerId,
        ephemeralKeySecret = response.ephemeralKey
    )
    
    val config = PaymentSheet.Configuration(
        merchantDisplayName = "YardLine",
        customer = customerConfig,
        googlePay = PaymentSheet.GooglePayConfiguration(
            environment = PaymentSheet.GooglePayConfiguration.Environment.Production,
            countryCode = "US"
        )
    )
    
    // 3. Present PaymentSheet
    paymentSheet.presentWithPaymentIntent(
        paymentIntentClientSecret = response.paymentIntentClientSecret,
        configuration = config
    ) { result ->
        when (result) {
            is PaymentSheetResult.Completed -> {
                fetchTickets(response.paymentIntentId)
            }
            is PaymentSheetResult.Canceled -> {
                showMessage("Payment canceled")
            }
            is PaymentSheetResult.Failed -> {
                showError("Payment failed: ${result.error}")
            }
        }
    }
}
```

---

## Backend API Call

```swift
struct PaymentIntentRequest: Codable {
    let userId: String
    let eventId: String
    let customerEmail: String
    let customerName: String
    let items: [Item]
    
    struct Item: Codable {
        let ticketTypeId: String
        let ticketTypeName: String
        let priceCents: Int
        let quantity: Int
    }
}

struct PaymentIntentResponse: Codable {
    let success: Bool
    let data: Data
    
    struct Data: Codable {
        let paymentIntentClientSecret: String
        let paymentIntentId: String
        let customerId: String
        let ephemeralKey: String
        let amount: Int
    }
}

func createPaymentIntent(
    userId: String,
    eventId: String,
    items: [CartItem],
    customerEmail: String,
    customerName: String
) async throws -> PaymentIntentResponse.Data {
    let url = URL(string: "https://api.yardline.com/v1/payments/create-intent")!
    
    let requestItems = items.map { item in
        PaymentIntentRequest.Item(
            ticketTypeId: item.id,
            ticketTypeName: item.name,
            priceCents: item.priceCents,
            quantity: item.quantity
        )
    }
    
    let body = PaymentIntentRequest(
        userId: userId,
        eventId: eventId,
        customerEmail: customerEmail,
        customerName: customerName,
        items: requestItems
    )
    
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(body)
    
    let (data, _) = try await URLSession.shared.data(for: request)
    let response = try JSONDecoder().decode(PaymentIntentResponse.self, from: data)
    
    return response.data
}
```

---

## Fetch Tickets After Payment

```swift
func pollForTickets(paymentIntentId: String) async throws -> [Ticket] {
    // Poll up to 10 times (20 seconds total)
    for _ in 1...10 {
        let url = URL(string: "https://api.yardline.com/v1/tickets/by-payment/\(paymentIntentId)")!
        let (data, _) = try await URLSession.shared.data(from: url)
        let response = try JSONDecoder().decode(TicketsResponse.self, from: data)
        
        if !response.data.isEmpty {
            return response.data // Tickets are ready!
        }
        
        try await Task.sleep(nanoseconds: 2_000_000_000) // Wait 2 seconds
    }
    
    throw TicketError.timeout
}

struct TicketsResponse: Codable {
    let success: Bool
    let data: [Ticket]
}

struct Ticket: Codable {
    let ticketId: String
    let ticketNumber: String
    let qrToken: String
    let ticketTypeName: String
    let priceCents: Int
    let status: String
}
```

---

## Important Notes

### ✅ What the Backend Handles
- Platform fee calculation (8% capped at $0.99-$12.99)
- Total amount calculation
- Customer creation/reuse
- Ephemeral key generation
- Payment processing
- Ticket generation (via webhook)

### ❌ What You DON'T Need to Do
- ❌ Calculate fees on client
- ❌ Calculate total amounts
- ❌ Send final prices to backend
- ❌ Handle webhook events
- ❌ Generate tickets

### 💡 Best Practices
1. **Show itemized breakdown** before checkout:
   ```
   Tickets:        $100.00
   Service Fee:      $8.00
   ----------------
   Total:         $108.00
   ```

2. **Poll for tickets** after payment succeeds (webhook may take 1-5 seconds)

3. **Handle errors gracefully**:
   - Payment canceled → Return to cart
   - Payment failed → Show error, allow retry
   - Network error → Show retry button

4. **Cache customer email** for faster checkout next time

---

## Environment Setup

### Development
```swift
let baseURL = "http://localhost:3000/v1"
let publishableKey = "pk_test_xxxxx" // Test mode
```

### Production
```swift
let baseURL = "https://api.yardline.com/v1"
let publishableKey = "pk_live_xxxxx" // Live mode
```

---

## Testing

### Test Cards (Test Mode Only)
- **Success**: `4242 4242 4242 4242`
- **Decline**: `4000 0000 0000 0002`
- **Requires Auth**: `4000 0025 0000 3155`
- Any future expiry date, any CVC

### Apple Pay (Sandbox)
1. Add test card in Wallet
2. Enable in Xcode: Capabilities → Apple Pay
3. Use sandbox merchant ID

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| PaymentSheet not showing payment methods | Check `ephemeralKey` is included |
| "Amount too small" error | Minimum charge is $0.50 |
| Tickets not appearing | Wait 5 seconds and retry poll |
| Review mode blocking charges | Backend has `REVIEW_MODE=true` (contact backend team) |
| Apple Pay not available | Check device supports Apple Pay and has cards configured |

---

## Support

- **Full docs**: [PAYMENTSHEET_IMPLEMENTATION.md](./PAYMENTSHEET_IMPLEMENTATION.md)
- **Backend code**: [src/index.ts](./src/index.ts)
- **Questions?** Contact backend team

---

**Ready to integrate!** 🎉
