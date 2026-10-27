# ChatLink real-time messaging, unread state and FCM push setup

## What is already deployed

- Supabase migration `chatlink_realtime_push_receipts` is applied to project `mtitrkspgoqaqdeiluud`.
- `chat-push` Edge Function is deployed with `verify_jwt=false`; all user actions are authenticated in the function, and database-trigger calls must pass a random Vault-backed webhook secret.
- The ChatLink page now syncs chat rows again when connectivity returns, updates the unread count, calls the browser App Badge API if supported, accepts native FCM-token/notification-open events, and can route a `?chat=<conversation UUID>` URL into a direct chat.
- Existing `messages`, `conversations`, `conversation_members`, login, images, and current realtime UI were kept. Existing messages remain in place.

## Important: two setup tasks still block real Android push

The backend deliberately does not fabricate tokens or local demo notifications. FCM delivery cannot be end-to-end enabled until both the server service-account secret and a real FCM device token are connected.

### A. Configure FCM on the server

1. Open [Firebase Console](https://console.firebase.google.com/) and select the Firebase project for ChatLink.
2. Under **Project settings → Service accounts**, generate/download a private-key JSON for a service account authorized to send Firebase Cloud Messaging HTTP v1 messages.
3. Open the [Supabase Edge Function Secrets page](https://supabase.com/dashboard/project/mtitrkspgoqaqdeiluud/functions/secrets).
4. Add one secret:
   - Name: `FCM_SERVICE_ACCOUNT_JSON`
   - Value: paste the *entire Firebase service-account private-key JSON*.
5. Do not commit that JSON to GitHub or put it into HTML/JavaScript. The database webhook secret was generated and stored in Supabase Vault; only its SHA-256 hash is in the database.

**Do not confuse the two Firebase files:** `google-services.json` is the Android app configuration uploaded to WebIntoApp. The service-account JSON is a private server credential stored only in Supabase Edge Function Secrets.

### B. Configure Firebase in WebIntoApp

WebIntoApp's guide says to register an Android Firebase app with the exact same package name as the generated WebIntoApp Android app, download `google-services.json`, then open WebIntoApp **Extra Features**, enable Firebase and Push Notification, upload the JSON, and rebuild the Android app:
- [WebIntoApp: Add Firebase capability](https://install.webintoapp.com/guides/add-firebase-to-your-app)
- [WebIntoApp App Maker / Extra Features](https://install.webintoapp.com/app-maker)

Check the package name in the app builder before creating the Firebase Android app. A package-name mismatch prevents Firebase configuration from matching the installed APK.

### C. Native token and notification-click bridge requirement

A server can only send a direct message notification after the app registers the actual FCM registration token for the signed-in ChatLink user. The public WebIntoApp guide confirms Firebase SDK/configuration support but does not document a JavaScript API for reading the native FCM token or forwarding notification-click data into the WebView. Therefore this repository exposes a bridge contract, but the standard WebIntoApp build will not register a token unless the native wrapper actually invokes it.

When the native wrapper provides a token, it should call:

```javascript
window.ChatLinkPushBridge.registerFcmToken("REAL_FCM_REGISTRATION_TOKEN");
```

Or dispatch the event:

```javascript
window.dispatchEvent(new CustomEvent("chatlink:fcm-token", {
  detail: { token: "REAL_FCM_REGISTRATION_TOKEN" }
}));
```

For notification taps, the native wrapper should forward the FCM `data` payload to:

```javascript
window.ChatLinkPushBridge.handleNotificationOpen({
  conversation_id: "CONVERSATION_UUID",
  click_url: "https://mondaljeet126580-bit.github.io/My-app-compatative-exam-/?chat=CONVERSATION_UUID"
});
```

The app then resolves the current user's direct-chat list and opens that chat. If WebIntoApp does not expose these callbacks, the remaining step requires a supported native JavaScript bridge, native source-code customization, or WebIntoApp support. A static HTML change alone cannot read a private FCM registration token from Android's Firebase SDK.

### D. Android permission and icon badge

- Android 13+ requires runtime notification permission (`POST_NOTIFICATIONS`). Ensure the rebuilt WebIntoApp app requests it. If the generated build does not request it, Android Settings → Apps → ChatLink → Notifications must allow notifications, or WebIntoApp must add the runtime permission prompt.
- FCM messages include `android.notification.notification_count` with the recipient's database unread total. Android launchers that support notification dots/numeric badges can use the OS notification state.
- In browser/PWA contexts, the app calls `navigator.setAppBadge(count)` and `navigator.clearAppBadge()` when available. An exact native icon badge reset when the user reads messages needs the native wrapper to implement `window.ChatLinkNative.setAppBadgeCount(count)`; ordinary WebView JavaScript cannot guarantee native launcher badge APIs on every launcher.
- Notification taps need the native wrapper to forward `conversation_id` or the `click_url` into the WebView. FCM opens the native app's default activity by default; a static HTML route alone cannot consume Android intent extras that the wrapper never forwards.

## Database objects

### Existing objects retained
- `public.messages`: message body, sender, conversation, created_at and existing delivery/read fields.
- `public.conversations` and `public.conversation_members`: membership and per-user `last_read_at`.
- `supabase_realtime` already publishes `messages`; the migration adds `message_receipts`.

### Added objects
- `public.message_receipts(message_id, recipient_user_id, delivered_at, read_at, created_at)`: one receipt per message/recipient, unique on `(message_id, recipient_user_id)`.
- `public.chat_push_devices`: owner, stable device ID, platform, FCM token, active/last-seen timestamps. Client roles have no direct table permissions.
- `public.chat_push_outbox`: unique `(message_id, recipient_user_id)`, pending/processing/sent/dead state and retry/error fields. This is the idempotent server queue.
- `public.chat_push_deliveries`: idempotent status for each outbox-item/device pair.
- `public.chat_push_secrets`: stores only a secret hash; plaintext webhook key is in Vault.

### RLS and access
- RLS is enabled on new tables.
- Authenticated users can read only receipts where they are the recipient or the sender of that message. They cannot insert/update/delete receipts directly; the existing server-controlled read/delivery RPCs update them.
- `chat_push_devices`, `chat_push_outbox`, `chat_push_deliveries` and `chat_push_secrets` are denied to `anon` and `authenticated`; the trusted Edge Function uses `service_role`.
- `get_total_unread_count()` returns only the current signed-in user's unread count. `chat_push_unread_count(uuid)` is service-role only.
- Service-role credentials are not included in frontend code or GitHub.

## Endpoints and online/offline behavior

- `chat-push` handles `register_token`, `unregister_token`, `retry_pending`, and database-triggered `outbox_id` dispatch.
- A trigger creates receipt/outbox rows after a new message is saved; the webhook request is asynchronous through `pg_net`, so network work does not block the message insert.
- Online app sessions keep using the existing Supabase Realtime subscriptions and fetch ordered messages from the database. Reconnection/foregrounding reloads the chat list and active chat from the database.
- If receiver is offline, FCM queues the accepted notification delivery according to its TTL; the message itself remains in Supabase. FCM is not assumed to be configured until the secret/token bridge checks pass.
- Stable FCM notification tags and unique outbox/delivery keys are used to reduce duplicate visible notifications. The database remains the source of truth for message order/unread state.

## Two-phone test after both setup tasks are complete

1. Rebuild the WebIntoApp Android APK after enabling Firebase/Push and granting Android notification permission. Install it on two phones with a distinct ChatLink account per phone.
2. Verify the app's native bridge registers a real FCM token for each signed-in user in `chat_push_devices`; never type a fake token.
3. Keep Phone B online with ChatLink closed/backgrounded. Send one message from A. Verify the row exists in `messages`, one recipient receipt/outbox row exists, and Phone B receives a system notification.
4. Send three messages to Phone B while it is offline. Restore the internet. Verify messages appear in time order after opening ChatLink; unread count should match the unread rows and the FCM summary should carry that count.
5. Open the chat on B. Verify `conversation_members.last_read_at` advances, the recipient's `message_receipts.read_at` values are set, and the unread count drops to zero.
6. Tap a notification and verify the native bridge forwards its `conversation_id`/URL to `ChatLinkPushBridge.handleNotificationOpen`, opening that direct chat.
7. Repeat with A/B reversed, then check both accounts' unread counts remain independent.

## Current verification boundary

The database migration, server function deployment, and frontend source are in place. FCM service credentials, a real native token, WebIntoApp runtime permission behavior, notification-tap forwarding, and native numeric badge behavior have not been verified on physical Android devices yet, because the Firebase service-account secret and documented native bridge integration are not available in this repository/session.
