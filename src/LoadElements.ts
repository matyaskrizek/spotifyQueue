import {fetchQueue, fetchCurrentlyPlaying} from "./spotifyService.ts"

let lastTrackId: string | null = null;
// @ts-ignore
let queuePollingInterval: number;



// Poll every 5 seconds (adjust as needed)
export function startQueuePolling(accessToken: string) {
    refreshQueue(accessToken);  // immediate fetch
    queuePollingInterval = window.setInterval(() => {
        refreshQueue(accessToken);
    }, 5000);
}

// Stop polling if needed
/*function stopQueuePolling() {
    clearInterval(queuePollingInterval);
}*/

export function populateProfileImage(profile: UserProfile) {

    const profileImg = document.getElementById("imgUrl") as HTMLImageElement | null;
    if (profileImg && profile.images[0]) {
        profileImg.src = profile.images[0].url;
    }

    // Optional: keep the URL displayed somewhere (if you still want it)
    profileImg!.alt = profile.display_name ?? 'Spotify Profile';
}


export function populateQueue(fullQueue: FullQueue) {
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
