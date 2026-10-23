const ALLOWED_PATHS = new Set(["/api/v1/log", "/api/v1/songs"]);

export interface Env {
    ALLOWED_ORIGINS: string;
    UPSTREAM: string;
    WALLS_DANCE_API_KEY?: string;
}

function allowedOrigins(env: Env): string[] {
    return env.ALLOWED_ORIGINS.split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);
}

function corsHeaders(origin: string): Record<string, string> {
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, x-api-key",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
    };
}

function jsonError(status: number, message: string, origin: string | null): Response {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (origin) {
        Object.assign(headers, corsHeaders(origin));
    }
    return new Response(JSON.stringify({ error: message }), { status, headers });
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const origins = allowedOrigins(env);
        const requestOrigin = request.headers.get("Origin");
        const corsOrigin =
            requestOrigin && origins.includes(requestOrigin) ? requestOrigin : null;

        if (request.method === "OPTIONS") {
            if (!corsOrigin) {
                return new Response(null, { status: 403 });
            }
            return new Response(null, { status: 204, headers: corsHeaders(corsOrigin) });
        }

        if (requestOrigin && !corsOrigin) {
            return jsonError(403, "Origin not allowed", null);
        }

        const url = new URL(request.url);
        if (!ALLOWED_PATHS.has(url.pathname)) {
            return jsonError(404, "Not found", corsOrigin);
        }

        const apiKey =
            request.headers.get("x-api-key") || env.WALLS_DANCE_API_KEY || "";
        if (!apiKey) {
            return jsonError(401, "Missing x-api-key", corsOrigin);
        }

        const upstreamBase = (env.UPSTREAM || "https://walls.dance").replace(/\/$/, "");
        const upstreamHeaders: Record<string, string> = {
            "x-api-key": apiKey,
        };
        const contentType = request.headers.get("Content-Type");
        if (contentType) {
            upstreamHeaders["Content-Type"] = contentType;
        }

        const method = request.method.toUpperCase();
        const upstream = await fetch(`${upstreamBase}${url.pathname}${url.search}`, {
            method,
            headers: upstreamHeaders,
            body: method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer(),
        });

        const headers = new Headers(upstream.headers);
        if (corsOrigin) {
            for (const [key, value] of Object.entries(corsHeaders(corsOrigin))) {
                headers.set(key, value);
            }
        }

        return new Response(upstream.body, {
            status: upstream.status,
            statusText: upstream.statusText,
            headers,
        });
    },
};
