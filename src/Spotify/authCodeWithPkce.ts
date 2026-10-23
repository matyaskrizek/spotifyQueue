const PRODUCTION_REDIRECT_URI =
    "https://matyaskrizek.github.io/spotifyQueue/queue.html";
const FORCE_DIALOG_KEY = "spotifyForceDialog";
/** Written on logout so other windows of the app follow. */
export const LOGGED_OUT_KEY = "loggedOutAt";

/**
 * Must match a Spotify Dashboard Redirect URI exactly.
 * In development, use the current origin so the PKCE verifier in localStorage
 * is available on the callback page (localhost ≠ 127.0.0.1, and port must match).
 */
export function getRedirectUri(): string {
    if (import.meta.env.PROD) {
        return PRODUCTION_REDIRECT_URI;
    }
    const override = import.meta.env.VITE_SPOTIFY_REDIRECT_URI;
    if (override) {
        return override;
    }
    const base = import.meta.env.BASE_URL.endsWith("/")
        ? import.meta.env.BASE_URL
        : `${import.meta.env.BASE_URL}/`;
    return `${window.location.origin}${base}queue.html`;
}

export async function redirectToAuthCodeFlow(clientId: string): Promise<void> {
    if (!clientId) {
        console.error("Missing VITE_SPOTIFY_CLIENT_ID; cannot start Spotify auth");
        return;
    }

    const verifier = generateCodeVerifier(128);
    const challenge = await generateCodeChallenge(verifier);
    const redirectUri = getRedirectUri();

    // Add queue-related scopes
    const scope = [
        'user-read-private',
        'user-read-email',
        'user-read-currently-playing',
        'user-read-playback-state',
        'user-modify-playback-state'
    ].join(' ');

    localStorage.setItem("verifier", verifier);

    const params = new URLSearchParams();
    params.append("client_id", clientId);
    params.append("response_type", "code");
    params.append("redirect_uri", redirectUri);
    params.append("scope", scope);
    params.append("code_challenge_method", "S256");
    params.append("code_challenge", challenge);
    params.append("state", "from=spotify");
    // After a logout, make Spotify ask instead of silently reusing its signed-in account.
    if (localStorage.getItem(FORCE_DIALOG_KEY)) params.append("show_dialog", "true");

    document.location = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

function generateCodeVerifier(length: number) {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

async function generateCodeChallenge(codeVerifier: string) {
    const data = new TextEncoder().encode(codeVerifier);
    const digest = await window.crypto.subtle?.digest('SHA-256', data);
    return btoa(String.fromCharCode.apply(null, [...new Uint8Array(digest)]))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

export async function getUserAccessToken(clientId: string, code: string): Promise<string> {
    const verifier = localStorage.getItem("verifier");
    const redirectUri = getRedirectUri();

    if (!verifier) {
        throw new Error(
            "Missing PKCE verifier in localStorage. Start login from the same origin you return to " +
            `(expected callback: ${redirectUri}).`
        );
    }

    const params = new URLSearchParams();
    params.append("client_id", clientId);
    params.append("grant_type", "authorization_code");
    params.append("code", code);
    params.append("redirect_uri", redirectUri);
    params.append("code_verifier", verifier);

    const result = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params
    });
    const data = await result.json();

    if (!result.ok || !data.access_token) {
        throw new Error(
            `Spotify token exchange failed (${result.status}): ${data.error || "unknown"}` +
            (data.error_description ? ` — ${data.error_description}` : "")
        );
    }

    saveAccessAndRefreshToken(data.access_token, data.refresh_token, data.expires_in);
    localStorage.removeItem("verifier");
    localStorage.removeItem(FORCE_DIALOG_KEY);
    window.history.replaceState({}, document.title, new URL(redirectUri).pathname);

    return data.access_token as string;
}

// src/spotifyApi.ts
export async function getSpotifyAccessToken(clientId: string, clientSecret: string) {
    const params = new URLSearchParams();
    params.append("grant_type", "client_credentials");
    params.append("client_id", clientId);

    const res = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
            "Authorization": "Basic " + btoa(`${clientId}:${clientSecret}`),
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: params
    });

    const data = await res.json();
    return data.access_token as string;
}


export async function refreshAccessToken(clientId: string): Promise<string> {
    const refreshToken = localStorage.getItem("refresh_token");
    if (!refreshToken) throw new Error("No refresh token available");

    const params = new URLSearchParams();
    params.append("client_id", clientId);
    params.append("grant_type", "refresh_token");
    params.append("refresh_token", refreshToken);

    const result = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {"Content-Type": "application/x-www-form-urlencoded"},
        body: params
    });

    const data = await result.json().catch(() => ({}));
    if (!result.ok || !data.access_token) {
        throw new Error(`Token refresh failed: ${result.status} ${data.error ?? result.statusText}`);
    }
    saveAccessAndRefreshToken(data.access_token, data.refresh_token, data.expires_in);
    return data.access_token as string;
}

function saveAccessAndRefreshToken(accessToken: string, refreshToken: string, expiresIn: number) {
    if (accessToken != null) {
        localStorage.setItem("access_token", accessToken);
        setCookie('spotifyAccessTokenForMyApp', accessToken, 7);
        setCookie('spotifyTokenExpiryForMyApp', (Date.now() + expiresIn * 1000).toString(), 7);
    }
    if (refreshToken != null) {
        localStorage.setItem("refresh_token", refreshToken);
        setCookie('spotifyRefreshTokenForMyApp', refreshToken, 7);
    }
}

export function setCookie(name: string, value: string, days: number) {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/`;
}

export function getCookie(name: string): string | null {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) {
        const raw = parts.pop()?.split(";").shift();
        return raw ? decodeURIComponent(raw) : null;
    }
    return null;
}

export function deleteCookie(name: string) {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
}

export function clearStoredSession() {
    for (const key of ["access_token", "refresh_token", "verifier"]) localStorage.removeItem(key);
    for (const name of [
        "spotifyAccessTokenForMyApp",
        "spotifyRefreshTokenForMyApp",
        "spotifyTokenExpiryForMyApp",
        "spotifyRetries",
    ]) {
        deleteCookie(name);
    }
}

export function redirectToLandingPage() {
    window.location.replace(import.meta.env.BASE_URL);
}

/**
 * Clears this app's tokens only; Spotify itself stays signed in, so the next
 * login shows Spotify's consent screen (with "Not you?") instead of skipping it.
 */
export function logoutOfSpotify(onDone: () => void = redirectToLandingPage) {
    clearStoredSession();
    localStorage.setItem(FORCE_DIALOG_KEY, "true");
    localStorage.setItem(LOGGED_OUT_KEY, Date.now().toString());
    onDone();
}
