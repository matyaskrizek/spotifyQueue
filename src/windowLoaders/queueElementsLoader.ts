import {fetchQueue, fetchCurrentlyPlaying} from "../services/spotifyService.ts"
import {loadSongDanceMap} from "../parsers/danceMapLoader.ts";
import { partnerDanceActive } from "./pop-outWindowLoader.ts";

// we load qrcode.js in HTML using CDN
declare var QRCode: any; // silence compiler during `npm run build`


let lastTrackId: string | null = null;
// @ts-ignore
let queuePollingInterval: number;
const songMap = await loadSongDanceMap(`${import.meta.env.BASE_URL}LineDanceMasterList.txt`);


// Poll every X seconds (adjust as needed)
export function startQueuePolling(accessToken: string) {
    refreshQueue(accessToken);  // immediate fetch
    queuePollingInterval = window.setInterval(() => {
        refreshQueue(accessToken);
    }, 500);
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

        const qr_code_resolution = 180;

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

export function populateQueue(fullQueue: FullQueue) {
    // Loading current Song Name

    document.getElementById("songTitle")!.innerText = fullQueue.currently_playing.name;
    let danceName = songMap.get(fullQueue.currently_playing.name);
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
      displayTutorialQRCode(fullQueue.currently_playing.name);
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
            if ((window as any).resetDanceTitle) {
                (window as any).resetDanceTitle();
            }
            populateQueue(fullQueue);
            displayNextSongs(fullQueue.queue, 3);  // your function to show next 3 songs
        }
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

