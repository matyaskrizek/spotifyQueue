# Cloudflare Worker Review Checklist

Applies to changes under `workers/`, `wrangler.toml`, and browser code that calls the Worker.

## Bugs

- [ ] Every code path returns a `Response` (including errors and unexpected methods)
- [ ] Upstream `fetch` failures (network error, non-2xx) are caught and mapped to a clear status instead of throwing a 500 with no CORS headers
- [ ] Request bodies are read at most once (clone if both logging and forwarding)
- [ ] `OPTIONS` preflight is handled for every allowed path and returns the same CORS headers as the real response
- [ ] Env vars used in code exist in `wrangler.toml` `[vars]` or are documented as `wrangler secret put` secrets, and the `Env` interface matches

## Security

- [ ] Origin allow-list is enforced: unknown origins get no `Access-Control-Allow-Origin` (never `*` while forwarding an API key)
- [ ] `Vary: Origin` is set whenever the CORS header depends on the request origin
- [ ] Path allow-list (`ALLOWED_PATHS`) is preserved -- new paths are added deliberately, and the Worker can't be used as an open proxy to arbitrary upstream URLs
- [ ] Path/query from the client can't change the upstream host (no string-concatenated URLs that allow `//evil.com` or `@` tricks; build with `new URL(path, env.UPSTREAM)` and re-check the host)
- [ ] Secrets (`WALLS_DANCE_API_KEY`) come from Worker secrets, are never echoed back in responses or logs, and are not also shipped to the browser via `VITE_*`
- [ ] Only needed request headers are forwarded upstream (don't forward cookies or arbitrary client headers)
- [ ] Allowed methods are restricted to what the upstream endpoints need
- [ ] Request body size / content type is validated before forwarding POSTs

## Config / Deploy

- [ ] `name` in `wrangler.toml` still matches the dashboard Worker (Cloudflare Git builds fail on mismatch)
- [ ] `ALLOWED_ORIGINS` includes both production (`https://matyaskrizek.github.io`) and the local dev origin if dev should work
- [ ] `compatibility_date` changes are intentional and checked against Cloudflare runtime changes
- [ ] Browser-side base URL (`VITE_WALLS_API_BASE`) and the Worker routes agree; the GitHub Actions workflow passes any new env vars

## Structure

- [ ] CORS/error helpers are reused instead of duplicating header construction
- [ ] Worker code stays free of browser-only APIs (`window`, `document`, `localStorage`)

## Verification

- [ ] `npx wrangler dev` runs locally and the changed paths respond as expected (including preflight from an allowed origin and rejection from a disallowed one)
- [ ] Review lists manual steps to verify the proxy end-to-end from the app
