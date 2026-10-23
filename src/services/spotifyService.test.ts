// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { authHeaderOf, jsonResponse, stubFetch } from "../test/helpers.ts";
import { SpotifyApiError, fetchCurrentlyPlaying, fetchQueue } from "./spotifyService.ts";

const API = "https://api.spotify.com/v1/me/player";
const TOKEN_URL = "https://accounts.spotify.com/api/token";

describe("SpotifyApiError", () => {
    it.each([
        ["30", 30_000],
        ["0", null],
        [null, null],
        ["soon", null],
    ])("reads Retry-After %s as %s ms", (header, expected) => {
        const headers: Record<string, string> = header === null ? {} : { "Retry-After": header };
        const error = new SpotifyApiError("Test", new Response(null, { status: 429, headers }));
        expect(error.retryAfterMs).toBe(expected);
        expect(error.status).toBe(429);
    });
});

describe("fetchCurrentlyPlaying", () => {
    it("returns null when nothing is playing (204)", async () => {
        stubFetch({ [`${API}/currently-playing`]: () => new Response(null, { status: 204 }) });
        await expect(fetchCurrentlyPlaying("token")).resolves.toBeNull();
    });

    it("returns the parsed body on success", async () => {
        stubFetch({ [`${API}/currently-playing`]: () => jsonResponse({ item: { id: "t1" } }) });
        await expect(fetchCurrentlyPlaying("token")).resolves.toEqual({ item: { id: "t1" } });
    });

    it.each([429, 500, 503])("throws a SpotifyApiError on %s", async (status) => {
        stubFetch({
            [`${API}/currently-playing`]: () =>
                new Response("{}", { status, headers: { "Retry-After": "7" } }),
        });
        const error = await fetchCurrentlyPlaying("token").catch((err: unknown) => err);
        expect(error).toBeInstanceOf(SpotifyApiError);
        expect(error).toMatchObject({ status, retryAfterMs: 7000 });
    });
});

describe("fetchQueue", () => {
    it("returns the queue when playback state and queue load", async () => {
        stubFetch({
            [`${API}/queue`]: () => jsonResponse({ currently_playing: { id: "t1" }, queue: [] }),
            [API]: () => jsonResponse({ is_playing: true }),
        });
        await expect(fetchQueue("token")).resolves.toEqual({ currently_playing: { id: "t1" }, queue: [] });
    });

    it("throws when the playback state request fails, without asking for the queue", async () => {
        const fetchMock = stubFetch({ [API]: () => new Response(null, { status: 429 }) });
        await expect(fetchQueue("token")).rejects.toBeInstanceOf(SpotifyApiError);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("throws when the queue request fails", async () => {
        stubFetch({
            [`${API}/queue`]: () => new Response(null, { status: 500 }),
            [API]: () => jsonResponse({}),
        });
        await expect(fetchQueue("token")).rejects.toMatchObject({ status: 500 });
    });
});

describe("token handling", () => {
    it("sends the newest stored token instead of the one passed in", async () => {
        localStorage.setItem("access_token", "fresh");
        const fetchMock = stubFetch({ [`${API}/currently-playing`]: () => new Response(null, { status: 204 }) });

        await fetchCurrentlyPlaying("stale");

        expect(authHeaderOf(fetchMock, 0)).toBe("Bearer fresh");
    });

    it("falls back to the passed token when none is stored", async () => {
        const fetchMock = stubFetch({ [`${API}/currently-playing`]: () => new Response(null, { status: 204 }) });
        await fetchCurrentlyPlaying("passed");
        expect(authHeaderOf(fetchMock, 0)).toBe("Bearer passed");
    });

    it("refreshes once on a 401 and retries with the new token", async () => {
        localStorage.setItem("refresh_token", "refresh-1");
        const fetchMock = stubFetch({
            [`${API}/currently-playing`]: [
                () => new Response(null, { status: 401 }),
                () => jsonResponse({ item: { id: "t1" } }),
            ],
            [TOKEN_URL]: () => jsonResponse({ access_token: "new", refresh_token: "refresh-2", expires_in: 3600 }),
        });

        await expect(fetchCurrentlyPlaying("old")).resolves.toEqual({ item: { id: "t1" } });

        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(authHeaderOf(fetchMock, 2)).toBe("Bearer new");
        expect(localStorage.getItem("access_token")).toBe("new");
        expect(localStorage.getItem("refresh_token")).toBe("refresh-2");
    });

    it("surfaces a failed refresh as an error instead of retrying with no token", async () => {
        localStorage.setItem("refresh_token", "revoked");
        const fetchMock = stubFetch({
            [`${API}/currently-playing`]: () => new Response(null, { status: 401 }),
            [TOKEN_URL]: () => jsonResponse({ error: "invalid_grant" }, { status: 400 }),
        });

        await expect(fetchCurrentlyPlaying("old")).rejects.toThrow(/Token refresh failed: 400 invalid_grant/);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
