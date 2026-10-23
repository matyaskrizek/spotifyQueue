import {refreshAccessToken, redirectToAuthCodeFlow} from "../Spotify/authCodeWithPkce.ts";
import {startQueuePolling, stopQueuePolling} from "./queueElementsLoader.ts";

const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
const SESSION_LENGTH_MS = 5 * 60 * 60 * 1000;
// Wall-clock check instead of one long setTimeout: background tabs and sleeping
// laptops can delay or suspend long timers.
const CHECK_INTERVAL_MS = 60 * 1000;
const PAUSED_KEY = "sessionPausedAt";
const RESUMED_KEY = "sessionResumedAt";

let sessionStartedAt = Date.now();
let sessionPaused = false;

export function initSessionTimeout() {
    sessionStartedAt = Date.now();
    window.setInterval(checkSession, CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) checkSession();
    });
    document.getElementById("sessionRefreshBtn")?.addEventListener("click", resumeSession);

    // Keep the main window and pop-out paused/resumed together
    window.addEventListener("storage", (event) => {
        if (event.key === PAUSED_KEY && event.newValue) {
            pauseSession(false);
        }
        if (event.key === RESUMED_KEY && event.newValue) {
            const token = localStorage.getItem("access_token");
            if (token) resumeWithToken(token);
        }
    });
}

function checkSession() {
    if (!sessionPaused && Date.now() - sessionStartedAt >= SESSION_LENGTH_MS) {
        pauseSession(true);
    }
}

function pauseSession(broadcast: boolean) {
    if (sessionPaused) return;
    sessionPaused = true;
    stopQueuePolling();
    (document.getElementById("bgVideo") as HTMLVideoElement | null)?.pause();
    document.getElementById("sessionOverlay")?.removeAttribute("hidden");
    if (broadcast) localStorage.setItem(PAUSED_KEY, Date.now().toString());
}

async function resumeSession() {
    const refreshBtn = document.getElementById("sessionRefreshBtn") as HTMLButtonElement | null;
    if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.textContent = "Reconnecting…";
    }

    let token: string | undefined;
    try {
        token = await refreshAccessToken(clientId);
    } catch (err) {
        console.warn("Session refresh failed:", err);
    }

    if (!token) {
        // Refresh token expired or was revoked: fall back to a full Spotify login
        await redirectToAuthCodeFlow(clientId);
        return;
    }

    resumeWithToken(token);
    localStorage.setItem(RESUMED_KEY, Date.now().toString());
}

function resumeWithToken(token: string) {
    if (!sessionPaused) return;
    sessionPaused = false;
    sessionStartedAt = Date.now();

    const refreshBtn = document.getElementById("sessionRefreshBtn") as HTMLButtonElement | null;
    if (refreshBtn) {
        refreshBtn.disabled = false;
        refreshBtn.textContent = "Refresh";
    }
    document.getElementById("sessionOverlay")?.setAttribute("hidden", "");

    const bgVideo = document.getElementById("bgVideo") as HTMLVideoElement | null;
    if (bgVideo && bgVideo.style.display !== "none") {
        bgVideo.play().catch(() => {});
    }
    startQueuePolling(token);
}
