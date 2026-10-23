// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { jsonResponse, stubFetch } from "../test/helpers.ts";
import {
    LOGGED_OUT_KEY,
    clearStoredSession,
    deleteCookie,
    getCookie,
    logoutOfSpotify,
    refreshAccessToken,
    setCookie,
} from "./authCodeWithPkce.ts";

const TOKEN_URL = "https://accounts.spotify.com/api/token";

describe("refreshAccessToken", () => {
    it("throws without a refresh token, without calling Spotify", async () => {
        const fetchMock = stubFetch({});
        await expect(refreshAccessToken("client")).rejects.toThrow("No refresh token available");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("sends the refresh token and saves the new tokens", async () => {
        localStorage.setItem("refresh_token", "r1");
        const fetchMock = stubFetch({
            [TOKEN_URL]: () => jsonResponse({ access_token: "a2", refresh_token: "r2", expires_in: 3600 }),
        });

        await expect(refreshAccessToken("client")).resolves.toBe("a2");

        const body = fetchMock.mock.calls[0][1]?.body as URLSearchParams;
        expect(Object.fromEntries(body)).toEqual({
            client_id: "client",
            grant_type: "refresh_token",
            refresh_token: "r1",
        });
        expect(localStorage.getItem("access_token")).toBe("a2");
        expect(localStorage.getItem("refresh_token")).toBe("r2");
        expect(getCookie("spotifyAccessTokenForMyApp")).toBe("a2");
    });

    it("keeps the old refresh token when Spotify doesn't rotate it", async () => {
        localStorage.setItem("refresh_token", "r1");
        stubFetch({ [TOKEN_URL]: () => jsonResponse({ access_token: "a2", expires_in: 3600 }) });
        await refreshAccessToken("client");
        expect(localStorage.getItem("refresh_token")).toBe("r1");
    });

    it.each([
        ["an error status", () => jsonResponse({ error: "invalid_grant" }, { status: 400 })],
        ["a body without a token", () => jsonResponse({})],
        ["a non-JSON body", () => new Response("<html>oops</html>", { status: 502 })],
    ])("throws on %s and keeps the stored tokens", async (_name, respond) => {
        localStorage.setItem("refresh_token", "r1");
        localStorage.setItem("access_token", "a1");
        stubFetch({ [TOKEN_URL]: respond });

        await expect(refreshAccessToken("client")).rejects.toThrow(/Token refresh failed/);
        expect(localStorage.getItem("access_token")).toBe("a1");
    });
});

describe("cookie helpers", () => {
    it("round-trips values that need encoding", () => {
        setCookie("weird", "a b;c=d", 1);
        expect(getCookie("weird")).toBe("a b;c=d");
    });

    it("returns null for missing or deleted cookies", () => {
        expect(getCookie("missing")).toBeNull();
        setCookie("gone", "x", 1);
        deleteCookie("gone");
        expect(getCookie("gone")).toBeNull();
    });
});

describe("logout", () => {
    it("clears tokens, forces the Spotify dialog next time and tells other windows", () => {
        localStorage.setItem("access_token", "a");
        localStorage.setItem("refresh_token", "r");
        localStorage.setItem("verifier", "v");
        setCookie("spotifyAccessTokenForMyApp", "a", 1);
        const onDone = vi.fn();

        logoutOfSpotify(onDone);

        expect(localStorage.getItem("access_token")).toBeNull();
        expect(localStorage.getItem("refresh_token")).toBeNull();
        expect(localStorage.getItem("verifier")).toBeNull();
        expect(getCookie("spotifyAccessTokenForMyApp")).toBeNull();
        expect(localStorage.getItem("spotifyForceDialog")).toBe("true");
        expect(localStorage.getItem(LOGGED_OUT_KEY)).not.toBeNull();
        expect(onDone).toHaveBeenCalledOnce();
    });

    it("clearStoredSession leaves unrelated storage alone", () => {
        localStorage.setItem("activeBackgroundProjectId", "p1");
        clearStoredSession();
        expect(localStorage.getItem("activeBackgroundProjectId")).toBe("p1");
    });
});
