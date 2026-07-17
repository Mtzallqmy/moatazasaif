# Integrated Files, GitHub, Supabase and Security Upgrade

## Existing foundation

- Chat already accepts PNG/JPEG/WebP and TXT/Markdown/JSON attachments, validates image signatures, limits attachments to three and caps the aggregate payload at 3 MiB.
- Provider requests already use server-side adapters, encrypted credentials, URL safety checks, validation and redacted diagnostics.
- GitHub manual integration already stores a fine-grained token encrypted and can test the current user and list repositories.
- Supabase is the platform database and sensitive server operations use the service role only on the backend.

## Safety boundary

Connections are authorized only by the account owner. No feature may bypass provider permissions, impersonate another account, reveal tokens, or silently acquire broader access. GitHub and Supabase permissions must be explicit, revocable, auditable and least-privilege by default.

## Delivery phases

1. Extend chat attachment support safely without replacing the working flow.
2. Add durable attachment metadata and optional private Storage persistence for signed-in chats.
3. Add GitHub connection capabilities with declared scopes and protected write actions such as repository creation.
4. Add Supabase project connection and a guarded database operations layer; arbitrary SQL is never exposed to browser clients.
5. Add audit events, connection health, token rotation indicators, rate limits and security regression checks.

## Non-goals

- No account takeover or access outside a user's explicit authorization.
- No raw service-role key or provider token in frontend code, browser storage, logs or API responses.
- No destructive database operation without an authenticated, role-checked server route and explicit confirmation metadata.
