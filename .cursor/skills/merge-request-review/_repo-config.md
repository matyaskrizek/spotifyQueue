# Repository Configuration

| Setting | Value |
|---------|-------|
| **git_host** | github.com |
| **github_repo** | matyaskrizek/spotifyQueue |
| **base_branch** | master |
| **pr_review_script** | scripts/pr-review.sh |
| **verify_commands** | `npm run typecheck`, `npm test`, `npm run build` |
| **test_suite** | Vitest (`npm test`; `src/**/*.test.ts`, `workers/**/*.test.ts`) and Playwright (`npm run test:e2e`; `e2e/`, mocks Spotify and walls.dance). Locally, `PW_CHANNEL=chrome npm run test:e2e` uses the installed Chrome. |

## Project layout

| Path | What it is |
|------|------------|
| `src/` | Browser app (Vite + TypeScript, no framework), deployed to GitHub Pages |
| `src/Spotify/`, `src/services/` | Spotify PKCE auth and Web API calls |
| `src/backgroundEditor/` | Background editor (IndexedDB via `idb`, `moveable`, zip import/export via `jszip`) |
| `src/windowLoaders/` | Page/window bootstrapping (landing, queue, pop-out, session timeout) |
| `index.html`, `queue.html`, `404.html` | Vite entry pages |
| `workers/walls-api-proxy/` | Cloudflare Worker proxying the walls.dance API (config in `wrangler.toml`) |
| `.github/workflows/deploy.yml` | GitHub Pages lint/typecheck/test/build/deploy on push to `master` |
| `.github/workflows/ci.yml` | Typecheck, tests and build on PRs and branch pushes; Playwright e2e on PRs |
| `src/test/`, `e2e/` | Vitest setup and helpers; Playwright specs and fixtures |
