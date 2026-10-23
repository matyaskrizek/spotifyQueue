import { vi } from "vitest";

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        ...init,
        headers: { "Content-Type": "application/json", ...init.headers },
    });
}

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;

/**
 * Stubs `fetch` with a router keyed by URL prefix. Each key maps to a handler, or to a
 * list of handlers used in order (the last one repeats). Unmatched URLs fail the test.
 */
export function stubFetch(routes: Record<string, Route | Route[]>) {
    const calls = new Map<string, number>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const key = Object.keys(routes)
            .filter((prefix) => url.startsWith(prefix))
            .sort((a, b) => b.length - a.length)[0];
        if (!key) throw new Error(`Unexpected fetch: ${url}`);
        const handlers = routes[key];
        const n = calls.get(key) ?? 0;
        calls.set(key, n + 1);
        const handler = Array.isArray(handlers) ? handlers[Math.min(n, handlers.length - 1)] : handlers;
        return handler(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

type LockCallback = (lock: { name: string; mode: LockMode } | null) => unknown;

/**
 * A minimal `navigator.locks` (shared/exclusive, `ifAvailable`) for environments
 * without Web Locks. Returns a function that removes it again.
 */
export function installFakeLocks(): () => void {
    let shared = 0;
    let exclusive = false;
    const idle = () => new Promise((resolve) => setTimeout(resolve, 0));
    const locks = {
        async request(name: string, options: LockOptions, callback: LockCallback) {
            const mode = options.mode ?? "exclusive";
            const busy = () => exclusive || (mode === "exclusive" && shared > 0);
            if (options.ifAvailable && busy()) return callback(null);
            while (busy()) await idle();
            if (mode === "shared") shared++;
            else exclusive = true;
            try {
                return await callback({ name, mode });
            } finally {
                if (mode === "shared") shared--;
                else exclusive = false;
            }
        },
    };
    Object.defineProperty(navigator, "locks", { value: locks, configurable: true });
    return () => {
        delete (navigator as unknown as { locks?: unknown }).locks;
    };
}

/** The Authorization header sent with the `index`-th fetch call. */
export function authHeaderOf(fetchMock: ReturnType<typeof stubFetch>, index: number): string | undefined {
    const init = fetchMock.mock.calls[index]?.[1];
    return (init?.headers as Record<string, string> | undefined)?.Authorization;
}
