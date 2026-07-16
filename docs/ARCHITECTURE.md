# Moataz AI architecture

The repository is organized by responsibility so that new features do not need to change the entire application.

## Runtime boundaries

- `src/`: browser application. Pages compose feature modules and never receive server secrets.
- `src/features/`: domain UI such as content management. Put new business interfaces here.
- `src/components/`: reusable visual and shell components.
- `src/contexts/`: cross-cutting browser state such as authentication and display preferences.
- `src/lib/`: typed browser clients, storage adapters, and small utilities.
- `api/v1/`: stable public/mobile HTTP contracts. Breaking changes require a new API version.
- `api/_handlers/`: internal route handlers used by the current web application.
- `api/_lib/`: server-only authentication, encryption, rate limiting, provider adapters, validation, and integrations.
- `shared/`: contracts and validation constants that are safe for both runtimes.
- `supabase/migrations/`: ordered, reviewable database changes. Never edit an applied migration.

## Adding a product module

1. Add the database migration with constraints, indexes, RLS, and grants.
2. Add server validation and a versioned endpoint under `api/v1/`.
3. Add a typed client under `src/lib/`.
4. Add isolated UI under `src/features/<module>/` and a thin route page.
5. Add role checks on the server even when the UI hides the route.
6. Add unit tests, then run `npm run check`.

## Security boundaries

- Provider and integration tokens are encrypted and handled only by Vercel Functions.
- Supabase publishable keys may be used in the browser; the service-role key must never be exposed.
- RLS is enabled on exposed tables. Administrative writes go through authenticated server APIs.
- External URLs are validated against SSRF and private-network access.
- Every expensive or sensitive endpoint has a distributed rate limit.
- Content deletes are soft deletes/archives by default.

## Deployments

The GitHub repository is the source for the Vercel application. The ChatGPT Sites project is a second frontend that calls the same versioned backend and Supabase Auth project. Both clients should depend on API contracts rather than duplicate server behavior.
