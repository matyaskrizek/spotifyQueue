import { isHexColor, type WidgetElement } from "../types/backgroundProject.ts";
import { ANIMATION_INFO, AUTO_COLOR, type WidgetAnimation, type WidgetAnimationKind } from "../types/widgetAnimation.ts";
import { getPlaybackState, subscribePlaybackState } from "../windowLoaders/playbackState.ts";

const AUTO_COLOR_VAR = "--bg-anim-auto-color";
const PREVIEW_MS = 5000;
const LIGHT_COUNT = 3;

/** Loop effects animated on the widget node itself (each uses its own CSS property). */
const NODE_LOOP_KINDS: WidgetAnimationKind[] = ["pulse", "glow", "float"];
const FRONT_LAYER_KINDS: WidgetAnimationKind[] = ["shimmer", "glitter", "flash"];

type Mounted = {
    el: WidgetElement;
    back: HTMLElement | null;
    front: HTMLElement | null;
    clip: HTMLElement | null;
};
const mounted = new WeakMap<HTMLElement, Mounted>();
const previewTimers = new WeakMap<HTMLElement, number>();

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function has(el: WidgetElement, kinds: WidgetAnimationKind[]): boolean {
    return el.animations.some((a) => kinds.includes(a.kind));
}

function find(el: WidgetElement, kind: WidgetAnimationKind): WidgetAnimation | undefined {
    return el.animations.find((a) => a.kind === kind);
}

function durationOf(anim: WidgetAnimation): number {
    return ANIMATION_INFO[anim.kind].duration / anim.speed;
}

function colorOf(anim: WidgetAnimation, el: WidgetElement): string {
    const fallback = isHexColor(el.color) ? el.color : "#ffffff";
    if (anim.color === AUTO_COLOR) return `var(${AUTO_COLOR_VAR}, ${fallback})`;
    return isHexColor(anim.color) ? anim.color : fallback;
}

/** Per-effect variables, read by the keyframes in widgetAnimations.css. */
function setAnimationVars(target: HTMLElement, el: WidgetElement) {
    for (const anim of el.animations) {
        target.style.setProperty(`--bg-anim-${anim.kind}-dur`, `${Math.round(durationOf(anim))}ms`);
        target.style.setProperty(`--bg-anim-${anim.kind}-i`, String(anim.intensity));
        target.style.setProperty(`--bg-anim-${anim.kind}-color`, colorOf(anim, el));
    }
}

function createLayer(node: HTMLElement, el: WidgetElement, position: "back" | "front"): HTMLElement {
    const layer = document.createElement("div");
    layer.className = `bg-anim-layer bg-anim-${position}`;
    layer.dataset.widget = el.widget;
    layer.setAttribute("aria-hidden", "true");
    setAnimationVars(layer, el);
    syncLayer(node, layer);
    return layer;
}

/** Layers live beside the widget (so effects aren't clipped) and follow its box. */
function syncLayer(node: HTMLElement, layer: HTMLElement) {
    const from = node.style;
    const to = layer.style;
    to.left = from.left;
    to.top = from.top;
    to.width = from.width;
    to.height = from.height;
    to.transform = from.transform;
    to.transformOrigin = from.transformOrigin;
    to.zIndex = from.zIndex;
    to.opacity = from.opacity;
    to.borderRadius = from.borderRadius;
    for (const cls of ["bg-autohide", "bg-anim-preview"]) {
        layer.classList.toggle(cls, node.classList.contains(cls));
    }
}

/** Adds the widget's animations. Call after `node` is attached to the scene. */
export function mountWidgetAnimations(node: HTMLElement, el: WidgetElement, editable: boolean): void {
    if (!el.animations.length) return;
    setAnimationVars(node, el);

    const loops = el.animations
        .filter((a) => NODE_LOOP_KINDS.includes(a.kind))
        .map((a) => `bg-anim-${a.kind} var(--bg-anim-${a.kind}-dur) ease-in-out infinite`);
    if (loops.length) {
        node.classList.add("bg-animated");
        node.style.setProperty("--bg-anim-node", loops.join(", "));
    }

    let back: HTMLElement | null = null;
    if (find(el, "backgroundLights")) {
        back = createLayer(node, el, "back");
        for (let i = 0; i < LIGHT_COUNT; i++) {
            const light = document.createElement("span");
            light.className = `bg-anim-light bg-anim-light-${i + 1}`;
            back.appendChild(light);
        }
        node.before(back);
    }

    let front: HTMLElement | null = null;
    let clip: HTMLElement | null = null;
    if (has(el, FRONT_LAYER_KINDS)) {
        front = createLayer(node, el, "front");
        clip = document.createElement("div");
        clip.className = "bg-anim-clip";
        if (find(el, "shimmer")) {
            const shimmer = document.createElement("span");
            shimmer.className = "bg-anim-shimmer";
            clip.appendChild(shimmer);
        }
        front.appendChild(clip);
        node.after(front);
    }

    mounted.set(node, { el, back, front, clip });
    if (back || front) {
        new MutationObserver(() => {
            if (back) syncLayer(node, back);
            if (front) syncLayer(node, front);
        }).observe(node, { attributes: true, attributeFilter: ["style", "class"] });
    }
    // The editor shows song-change effects through Preview instead of on every new song.
    if (!editable && el.animations.some((a) => ANIMATION_INFO[a.kind].trigger === "songChange")) {
        node.classList.add("bg-anim-song");
    }
}

function spawnGlitter(front: HTMLElement, anim: WidgetAnimation, el: WidgetElement) {
    const count = Math.round(12 + anim.intensity * 48);
    const duration = durationOf(anim);
    const color = colorOf(anim, el);
    const reach = Math.max(40, Math.min(el.width, el.height) * 0.35);
    for (let i = 0; i < count; i++) {
        const spark = document.createElement("span");
        spark.className = "bg-anim-spark";
        const size = 6 + Math.random() * 12;
        spark.style.width = `${size}px`;
        spark.style.height = `${size}px`;
        spark.style.left = `${Math.random() * 100}%`;
        spark.style.top = `${Math.random() * 100}%`;
        spark.style.background = i % 3 === 0 ? "#ffffff" : color;
        front.appendChild(spark);

        const angle = Math.random() * Math.PI * 2;
        const distance = reach * (0.3 + Math.random() * 0.7);
        const dx = Math.cos(angle) * distance;
        const dy = Math.sin(angle) * distance;
        const spin = (Math.random() - 0.5) * 360;
        spark
            .animate(
                [
                    { opacity: 0, transform: "translate(-50%, -50%) scale(0) rotate(0deg)" },
                    { opacity: 1, transform: `translate(-50%, -50%) scale(1.2) rotate(${spin / 3}deg)`, offset: 0.2 },
                    {
                        opacity: 0,
                        transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.2) rotate(${spin}deg)`,
                    },
                ],
                { duration: duration * (0.6 + Math.random() * 0.4), delay: Math.random() * duration * 0.35, easing: "ease-out", fill: "backwards" }
            )
            .finished.then(() => spark.remove(), () => spark.remove());
    }
}

function flash(clip: HTMLElement, anim: WidgetAnimation, el: WidgetElement) {
    const overlay = document.createElement("span");
    overlay.className = "bg-anim-flash";
    overlay.style.background = colorOf(anim, el);
    clip.appendChild(overlay);
    overlay
        .animate([{ opacity: 0 }, { opacity: 0.25 + anim.intensity * 0.6, offset: 0.15 }, { opacity: 0 }], {
            duration: durationOf(anim),
            easing: "ease-out",
        })
        .finished.then(() => overlay.remove(), () => overlay.remove());
}

/** Plays the widget's song-change effects once. */
export function playSongChange(node: HTMLElement): void {
    const entry = mounted.get(node);
    if (!entry) return;
    const { el, front, clip } = entry;
    const songAnims = el.animations.filter((a) => ANIMATION_INFO[a.kind].trigger === "songChange");
    if (!songAnims.length) return;

    if (reducedMotion.matches) {
        node.animate([{ opacity: 0.4 }, { opacity: el.opacity }], { duration: 400, easing: "ease-out" });
        return;
    }
    for (const anim of songAnims) {
        const duration = durationOf(anim);
        switch (anim.kind) {
            case "glitter":
                if (front) spawnGlitter(front, anim, el);
                break;
            case "flash":
                if (clip) flash(clip, anim, el);
                break;
            case "pop":
                node.animate([{ scale: "1" }, { scale: String(1 + 0.04 + anim.intensity * 0.14) }, { scale: "1" }], {
                    duration,
                    easing: "cubic-bezier(0.3, 1.6, 0.5, 1)",
                });
                break;
            case "fadeSlide":
                node.animate(
                    [
                        { opacity: 0, translate: `0 ${Math.round(16 + anim.intensity * 48)}px` },
                        { opacity: el.opacity, translate: "0 0" },
                    ],
                    { duration, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }
                );
                break;
        }
    }
}

/** Editor preview: runs the loop effects for a few seconds and plays the song-change ones. */
export function previewWidgetAnimations(node: HTMLElement): void {
    const entry = mounted.get(node);
    if (!entry) return;
    window.clearTimeout(previewTimers.get(node));
    node.classList.add("bg-anim-preview");
    playSongChange(node);
    previewTimers.set(
        node,
        window.setTimeout(() => {
            node.classList.remove("bg-anim-preview");
            // Paused loops would otherwise freeze mid-pulse.
            for (const target of [node, entry.back, entry.front]) {
                target?.getAnimations({ subtree: true }).forEach((a) => {
                    if (a instanceof CSSAnimation) a.currentTime = 0;
                });
            }
        }, PREVIEW_MS)
    );
}

let lastSong: string | null = null;
let lastArt = "";

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
}

/** A vivid color from the album art, weighted toward saturated pixels. */
async function updateAutoColor(url: string) {
    const root = document.documentElement;
    if (!url) {
        root.style.removeProperty(AUTO_COLOR_VAR);
        return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    try {
        await img.decode();
        if (url !== lastArt) return;
        const size = 16;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        let r = 0;
        let g = 0;
        let b = 0;
        let total = 0;
        for (let i = 0; i < data.length; i += 4) {
            const [, s, l] = rgbToHsl(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
            const weight = s * (1 - Math.abs(l - 0.5) * 2) + 0.02;
            r += data[i] * weight;
            g += data[i + 1] * weight;
            b += data[i + 2] * weight;
            total += weight;
        }
        const [h, s, l] = rgbToHsl(r / total / 255, g / total / 255, b / total / 255);
        root.style.setProperty(
            AUTO_COLOR_VAR,
            `hsl(${Math.round(h)} ${Math.round(Math.max(s, 0.6) * 100)}% ${Math.round(Math.min(Math.max(l, 0.55), 0.75) * 100)}%)`
        );
    } catch {
        // Unreadable (CORS-tainted) art: effects fall back to the widget's text color.
        if (url === lastArt) root.style.removeProperty(AUTO_COLOR_VAR);
    }
}

subscribePlaybackState(() => {
    const { songTitle, albumArtUrl } = getPlaybackState();
    if (albumArtUrl !== lastArt) {
        lastArt = albumArtUrl;
        void updateAutoColor(albumArtUrl);
    }
    if (!songTitle) return;
    // The first song after loading sets the baseline rather than counting as a change.
    if (lastSong === null || songTitle === lastSong) {
        lastSong = songTitle;
        return;
    }
    lastSong = songTitle;
    if (document.hidden) return;
    document.querySelectorAll<HTMLElement>(".bg-anim-song").forEach(playSongChange);
});
