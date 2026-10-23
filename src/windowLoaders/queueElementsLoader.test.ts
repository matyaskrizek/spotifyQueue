// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, stubFetch } from "../test/helpers.ts";

vi.mock("../services/spotifyService.ts", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../services/spotifyService.ts")>();
    return { SpotifyApiError: actual.SpotifyApiError, fetchCurrentlyPlaying: vi.fn(), fetchQueue: vi.fn() };
});

type Loader = typeof import("./queueElementsLoader.ts");
type Service = typeof import("../services/spotifyService.ts");
type State = typeof import("./playbackState.ts");

let loader: Loader;
let service: { fetchCurrentlyPlaying: ReturnType<typeof vi.fn>; fetchQueue: ReturnType<typeof vi.fn> };
let SpotifyApiError: Service["SpotifyApiError"];
let state: State;

function track(id: string, name = `Song ${id}`): TrackObject {
    return { id, name, artists: [{ name: "Artist" }], album: { name: "Album", images: [{ url: `${id}.jpg` } as Image] } };
}

function queueFor(id: string, name?: string): FullQueue {
    return { currently_playing: track(id, name), queue: [track(`${id}-next`)] };
}

function playing(id: string, remainingMs = 60_000) {
    return { item: { id, duration_ms: 200_000 }, progress_ms: 200_000 - remainingMs };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
}

const wallsMatch = (dance: string) => jsonResponse({ match: { dance: { id: 1, name: dance, displayName: dance } } });

/** walls.dance, the tutorial API and the built-in dance list, with no surprises by default. */
function stubSideServices(walls: (url: string) => Response | Promise<Response> = () => wallsMatch("Walls Dance")) {
    return stubFetch({
        "/walls-api/api/v1/songs": walls,
        "/walls-api/api/v1/log": () => jsonResponse({ ok: true }),
        "https://loic.lescoat.me": () => jsonResponse({ distance: 0.1, tutorial_url: "https://example.com/t" }),
        [`${import.meta.env.BASE_URL}LineDanceMasterList.txt`]: () => new Response("Song t1,Map Dance"),
    });
}

/** Times (fake clock) at which Spotify's currently-playing endpoint was called. */
function recordPollTimes() {
    const times: number[] = [];
    const record = () => times.push(Date.now());
    return { times, record, gaps: () => times.slice(1).map((t, i) => t - times[i]) };
}

beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv("VITE_WALLS_DANCE_API_KEY", "test-key");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    window.name = "";
    const mocked = await import("../services/spotifyService.ts");
    service = mocked as unknown as typeof service;
    SpotifyApiError = mocked.SpotifyApiError;
    loader = await import("./queueElementsLoader.ts");
    state = await import("./playbackState.ts");
});

afterEach(() => {
    loader.stopQueuePolling();
    vi.useRealTimers();
});

describe("nextPollDelay", () => {
    it("doubles from 5 s and stops at 2 minutes", () => {
        const delays = Array.from({ length: 8 }, (_, failed) => loader.nextPollDelay(failed, null));
        expect(delays).toEqual([5_000, 10_000, 20_000, 40_000, 80_000, 120_000, 120_000, 120_000]);
    });

    it("uses Spotify's Retry-After when it's longer than the backoff", () => {
        expect(loader.nextPollDelay(0, 90_000)).toBe(90_000);
        expect(loader.nextPollDelay(5, 1_000)).toBe(120_000);
    });
});

describe("queue polling", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        stubSideServices();
    });

    it("backs off exponentially while Spotify keeps failing", async () => {
        const polls = recordPollTimes();
        service.fetchCurrentlyPlaying.mockImplementation(async () => {
            polls.record();
            throw new Error("offline");
        });

        loader.startQueuePolling("token");
        await vi.advanceTimersByTimeAsync(600_000);

        expect(polls.gaps().slice(0, 7)).toEqual([5_000, 10_000, 20_000, 40_000, 80_000, 120_000, 120_000]);
    });

    it("starts the backoff over after a successful poll", async () => {
        const polls = recordPollTimes();
        const results = [new Error("1"), new Error("2"), null, new Error("3"), new Error("4")];
        service.fetchCurrentlyPlaying.mockImplementation(async () => {
            polls.record();
            const next = results.shift() ?? null;
            if (next instanceof Error) throw next;
            return next;
        });

        loader.startQueuePolling("token");
        await vi.advanceTimersByTimeAsync(40_000);

        // fail, fail, success (nothing playing → 5 s), then the backoff restarts at 5 s.
        expect(polls.gaps().slice(0, 4)).toEqual([5_000, 10_000, 5_000, 5_000]);
    });

    it("waits as long as Spotify's Retry-After asks", async () => {
        const polls = recordPollTimes();
        service.fetchCurrentlyPlaying.mockImplementation(async () => {
            polls.record();
            throw new SpotifyApiError("Test", new Response(null, { status: 429, headers: { "Retry-After": "90" } }));
        });

        loader.startQueuePolling("token");
        await vi.advanceTimersByTimeAsync(100_000);

        expect(polls.gaps()[0]).toBe(90_000);
    });

    it("polls again when the song is due to end", async () => {
        const polls = recordPollTimes();
        service.fetchCurrentlyPlaying.mockImplementation(async () => {
            polls.record();
            return playing("t1", 42_000);
        });
        service.fetchQueue.mockResolvedValue(queueFor("t1"));

        loader.startQueuePolling("token");
        await vi.advanceTimersByTimeAsync(50_000);

        expect(polls.gaps()[0]).toBe(42_000);
    });

    it("retires the old loop when polling restarts mid-request", async () => {
        const slow = deferred<null>();
        service.fetchCurrentlyPlaying.mockReturnValueOnce(slow.promise).mockResolvedValue(null);

        loader.startQueuePolling("token");
        loader.startQueuePolling("token");
        slow.resolve(null);
        await vi.advanceTimersByTimeAsync(5_000);

        // First loop: 1 call. Second loop: initial call + one 5 s later. A surviving
        // first loop would add another.
        expect(service.fetchCurrentlyPlaying).toHaveBeenCalledTimes(3);
    });

    it("can still be stopped after restarting mid-request", async () => {
        const slow = deferred<null>();
        service.fetchCurrentlyPlaying.mockReturnValueOnce(slow.promise).mockResolvedValue(null);

        loader.startQueuePolling("token");
        loader.startQueuePolling("token");
        slow.resolve(null);
        await vi.advanceTimersByTimeAsync(0);
        loader.stopQueuePolling();
        await vi.advanceTimersByTimeAsync(60_000);

        expect(service.fetchCurrentlyPlaying).toHaveBeenCalledTimes(2);
    });

    it("stops completely when stopped mid-request", async () => {
        const slow = deferred<null>();
        service.fetchCurrentlyPlaying.mockReturnValueOnce(slow.promise).mockResolvedValue(null);

        loader.startQueuePolling("token");
        loader.stopQueuePolling();
        slow.resolve(null);
        await vi.advanceTimersByTimeAsync(60_000);

        expect(service.fetchCurrentlyPlaying).toHaveBeenCalledTimes(1);
    });
});

describe("refreshQueue", () => {
    beforeEach(() => {
        stubSideServices();
    });

    it("loads the queue only when the track changes, retrying a failed load", async () => {
        service.fetchCurrentlyPlaying.mockResolvedValue(playing("t1"));
        service.fetchQueue.mockRejectedValueOnce(new Error("queue down")).mockResolvedValue(queueFor("t1"));

        await expect(loader.refreshQueue("token")).rejects.toThrow("queue down");
        await loader.refreshQueue("token");
        await loader.refreshQueue("token");

        expect(service.fetchQueue).toHaveBeenCalledTimes(2);
        expect(state.getPlaybackState().songTitle).toBe("Song t1");
    });

    it("treats nothing playing as a normal 5 s wait", async () => {
        service.fetchCurrentlyPlaying.mockResolvedValue(null);
        await expect(loader.refreshQueue("token")).resolves.toBe(5_000);
        expect(service.fetchQueue).not.toHaveBeenCalled();
    });
});

describe("populateQueue", () => {
    it("shows the song, the walls.dance dance and up next", async () => {
        stubSideServices();
        await loader.populateQueue(queueFor("t1"));

        const current = state.getPlaybackState();
        expect(current.songTitle).toBe("Song t1");
        expect(current.danceTitle).toBe("Walls Dance");
        expect(current.upNext.map((t) => t.id)).toEqual(["t1-next"]);
    });

    it("falls back to the built-in list when walls.dance fails", async () => {
        stubSideServices(() => new Response(null, { status: 500 }));
        await loader.populateQueue(queueFor("t1"));
        expect(state.getPlaybackState().danceTitle).toBe("Map Dance");
    });

    it("keeps a dance set with Set Dance while the walls.dance lookup was running", async () => {
        const lookup = deferred<Response>();
        stubSideServices(() => lookup.promise);

        const populating = loader.populateQueue(queueFor("t1"));
        await vi.waitFor(() => expect(state.getPlaybackState().songTitle).toBe("Song t1"));
        loader.submitManualDanceName("Manual Dance");
        lookup.resolve(wallsMatch("Walls Dance"));
        await populating;

        expect(state.getPlaybackState().danceTitle).toBe("Manual Dance");
    });

    it("ignores a slow lookup for a song that has already changed", async () => {
        const slow = deferred<Response>();
        stubSideServices((url) => (url.includes("Song+t1") ? slow.promise : wallsMatch("Second Dance")));

        const first = loader.populateQueue(queueFor("t1"));
        await loader.populateQueue(queueFor("t2"));
        slow.resolve(wallsMatch("First Dance"));
        await first;

        expect(state.getPlaybackState()).toMatchObject({ songTitle: "Song t2", danceTitle: "Second Dance" });
    });

    it("logs each play once, and never from the pop-out", async () => {
        const fetchMock = stubSideServices();
        const logCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/v1/log")).length;

        await loader.populateQueue(queueFor("t1"));
        await loader.populateQueue(queueFor("t1"));
        expect(logCalls()).toBe(1);

        window.name = "SpotifyQueuePopout";
        await loader.populateQueue(queueFor("t2"));
        expect(logCalls()).toBe(1);
    });
});
