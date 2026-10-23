import type { OptimizeRequest, OptimizeResponse } from "./mediaOptimizer.worker.ts";

const OPTIMIZABLE_TYPES = new Set(["image/png", "image/gif"]);

/** WebAssembly memory never shrinks, so an idle worker is shut down to give it back. */
const IDLE_SHUTDOWN_MS = 30_000;

let worker: Worker | null = null;
let idleTimer: number | null = null;
let nextRequestId = 0;
const pending = new Map<number, (response: OptimizeResponse) => void>();

function failPending(reason: string) {
    for (const [id, resolve] of pending) resolve({ id, result: null, reason });
    pending.clear();
}

function scheduleIdleShutdown() {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
        idleTimer = null;
        if (pending.size > 0) return;
        worker?.terminate();
        worker = null;
    }, IDLE_SHUTDOWN_MS);
}

function getWorker(): Worker | null {
    if (idleTimer !== null) {
        clearTimeout(idleTimer);
        idleTimer = null;
    }
    if (worker) return worker;
    try {
        worker = new Worker(new URL("./mediaOptimizer.worker.ts", import.meta.url), { type: "module" });
    } catch (err) {
        console.warn("Media optimizer unavailable:", err);
        return null;
    }
    worker.onmessage = (event: MessageEvent<OptimizeResponse>) => {
        pending.get(event.data.id)?.(event.data);
        pending.delete(event.data.id);
        if (pending.size === 0) scheduleIdleShutdown();
    };
    // A crashed worker (e.g. out of memory) is replaced on the next request.
    worker.onerror = (event) => {
        event.preventDefault();
        worker?.terminate();
        worker = null;
        failPending(event.message || "worker crashed");
    };
    return worker;
}

/** Recognises formats by their file signature, for files the browser gave no type. */
export async function sniffMimeType(blob: Blob): Promise<string | null> {
    const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    const ascii = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to));
    if (head[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
    if (ascii(0, 4) === "GIF8") return "image/gif";
    if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
    if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
    return null;
}

export function isOptimizable(mimeType: string): boolean {
    return OPTIMIZABLE_TYPES.has(mimeType);
}

/**
 * Re-encodes PNGs and GIFs as lossless WebP off the main thread. Resolves to the
 * smaller file only when it was verified pixel-identical, otherwise to null so the
 * caller keeps the original.
 */
export async function optimizeMedia(blob: Blob, mimeType: string): Promise<Blob | null> {
    if (!isOptimizable(mimeType)) return null;
    // Read first: getWorker() cancels the idle shutdown, which only a reply reschedules.
    const buffer = await blob.arrayBuffer();
    const target = getWorker();
    if (!target) return null;

    const id = nextRequestId++;
    const response = await new Promise<OptimizeResponse>((resolve) => {
        pending.set(id, resolve);
        const request: OptimizeRequest = { id, buffer, mimeType };
        target.postMessage(request, [buffer]);
    });
    if (!response.result) {
        console.info(`Kept original ${mimeType} (${response.reason ?? "no result"}).`);
        return null;
    }
    return new Blob([response.result.buffer], { type: response.result.mimeType });
}
