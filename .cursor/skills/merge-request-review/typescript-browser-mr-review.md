# TypeScript / Browser (Vite) Review Checklist

Applies to changes under `src/`, the HTML entry pages, `vite.config.js`, `tsconfig.json`, and `.env*` files.

## Standards

- If `.cursor/rules/` exists, use the Glob tool to find all `.cursor/rules/**/*.mdc` files, read each, and verify the diff conforms to them.
- `tsconfig.json` is `strict` with `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`, and `erasableSyntaxOnly`. The diff must type-check under those settings (`npx tsc --noEmit`).

## Bugs

- [ ] DOM lookups (`getElementById`, `querySelector`) handle `null` instead of using `!` on elements that may not exist on every page
- [ ] Every `async` call is awaited or explicitly handled -- no floating promises that swallow rejections
- [ ] `fetch` checks `response.ok` before reading the body; non-2xx paths are handled
- [ ] Spotify API edge cases handled: `204 No Content` (nothing playing), `401` (expired token -> refresh), `429` (respect `Retry-After`)
- [ ] Races between overlapping async work (polling, rapid clicks, switching projects) can't apply stale results
- [ ] Type assertions (`as X`) aren't hiding a real shape mismatch -- especially on `JSON.parse`, API responses, and imported files
- [ ] `localStorage` / IndexedDB reads tolerate missing or malformed data (first run, older saved format)

## Memory Leaks

- [ ] `addEventListener` on `window`/`document` or long-lived nodes is removed when the owning view closes, or is guaranteed to run only once
- [ ] Re-rendering a list or opening an editor repeatedly doesn't stack duplicate listeners
- [ ] `URL.createObjectURL` is paired with `URL.revokeObjectURL` when the asset is replaced or removed
- [ ] `setInterval` / `setTimeout` / `requestAnimationFrame` loops are cleared on teardown and not restarted on top of an existing one
- [ ] `<video>`/`<img>` elements for removed assets are released (no lingering references in maps/caches)
- [ ] Moveable instances are destroyed when their target is removed

## Security

- [ ] **Anything read via `import.meta.env.VITE_*` is public** -- it is inlined into the shipped bundle. No secrets (API keys, client secrets) may use a `VITE_` variable; they belong behind the Cloudflare Worker
- [ ] No real secrets added to committed `.env*` files (`.env.local` and `*.local` are gitignored; `.env.development` / `.env.production` / `.env.example` are not)
- [ ] User- or API-controlled strings (song titles, artist names, dance names, imported project text) are inserted with `textContent` / DOM APIs, not `innerHTML` or template-string HTML
- [ ] Imported project files (zip/JSON) are validated: expected structure, types, size limits, allowed MIME types for media
- [ ] PKCE flow: `code_verifier` is generated with `crypto.getRandomValues`, removed from storage after the token exchange, and the `code` is stripped from the URL after use
- [ ] Access/refresh tokens are not logged and not put in URLs; requested Spotify scopes are the minimum needed
- [ ] `postMessage` / pop-out window communication checks `event.origin` and doesn't trust message contents blindly
- [ ] Redirect URIs and origins aren't hard-coded to one environment in a way that breaks dev vs. GitHub Pages (`/spotifyQueue/` base path)

## Structure

- [ ] Functions stay focused (prefer < 50 lines); large controllers aren't growing further without reason
- [ ] DOM wiring, state, and rendering stay separated the way existing modules do (`editorController` / `sceneRenderer` / `projectStore`)
- [ ] Shared types live in `src/types/` rather than being redefined inline
- [ ] Type-only imports use `import type` (required by `verbatimModuleSyntax`)
- [ ] No `enum`, `namespace`, or parameter properties (disallowed by `erasableSyntaxOnly`)
- [ ] No leftover `console.log` debugging; intentional logging is clearly meaningful
- [ ] Persisted data format changes (IndexedDB schema, localStorage keys) include a migration path or version bump, like the existing legacy-background migration in `projectStore.ts`

## CSS / HTML

- [ ] New styles are scoped (class prefixes like the existing `bg*` ids/classes) and don't override unrelated pages
- [ ] Layout works in the pop-out window and at the display sizes the queue is shown on
- [ ] Interactive elements are real `<button>`s / have labels; keyboard shortcuts don't fire while typing in inputs

## Verification

- [ ] `npm run typecheck`, `npm test` and `npm run build` pass; run `npm run test:e2e` when the diff touches the queue page, editor, media handling or pop-out
- [ ] Changed behaviour has a test next to the code (`src/**/*.test.ts`, Vitest) or, for flows that need a real browser, in `e2e/` (Playwright with mocked Spotify) -- missing tests for new logic are a WARNING
- [ ] New tests would fail if the fix were reverted (not just asserting on mocks)
- [ ] Review lists manual steps only for what the tests can't cover (real Spotify login, real walls.dance, multi-monitor pop-out)

## Common Patterns to Verify

### Safe text insertion
```ts
// Good
el.textContent = track.name;

// Bad: XSS if the track name contains markup
el.innerHTML = `<span>${track.name}</span>`;
```

### Object URL lifecycle
```ts
// Good: revoke when the asset is replaced or removed
const url = URL.createObjectURL(blob);
urls.set(id, url);
// ...later
URL.revokeObjectURL(urls.get(id)!);
urls.delete(id);

// Bad: createObjectURL on every render with no revoke
```

### Listener teardown
```ts
// Good
const controller = new AbortController();
window.addEventListener("resize", onResize, { signal: controller.signal });
// on close:
controller.abort();

// Bad: adding a window listener each time the editor opens
```
