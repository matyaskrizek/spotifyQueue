import { describe, expect, it } from "vitest";
import {
    Skip,
    checkAnimationMatches,
    checkPngIsPlainSrgb,
    fixLastFrameDuration,
    parseGif,
    visiblyEqual,
} from "./mediaFormats.ts";

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
const u16le = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u24le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];
const u32le = (n: number) => [...u16le(n & 0xffff), ...u16le(n >>> 16)];
const u32be = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];

// ---------- PNG ----------

/** CRCs aren't checked by the parser, so they're left as zeros. */
function pngChunk(type: string, data: number[] = []) {
    return [...u32be(data.length), ...ascii(type), ...data, 0, 0, 0, 0];
}

function png({ bitDepth = 8, extra = [] as number[][] } = {}) {
    const ihdr = [...u32be(4), ...u32be(4), bitDepth, 6, 0, 0, 0];
    return new Uint8Array([
        0x89, ...ascii("PNG"), 0x0d, 0x0a, 0x1a, 0x0a,
        ...pngChunk("IHDR", ihdr),
        ...extra.flat(),
        ...pngChunk("IDAT", [1, 2, 3]),
        ...pngChunk("IEND"),
    ]);
}

function skipReason(run: () => unknown): string | null {
    try {
        run();
        return null;
    } catch (err) {
        if (!(err instanceof Skip)) throw err;
        return err.message;
    }
}

describe("checkPngIsPlainSrgb", () => {
    it("accepts a plain 8-bit PNG", () => {
        expect(skipReason(() => checkPngIsPlainSrgb(png()))).toBeNull();
    });

    it("accepts sRGB gamma, and any gamma next to an sRGB chunk", () => {
        expect(skipReason(() => checkPngIsPlainSrgb(png({ extra: [pngChunk("gAMA", u32be(45455))] })))).toBeNull();
        const both = png({ extra: [pngChunk("sRGB", [0]), pngChunk("gAMA", u32be(100000))] });
        expect(skipReason(() => checkPngIsPlainSrgb(both))).toBeNull();
    });

    it.each([
        ["16-bit png", png({ bitDepth: 16 })],
        ["apng", png({ extra: [pngChunk("acTL", [0, 0, 0, 2, 0, 0, 0, 0])] })],
        ["png iCCP", png({ extra: [pngChunk("iCCP", [1, 2])] })],
        ["png cHRM", png({ extra: [pngChunk("cHRM", [1, 2])] })],
        ["png eXIf", png({ extra: [pngChunk("eXIf", [1, 2])] })],
        ["png gamma", png({ extra: [pngChunk("gAMA", u32be(100000))] })],
    ])("rejects %s", (reason, bytes) => {
        expect(skipReason(() => checkPngIsPlainSrgb(bytes))).toBe(reason);
    });

    it("rejects a file cut off inside a chunk", () => {
        // Signature (8) + IHDR header (8) + 4 of its 13 data bytes.
        expect(skipReason(() => checkPngIsPlainSrgb(png().slice(0, 20)))).toBe("truncated png");
    });
});

// ---------- GIF ----------

function gif({ loopCount = 0 as number | null, delays = [10, 20] } = {}) {
    const bytes = [...ascii("GIF89a"), ...u16le(3), ...u16le(2), 0x80, 0, 0];
    bytes.push(0, 0, 0, 255, 255, 255); // two-colour global palette
    if (loopCount !== null) {
        bytes.push(0x21, 0xff, 11, ...ascii("NETSCAPE2.0"), 3, 1, ...u16le(loopCount), 0);
    }
    for (const delay of delays) {
        bytes.push(0x21, 0xf9, 4, 0, ...u16le(delay), 0, 0);
        bytes.push(0x2c, 0, 0, 0, 0, ...u16le(3), ...u16le(2), 0);
        bytes.push(2, 2, 0x4c, 0x01, 0);
    }
    bytes.push(0x3b);
    return new Uint8Array(bytes);
}

describe("parseGif", () => {
    it("reads size, frame delays and the loop count", () => {
        expect(parseGif(gif({ loopCount: 0, delays: [10, 20, 5] }))).toEqual({
            width: 3,
            height: 2,
            delays: [10, 20, 5],
            loopCount: 0,
        });
    });

    it("reports a finite loop count, or null without a loop extension", () => {
        expect(parseGif(gif({ loopCount: 3 })).loopCount).toBe(3);
        expect(parseGif(gif({ loopCount: null })).loopCount).toBeNull();
    });

    it("rejects files that aren't GIFs, or are cut short", () => {
        expect(skipReason(() => parseGif(new Uint8Array(ascii("PNG not a gif"))))).toBe("not a gif");
        const truncated = gif();
        expect(skipReason(() => parseGif(truncated.slice(0, truncated.length - 4)))).toBe("truncated gif");
    });
});

// ---------- Animated WebP ----------

function anmfChunk(duration: number) {
    const payload = [...u24le(0), ...u24le(0), ...u24le(1), ...u24le(1), ...u24le(duration), 0, 0xaa, 0xbb];
    return [...ascii("ANMF"), ...u32le(payload.length), ...payload];
}

function animatedWebp(durations: number[]) {
    const body = [
        ...ascii("WEBP"),
        ...ascii("VP8X"), ...u32le(10), 0x02, 0, 0, 0, ...u24le(1), ...u24le(1),
        ...ascii("ANIM"), ...u32le(6), 0, 0, 0, 0, 0, 0,
        ...durations.flatMap(anmfChunk),
    ];
    return new Uint8Array([...ascii("RIFF"), ...u32le(body.length), ...body]);
}

function readDurations(webp: Uint8Array): number[] {
    const durations: number[] = [];
    for (let pos = 12; pos + 8 <= webp.length; ) {
        const size = webp[pos + 4] | (webp[pos + 5] << 8) | (webp[pos + 6] << 16);
        if (String.fromCharCode(...webp.subarray(pos, pos + 4)) === "ANMF") {
            const at = pos + 20;
            durations.push(webp[at] | (webp[at + 1] << 8) | (webp[at + 2] << 16));
        }
        pos += 8 + size + (size & 1);
    }
    return durations;
}

describe("fixLastFrameDuration", () => {
    it("sets the last frame to the rest of the total and leaves the others alone", () => {
        // The encoder bug: the last frame repeats the previous frame's duration.
        const webp = animatedWebp([100, 250, 250]);
        fixLastFrameDuration(webp, 100 + 250 + 70000);
        expect(readDurations(webp)).toEqual([100, 250, 70000]);
    });

    it("rejects timing that doesn't add up", () => {
        expect(skipReason(() => fixLastFrameDuration(animatedWebp([100, 100]), 100))).toBe("bad frame timing");
    });

    it("rejects a WebP without animation frames", () => {
        expect(skipReason(() => fixLastFrameDuration(animatedWebp([]), 100))).toBe("no animation frames");
    });
});

// ---------- Frame comparison ----------

const pixel = (r: number, g: number, b: number, a: number) => new Uint8Array([r, g, b, a]);

describe("visiblyEqual", () => {
    it("ignores colour under fully transparent pixels", () => {
        expect(visiblyEqual(pixel(1, 2, 3, 0), pixel(9, 9, 9, 0))).toBe(true);
    });

    it("compares colour and alpha of visible pixels", () => {
        expect(visiblyEqual(pixel(1, 2, 3, 255), pixel(1, 2, 3, 255))).toBe(true);
        expect(visiblyEqual(pixel(1, 2, 3, 255), pixel(1, 2, 4, 255))).toBe(false);
        expect(visiblyEqual(pixel(1, 2, 3, 255), pixel(1, 2, 3, 0))).toBe(false);
    });
});

describe("checkAnimationMatches", () => {
    const red = pixel(255, 0, 0, 255);
    const blue = pixel(0, 0, 255, 255);
    const frame = (data: Uint8Array, duration: number) => ({ data, width: 1, height: 1, duration });

    it("accepts identical frames, including merged repeats", () => {
        expect(() =>
            checkAnimationMatches([red, red, blue], [100, 50, 200], [frame(red, 150), frame(blue, 200)], 1, 1)
        ).not.toThrow();
    });

    it("rejects changed pixels, timing or frame count", () => {
        const cases = [
            [frame(red, 100), frame(red, 200)],
            [frame(red, 100), frame(blue, 300)],
            [frame(red, 100)],
        ];
        for (const decoded of cases) {
            expect(skipReason(() => checkAnimationMatches([red, blue], [100, 200], decoded, 1, 1))).toBe(
                "animation round trip mismatch"
            );
        }
    });

    it("rejects a different frame size", () => {
        expect(skipReason(() => checkAnimationMatches([red], [100], [frame(red, 100)], 2, 1))).toBe(
            "decoded size mismatch"
        );
    });
});
