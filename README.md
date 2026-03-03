# Summary

Application to show current queue in slideShow form, with the ability to add a map library to translate song names into dances.

# Setup instructions for local development

## Prerequisites

- Spotify premium subscription

## Setup steps

1. Create project on [Spotify developers dashboard](https://developer.spotify.com/dashboard)
1. Export the following environment variable: `VITE_SPOTIFY_CLIENT_ID`
1. Add the URL on [this line](https://github.com/matyaskrizek/spotifyQueue/blob/cc8e673365b93428181cd6a343ddd4be3022bd3e/src/Spotify/authCodeWithPkce.ts?plain=1#L3) to the `Redirect URIs` section

1. Clone repo and `cd` into it
1. `npm install`
1. `npm run dev`
1. Open URL that is shown in web browser

