export type WidgetAnimationKind =
    | "pulse"
    | "glow"
    | "backgroundLights"
    | "float"
    | "shimmer"
    | "glitter"
    | "pop"
    | "flash"
    | "fadeSlide";

/** "loop" effects run all the time; "songChange" effects play once per new song. */
export type WidgetAnimationTrigger = "loop" | "songChange";

export type WidgetAnimation = {
    kind: WidgetAnimationKind;
    /** Multiplies the default playback rate (0.25–3). */
    speed: number;
    /** How strong the effect is, or how many particles (0–1). */
    intensity: number;
    /** "#rrggbb", or "auto" to follow the album art. */
    color: string;
};

type AnimationInfo = {
    name: string;
    trigger: WidgetAnimationTrigger;
    /** Duration at speed 1, in milliseconds. */
    duration: number;
    defaults: Pick<WidgetAnimation, "speed" | "intensity" | "color">;
};

export const ANIMATION_INFO: Record<WidgetAnimationKind, AnimationInfo> = {
    pulse: { name: "Pulse", trigger: "loop", duration: 1800, defaults: { speed: 1, intensity: 0.5, color: "auto" } },
    glow: { name: "Glow", trigger: "loop", duration: 2600, defaults: { speed: 1, intensity: 0.6, color: "auto" } },
    backgroundLights: {
        name: "Background lights",
        trigger: "loop",
        duration: 9000,
        defaults: { speed: 1, intensity: 0.6, color: "auto" },
    },
    float: { name: "Float", trigger: "loop", duration: 4200, defaults: { speed: 1, intensity: 0.5, color: "auto" } },
    shimmer: { name: "Shimmer", trigger: "loop", duration: 3200, defaults: { speed: 1, intensity: 0.5, color: "#ffffff" } },
    glitter: {
        name: "Glitter",
        trigger: "songChange",
        duration: 1600,
        defaults: { speed: 1, intensity: 0.6, color: "#ffe680" },
    },
    pop: { name: "Pop", trigger: "songChange", duration: 650, defaults: { speed: 1, intensity: 0.5, color: "auto" } },
    flash: { name: "Flash", trigger: "songChange", duration: 700, defaults: { speed: 1, intensity: 0.5, color: "#ffffff" } },
    fadeSlide: {
        name: "Fade & slide in",
        trigger: "songChange",
        duration: 800,
        defaults: { speed: 1, intensity: 0.5, color: "auto" },
    },
};

export const MAX_WIDGET_ANIMATIONS = 4;
export const AUTO_COLOR = "auto";

export function isAnimationKind(value: unknown): value is WidgetAnimationKind {
    return typeof value === "string" && Object.prototype.hasOwnProperty.call(ANIMATION_INFO, value);
}

export function createAnimation(kind: WidgetAnimationKind): WidgetAnimation {
    return { kind, ...ANIMATION_INFO[kind].defaults };
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
    const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
    return Math.min(max, Math.max(min, n));
}

/** Imported files can hold anything: keep known kinds once each, with clamped values. */
export function sanitizeAnimations(value: unknown): WidgetAnimation[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<WidgetAnimationKind>();
    const result: WidgetAnimation[] = [];
    for (const item of value) {
        if (result.length >= MAX_WIDGET_ANIMATIONS) break;
        if (!item || typeof item !== "object") continue;
        const source = item as Record<string, unknown>;
        if (!isAnimationKind(source.kind) || seen.has(source.kind)) continue;
        seen.add(source.kind);
        const defaults = ANIMATION_INFO[source.kind].defaults;
        const color =
            source.color === AUTO_COLOR ||
            (typeof source.color === "string" && /^#[0-9a-f]{6}$/i.test(source.color))
                ? source.color
                : defaults.color;
        result.push({
            kind: source.kind,
            speed: clamp(source.speed, 0.25, 3, defaults.speed),
            intensity: clamp(source.intensity, 0, 1, defaults.intensity),
            color,
        });
    }
    return result;
}
