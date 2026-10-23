// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    displayedDanceTitle,
    displayedTutorialUrl,
    getPlaybackState,
    subscribePlaybackState,
    updatePlaybackState,
} from "./playbackState.ts";

afterEach(() => {
    updatePlaybackState({ danceTitle: "", tutorialUrl: null, partnerDance: false, queueHidden: false });
});

describe("playbackState", () => {
    it("merges updates and notifies subscribers until they unsubscribe", () => {
        const listener = vi.fn();
        const unsubscribe = subscribePlaybackState(listener);

        updatePlaybackState({ songTitle: "Song" });
        expect(getPlaybackState().songTitle).toBe("Song");
        expect(listener).toHaveBeenCalledOnce();

        unsubscribe();
        updatePlaybackState({ songTitle: "Other" });
        expect(listener).toHaveBeenCalledOnce();
    });

    it("shows Partner Dance and hides the tutorial while partner dance is on", () => {
        updatePlaybackState({ danceTitle: "Cha Cha Slide", tutorialUrl: "https://example.com/t" });
        expect(displayedDanceTitle()).toBe("Cha Cha Slide");
        expect(displayedTutorialUrl()).toBe("https://example.com/t");

        updatePlaybackState({ partnerDance: true });
        expect(displayedDanceTitle()).toBe("Partner Dance");
        expect(displayedTutorialUrl()).toBeNull();

        updatePlaybackState({ partnerDance: false });
        expect(displayedDanceTitle()).toBe("Cha Cha Slide");
    });

    it("mirrors queueHidden onto the body class", () => {
        updatePlaybackState({ queueHidden: true });
        expect(document.body.classList.contains("queue-hidden")).toBe(true);
        updatePlaybackState({ queueHidden: false });
        expect(document.body.classList.contains("queue-hidden")).toBe(false);
    });
});
