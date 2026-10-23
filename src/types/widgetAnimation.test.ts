import { describe, expect, it } from "vitest";
import { ANIMATION_INFO, MAX_WIDGET_ANIMATIONS, createAnimation, sanitizeAnimations } from "./widgetAnimation.ts";

describe("sanitizeAnimations", () => {
    it("returns an empty list for anything that isn't an array", () => {
        for (const value of [undefined, null, "pulse", 3, { kind: "pulse" }]) {
            expect(sanitizeAnimations(value)).toEqual([]);
        }
    });

    it("keeps valid animations as they are", () => {
        const input = [
            { kind: "glow", speed: 2, intensity: 0.2, color: "#00ff00" },
            { kind: "pop", speed: 0.5, intensity: 1, color: "auto" },
        ];
        expect(sanitizeAnimations(input)).toEqual(input);
    });

    it("drops unknown kinds, duplicates and non-objects", () => {
        const result = sanitizeAnimations([null, "glow", { kind: "explode" }, { kind: "glow" }, { kind: "glow" }]);
        expect(result.map((a) => a.kind)).toEqual(["glow"]);
    });

    it("clamps speed and intensity, and defaults non-numbers", () => {
        const [fast, slow, junk] = sanitizeAnimations([
            { kind: "pulse", speed: 10, intensity: -1 },
            { kind: "glow", speed: 0, intensity: 5 },
            { kind: "float", speed: "fast", intensity: Number.NaN },
        ]);
        expect(fast).toMatchObject({ speed: 3, intensity: 0 });
        expect(slow).toMatchObject({ speed: 0.25, intensity: 1 });
        expect(junk).toMatchObject({ speed: 1, intensity: ANIMATION_INFO.float.defaults.intensity });
    });

    it("falls back to the default color for anything but #rrggbb or auto", () => {
        const result = sanitizeAnimations([
            { kind: "shimmer", color: "red" },
            { kind: "glitter", color: "#fff" },
            { kind: "flash", color: "url(javascript:alert(1))" },
        ]);
        expect(result.map((a) => a.color)).toEqual([
            ANIMATION_INFO.shimmer.defaults.color,
            ANIMATION_INFO.glitter.defaults.color,
            ANIMATION_INFO.flash.defaults.color,
        ]);
    });

    it(`keeps at most ${MAX_WIDGET_ANIMATIONS}`, () => {
        const kinds = Object.keys(ANIMATION_INFO) as (keyof typeof ANIMATION_INFO)[];
        expect(sanitizeAnimations(kinds.map(createAnimation))).toHaveLength(MAX_WIDGET_ANIMATIONS);
    });
});
