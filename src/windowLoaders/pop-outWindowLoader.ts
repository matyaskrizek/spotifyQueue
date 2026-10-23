import {
    applyManualDanceFromStorage,
    resetTimeout,
    stopQueuePolling,
    submitManualDanceName,
} from "./queueElementsLoader.ts";
import { LOGGED_OUT_KEY, logoutOfSpotify, redirectToLandingPage } from "../Spotify/authCodeWithPkce.ts";
import { renderActiveBackground } from "../backgroundEditor/sceneRenderer.ts";
import { toggleSettingsMenu } from "../backgroundEditor/settingsMenu.ts";
import { ACTIVE_PROJECT_ID_KEY, ACTIVE_PROJECT_REV_KEY, type WidgetKind } from "../types/backgroundProject.ts";
import { isPopoutWindow, POPOUT_WINDOW_NAME } from "./windowRole.ts";
import {
    PARTNER_DANCE_KEY,
    QUEUE_HIDDEN_KEY,
    getPlaybackState,
    updatePlaybackState,
} from "./playbackState.ts";
import { positionPopover } from "./popover.ts";

export { isPopoutWindow };

let popout: Window | null;

export function openPopout() {
    popout = window.open(
        window.location.href,
        POPOUT_WINDOW_NAME,
        "width=1200,height=800,resizable,scrollbars"
    );

    if (!popout) {
        alert("Pop-out blocked by browser! Please allow pop-ups.");
    }
}

export function toggleFullscreen() {
    if (!document.fullscreenElement) {
        void document.documentElement.requestFullscreen();
    } else {
        void document.exitFullscreen();
    }
}

export function setupWindowControls() {
    document.body.classList.toggle("is-popout", isPopoutWindow());
    if (isPopoutWindow()) {
        document.getElementById("bgEditorOverlay")?.setAttribute("hidden", "");
    }
    // Partner dance and hidden queue persist so a reloaded or new pop-out matches the main window.
    updatePlaybackState({
        partnerDance: localStorage.getItem(PARTNER_DANCE_KEY) === "true",
        queueHidden: localStorage.getItem(QUEUE_HIDDEN_KEY) === "true",
    });
}

export async function setupBackground() {
    await renderActiveBackground();
}

function togglePartnerDance() {
    const partnerDance = !getPlaybackState().partnerDance;
    localStorage.setItem(PARTNER_DANCE_KEY, String(partnerDance));
    updatePlaybackState({ partnerDance });
}

function toggleQueueHidden() {
    const queueHidden = !getPlaybackState().queueHidden;
    localStorage.setItem(QUEUE_HIDDEN_KEY, String(queueHidden));
    updatePlaybackState({ queueHidden });
}

function refreshNow() {
    localStorage.setItem("refreshCurrPlaying", Date.now().toString());
    resetTimeout();
}

function toggleSetDanceForm(anchor: HTMLElement) {
    const form = document.getElementById("setDanceForm") as HTMLFormElement | null;
    const input = document.getElementById("danceNameInput") as HTMLInputElement | null;
    if (!form || !input) return;
    if (!form.hasAttribute("hidden")) {
        form.setAttribute("hidden", "");
        return;
    }
    form.removeAttribute("hidden");
    positionPopover(form, anchor);
    input.focus();
    input.select();
}

function runControlAction(action: WidgetKind, trigger: HTMLElement) {
    switch (action) {
        case "settingsButton":
            if (!isPopoutWindow()) toggleSettingsMenu(trigger);
            break;
        case "popoutButton":
            if (!isPopoutWindow()) openPopout();
            break;
        case "fullscreenButton":
            toggleFullscreen();
            break;
        case "partnerDanceButton":
            togglePartnerDance();
            break;
        case "hideQueueButton":
            toggleQueueHidden();
            break;
        case "refreshButton":
            refreshNow();
            break;
        case "setDanceButton":
            if (!isPopoutWindow()) toggleSetDanceForm(trigger);
            break;
        case "profile":
            // The queue often runs on a shared display, where a stray click shouldn't end the session.
            if (confirm("Log out of Spotify?")) {
                stopQueuePolling();
                logoutOfSpotify(isPopoutWindow() ? () => window.close() : redirectToLandingPage);
            }
            break;
    }
}

const AUTO_HIDE_DELAY_MS = 5000;

/** Wires every button widget (they are re-rendered whenever the project changes). */
export function setupControlActions() {
    document.addEventListener("click", (event) => {
        const trigger = (event.target as Element | null)?.closest<HTMLElement>("[data-action]");
        if (!trigger || !trigger.closest("#backgroundContainer")) return;
        runControlAction(trigger.dataset.action as WidgetKind, trigger);
    });

    // Auto-hide widgets stay hidden until the mouse moves.
    let hideTimeout: number | null = null;
    const wake = () => {
        document.body.classList.add("controls-awake");
        if (hideTimeout !== null) clearTimeout(hideTimeout);
        hideTimeout = window.setTimeout(() => {
            document.body.classList.remove("controls-awake");
            hideTimeout = null;
        }, AUTO_HIDE_DELAY_MS);
    };
    window.addEventListener("mousemove", wake);
    window.addEventListener("mouseenter", wake);
}

export function setupSetDanceForm() {
    const form = document.getElementById("setDanceForm") as HTMLFormElement | null;
    const input = document.getElementById("danceNameInput") as HTMLInputElement | null;
    if (!form || !input || isPopoutWindow()) return;

    form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (!submitManualDanceName(input.value)) {
            input.focus();
            return;
        }
        input.value = "";
        form.setAttribute("hidden", "");
    });
    input.addEventListener("keydown", (event) => {
        if (event.key === "Escape") form.setAttribute("hidden", "");
    });
    document.addEventListener("click", (event) => {
        if (form.hasAttribute("hidden")) return;
        const target = event.target as Element;
        if (form.contains(target) || target.closest?.('[data-action="setDanceButton"]')) return;
        form.setAttribute("hidden", "");
    });
}

// Event listener to make sure all updates to one window happen to others
window.addEventListener("storage", (event) => {
    if (event.key === QUEUE_HIDDEN_KEY) {
        updatePlaybackState({ queueHidden: event.newValue === "true" });
    }
    if (event.key === PARTNER_DANCE_KEY) {
        updatePlaybackState({ partnerDance: event.newValue === "true" });
    }
    if (event.key === ACTIVE_PROJECT_ID_KEY || event.key === ACTIVE_PROJECT_REV_KEY) {
        void renderActiveBackground();
    }
    if (event.key === "refreshCurrPlaying") {
        resetTimeout();
    }
    if (event.key === "manualDanceOverride") {
        applyManualDanceFromStorage();
    }
    if (event.key === LOGGED_OUT_KEY && event.newValue) {
        stopQueuePolling();
        if (isPopoutWindow()) window.close();
        else redirectToLandingPage();
    }
});
