import "/src/style.css";
import {redirectToAuthCodeFlow, getAccessToken, refreshAccessToken, getCookie, setCookie} from "./authCodeWithPkce";
import {fetchQueue, fetchProfile, fetchCurrentlyPlaying} from "./spotifyService.ts"


// TODO make this an env variable
const clientId = "bdb65f4eee034a86828ae4c9ee70a8e6"; // Replace with your client id
const params = new URLSearchParams(window.location.search);
const code = params.get("code");

let lastTrackId: string | null = null;
// @ts-ignore
let queuePollingInterval: number;


// ---------------- Main Initialization ----------------
async function init() {
    let accessToken = getCookie("spotifyAccessToken");
    let refreshToken: string | null = getCookie("spotifyRefreshToken");
    const tokenExpiry = Number(getCookie("spotifyTokenExpiry") || "0");

    try {
        if (!accessToken || Date.now() > tokenExpiry) {
            let gotToken = false;

            // Step 1: Try refresh token
            if (refreshToken) {
                try {
                    accessToken = await refreshAccessToken(refreshToken);
                    gotToken = true;
                } catch (err) {
                    console.warn("Refresh token failed, trying code flow:", err);
                    refreshToken = null;
                }
            }

            // Step 2: If still no token, try exchange code
            if (!gotToken && code) {
                try {
                    accessToken = await getAccessToken(clientId, code);
                    gotToken = true;
                } catch (err) {
                    console.warn("Code exchange failed:", err);
                    //setCookie("spotifyRefreshToken", null, null);
                    refreshToken = null;
                }
            }

            // Step 3: If both fail, redirect
            if (!gotToken) {
                console.warn("No valid access token, redirecting to login.");
                await redirectToAuthCodeFlow(clientId);
                return;
            }
        }

        // ---- At this point we should have a valid access token ----
        const profile = await fetchProfile(accessToken);
        populateProfileImage(profile);

        const fullQueue = await fetchQueue(accessToken);
        if (fullQueue) {
            populateQueue(fullQueue);
        }

        startQueuePolling(accessToken);

    } catch (err) {
        console.error("Init failed, redirecting:", err);
        await redirectToAuthCodeFlow(clientId);
    }
}



function populateProfileImage(profile: UserProfile) {

    const profileImg = document.getElementById("imgUrl") as HTMLImageElement | null;
    if (profileImg && profile.images[0]) {
        profileImg.src = profile.images[0].url;
    }

    // Optional: keep the URL displayed somewhere (if you still want it)
    profileImg!.alt = profile.display_name ?? 'Spotify Profile';
}


function populateQueue(fullQueue: FullQueue) {
    // Loading current Song Name
    document.getElementById("songTitle")!.innerText = fullQueue.currently_playing.name;
    // Updating the current song album cover
    loadBackground((fullQueue.currently_playing as unknown as TrackObject).album?.images[0]?.url ?? (fullQueue.currently_playing as unknown as EpisodeObject).images[0]?.url ?? '');
    // Loading the next three songs in the queue
    const nextSongs: QueueItem[] = fullQueue.queue.slice(0, 3);
    displayNextThreeSongs(nextSongs);
}

function loadBackground(backgroundUrl: string | null) {
    const video = document.getElementById("bgVideo") as HTMLVideoElement;
    const image = document.getElementById("bgImage") as HTMLImageElement;

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


export async function refreshQueue(accessToken: string) {
    try {
        const currentlyPlaying = await fetchCurrentlyPlaying(accessToken);
        if (!currentlyPlaying) return;

        const currentTrackId = await currentlyPlaying.item.id;

        // Only update queue if the track changed
        if (currentTrackId !== lastTrackId) {
            lastTrackId = currentTrackId;

            const fullQueue = await fetchQueue(accessToken);
            if (!fullQueue) return;
            populateQueue(fullQueue);
            displayNextThreeSongs(fullQueue.queue);  // your function to show next 3 songs
        }
    } catch (err) {
        console.error("Failed to refresh queue:", err);
    }
}

// Poll every 5 seconds (adjust as needed)
function startQueuePolling(accessToken: string) {
    refreshQueue(accessToken);  // immediate fetch
    queuePollingInterval = window.setInterval(() => {
        refreshQueue(accessToken);
    }, 5000);
}

// Stop polling if needed
/*function stopQueuePolling() {
    clearInterval(queuePollingInterval);
}*/

function displayNextThreeSongs(queue: QueueItem[]) {
    const container = document.getElementById("upNextColumn");
    if (!container) return;

    container.innerHTML = ""; // clear previous content

    // take next 3 songs
    queue.slice(0, 3).forEach(item => {
        const div = document.createElement("div");
        div.className = "songItem";

        const nameSpan = document.createElement("span");
        nameSpan.innerText = item.name;

        const img = document.createElement("img");
        img.src = "album" in item ? item.album.images[0]?.url ?? "" : item.images[0]?.url ?? "";
        img.alt = item.name;

        div.appendChild(nameSpan);
        div.appendChild(img);
        container.appendChild(div);
    });
}



init();


