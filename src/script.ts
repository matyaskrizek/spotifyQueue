import {redirectToAuthCodeFlow, getUserAccessToken, refreshAccessToken, getCookie, setCookie, deleteCookie, getRedirectUri} from "./Spotify/authCodeWithPkce.ts";
import {populateProfileImage, populateQueue, startQueuePolling} from "./windowLoaders/queueElementsLoader.ts"
import {fetchQueue, fetchProfile} from "./services/spotifyService.ts"
import {
    openPopout,
    toggleFullscreen,
    setupWindowControls,
    initFullscreenButton, setupPartnerDanceButton, setupBackground, initHideQueueButton,
    initRefreshButton, setupSetDanceButton
} from "./windowLoaders/pop-outWindowLoader.ts";
import { setupBackgroundEditor } from "./backgroundEditor/editorController.ts";


const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
const currentlyPlayingSection = document.querySelector(".currentlyPlaying") as HTMLElement;

function showAuthError(message: string) {
    currentlyPlayingSection.style.display = "flex";
    const title = document.getElementById("songTitle");
    if (title) {
        title.innerText = message;
        title.style.visibility = "visible";
    }
    console.error(message);
}

// ---------------- Main Initialization ----------------
async function init() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code") || null;
    const maxRetries = 3;
    let accessToken: string | null = null;
    let refreshToken: string | null = null;

    // OAuth callback: exchange once. Never bounce back to Spotify on failure
    // (that creates an authorize-page loop).
    if (code) {
        try {
            console.log("Exchanging code for new access token...", {
                redirectUri: getRedirectUri(),
                hasVerifier: !!localStorage.getItem("verifier"),
            });
            accessToken = await getUserAccessToken(clientId, code);
        } catch (err) {
            console.error("Code exchange failed:", err);
            showAuthError(
                "Spotify login failed. Open the app at the same host/port you use to log in " +
                `(expected redirect: ${getRedirectUri()}), then try Connect again from the landing page.`
            );
            return;
        }
    }

    // Retrieve tokens from cookies
    const tokenExpiry = Number(getCookie("spotifyTokenExpiryForMyApp") || "0");
    if (!accessToken) accessToken = getCookie("spotifyAccessTokenForMyApp") || null;
    if (!refreshToken) refreshToken = getCookie("spotifyRefreshTokenForMyApp") || null;
    let retries: number = Number(getCookie("spotifyRetries") || "0");

    // I hate you typescript. Only you would infer that the return type 'undefined'
    // would be a string and not actually undefined smh 🤦‍♂️
    if (accessToken == "undefined") {
        accessToken = null;
    }
    if (refreshToken == "undefined") {
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
                    setCookie("spotifyRetries", "0", 1);
                } catch (err) {
                    console.warn("Refresh token failed:", err);
                    deleteCookie("spotifyAccessTokenForMyApp");
                    deleteCookie("spotifyRefreshTokenForMyApp");
                    retries++;
                    setCookie("spotifyRetries", retries.toString(), 1);
                    accessToken = null;
                    refreshToken = null;
                }
            }

            // No token and not on an OAuth callback → start auth once
            if (!accessToken) {
                console.log("Redirecting to Spotify");
                currentlyPlayingSection.style.display = "none";
                await redirectToAuthCodeFlow(clientId);
                return;
            }
        }

        currentlyPlayingSection.style.display = "flex";
        setupSiteContentAndButtons();
        const profile = await fetchProfile(accessToken);
        populateProfileImage(profile);
        pollQueueLoop(accessToken);
    } catch (err) {
        // Do not re-enter the Spotify authorize flow on app errors — that loops the consent page.
        console.error("Initialization failed:", err);
        showAuthError("Failed to load Spotify session. Check the console, then try logging in again from the landing page.");
    }
}

function setupSiteContentAndButtons() {
    console.log("Setting up background");
    void setupBackground();
    console.log("Setting up window controls");
    setupWindowControls();
    if (!window.opener) {
        setupBackgroundEditor();
        document.getElementById("openPopoutBtn")?.addEventListener("click", openPopout);
    }
    document.getElementById("fullscreenBtn")?.addEventListener("click", toggleFullscreen);
    initFullscreenButton("fullscreenBtn");
    setupPartnerDanceButton();
    initHideQueueButton();
    initRefreshButton();
    setupSetDanceButton();
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


