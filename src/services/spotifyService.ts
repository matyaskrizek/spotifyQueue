
import { refreshAccessToken } from "../Spotify/authCodeWithPkce.ts";
const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID;

export async function fetchProfile(token: string): Promise<UserProfile> {
    console.log('Fetching user profile');
    const result = await fetchWithAuth(
        "https://api.spotify.com/v1/me",
        token,
        clientId
    );
    if (!result.ok) {
        console.error("Profile fetch failed", result.status, result.statusText,  await result.text());
        throw new Error("Failed to fetch profile");
    }
    return await result.json();
}

/** A non-OK Spotify response. `retryAfterMs` comes from a 429's `Retry-After` header, when readable. */
export class SpotifyApiError extends Error {
    status: number;
    retryAfterMs: number | null;

    constructor(what: string, response: Response) {
        super(`${what} failed: ${response.status} ${response.statusText}`);
        this.name = "SpotifyApiError";
        this.status = response.status;
        const retryAfterSeconds = Number(response.headers.get("Retry-After"));
        this.retryAfterMs = retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : null;
    }
}

export async function fetchQueue(token: string): Promise<FullQueue> {
    const playbackState = await fetchWithAuth('https://api.spotify.com/v1/me/player', token, clientId);
    if (!playbackState.ok) throw new SpotifyApiError("Playback state fetch", playbackState);
    const result = await fetchWithAuth(
        "https://api.spotify.com/v1/me/player/queue",
        token,
        clientId
    );
    if (!result.ok) throw new SpotifyApiError("Queue fetch", result);
    return await result.json();
}

// src/fetchAlbums.ts
export async function fetchCountryAlbums(accessToken: string, limit = 20) {
    const url = `https://api.spotify.com/v1/search?q=country&type=album&limit=${limit}`;
    const res = await fetch(url, {
        headers: { "Authorization": `Bearer ${accessToken}` }
    });
    const data = await res.json();

    // Extract album image URLs (small size for background)
    return data.albums.items
        .map((album: { images: Image[] }) => album.images[2]?.url || album.images[0]?.url)
        .filter(Boolean);
}


async function fetchWithAuth(url: string, token: string, clientId: string) {
    // Callers like the poll loop keep the token they started with; after a refresh
    // (in this window or the other one) the newest one is in localStorage.
    const currentToken = localStorage.getItem("access_token") || token;
    let result = await fetch(url, {
        headers: { Authorization: `Bearer ${currentToken}` }
    });

    if (result.status === 401) { // token expired
        console.warn("Token expired, refreshing...");
        const newToken = await refreshAccessToken(clientId);

        result = await fetch(url, {
            headers: { Authorization: `Bearer ${newToken}` }
        });
    }

    return result;
}

// Example fetchCurrentlyPlaying function
export async function fetchCurrentlyPlaying(token: string): Promise<CurrentlyPlaying | null> {
    const res = await fetchWithAuth("https://api.spotify.com/v1/me/player/currently-playing", token, clientId);
    if (res.status === 204) return null;  // nothing playing
    if (!res.ok) throw new SpotifyApiError("Currently playing fetch", res);
    return await res.json();
}
