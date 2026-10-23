import { beforeEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "./index.ts";

const APP = "https://example.github.io";
const env: Env = {
    ALLOWED_ORIGINS: `${APP}, http://localhost:5173`,
    UPSTREAM: "https://upstream.test/",
};

let upstream: ReturnType<typeof vi.fn>;

beforeEach(() => {
    upstream = vi.fn(async () => new Response('{"ok":true}', { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", upstream);
});

function call(path: string, init: RequestInit & { origin?: string | null } = {}, workerEnv: Env = env) {
    const { origin = APP, ...rest } = init;
    const headers = new Headers(rest.headers);
    if (origin) headers.set("Origin", origin);
    return worker.fetch(new Request(`https://proxy.test${path}`, { ...rest, headers }), workerEnv);
}

describe("CORS", () => {
    it("answers preflight from allowed origins", async () => {
        const res = await call("/api/v1/log", { method: "OPTIONS", origin: "http://localhost:5173" });
        expect(res.status).toBe(204);
        expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
        expect(res.headers.get("Access-Control-Allow-Headers")).toContain("x-api-key");
        expect(upstream).not.toHaveBeenCalled();
    });

    it("rejects preflight and requests from other origins without calling upstream", async () => {
        const preflight = await call("/api/v1/log", { method: "OPTIONS", origin: "https://evil.test" });
        const request = await call("/api/v1/log", { origin: "https://evil.test", headers: { "x-api-key": "k" } });

        expect(preflight.status).toBe(403);
        expect(request.status).toBe(403);
        expect(request.headers.get("Access-Control-Allow-Origin")).toBeNull();
        expect(upstream).not.toHaveBeenCalled();
    });

    it("allows requests without an Origin header (non-browser callers)", async () => {
        const res = await call("/api/v1/songs", { origin: null, headers: { "x-api-key": "k" } });
        expect(res.status).toBe(200);
        expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });
});

describe("routing and auth", () => {
    it("only proxies the allowlisted paths", async () => {
        const res = await call("/api/v1/admin", { headers: { "x-api-key": "k" } });
        expect(res.status).toBe(404);
        expect(res.headers.get("Access-Control-Allow-Origin")).toBe(APP);
        expect(upstream).not.toHaveBeenCalled();
    });

    it("prefers the caller's key over the configured one", async () => {
        await call("/api/v1/log", { headers: { "x-api-key": "caller" } }, { ...env, WALLS_DANCE_API_KEY: "server" });
        expect(new Headers(upstream.mock.calls[0][1].headers).get("x-api-key")).toBe("caller");
    });

    it("falls back to the configured key", async () => {
        await call("/api/v1/log", {}, { ...env, WALLS_DANCE_API_KEY: "server" });
        expect(new Headers(upstream.mock.calls[0][1].headers).get("x-api-key")).toBe("server");
    });

    it("returns 401 when there's no key anywhere", async () => {
        const res = await call("/api/v1/log");
        expect(res.status).toBe(401);
        expect(upstream).not.toHaveBeenCalled();
    });
});

describe("passthrough", () => {
    it("forwards path, query, method, body and content type", async () => {
        await call("/api/v1/log?bar=westwood", {
            method: "POST",
            headers: { "x-api-key": "k", "Content-Type": "application/json", Cookie: "secret=1" },
            body: '{"song":"x"}',
        });

        const [url, init] = upstream.mock.calls[0];
        expect(url).toBe("https://upstream.test/api/v1/log?bar=westwood");
        expect(init.method).toBe("POST");
        expect(new TextDecoder().decode(init.body)).toBe('{"song":"x"}');
        const sent = new Headers(init.headers);
        expect(sent.get("Content-Type")).toBe("application/json");
        expect(sent.get("Cookie")).toBeNull();
    });

    it("returns the upstream status and body with CORS headers added", async () => {
        upstream.mockResolvedValueOnce(new Response("rate limited", { status: 429, headers: { "Retry-After": "7" } }));

        const res = await call("/api/v1/songs", { headers: { "x-api-key": "k" } });

        expect(res.status).toBe(429);
        expect(await res.text()).toBe("rate limited");
        expect(res.headers.get("Retry-After")).toBe("7");
        expect(res.headers.get("Access-Control-Allow-Origin")).toBe(APP);
    });

    it("defaults to walls.dance when no upstream is configured", async () => {
        await call("/api/v1/songs", { headers: { "x-api-key": "k" } }, { ...env, UPSTREAM: "" });
        expect(upstream.mock.calls[0][0]).toBe("https://walls.dance/api/v1/songs");
    });
});
