# Mobile API contract

Future Android clients should use the canonical HTTPS origin and `/api/v1` endpoints. The current web-only endpoints remain supported, but new cross-client features belong under `api/v1`.

## Rules

- Send `Accept-Language: ar` or `en`.
- Send a unique `X-Request-ID` per request for tracing.
- Send `Authorization: Bearer <Supabase access token>` for authenticated routes.
- Treat `429` as retryable and honor `Retry-After`.
- Treat `401` as an expired/revoked local session and refresh through Supabase Auth.
- Never embed provider, integration, service-role, or bootstrap secrets in an Android binary.

## Available v1 endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/v1/status` | Public | Lightweight API availability |
| GET | `/api/v1/sections` | Public | Visible content sections |
| GET | `/api/v1/articles` | Public | Paginated published articles |
| GET | `/api/v1/articles?slug=...` | Public | One published article |
| GET | `/api/v1/announcements` | Public | Active announcement strips/cards |
| GET | `/api/v1/content/summary` | Public | Published content totals |
| POST/PATCH/DELETE | content endpoints | Owner/Admin/Manager/Editor | Create, update, and archive content |

## Authenticated product endpoints

The same stable HTTPS origin also exposes the current authenticated product contract:

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | Public | Create a regular account |
| POST | `/api/auth/login` | Public | Password sign-in |
| GET/PATCH | `/api/auth/me`, `/api/auth/profile` | Bearer | Session profile and preferences |
| GET/POST/PATCH/DELETE | `/api/providers` | Bearer | User-owned AI providers |
| POST | `/api/providers/test` | Optional by mode | Validate a saved or session-only provider |
| POST | `/api/chat` | Optional by mode | SSE or JSON AI generation |
| GET | `/api/platform-provider` | Bearer | Platform provider availability and daily usage |
| PATCH | `/api/platform-provider` | Owner | Select the shared provider and set quotas |
| GET/POST/PATCH/DELETE | `/api/integrations/telegram` | Bearer | Telegram connection lifecycle |
| GET/POST/PATCH/DELETE | `/api/integrations/external` | Bearer | GitHub/WhatsApp connection lifecycle |
| GET/POST/PATCH/DELETE | `/api/admin/users` | Owner | Managed users and RBAC |

OAuth must be completed through the system browser and the resulting PKCE session stored in Android secure storage. Do not send social-provider secrets to these application endpoints.

The browser chat stream uses Server-Sent Events (`/api/chat`). Android can consume the same SSE events: `meta`, `delta`, `usage`, `error`, and `done`.

The generated public API description is available at `/openapi.json`.
