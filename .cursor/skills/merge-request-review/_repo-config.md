# Repository Configuration

| Setting | Value |
|---------|-------|
| **git_host** | github.com |
| **github_repo** | matyaskrizek/spotifyQueue |
| **base_branch** | master |
| **pr_review_script** | scripts/pr-review.sh |
| **verify_commands** | `npx tsc --noEmit`, `npm run build` |
| **test_suite** | none (manual verification via `npm run dev`) |

## Project layout

| Path | What it is |
|------|------------|
| `src/` | Browser app (Vite + TypeScript, no framework), deployed to GitHub Pages |
| `src/Spotify/`, `src/services/` | Spotify PKCE auth and Web API calls |
| `src/backgroundEditor/` | Background editor (IndexedDB via `idb`, `moveable`, zip import/export via `jszip`) |
| `src/windowLoaders/` | Page/window bootstrapping (landing, queue, pop-out, session timeout) |
| `index.html`, `queue.html`, `404.html` | Vite entry pages |
| `workers/walls-api-proxy/` | Cloudflare Worker proxying the walls.dance API (config in `wrangler.toml`) |
| `.github/workflows/deploy.yml` | GitHub Pages build/deploy on push to `master` |
