# Ticket Checkout "Pay Online" - Migration Summary

## ✅ Changes Made

### Updated Endpoint: POST /v1/checkout/create-session

**Changes:**

1. **Deep Link URLs** - Uses `APP_URL_SCHEME` environment variable (defaults to `yardline`)
   ```typescript
   // Before
   success_url: 'https://yardline.app/checkout/success?session_id={CHECKOUT_SESSION_ID}'
   cancel_url: 'https://yardline.app/checkout/cancel'
   
   // After
   success_url: 'yardline://payment-success?type=ticket&session_id={CHECKOUT_SESSION_ID}'
   cancel_url: 'yardline://payment-cancel?type=ticket&eventId={eventId}'
   ```

2. **Response Format** - Standardized to match booking checkout
   ```typescript
   // Before
   { sessionUrl: "...", sessionId: "..." }
   
   // After  
   { url: "...", sessionId: "..." }
   ```

3. **Session Metadata** - Added type field for webhook routing
   ```typescript
   metadata: {
     type: 'ticket',  // NEW
     user_id: userId,
     event_id: eventId,
     pricing_model: 'model_a'
   }
   ```

4. **Webhook Logging** - Enhanced logging for ticket sessions
   ```
   🎟️  Processing ticket checkout session: cs_xxx
   ✅ Created 2 tickets for checkout session cs_xxx
   ```

---

## 📱 Mobile App Migration

### Required Change

Update code to use `url` instead of `sessionUrl`:

```typescript
// ❌ OLD
const { data } = await createCheckoutSession(...);
Linking.openURL(data.sessionUrl);

// ✅ NEW
const { data } = await createCheckoutSession(...);
Linking.openURL(data.url);
```

### Add Deep Link Handler

```typescript
// Listen for return from Stripe checkout
Linking.addEventListener('url', (event) => {
  const url = new URL(event.url);
  
  // Success: yardline://payment-success?type=ticket&session_id=cs_xxx
  if (url.pathname === '//payment-success' && url.searchParams.get('type') === 'ticket') {
    const sessionId = url.searchParams.get('session_id');
    // Fetch tickets: GET /v1/tickets/by-session/{sessionId}
    fetchAndDisplayTickets(sessionId);
  }
  
  // Cancel: yardline://payment-cancel?type=ticket&eventId=event-uuid
  if (url.pathname === '//payment-cancel' && url.searchParams.get('type') === 'ticket') {
    showCancellationMessage();
  }
});
```

### Update App Configuration

**iOS (Info.plist):**
```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>yardline</string>
    </array>
  </dict>
</array>
```

**Android (AndroidManifest.xml):**
```xml
<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="yardline" />
</intent-filter>
```

---

## 🔧 Backend Deployment

### No Database Changes Required

This is purely a logic update - no migrations needed.

### Environment Variable (Optional)

```bash
# Add to .env (optional, defaults to 'yardline')
APP_URL_SCHEME=yardline
```

### Deploy Steps

```bash
# No changes needed - just deploy updated code
git add src/index.ts
git commit -m "Update ticket checkout for Pay Online flow with deep links"
git push
pm2 restart yardline-api
```

---

## 🧪 Testing

### Backend Test

```bash
# Create session
curl -X POST http://localhost:3000/v1/checkout/create-session \\
  -H "Content-Type: application/json" \\
  -d '{
    "userId": "test-user",
    "eventId": "test-event",
    "eventName": "Test Concert",
    "items": [{
      "ticketTypeId": "general",
      "ticketTypeName": "General Admission",
      "priceCents": 5000,
      "quantity": 1
    }],
    "connectedAccountId": "acct_test_..."
  }' | jq '.'

# Should return:
# {
#   "success": true,
#   "data": {
#     "url": "https://checkout.stripe.com/c/pay/cs_test_...",  ← Check this field
#     "sessionId": "cs_test_...",
#     ...
#   }
# }
```

### Deep Link Test (iOS Simulator)

```bash
# Test success URL
xcrun simctl openurl booted \\
  "yardline://payment-success?type=ticket&session_id=cs_test_123"

# Test cancel URL  
xcrun simctl openurl booted \\
  "yardline://payment-cancel?type=ticket&eventId=event-123"
```

### Deep Link Test (Android Emulator)

```bash
# Test success URL
adb shell am start -a android.intent.action.VIEW \\
  -d "yardline://payment-success?type=ticket&session_id=cs_test_123"

# Test cancel URL
adb shell am start -a android.intent.action.VIEW \\
  -d "yardline://payment-cancel?type=ticket&eventId=event-123"
```

---

## 🔄 Backward Compatibility

### Breaking Change: Redirect URLs

**The backend now fully controls redirect URLs via `APP_URL_SCHEME` environment variable.**

Clients can no longer provide custom `successUrl` and `cancelUrl` parameters. This ensures:
- ✅ Production always uses `yardline://` scheme
- ✅ Dev/preview environments use `vibecode://` scheme  
- ✅ No accidental misconfiguration causing payment callbacks to fail

**Environment Configuration:**
```bash
# Production
export APP_URL_SCHEME=yardline

# Dev/Preview
export APP_URL_SCHEME=vibecode
```

### Gradual Migration Supported

Old clients using `data.sessionUrl` will break. Update to use `data.url`.

**Migration Path:**
1. Update backend (remove custom URL support)
2. Update mobile app to use `data.url`
3. Configure `APP_URL_SCHEME` in deployment environments
4. Add deep link handlers for payment callbacks
5. Deploy mobile app update

---

## 📊 Comparison: Before vs After

| Aspect | Before | After |
|--------|--------|-------|
| **Response field** | `sessionUrl` | `url` ✅ |
| **Success URL** | Web URL | Deep link ✅ |
| **Cancel URL** | Web URL | Deep link ✅ |
| **Session metadata** | No type field | `type: 'ticket'` ✅ |
| **Webhook logging** | Generic | Ticket-specific ✅ |
| **Mobile experience** | Web redirect | App redirect ✅ |

---

## 🎯 Benefits

✅ **Native experience** - Returns to app, not web page  
✅ **Consistency** - Matches booking checkout flow  
✅ **Flexibility** - Custom URLs still supported  
✅ **Better UX** - Deep links feel more native  
✅ **Simpler client** - No PaymentSheet SDK needed  

---

## 🐛 Troubleshooting

### Issue: Response still has `sessionUrl`

**Cause:** Backend not deployed  
**Fix:** Deploy updated `src/index.ts`

### Issue: Deep links not working

**Cause:** App not configured for URL scheme  
**Fix:** Add `yardline` scheme to Info.plist (iOS) and AndroidManifest.xml (Android)

### Issue: App doesn't open after payment

**Cause:** `APP_URL_SCHEME` mismatch  
**Fix:** Verify environment variable matches app configuration

### Issue: Tickets not created

**Cause:** Webhook not processing  
**Fix:** Check webhook logs, verify `STRIPE_LIVE_WEBHOOK_SECRET` set

---

## 📚 Related Documentation

- **Ticket Checkout Details:** [TICKET_CHECKOUT_PAY_ONLINE.md](./TICKET_CHECKOUT_PAY_ONLINE.md)
- **Booking Checkout (for reference):** [CHECKOUT_SESSION_BOOKINGS.md](./CHECKOUT_SESSION_BOOKINGS.md)
- **Environment Config:** [ENVIRONMENT_CONFIG.md](./ENVIRONMENT_CONFIG.md)

---

## ✅ Checklist

### Backend
- [x] Updated success/cancel URLs to deep links
- [x] Changed response from `sessionUrl` to `url`
- [x] Added `type: 'ticket'` to session metadata
- [x] Enhanced webhook logging
- [x] No database changes needed

### Mobile App (Required)
- [ ] Update code to use `data.url` instead of `data.sessionUrl`
- [ ] Add deep link handler for `payment-success`
- [ ] Add deep link handler for `payment-cancel`
- [ ] Update iOS Info.plist with URL scheme
- [ ] Update Android AndroidManifest.xml with URL scheme
- [ ] Test deep link opening on device/simulator

### Testing
- [ ] Backend returns `url` field
- [ ] Deep links have correct format
- [ ] Tickets created after payment
- [ ] App opens on success redirect
- [ ] Cancel flow works correctly

---

**Status: ✅ Backend Ready - Mobile App Update Required**
