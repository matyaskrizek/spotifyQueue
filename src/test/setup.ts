import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach } from "vitest";

// happy-dom's Blob isn't structured-cloneable, so values read back from fake-indexeddb
// would lose their blobs. Browsers clone Blobs by reference-like semantics anyway
// (they're immutable), so keep the same instance.
if (typeof window !== "undefined") {
    const nativeClone = globalThis.structuredClone;
    const cloneKeepingBlobs = (value: unknown): unknown => {
        if (value instanceof Blob) return value;
        if (Array.isArray(value)) return value.map(cloneKeepingBlobs);
        if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
            return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cloneKeepingBlobs(v)]));
        }
        return nativeClone(value);
    };
    globalThis.structuredClone = ((value: unknown) => cloneKeepingBlobs(value)) as typeof structuredClone;
}

beforeEach(() => {
    // A fresh database per test; modules holding a connection must reset it themselves.
    globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
    if (typeof window === "undefined") return;
    window.localStorage.clear();
    for (const cookie of document.cookie.split(";")) {
        const name = cookie.split("=")[0]?.trim();
        if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    }
});
