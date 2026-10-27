# ChatLink Automation API

Automation API lives in the Supabase Edge Function:

`POST https://mtitrkspgoqaqdeiluud.supabase.co/functions/v1/chatlink-automation`

## Current status

The Automation API is intentionally **OFF by default**. While it is off, the server rejects profile/chats/send-message actions and blocks creation of new API keys. Existing keys cannot be used for runtime requests while the switch is off. Normal ChatLink login and messaging are not disabled.

The ChatLink user page's Automation API section is deliberately blurred and non-interactive until the feature is released. The former `automation-control.html` page is now a professional "Coming Soon" notice only; it does not contain a second copy of the controls.

## Admin control

The single authoritative ON/OFF control has been added to the existing SSC Smart Study Admin Console:

[Open SSC Smart Study Admin Console](https://mondaljeet126580-bit.github.io/ssc-smart-study/)

After signing in with the approved Admin account, open **Automation API** in the Admin navigation. The control reads and updates `public.app_settings` at key `chatlink_automation` through the existing admin-only Edge Function. The backend verifies the signed-in account and allowlist before every control request and writes an audit entry when the switch changes.

## Key safety

Do not expose an automation key in public HTML/JavaScript or commit it to GitHub. The server stores only SHA-256 hashes. API keys use scoped permissions:
- `profile:read`
- `chats:read`
- `messages:send`

The API can read the authenticated key owner's profile and chats, and can send messages only to conversations that owner belongs to. The Supabase publishable key is a public client key, not an automation credential. Never place a service-role/secret key in browser code.
