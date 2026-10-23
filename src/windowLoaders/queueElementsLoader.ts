import {fetchQueue, fetchCurrentlyPlaying, SpotifyApiError} from "../services/spotifyService.ts"
import {loadSongDanceMap} from "../parsers/danceMapLoader.ts";
import { isPopoutWindow } from "./windowRole.ts";
import { updatePlaybackState, type TrackSummary } from "./playbackState.ts";


let lastTrackId: string | null = null;
let queuePollingInterval: number | undefined;
let songMapPromise: Promise<Map<string, string>> | null = null;

/** The built-in song → dance list, fetched on first use. */
function getSongMap(): Promise<Map<string, string>> {
    songMapPromise ??= loadSongDanceMap(`${import.meta.env.BASE_URL}LineDanceMasterList.txt`);
    return songMapPromise;
}
let currAccessToken: string;
const defaultPollingRate = 5000;
/** Failed polls double the wait from `defaultPollingRate`, up to this cap. */
const MAX_BACKOFF_MS = 2 * 60 * 1000;
let pollingPaused = false;
/** Bumped on every (re)start so a poll still awaiting Spotify can't keep an old loop alive. */
let pollGeneration = 0;

const MANUAL_DANCE_KEY = "manualDanceOverride";

type ManualDanceOverride = { trackId: string; danceName: string };

let currentTrack: { id: string; name: string; artist: string } | null = null;
/** User-entered dance for the current track; wins over walls / local map. */
let manualDanceName: string | null = null;

function readManualDance(): ManualDanceOverride | null {
    try {
        const raw = localStorage.getItem(MANUAL_DANCE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as ManualDanceOverride;
        if (parsed?.trackId && parsed?.danceName) return parsed;
    } catch {
        // ignore corrupt storage
    }
    return null;
}

function writeManualDance(override: ManualDanceOverride): void {
    localStorage.setItem(MANUAL_DANCE_KEY, JSON.stringify(override));
}

function clearManualDanceStorage(): void {
    localStorage.removeItem(MANUAL_DANCE_KEY);
}

// The pop-out picks up manual overrides through the `manualDanceOverride` storage event.
function setDanceTitleDisplay(danceName: string | undefined | null): void {
    updatePlaybackState({ danceTitle: danceName ?? "" });
}

// populateQueue runs more than once per track (startup fetch + first poll),
// so remember which track was logged to record each play once.
let loggedTrackId: string | null = null;

function logPlayOnce(trackId: string, song: string, artist: string, dance?: string) {
    // Only the main window logs; the pop-out would double-count every play.
    if (isPopoutWindow()) return;
    if (loggedTrackId === trackId) return;
    loggedTrackId = trackId;
    void logSongToWalls(song, artist, dance);
}

/** Apply a user-entered dance name for the currently playing song and log it. */
export function submitManualDanceName(danceName: string): boolean {
    const trimmed = danceName.trim();
    if (!trimmed) return false;
    if (!currentTrack) {
        console.warn("No current track; cannot set dance name");
        return false;
    }

    manualDanceName = trimmed;
    writeManualDance({ trackId: currentTrack.id, danceName: trimmed });
    setDanceTitleDisplay(trimmed);
    // The play was already logged with the auto-detected dance; record the correction.
    if (!isPopoutWindow()) {
        void logSongToWalls(currentTrack.name, currentTrack.artist, trimmed);
    }
    return true;
}

/** Sync dance title when another window sets a manual override. */
export function applyManualDanceFromStorage(): void {
    if (!currentTrack) return;
    const stored = readManualDance();
    if (stored?.trackId === currentTrack.id) {
        manualDanceName = stored.danceName;
        setDanceTitleDisplay(stored.danceName);
    }
}

/**
 * Wait before retrying after `failedPolls` earlier failures in a row: doubles from
 * the default rate up to the cap. Spotify's own retry time wins when it asks for longer.
 */
export function nextPollDelay(failedPolls: number, retryAfterMs: number | null): number {
    const backoff = Math.min(defaultPollingRate * 2 ** failedPolls, MAX_BACKOFF_MS);
    return Math.max(backoff, retryAfterMs ?? 0);
}

// Poll every X seconds Based on the remaining time left in the current song
export function startQueuePolling(accessToken: string) {
    if(accessToken != null && accessToken != "") {
        currAccessToken = accessToken
    } else {
        accessToken = currAccessToken;
    }
    pollingPaused = false;
    clearTimeout(queuePollingInterval);
    const generation = ++pollGeneration;
    let failedPolls = 0;
    const poll = async () => {
        if (pollingPaused || generation !== pollGeneration) return;
        let wait: number;
        try {
            wait = await refreshQueue(accessToken);
            failedPolls = 0;
        } catch (err) {
            console.error("Failed to refresh queue:", err);
            wait = nextPollDelay(failedPolls, err instanceof SpotifyApiError ? err.retryAfterMs : null);
            failedPolls++;
        }
        // A poll may still be awaiting Spotify when the session gets paused or polling restarts
        if (pollingPaused || generation !== pollGeneration) return;
        console.log("polling with wait: ", wait);
        queuePollingInterval = window.setTimeout(poll, wait);
    };

    poll();
}

export function stopQueuePolling() {
    pollingPaused = true;
    clearTimeout(queuePollingInterval);
}

export function resetTimeout(){
    if (pollingPaused) return;
    clearTimeout(queuePollingInterval);
    startQueuePolling(currAccessToken)
}

export function populateProfileImage(profile: UserProfile) {
    updatePlaybackState({
        profileImageUrl: profile.images[0]?.url ?? "",
        profileName: profile.display_name ?? "",
    });
}

async function displayTutorialQRCode(songName: string, trackId: string): Promise<void> {
    try {
        const url = await getTutorialUrl(songName);
        // A slow lookup must not overwrite the QR code of a newer track.
        if (currentTrack?.id !== trackId) return;
        updatePlaybackState({ tutorialUrl: url || null });
    } catch (err) {
        console.error("Error displaying tutorial URL:", err);
    }
}

function itemImageUrl(item: QueueItem): string {
    return "album" in item ? item.album.images[0]?.url ?? "" : item.images[0]?.url ?? "";
}

function toTrackSummary(item: QueueItem): TrackSummary {
    return { id: item.id, name: item.name, imageUrl: itemImageUrl(item) };
}

function getArtistName(item: QueueItem): string {
    if ("artists" in item && item.artists?.length) {
        return item.artists.map((a) => a.name).join(", ");
    }
    return "";
}

function wallsApiUrl(path: string): string {
    // Dev: Vite same-origin proxy. Production: Cloudflare Worker (CORS).
    if (import.meta.env.DEV) {
        return `/walls-api${path}`;
    }
    const base = (import.meta.env.VITE_WALLS_API_BASE || "https://walls.dance").replace(/\/$/, "");
    return `${base}${path}`;
}

type WallsDanceLookup =
    | { ok: true; danceName: string | null } // HTTP 200
    | { ok: false }; // network / non-2xx / missing key — fall back to map

/**
 * Look up a dance for the given song via walls.dance (no `bar`, so this does not
 * log a play — plays are always recorded via POST /log with the resolved dance).
 */
async function fetchDanceFromWalls(song: string): Promise<WallsDanceLookup> {
    const apiKey = import.meta.env.VITE_WALLS_DANCE_API_KEY;
    if (!apiKey) {
        console.warn("VITE_WALLS_DANCE_API_KEY not set; skipping walls.dance song lookup");
        return { ok: false };
    }

    const params = new URLSearchParams({ q: song });
    const url = wallsApiUrl(`/api/v1/songs?${params}`);

    console.log("[walls.dance] GET", url, {
        apiKeyPresent: Boolean(apiKey),
        apiKeySuffix: apiKey.slice(-6),
    });

    try {
        const response = await fetch(url, {
            headers: { "x-api-key": apiKey },
        });

        if (!response.ok) {
            console.error(
                "Failed to look up song on walls.dance:",
                response.status,
                response.statusText
            );
            return { ok: false };
        }

        const data = (await response.json()) as WallsSongsResponse;
        console.log("[walls.dance] songs response", data);

        if (!data.match) {
            return { ok: true, danceName: null };
        }

        const danceName = data.match.dance.displayName || data.match.dance.name || null;
        return { ok: true, danceName };
    } catch (err) {
        console.error("Error looking up song on walls.dance:", err);
        return { ok: false };
    }
}

async function logSongToWalls(song: string, artist: string, dance?: string): Promise<void> {
    const apiKey = import.meta.env.VITE_WALLS_DANCE_API_KEY;
    if (!apiKey) {
        console.warn("VITE_WALLS_DANCE_API_KEY not set; skipping walls.dance log");
        return;
    }

    const body: { song: string; artist: string; bar: string; dance?: string } = {
        song,
        artist,
        bar: import.meta.env.VITE_WALLS_BAR || "test-bar",
    };
    if (dance) {
        body.dance = dance;
    }

    const url = wallsApiUrl("/api/v1/log");
    console.log("[walls.dance] POST", url, {
        body,
        apiKeyPresent: Boolean(apiKey),
        apiKeySuffix: apiKey.slice(-6),
    });

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
            },
            body: JSON.stringify(body),
        });
        const responseText = await response.text();
        let responseJson: unknown = null;
        try {
            responseJson = responseText ? JSON.parse(responseText) : null;
        } catch {
            // non-JSON body
        }

        console.log("[walls.dance] response", {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            body: responseJson ?? responseText,
        });

        if (!response.ok) {
            console.error(
                "Failed to log song to walls.dance:",
                response.status,
                responseJson ?? responseText
            );
        }
    } catch (err) {
        console.error("Error logging song to walls.dance:", err);
    }
}

export async function populateQueue(fullQueue: FullQueue) {
    // Loading current Song Name

    const playing = fullQueue.currently_playing;
    const songName = playing.name;
    const trackId = playing.id;
    const artistName = getArtistName(playing);
    const imageUrl = itemImageUrl(playing);

    // Reset manual override when the track changes.
    if (currentTrack?.id !== trackId) {
        manualDanceName = null;
        const stored = readManualDance();
        if (stored && stored.trackId !== trackId) {
            clearManualDanceStorage();
        }
        updatePlaybackState({ tutorialUrl: null });
    }
    currentTrack = { id: trackId, name: songName, artist: artistName };
    updatePlaybackState({ songTitle: songName, albumArtUrl: imageUrl });

    const storedOverride = readManualDance();
    if (storedOverride?.trackId === trackId) {
        manualDanceName = storedOverride.danceName;
    }

    let danceName: string | undefined = manualDanceName ?? undefined;

    // Skip auto-lookup when the user already named this track's dance.
    if (!manualDanceName) {
        const [wallsLookup, songMap] = await Promise.all([fetchDanceFromWalls(songName), getSongMap()]);
        // A newer track's update owns the display now.
        if (currentTrack?.id !== trackId) return;
        // Prefer walls.dance match; on error or null match, fall back to the built-in map.
        // A dance set with Set Dance during the lookup still wins.
        danceName =
            manualDanceName ??
            (wallsLookup.ok && wallsLookup.danceName ? wallsLookup.danceName : songMap.get(songName));
    }

    // Partner dance mode overrides what's displayed, so the real dance is kept for when it's toggled off.
    setDanceTitleDisplay(danceName);

    displayNextSongs(fullQueue.queue);
    void displayTutorialQRCode(songName, trackId);

    // Include dance when resolved (API, local map, or Set Dance).
    logPlayOnce(trackId, songName, artistName, danceName);
}

/*
 * Returns tutorial URL if found; else null
 */
async function getTutorialUrl(song_name: string){
    const DISTANCE_THRESHOLD = 0.3;
    const API_HOST = 'loic.lescoat.me';
    try {
        const response = await fetch(`https://${API_HOST}/linedance_database/tutorial_url?song_name=${encodeURIComponent(song_name)}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const x = await response.json();
        if (x.distance >= DISTANCE_THRESHOLD){
          throw new Error(`Distance of ${x.distance} exceeds threshold of ${DISTANCE_THRESHOLD}; assuming song name "${song_name}" has no matches; closest match is "${x.best_match}"`);
        }
        return x.tutorial_url;
    } catch (error) {
        console.error("Error fetching tutorial URL:", error);
    }
    return null;
}

/** Returns how long to wait before the next poll. Throws when Spotify can't be reached. */
export async function refreshQueue(accessToken: string): Promise<number> {
    const currentlyPlaying = await fetchCurrentlyPlaying(accessToken);
    if (!currentlyPlaying?.item) return defaultPollingRate;

    const currentTrackId = currentlyPlaying.item.id;

    // Only update queue if the track changed
    if (currentTrackId !== lastTrackId) {
        const fullQueue = await fetchQueue(accessToken);
        (window as Window & { resetDanceTitle?: () => void }).resetDanceTitle?.();
        await populateQueue(fullQueue);
        lastTrackId = currentTrackId;
        // Calculating the offset when to poll for the next song.
        console.log("Time left in the song: ", currentlyPlaying.item.duration_ms - currentlyPlaying.progress_ms)
    }
    // Default polling for next song is 5 seconds
    return Math.max(currentlyPlaying.item.duration_ms - currentlyPlaying.progress_ms, defaultPollingRate)
}

// Widgets choose how many to show (up to 10).
function displayNextSongs(queue: QueueItem[]) {
    updatePlaybackState({ upNext: queue.slice(0, 10).map(toTrackSummary) });
}

/** For status messages like "No songs currently playing". */
export function showSongTitleMessage(message: string) {
    updatePlaybackState({ songTitle: message });
}

