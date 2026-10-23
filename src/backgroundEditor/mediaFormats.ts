/** Byte-level PNG / GIF / WebP helpers for the media optimizer worker. */

/** Thrown when a file can't be proven to convert losslessly; the original is kept. */
export class Skip extends Error {}

/** Rejects PNGs whose appearance depends on data a plain sRGB WebP can't carry. */
export function checkPngIsPlainSrgb(bytes: Uint8Array) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let pos = 8;
    let hasSrgb = false;
    let gamma: number | null = null;
    while (pos + 8 <= bytes.length) {
        const length = view.getUint32(pos);
        const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
        const data = pos + 8;
        if (data + length > bytes.length) throw new Skip("truncated png");
        if (type === "IHDR" && bytes[data + 8] === 16) throw new Skip("16-bit png");
        // Animated PNG: only the first frame would survive.
        if (type === "acTL") throw new Skip("apng");
        // Colour profiles / chromaticities and EXIF orientation change how it's displayed.
        if (type === "iCCP" || type === "cHRM" || type === "eXIf") throw new Skip(`png ${type}`);
        if (type === "sRGB") hasSrgb = true;
        if (type === "gAMA") gamma = view.getUint32(data);
        if (type === "IEND") break;
        pos = data + length + 4;
    }
    // 45455 is the sRGB gamma (1/2.2); anything else is colour-managed differently.
    if (gamma !== null && !hasSrgb && gamma !== 45455) throw new Skip("png gamma");
}

export type GifInfo = { width: number; height: number; delays: number[]; loopCount: number | null };

/** Reads frame delays (centiseconds) and the loop count without decoding pixels. */
export function parseGif(bytes: Uint8Array): GifInfo {
    const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
    const u16 = (at: number) => bytes[at] | (bytes[at + 1] << 8);
    if (!ascii(0, 3).startsWith("GIF")) throw new Skip("not a gif");
    const width = u16(6);
    const height = u16(8);
    const packed = bytes[10];
    let pos = 13 + (packed & 0x80 ? 3 * (1 << ((packed & 7) + 1)) : 0);

    const skipSubBlocks = (at: number) => {
        while (at < bytes.length && bytes[at] !== 0) at += bytes[at] + 1;
        if (at >= bytes.length) throw new Skip("truncated gif");
        return at + 1;
    };

    const delays: number[] = [];
    let loopCount: number | null = null;
    let pendingDelay = 0;
    while (pos < bytes.length) {
        const block = bytes[pos];
        if (block === 0x3b) break;
        if (block === 0x21) {
            const label = bytes[pos + 1];
            if (label === 0xf9) pendingDelay = u16(pos + 4);
            if (label === 0xff && bytes[pos + 2] === 11) {
                const app = ascii(pos + 3, pos + 14);
                const sub = pos + 14;
                if ((app === "NETSCAPE2.0" || app === "ANIMEXTS1.0") && bytes[sub] >= 3 && bytes[sub + 1] === 1) {
                    loopCount = u16(sub + 2);
                }
            }
            pos = skipSubBlocks(pos + 2);
        } else if (block === 0x2c) {
            const imagePacked = bytes[pos + 9];
            pos += 10 + (imagePacked & 0x80 ? 3 * (1 << ((imagePacked & 7) + 1)) : 0);
            pos = skipSubBlocks(pos + 1);
            delays.push(pendingDelay);
            pendingDelay = 0;
        } else {
            throw new Skip("malformed gif");
        }
    }
    return { width, height, delays, loopCount };
}

/**
 * wasm-webp writes the second-to-last frame's duration on the last frame. ANMF frame
 * durations are a plain 24-bit field, so set the last one to what's left of the total.
 */
export function fixLastFrameDuration(webp: Uint8Array, totalDuration: number) {
    const view = new DataView(webp.buffer, webp.byteOffset, webp.byteLength);
    const anmf: number[] = [];
    for (let pos = 12; pos + 8 <= webp.length; ) {
        const size = view.getUint32(pos + 4, true);
        if (String.fromCharCode(...webp.subarray(pos, pos + 4)) === "ANMF") anmf.push(pos);
        pos += 8 + size + (size & 1);
    }
    if (anmf.length === 0) throw new Skip("no animation frames");
    const durationAt = (pos: number) => pos + 8 + 12;
    const readDuration = (pos: number) =>
        webp[durationAt(pos)] | (webp[durationAt(pos) + 1] << 8) | (webp[durationAt(pos) + 2] << 16);
    const before = anmf.slice(0, -1).reduce((sum, pos) => sum + readDuration(pos), 0);
    const last = totalDuration - before;
    if (last <= 0 || last > 0xffffff) throw new Skip("bad frame timing");
    const at = durationAt(anmf[anmf.length - 1]);
    webp[at] = last & 0xff;
    webp[at + 1] = (last >> 8) & 0xff;
    webp[at + 2] = (last >> 16) & 0xff;
}

/** The encoder may merge identical consecutive frames, adding their durations together. */
export function checkAnimationMatches(
    source: Uint8Array[],
    durations: number[],
    decoded: { data: Uint8Array; width: number; height: number; duration: number }[],
    width: number,
    height: number
) {
    let i = 0;
    for (const frame of decoded) {
        if (frame.width !== width || frame.height !== height) throw new Skip("decoded size mismatch");
        let covered = 0;
        while (i < source.length && covered < frame.duration && visiblyEqual(source[i], frame.data)) {
            covered += durations[i];
            i++;
        }
        if (covered !== frame.duration) throw new Skip("animation round trip mismatch");
    }
    if (i !== source.length) throw new Skip("animation round trip mismatch");
}

/** Compares RGBA pixels, treating any two fully transparent pixels as equal. */
export function visiblyEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let p = 0; p < a.length; p += 4) {
        if (a[p + 3] !== b[p + 3]) return false;
        if (a[p + 3] === 0) continue;
        if (a[p] !== b[p] || a[p + 1] !== b[p + 1] || a[p + 2] !== b[p + 2]) return false;
    }
    return true;
}

export function bytesEqual(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}
