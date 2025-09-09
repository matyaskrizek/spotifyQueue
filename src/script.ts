
import "/src/style.css";
import { redirectToAuthCodeFlow, getAccessToken } from "./authCodeWithPkce";
const clientId = "bdb65f4eee034a86828ae4c9ee70a8e6"; // Replace with your client id
const params = new URLSearchParams(window.location.search);

const code = params.get("code");

if (!code) {
    redirectToAuthCodeFlow(clientId);
} else {
    const accessToken = await getAccessToken(clientId, code);
    console.log(accessToken);
    const queue = await fetchQueue(accessToken)
    const profile = await fetchProfile(accessToken);
    populateUI(profile);
    console.log("going to load queue");
    populateQueue(queue)
    let item;
    loadBackground((item as unknown as TrackObject).album?.images[0]?.url ?? (item as unknown as EpisodeObject).images[0]?.url ?? '');

}


async function fetchProfile(token: string): Promise<UserProfile> {
    const result = await fetch("https://api.spotify.com/v1/me", {
        method: "GET", headers: { Authorization: `Bearer ${token}` }
    });

    return await result.json();
}

async function fetchQueue(token: String): Promise<FullQueue>{
    const result = await fetch("https://api.spotify.com/v1/me/player/queue", {
        method: "GET", headers: {Authorization: `Bearer ${token}` }
    })
    const results = await result.json();
    console.log(results);
    return results;
}


function populateUI(profile: UserProfile) {
    document.getElementById("displayName")!.innerText = profile.display_name;
    if (profile.images[0]) {
        const profileImage = new Image(200, 200);
        profileImage.src = profile.images[0].url;
        document.getElementById("avatar")!.appendChild(profileImage);
    }
    document.getElementById("id")!.innerText = profile.id;
    document.getElementById("email")!.innerText = profile.email;
    document.getElementById("uri")!.innerText = profile.uri;
    document.getElementById("uri")!.setAttribute("href", profile.external_urls.spotify);
    document.getElementById("url")!.innerText = profile.href;
    document.getElementById("url")!.setAttribute("href", profile.href);
    document.getElementById("imgUrl")!.innerText = profile.images[0]?.url ?? '(no profile image)';
}

function populateQueue(fullQueue: FullQueue) {
    document.getElementById("songTitle")!.innerText = fullQueue.currently_playing.track.name;


}

function loadBackground(backgroundUrl: string) {
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
    if (canPlayVideo) {
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


