/**
 * Re-encodes PNG and GIF media as lossless WebP. A result is only returned when it
 * is smaller and decodes to exactly the same pixels (and frame timing) as the
 * original; anything this can't prove is lossless is left untouched.
 */

import {
    Skip,
    bytesEqual,
    checkAnimationMatches,
    checkPngIsPlainSrgb,
    fixLastFrameDuration,
    parseGif,
    type GifInfo,
} from "./mediaFormats.ts";

export type OptimizeRequest = { id: number; buffer: ArrayBuffer; mimeType: string };
export type OptimizeResponse = {
    id: number;
    result: { buffer: ArrayBuffer; mimeType: string } | null;
    reason?: string;
};

// The project compiles against the DOM lib, which conflicts with the WebWorker lib.
const scope = self as unknown as {
    onmessage: ((event: MessageEvent<OptimizeRequest>) => void) | null;
    postMessage(message: OptimizeResponse, transfer?: Transferable[]): void;
};

/** libwebp's maximum width/height. */
const WEBP_MAX_DIMENSION = 16383;
/** Raw RGBA kept in memory while converting a GIF (all frames plus the round-trip check). */
const MAX_GIF_FRAME_BYTES = 256 * 1024 * 1024;
/** Above this many pixels the slowest lossless effort takes too long to be worth it. */
const MAX_EFFORT_PIXELS = 4_200_000;

scope.onmessage = async (event) => {
    const { id, buffer, mimeType } = event.data;
    let response: OptimizeResponse;
    try {
        const bytes = new Uint8Array(buffer);
        const out = mimeType === "image/png" ? await optimizePng(bytes) : await optimizeGif(bytes);
        if (out.byteLength >= bytes.byteLength) throw new Skip("not smaller");
        const result = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
        response = { id, result: { buffer: result, mimeType: "image/webp" } };
        scope.postMessage(response, [result]);
        return;
    } catch (err) {
        response = { id, result: null, reason: err instanceof Error ? err.message : String(err) };
    }
    scope.postMessage(response);
};

function stillEffort(pixels: number) {
    return pixels <= MAX_EFFORT_PIXELS ? { quality: 100, method: 6 } : { quality: 75, method: 4 };
}

async function encodeStillLossless(image: ImageData): Promise<Uint8Array> {
    const { encode, decode } = await import("@jsquash/webp");
    // exact keeps the colour of fully transparent pixels, so the round trip is byte-identical.
    const out = await encode(image, { lossless: 1, exact: 1, ...stillEffort(image.width * image.height) });
    const check = await decode(out);
    if (check.width !== image.width || check.height !== image.height || !bytesEqual(check.data, image.data)) {
        throw new Skip("round trip mismatch");
    }
    return new Uint8Array(out);
}

// ---------- PNG ----------

async function optimizePng(bytes: Uint8Array): Promise<Uint8Array> {
    checkPngIsPlainSrgb(bytes);
    const { decode } = await import("@jsquash/png");
    // Decoded straight from the file: no colour management or premultiplied alpha, unlike a canvas.
    const image = await decode(bytes.slice().buffer);
    if (image.width > WEBP_MAX_DIMENSION || image.height > WEBP_MAX_DIMENSION) throw new Skip("too large");
    return encodeStillLossless(image);
}

type ImageDecoderLike = {
    tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null };
    completed: Promise<void>;
    decode(options: { frameIndex: number }): Promise<{ image: VideoFrame }>;
    close(): void;
};
type ImageDecoderCtor = {
    new (init: { data: BufferSource; type: string }): ImageDecoderLike;
    isTypeSupported(type: string): Promise<boolean>;
};

async function optimizeGif(bytes: Uint8Array): Promise<Uint8Array> {
    const info = parseGif(bytes);
    const { width, height, delays } = info;
    const frameCount = delays.length;
    if (frameCount === 0 || width === 0 || height === 0) throw new Skip("empty gif");
    if (width > WEBP_MAX_DIMENSION || height > WEBP_MAX_DIMENSION) throw new Skip("too large");
    if (frameCount > 1) {
        // Animated WebP from this encoder always loops forever.
        if (info.loopCount !== 0) throw new Skip("gif does not loop forever");
        // Browsers slow GIF delays of 10 ms or less to 100 ms, but may not do the same for WebP.
        if (delays.some((d) => d <= 1)) throw new Skip("gif has very short frame delays");
    }
    if (width * height * 4 * frameCount * 2 > MAX_GIF_FRAME_BYTES) throw new Skip("gif too large to verify");

    const frames = await decodeGifFrames(bytes, info);
    if (frameCount === 1) {
        return encodeStillLossless(new ImageData(new Uint8ClampedArray(frames[0]), width, height));
    }

    const { encodeAnimation, decodeAnimation } = await import("wasm-webp");
    const durations = delays.map((d) => d * 10);
    const quality = width * height * frameCount <= MAX_EFFORT_PIXELS * 5 ? 100 : 75;
    const raw = await encodeAnimation(
        width,
        height,
        true,
        frames.map((data, i) => ({ data, duration: durations[i], config: { lossless: 1, quality } }))
    );
    if (!raw) throw new Skip("encode failed");
    // Copied because it's patched below and may be a view into WebAssembly memory.
    const encoded = new Uint8Array(raw);
    fixLastFrameDuration(encoded, durations.reduce((a, b) => a + b, 0));

    const decoded = await decodeAnimation(encoded, true);
    if (!decoded) throw new Skip("decode failed");
    checkAnimationMatches(frames, durations, decoded, width, height);
    return encoded;
}

/** Full composited frames as RGBA, using the browser's own GIF decoder. */
async function decodeGifFrames(bytes: Uint8Array, info: GifInfo): Promise<Uint8Array[]> {
    const Decoder = (globalThis as unknown as { ImageDecoder?: ImageDecoderCtor }).ImageDecoder;
    if (!Decoder || !(await Decoder.isTypeSupported("image/gif"))) throw new Skip("no ImageDecoder");
    if (typeof OffscreenCanvas === "undefined") throw new Skip("no OffscreenCanvas");

    const decoder = new Decoder({ data: bytes, type: "image/gif" });
    try {
        await decoder.tracks.ready;
        await decoder.completed;
        if (decoder.tracks.selectedTrack?.frameCount !== info.delays.length) {
            throw new Skip("frame count mismatch");
        }
        const canvas = new OffscreenCanvas(info.width, info.height);
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Skip("no canvas");

        const frames: Uint8Array[] = [];
        for (let i = 0; i < info.delays.length; i++) {
            const { image } = await decoder.decode({ frameIndex: i });
            const sameSize = image.displayWidth === info.width && image.displayHeight === info.height;
            if (sameSize) {
                ctx.clearRect(0, 0, info.width, info.height);
                ctx.drawImage(image, 0, 0);
            }
            image.close();
            if (!sameSize) throw new Skip("frame size mismatch");

            const data = new Uint8Array(ctx.getImageData(0, 0, info.width, info.height).data.buffer);
            for (let p = 0; p < data.length; p += 4) {
                // GIF transparency is all-or-nothing; anything else means the canvas altered the pixels.
                if (data[p + 3] !== 0 && data[p + 3] !== 255) throw new Skip("unexpected partial alpha");
                if (data[p + 3] === 0) data[p] = data[p + 1] = data[p + 2] = 0;
            }
            frames.push(data);
        }
        return frames;
    } finally {
        decoder.close();
    }
}
