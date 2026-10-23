// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { createDefaultWidget, type WidgetElement } from "../types/backgroundProject.ts";
import { updatePlaybackState } from "../windowLoaders/playbackState.ts";
import { buildWidget, refreshWidgets } from "./widgets.ts";

const HOSTILE = `<img src=x onerror="window.__pwned = true">`;

function mount(el: WidgetElement, editable = false): HTMLElement {
    const node = document.createElement("div");
    document.body.appendChild(node);
    buildWidget(node, el, editable);
    return node;
}

afterEach(() => {
    document.body.replaceChildren();
    updatePlaybackState({ songTitle: "", danceTitle: "", upNext: [], partnerDance: false, albumArtUrl: "" });
});

describe("widgets render untrusted text as text", () => {
    it("song and dance titles", () => {
        updatePlaybackState({ songTitle: HOSTILE, danceTitle: HOSTILE });
        const node = mount(createDefaultWidget("currentlyPlaying"));

        expect(node.querySelector("img[onerror]")).toBeNull();
        const titles = [...node.querySelectorAll(".bg-now-playing-title")].map((t) => t.textContent);
        expect(titles).toEqual([HOSTILE, HOSTILE]);
    });

    it("up next track names", () => {
        updatePlaybackState({ upNext: [{ id: "1", name: HOSTILE, imageUrl: "" }] });
        const node = mount(createDefaultWidget("upNext", { itemCount: 1 }));

        expect(node.querySelector("img[onerror]")).toBeNull();
        expect(node.querySelector(".bg-track-name")?.textContent).toBe(HOSTILE);
    });

    it("button labels and QR captions from imported projects", () => {
        const button = mount(createDefaultWidget("refreshButton", { label: HOSTILE }));
        const qr = mount(createDefaultWidget("qrCode", { label: HOSTILE }), true);

        expect(document.querySelector("img[onerror]")).toBeNull();
        expect(button.querySelector("button")?.textContent).toBe(HOSTILE);
        expect(qr.querySelector(".bg-qr-caption")?.textContent).toBe(HOSTILE);
    });
});

describe("widget styling", () => {
    it("ignores colors that aren't hex values", () => {
        const node = mount(
            createDefaultWidget("refreshButton", { background: "url(https://evil.example/x.png)", color: "expression(1)" })
        );
        expect(node.style.background).toBe("transparent");
        expect(node.style.color).not.toContain("expression");
    });
});

describe("widget content", () => {
    it("follows playback updates and the partner-dance override", () => {
        updatePlaybackState({ songTitle: "Song", danceTitle: "Cha Cha" });
        const node = mount(createDefaultWidget("currentlyPlaying"));
        const titles = () => [...node.querySelectorAll(".bg-now-playing-title")].map((t) => t.textContent);
        expect(titles()).toEqual(["Song", "Cha Cha"]);

        updatePlaybackState({ partnerDance: true });
        refreshWidgets();
        expect(titles()).toEqual(["Song", "Partner Dance"]);
    });

    it("shows only as many queue items as configured", () => {
        updatePlaybackState({
            upNext: Array.from({ length: 6 }, (_, i) => ({ id: String(i), name: `Track ${i}`, imageUrl: "" })),
        });
        const node = mount(createDefaultWidget("upNext", { itemCount: 2 }));
        expect(node.querySelectorAll(".bg-track")).toHaveLength(2);
    });

    it("shows placeholders in the editor but nothing live when there's no data", () => {
        const editing = mount(createDefaultWidget("upNext", { itemCount: 3 }), true);
        const live = mount(createDefaultWidget("upNext", { itemCount: 3 }));
        expect(editing.querySelectorAll(".bg-track")).toHaveLength(3);
        expect(live.querySelectorAll(".bg-track")).toHaveLength(0);
    });
});
