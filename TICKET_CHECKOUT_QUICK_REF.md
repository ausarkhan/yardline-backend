# Ticket Checkout "Pay Online" - Quick Reference

## Endpoint

```
POST /v1/checkout/create-session
```

## Request

```json
{
  "userId": "uuid",
  "eventId": "uuid",
  "eventName": "Concert Name",
  "items": [
    {
      "ticketTypeId": "general",
      "ticketTypeName": "General Admission",
      "priceCents": 5000,
      "quantity": 2
    }
  ],
  "connectedAccountId": "acct_..."
}
```

## Response

```json
{
  "success": true,
  "data": {
    "url": "https://checkout.stripe.com/...",
    "sessionId": "cs_...",
    "ticketSubtotalCents": 10000,
    "buyerFeeTotalCents": 132,
    "totalChargeCents": 10132
  }
}
```

## Deep Links

**Success:**
```
yardline://payment-success?type=ticket&session_id={CHECKOUT_SESSION_ID}
```

**Cancel:**
```
yardline://payment-cancel?type=ticket&eventId={eventId}
```

## Mobile Integration

```typescript
// 1. Create session
const { data } = await fetch('/v1/checkout/create-session', {
  method: 'POST',
  body: JSON.stringify({ userId, eventId, items, connectedAccountId })
}).then(r => r.json());

// 2. Open checkout
Linking.openURL(data.url);

// 3. Handle return
Linking.addEventListener('url', (event) => {
  const url = new URL(event.url);
  if (url.searchParams.get('type') === 'ticket') {
    const sessionId = url.searchParams.get('session_id');
    fetchTickets(sessionId); // GET /v1/tickets/by-session/{sessionId}
  }
});
```

## Key Changes

| Before | After |
|--------|-------|
| `data.sessionUrl` | `data.url` |
| Web redirect | Deep link |
| No type metadata | `type: 'ticket'` |

## Testing

```bash
# Create session
curl -X POST http://localhost:3000/v1/checkout/create-session \\
  -H "Content-Type: application/json" \\
  -d '{"userId":"test","eventId":"evt","eventName":"Concert","items":[{"ticketTypeId":"gen","ticketTypeName":"General","priceCents":5000,"quantity":1}],"connectedAccountId":"acct_test"}' \\
  | jq '.data | {url, sessionId}'

# Test deep link (iOS)
xcrun simctl openurl booted "yardline://payment-success?type=ticket&session_id=cs_test_123"

# Test deep link (Android)
adb shell am start -W -a android.intent.action.VIEW -d "yardline://payment-success?type=ticket&session_id=cs_test_123"
```

## Mobile App Config

**iOS Info.plist:**
```xml
<key>CFBundleURLSchemes</key>
<array>
  <string>yardline</string>
</array>
```

**Android AndroidManifest.xml:**
```xml
<data android:scheme="yardline" />
```

---

**✅ Ready for "Pay Online" Integration**
