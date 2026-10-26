# ChatLink Automation API

ChatLink now has a separate server-side Automation API. It is intentionally different from the browser Supabase publishable key.

## Endpoint

`POST https://mtitrkspgoqaqdeiluud.supabase.co/functions/v1/chatlink-automation`

## Authentication

Send the dedicated automation credential in the `X-ChatLink-Automation-Key` header.

Do **not** put this key in public HTML/JavaScript or commit it to GitHub. The server stores only a SHA-256 hash of the key.

## Supported actions

### Health check

```json
{"action":"health"}
```

### Maintenance control

Turn maintenance on:

```json
{"action":"maintenance","enabled":true,"message":"on maintenance"}
```

Turn maintenance off:

```json
{"action":"maintenance","enabled":false,"message":"on maintenance"}
```

This updates the existing `app_settings.maintenance` setting used by the user app, so the **user app** enters/leaves maintenance mode; the admin console is not the maintenance target.

## External automation

The endpoint can be called from an automation service, server, cron job, or webhook workflow. For example, a scheduled workflow can call the maintenance action before a planned deployment and call it again afterwards.

## Separate control page

GitHub Pages also contains `automation-control.html`, a small mobile-friendly control page. It accepts the automation key locally in the browser and can test the API or switch maintenance mode.

## Security

The normal Supabase publishable key is for the public client and is not an automation/control credential. Supabase's documentation recommends keeping secret keys on server-side code and using Edge Functions for authenticated HTTP endpoints. The ChatLink automation endpoint therefore uses a separate server-side credential and never exposes a secret Supabase key in the user app.
