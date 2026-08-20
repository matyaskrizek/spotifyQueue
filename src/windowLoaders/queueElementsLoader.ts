import {fetchQueue, fetchCurrentlyPlaying} from "../services/spotifyService.ts"
import {loadSongDanceMap} from "../parsers/danceMapLoader.ts";
import { partnerDanceActive } from "./pop-outWindowLoader.ts";

// we load qrcode.js in HTML using CDN
declare var QRCode: any; // silence compiler during `npm run build`


let lastTrackId: string | null = null;
// @ts-ignore
let queuePollingInterval: number;
const songMap = await loadSongDanceMap(`${import.meta.env.BASE_URL}LineDanceMasterList.txt`);
let currAccessToken: string;
const defaultPollingRate = 5000;

// Poll every X seconds Based on the remaining time left in the current song
export function startQueuePolling(accessToken: string) {
    if(accessToken != null && accessToken != "") {
        currAccessToken = accessToken
    } else {
        accessToken = currAccessToken;
    }
    const poll = async () => {
        let currTimeout = await refreshQueue(accessToken);
        console.log("polling with wait: ", currTimeout);
        queuePollingInterval = window.setTimeout(poll, currTimeout);
    };

    poll();
}

export function resetTimeout(){
    clearTimeout(queuePollingInterval);
    startQueuePolling(currAccessToken)
}

export function populateProfileImage(profile: UserProfile) {

    const profileImg = document.getElementById("imgUrl") as HTMLImageElement | null;
    if (profileImg && profile.images[0]) {
        profileImg.src = profile.images[0].url;
    }

    // Optional: keep the URL displayed somewhere (if you still want it)
    profileImg!.alt = profile.display_name ?? 'Spotify Profile';
}

async function displayTutorialQRCode(danceName: string): Promise<void> {
    const qrContainer = document.getElementById('qrCodeContainer');
    if (!qrContainer) return;


    try {
        const url = await getTutorialUrl(danceName);
        if (!url) {
          qrContainer.innerHTML = "";
          return;
        }

        // Match CSS --tile-size so QR scales with short / odd viewports (e.g. TVs)
        const tileSizePx = parseFloat(getComputedStyle(qrContainer).width);
        const qr_code_resolution = Number.isFinite(tileSizePx) && tileSizePx > 0
            ? Math.max(72, Math.round(tileSizePx))
            : 180;

        // Clear previous QR but keep the slot
        qrContainer.innerHTML = "";
        new QRCode(qrContainer, {
            text: url,
            width: qr_code_resolution,
            height: qr_code_resolution,
            colorDark: "#000000",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.H
        });

        const nameSpan = document.createElement("span");
        nameSpan.innerText = "Scan QR code to see video tutorial :)";
        qrContainer.appendChild(nameSpan);
        
    } catch (err) {
        console.error("Error displaying tutorial URL:", err);
    }
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
    | { ok: true; danceName: string | null } // HTTP 200; play already logged by API
    | { ok: false }; // network / non-2xx / missing key — fall back to map + legacy log

/**
 * Look up a dance for the given song via walls.dance.
 * On HTTP 200, `danceName` is the matched display name or null when unmatched.
 * A successful response also logs a play when `bar` is provided.
 */
async function fetchDanceFromWalls(song: string): Promise<WallsDanceLookup> {
    const apiKey = import.meta.env.VITE_WALLS_DANCE_API_KEY;
    if (!apiKey) {
        console.warn("VITE_WALLS_DANCE_API_KEY not set; skipping walls.dance song lookup");
        return { ok: false };
    }

    const bar = import.meta.env.VITE_WALLS_BAR || "test-bar";
    const params = new URLSearchParams({ q: song, bar });
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

    document.getElementById("songTitle")!.innerText = fullQueue.currently_playing.name;
    const songName = fullQueue.currently_playing.name;
    const wallsLookup = await fetchDanceFromWalls(songName);
    // Prefer walls.dance match; on error or null match, fall back to the built-in map.
    const danceName =
        wallsLookup.ok && wallsLookup.danceName
            ? wallsLookup.danceName
            : songMap.get(songName);
    const danceTitleElmnt = document.getElementById("danceTitle");
    if (danceTitleElmnt) {
        if (danceName) {
            danceTitleElmnt.innerText = danceName;
            danceTitleElmnt.style.visibility = "visible";  // show the element
        } else {
            danceTitleElmnt.innerText = "";
            danceTitleElmnt.style.visibility = "hidden";   // hide the element
        }
    }
    // Updating the current song album cover
    loadCurrentlyPlayingAlbumCover((fullQueue.currently_playing as unknown as TrackObject).album?.images[0]?.url ?? (fullQueue.currently_playing as unknown as EpisodeObject).images[0]?.url ?? '');

    // Loading the next three songs in the queue
    const nextSongs: QueueItem[] = fullQueue.queue.slice(0, 3);
    displayNextSongs(nextSongs, 3);
    // if this is a partner dance: no line dance tutorial QR code to be shown
    if (!partnerDanceActive){
      displayTutorialQRCode(songName);
    }

    // GET /songs already logs on HTTP 200; only use POST /log when the lookup failed.
    if (!wallsLookup.ok) {
        void logSongToWalls(
            songName,
            getArtistName(fullQueue.currently_playing),
            danceName
        );
    }
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

function loadCurrentlyPlayingAlbumCover(backgroundUrl: string | null) {
    const video = document.getElementById("bgVideo") as HTMLVideoElement;
    const image = document.getElementById("albumArt") as HTMLImageElement;

    if (!video || !image || !backgroundUrl) return;

    // Reset
    video.style.display = "none";
    image.style.display = "none";
    video.src = "";
    image.src = "";

    // Determine if URL is a video
    const isVideo = backgroundUrl.match(/\.(mp4|webm|ogg)$/i);

    if (isVideo) {
        video.src = backgroundUrl;
        video.autoplay = true;
        video.loop = true;
        video.muted = true;
        video.style.display = "block";
        video.style.objectFit = "cover";     // video fills screen
        video.style.objectPosition = "center";

        // fallback to image if video fails
        video.addEventListener("error", () => {
            video.style.display = "none";
            image.src = backgroundUrl;
            image.style.display = "block";
            image.style.objectFit = "contain";   // image centered
            image.style.objectPosition = "center";
        });
    } else {
        // Treat as image
        image.src = backgroundUrl;
        image.style.display = "block";
        image.style.objectFit = "contain";       // image centered
        image.style.objectPosition = "center";
    }
}


// @ts-ignore
export async function refreshQueue(accessToken: string): Promise<number> {
    try {
        const currentlyPlaying = await fetchCurrentlyPlaying(accessToken);
        if (!currentlyPlaying) return defaultPollingRate;

        const currentTrackId = await currentlyPlaying.item.id;

        // Only update queue if the track changed
        if (currentTrackId !== lastTrackId) {

            lastTrackId = currentTrackId;

            const fullQueue = await fetchQueue(accessToken);

            if (!fullQueue) return defaultPollingRate;
            if ((window as any).resetDanceTitle) {
                (window as any).resetDanceTitle();
            }
            await populateQueue(fullQueue);
            // your function to show next 3 songs
            displayNextSongs(fullQueue.queue, 3);
            // Calculating the offset when to poll for the next song.
            console.log("Time left in the song: ", currentlyPlaying.item.duration_ms - currentlyPlaying.progress_ms)

        }
        // Default polling for next song is 5 seconds
        return Math.max(currentlyPlaying.item.duration_ms - currentlyPlaying.progress_ms, defaultPollingRate)
    } catch (err) {
        console.error("Failed to refresh queue:", err);
    }
}

function displayNextSongs(queue: QueueItem[], n_songs: number) {
    const container = document.getElementById("songsList");
    if (!container) return;

    container.innerHTML = "";  // clear previous content

    // take next n_songs songs
    queue.slice(0, n_songs).forEach(item => {
        const div = document.createElement("div");
        div.className = "songItem";

        const img = document.createElement("img");
        img.src = "album" in item ? item.album.images[0]?.url ?? "" : item.images[0]?.url ?? "";
        img.alt = item.name;

        const nameSpan = document.createElement("span");
        nameSpan.innerText = item.name;

        div.appendChild(img);
        div.appendChild(nameSpan);
        container.appendChild(div);
    });
}

