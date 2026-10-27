# ChatLink Automation API

The Automation API is implemented by the Supabase Edge Function:

`POST https://mtitrkspgoqaqdeiluud.supabase.co/functions/v1/chatlink-automation`

## Global enable / disable

The global master switch is stored in `public.app_settings` under `chatlink_automation`. It is **OFF by default**. When the status cannot be checked, the API fails closed.

While OFF:
- `profile`, `chats`, `send_message`, and `create_key` return HTTP `503`.
- `list_keys` and `revoke_key` remain available so keys can be reviewed or revoked.
- Normal ChatLink messaging is unaffected. This switch is separate from Maintenance Mode.

To enable it later, log in to ChatLink using an account on the admin allowlist in the **same browser**, then open [Automation Control](automation-control.html). Only allowlisted admins can change the server-side switch.

## Authentication

For automation actions, use the dedicated API key in the header:

`Authorization: Bearer YOUR_CHATLINK_AUTOMATION_KEY`

Do not put the automation key in public HTML/JavaScript, commit it to GitHub, or share it in screenshots. The server stores only a SHA-256 hash. The API key permissions are limited to the selected scopes:
- `profile:read`
- `chats:read`
- `messages:send`

The API can read the authenticated key owner's own profile and chats, and can send messages only to conversations that owner belongs to.

## Managing keys

Sign in to ChatLink and open **More → Automation API** to create, list, or revoke keys. Creating a new key is unavailable while the global switch is OFF. Turn the global switch ON from the admin-only Automation Control page first.

## Safety

The Supabase publishable key is a public client key, not an automation credential. The service-role/secret key must never be placed in browser code. The server-side switch does not replace per-key scopes or chat-membership checks.
