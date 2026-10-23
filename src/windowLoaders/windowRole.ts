export const POPOUT_WINDOW_NAME = "SpotifyQueuePopout";

/**
 * `window.opener` can become null when the main window closes, so identify the
 * pop-out by the name it was opened with (kept across reloads).
 */
export function isPopoutWindow(): boolean {
    return window.name === POPOUT_WINDOW_NAME;
}
