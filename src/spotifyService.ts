
import { refreshAccessToken } from "./authCodeWithPkce";
// TODO make this an env variable
const clientId = "bdb65f4eee034a86828ae4c9ee70a8e6"; // Replace with your client id

export async function fetchProfile(token: string): Promise<UserProfile> {
    console.log(`Fetching profile for ${token}`);
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

export async function fetchQueue(token: string): Promise<FullQueue | null> {
    const playbackState = await fetchWithAuth('https://api.spotify.com/v1/me/player', token, clientId);
    if (!playbackState.ok) {
        console.error('No active playback device or session');
        return null;
    } else {
        const result = await fetchWithAuth(
            "https://api.spotify.com/v1/me/player/queue",
            token,
            clientId
        );
        if (!result.ok) {
            console.error("Queue fetch failed", result.status, result.statusText, await result.text());
            throw new Error("Failed to fetch queue");
        }
        return await result.json();
    }
}

async function fetchWithAuth(url: string, token: string, clientId: string) {
    let result = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
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
export async function fetchCurrentlyPlaying(token: string): Promise<any> {
    const res = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (res.status === 204) return null;  // nothing playing
    return await res.json();
}
