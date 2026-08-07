# Summary

Application to show current queue in slideShow form, with the ability to add a map library to translate song names into dances.

# Setup instructions for local development

## Prerequisites

- Spotify premium subscription

## Setup steps

1. Create project on [Spotify developers dashboard](https://developer.spotify.com/dashboard)
1. Export the following environment variable: `VITE_SPOTIFY_CLIENT_ID`
1. Add these Redirect URIs in the Spotify Dashboard (exact match required — `localhost` and `127.0.0.1` are different):
   - `http://127.0.0.1:5173/spotifyQueue/queue.html` (local)
   - `https://matyaskrizek.github.io/spotifyQueue/queue.html` (production)

1. Clone repo and `cd` into it
1. `npm install`
1. `npm run dev`
1. Open URL that is shown in web browser (use that exact origin when registering the redirect URI)

