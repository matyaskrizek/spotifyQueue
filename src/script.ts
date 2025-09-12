import "/src/style.css";
import {redirectToAuthCodeFlow, getAccessToken, refreshAccessToken, getCookie, setCookie, deleteCookie} from "./authCodeWithPkce";
import {fetchQueue, fetchProfile, fetchCurrentlyPlaying} from "./spotifyService.ts"


// TODO make this an env variable
const clientId = "bdb65f4eee034a86828ae4c9ee70a8e6"; // Replace with your client id

let lastTrackId: string | null = null;
// @ts-ignore
let queuePollingInterval: number;


// ---------------- Main Initialization ----------------
async function init() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code") || null;
    const maxRetries = 3;

    // Retrieve tokens from cookies
    const tokenExpiry = Number(getCookie("spotifyTokenExpiry") || "0");
    let accessToken: string | null = getCookie("spotifyAccessToken") || null;

    let refreshToken: string | null = getCookie("spotifyRefreshToken") || null;
    let retries: number = Number(getCookie("spotifyRetries") || "0");
    if(accessToken == "undefined"){
        accessToken = null;
    }
    if(refreshToken == "undefined"){
        refreshToken = null;
    }
    console.log("TOP OF INIT");
    console.log("accessToken at top of INIT:", accessToken);
    console.log("code at top of INIt:", code);

    try {
        // Only retry locally if token missing or expired, up to maxRetries
        if (!accessToken || Date.now() > tokenExpiry) {
            if (refreshToken && retries < maxRetries) {
                try {
                    accessToken = await refreshAccessToken(refreshToken);
                    setCookie("spotifyAccessToken", accessToken, 1); // persist new access token
                    setCookie("spotifyRetries", "0", 1); // reset retries
                } catch (err) {
                    console.warn("Refresh token failed:", err);
                    deleteCookie("spotifyAccessToken");
                    deleteCookie("spotifyRefreshToken");
                    retries++;
                    setCookie("spotifyRetries", retries.toString(), 1);
                    accessToken = null;
                    refreshToken = null;
                }
            }

            // Try authorization code flow if refresh token fails
            if (!accessToken && code) {
                try {
                    accessToken = await getAccessToken(clientId, code);
                    setCookie("spotifyAccessToken", accessToken, 1);
                    setCookie("spotifyRetries", "0", 1); // reset retries
                } catch (err) {
                    console.warn("Code exchange failed:", err);
                    deleteCookie("spotifyAccessToken");
                    deleteCookie("spotifyRefreshToken");
                    accessToken = null;
                    refreshToken = null;
                }
            }

            // If still no token after retries → single redirect
            if (!accessToken) {
                console.warn("Redirecting to Spotify login...");
                await redirectToAuthCodeFlow(clientId);
                return; // stop execution; page reloads
            }
        }

        // ---- Valid access token here ----
        const profile = await fetchProfile(accessToken);
        populateProfileImage(profile);

        const fullQueue = await fetchQueue(accessToken);
        if (fullQueue) populateQueue(fullQueue);

        startQueuePolling(accessToken);

    } catch (err) {
        console.error("Initialization failed, redirecting:", err);
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


