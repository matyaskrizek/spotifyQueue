import "/src/style.css";
import {redirectToAuthCodeFlow, getAccessToken, refreshAccessToken, getCookie, setCookie, deleteCookie} from "./authCodeWithPkce";
import {populateProfileImage, populateQueue, startQueuePolling} from "./LoadElements.ts"
import {fetchQueue, fetchProfile} from "./spotifyService.ts"


// TODO make this an env variable
const clientId = "bdb65f4eee034a86828ae4c9ee70a8e6"; // Make env var


// ---------------- Main Initialization ----------------
async function init() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code") || null;
    const maxRetries = 3;
    let accessToken: string | null = null;
    let refreshToken: string | null = null;

    console.log("code: ", code);
    if (code) {
        try {
            console.log("Exchanging code for new access token...");
            accessToken = await getAccessToken(clientId, code);// ✅ stop here — don’t check stale cookies
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
    // would be a string and not actually undefined smh
    if(accessToken == "undefined"){
        accessToken = null;
    }
    if(refreshToken == "undefined"){
        refreshToken = null;
    }
    console.log("accessToken: ", accessToken);

    try {
        // Only retry locally if token missing or expired, up to maxRetries
        if (!accessToken || Date.now() > tokenExpiry) {
            if (refreshToken && retries < maxRetries) {
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

        console.log("AccessToken after auth attempts: ", accessToken);
        console.log("code after all auth attempts: ", code);

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

init()


