# Moataz AI Public API v1

## Current base URL

`https://moatazalalqami.online/api/v1`

The target alias is `https://api.moatazalalqami.online/v1` after DNS and Vercel domain routing are configured.

## Authentication

Send a platform API key only from a trusted server:

```http
Authorization: Bearer mk_live_xxxxx
```

Never expose `mk_live_` keys in public frontend JavaScript. Keys are generated on the server, shown once, and only an HMAC-SHA256 digest is stored.

## Implemented endpoints

- `GET /api/v1/health`
- `GET /api/v1/account` — `account:read`
- `GET /api/v1/models` — `models:read`
- `POST /api/v1/chat/completions` — `chat:write`
- Internal dashboard endpoint: `GET|POST|PATCH /api/api-keys`

The chat endpoint currently supports non-streaming text chat through the configured shared/default platform provider. Unsupported OpenAI parameters are rejected explicitly rather than ignored.

## Example

```bash
curl 'https://moatazalalqami.online/api/v1/chat/completions' \
  -H 'Authorization: Bearer mk_live_xxxxx' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "gemini-2.5-flash",
    "messages": [{"role":"user","content":"مرحبا"}],
    "stream": false
  }'
```

## Required environment

Set a server-only secret with at least 32 random characters:

```env
API_KEY_HASH_SECRET=
```

When absent, the implementation temporarily falls back to the existing server-only `ENCRYPTION_KEY`. A dedicated secret is recommended before production release.

## Database

Migration `20260717120000_public_api_v1.sql` creates:

- `api_keys`
- `api_usage_logs`
- `webhook_endpoints`
- `webhook_deliveries`
- `idempotency_keys`

RLS is enabled. Browser roles have no direct table privileges; sensitive mutations use the authenticated server API and Supabase service role.

## Not yet claimed as complete

Streaming, idempotency execution, webhook delivery workers, Telegram/WhatsApp public send routes, workflow triggers, OpenAPI UI, and the dashboard pages remain separate implementation phases. No placeholder endpoint claims these features are operational.
