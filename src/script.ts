
import {redirectToAuthCodeFlow, getUserAccessToken, refreshAccessToken, getCookie, setCookie, deleteCookie} from "./Spotify/authCodeWithPkce.ts";
import {populateProfileImage, populateQueue, startQueuePolling} from "./windowLoaders/queueElementsLoader.ts"
import {fetchQueue, fetchProfile} from "./services/spotifyService.ts"
import {
    openPopout,
    toggleFullscreen,
    setupWindowControls,
    initFullscreenButton, setupPartnerDanceButton, setupBackgroundUploadButton, setupBackground, initHideQueueButton,
    initRefreshButton
} from "./windowLoaders/pop-outWindowLoader.ts";


const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
const currentlyPlayingSection = document.querySelector(".currentlyPlaying") as HTMLElement;

// ---------------- Main Initialization ----------------
async function init() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code") || null;
    const maxRetries = 3;
    let accessToken: string | null = null;
    let refreshToken: string | null = null;
    if (code) {
        try {
            console.log("Exchanging code for new access token...");
            accessToken = await getUserAccessToken(clientId, code);
        } catch (err) {
            console.error("Code exchange failed, redirecting:", err);
            await redirectToAuthCodeFlow(clientId);
            return;
        }
    }

    // Retrieve tokens from cookies
    const tokenExpiry = Number(getCookie("spotifyTokenExpiryForMyApp") || "0");
    if(!accessToken) accessToken = getCookie("spotifyAccessTokenForMyApp") || null;
    if(!refreshToken) refreshToken = getCookie("spotifyRefreshTokenForMyApp") || null;
    let retries: number = Number(getCookie("spotifyRetries") || "0");

    // I hate you typescript. Only you would infer that the return type 'undefined'
    // would be a string and not actually undefined smh 🤦‍♂️
    if(accessToken == "undefined"){
        accessToken = null;
    }
    if(refreshToken == "undefined"){
        refreshToken = null;
    }

    try {
        // Only retry locally if token missing or expired, up to maxRetries
        if (!accessToken || Date.now() > tokenExpiry) {

            console.log("NO ACCESS TOKEN OR EXPIRED TOKEN");
            if (refreshToken && retries < maxRetries) {

                console.log("Trying to refresh token");
                try {
                    accessToken = await refreshAccessToken(clientId);
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
                console.log("Trying to get new token");
                try {
                    accessToken = await getUserAccessToken(clientId, code);
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
            if(!accessToken) {
                console.log("Redirecting to Spotify");
                currentlyPlayingSection.style.display = "none";
                await redirectToAuthCodeFlow(clientId);
                return;
            }
        }
        currentlyPlayingSection.style.display = "flex";
        // Setting up all the Button logic and controls
        setupSiteContentAndButtons();
        // Getting the user profile and image to display
        const profile = await fetchProfile(accessToken);
        populateProfileImage(profile);
        // Fetching the queue
        pollQueueLoop(accessToken);

    } catch (err) {
        console.error("Initialization failed, redirecting:", err);
        await redirectToAuthCodeFlow(clientId);
    }
}

function setupSiteContentAndButtons() {
    console.log("Setting up background")
    //Setting up the background
    setupBackground();
    console.log("Setting up window controls")
    // Call this once when the app starts
    setupWindowControls();
    if(!window.opener) {
        // Upload Background image logic
        setupBackgroundUploadButton();

        // Hook buttons
        document.getElementById("openPopoutBtn")?.addEventListener("click", openPopout);
    }
    document.getElementById("fullscreenBtn")?.addEventListener("click", toggleFullscreen);
    // Disappearing logic on the fullscreen button
    initFullscreenButton("fullscreenBtn");
    // Partner Dance Button Logic
    setupPartnerDanceButton();
    // Hide Queue logic
    initHideQueueButton();
    // Setup refresh Button
    initRefreshButton();
}

async function pollQueueLoop(accessToken:string){
    try {
        const fullQueue = await fetchQueue(accessToken);
        if (fullQueue) await populateQueue(fullQueue);
        // Starting the constant queue refresh
        startQueuePolling(accessToken);
    } catch (e) {
        const ErrorMessage = document.getElementById("songTitle")
        if(ErrorMessage){
            ErrorMessage.innerText = "No songs currently Playing";
            ErrorMessage.style.visibility = "visible";
        }
        sleep(500);
        pollQueueLoop(accessToken);
    }

}

const sleep = (ms: number) => {
    return new Promise(resolve => setTimeout(resolve, ms));
};


init();


