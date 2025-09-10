
import "/src/style.css";
import { redirectToAuthCodeFlow, getAccessToken, refreshAccessToken } from "./authCodeWithPkce";
const clientId = "bdb65f4eee034a86828ae4c9ee70a8e6"; // Replace with your client id
const params = new URLSearchParams(window.location.search);

const code = params.get("code");

if (!code) {
    console.log("hitting the redirect code");
    redirectToAuthCodeFlow(clientId);
} else {
    const accessToken = await getAccessToken(clientId, code);
    console.log(accessToken);
    const profile = await fetchProfile(accessToken);
    populateProfileImage(profile);
    console.log("going to load queue");

    const queue = await fetchQueue(accessToken)
    if(queue != null) {
        populateQueue(queue);
        loadBackground((queue.currently_playing as unknown as TrackObject).album?.images[0]?.url ?? (queue.currently_playing as unknown as EpisodeObject).images[0]?.url ?? '');
        const nextSongs: QueueItem[] = queue.queue.slice(0, 3);
        displayNextThreeSongs(nextSongs);
    }
}


async function fetchProfile(token: string): Promise<UserProfile> {
    const result = await fetchWithAuth(
        "https://api.spotify.com/v1/me",
        token,
        clientId
    );
    if (!result.ok) {
        console.error("Profile fetch failed", result.status, await result.text());
        throw new Error("Failed to fetch profile");
    }
    return await result.json();
}

//async function fetchCurrentlyPlaying(token: string): Promise<UserPr> {}

/*async function fetchQueue(token: String): Promise<FullQueue>{
    const result = await fetch("https://api.spotify.com/v1/me/player/queue", {
        method: "GET", headers: {Authorization: `Bearer ${token}` }
    })
    console.log(result);
    const results = await result.json();
    console.log(results);
    return results;
}*/
async function fetchQueue(token: string): Promise<FullQueue | null> {
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
            console.error("Queue fetch failed", result.status, await result.text());
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


function populateProfileImage(profile: UserProfile) {

    const profileImg = document.getElementById("imgUrl") as HTMLImageElement | null;
    if (profileImg && profile.images[0]) {
        profileImg.src = profile.images[0].url;
    }

    // Optional: keep the URL displayed somewhere (if you still want it)
    profileImg!.alt = profile.display_name ?? 'Spotify Profile';
}


function populateQueue(fullQueue: FullQueue) {
    document.getElementById("songTitle")!.innerText = fullQueue.currently_playing.name;
}

function loadBackground(backgroundUrl: string | null) {
    const video = document.getElementById("bgVideo") as HTMLVideoElement;
    const image = document.getElementById("bgImage") as HTMLImageElement;

    if (!video || !image) return;

    // Reset both first
    video.style.display = "none";
    image.style.display = "none";
    video.src = "";
    image.src = "";

    // Try to load as video first
    const canPlayVideo = video.canPlayType("video/mp4");
    if (canPlayVideo && backgroundUrl != null) {
        video.src = backgroundUrl;
        video.style.display = "block";

        // If video fails, fallback to image
        video.addEventListener("error", () => {
            video.style.display = "none";
            image.src = backgroundUrl;
            image.style.display = "block";
        });
    } else {
        // If browser cannot play video, use image
        image.src = "src/background.png";
        image.style.display = "block";
    }
}

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


