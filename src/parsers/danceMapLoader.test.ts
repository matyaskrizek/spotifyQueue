import { afterEach, describe, expect, it, vi } from "vitest";
import { loadSongDanceMap, parseSongDanceMap } from "./danceMapLoader.ts";

describe("parseSongDanceMap", () => {
    it("maps song names to dance names", () => {
        const map = parseSongDanceMap("Song A,Dance A\nSong B, Dance B");
        expect([...map]).toEqual([
            ["Song A", "Dance A"],
            ["Song B", "Dance B"],
        ]);
    });

    it("handles quoted values containing commas", () => {
        const map = parseSongDanceMap('"Hello, World","Cha Cha, Slide"');
        expect(map.get("Hello, World")).toBe("Cha Cha, Slide");
    });

    it("handles CRLF line endings and skips blank lines", () => {
        const map = parseSongDanceMap("A,1\r\n\r\n   \r\nB,2\r\n");
        expect([...map.keys()]).toEqual(["A", "B"]);
    });

    it("skips lines without both a song and a dance", () => {
        const map = parseSongDanceMap("Only a song\n,No song\nGood,Dance");
        expect([...map]).toEqual([["Good", "Dance"]]);
    });
});

describe("loadSongDanceMap", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("fetches and parses the list", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response("Song,Dance")));
        await expect(loadSongDanceMap("/list.txt")).resolves.toEqual(new Map([["Song", "Dance"]]));
    });

    it("returns an empty map when the fetch fails", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
        await expect(loadSongDanceMap("/missing.txt")).resolves.toEqual(new Map());
    });
});
