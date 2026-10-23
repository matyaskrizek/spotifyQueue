import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import { png } from "./images.ts";

export type Track = { id: string; name: string; artist: string };

export const TRACKS = {
    copperhead: { id: "t-copperhead", name: "Copperhead Road", artist: "Steve Earle" },
    boot: { id: "t-boot", name: "Boot Scootin' Boogie", artist: "Brooks & Dunn" },
    achy: { id: "t-achy", name: "Achy Breaky Heart", artist: "Billy Ray Cyrus" },
    chattahoochee: { id: "t-chatta", name: "Chattahoochee", artist: "Alan Jackson" },
} satisfies Record<string, Track>;

/** What the fake Spotify / walls.dance servers return. Tests change it mid-run. */
export type MockState = {
    nowPlaying: Track | null;
    upNext: Track[];
    /** Time left in the current song, which sets the next poll delay. */
    remainingMs: number;
    /** Every Spotify player endpoint answers with this status when set. */
    failWith: number | null;
    /** Dance name walls.dance knows for any song; null means no match. */
    wallsDance: string | null;
    currentlyPlayingRequests: number;
    wallsLogs: Array<{ song: string; artist: string; bar: string; dance?: string }>;
};

const trackJson = (t: Track) => ({
    id: t.id,
    name: t.name,
    type: "track",
    artists: [{ name: t.artist }],
    album: { images: [{ url: `https://i.scdn.co/image/${t.id}` }] },
    duration_ms: 200_000,
});

export async function installMocks(context: BrowserContext, state: MockState) {
    const json = (body: unknown, status = 200) => ({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
    });

    await context.addInitScript(() => {
        localStorage.setItem("access_token", "e2e-token");
        document.cookie = "spotifyAccessTokenForMyApp=e2e-token; path=/";
        document.cookie = `spotifyTokenExpiryForMyApp=${Date.now() + 3_600_000}; path=/`;
    });

    // A test that falls into the login flow fails here instead of reaching the real Spotify.
    await context.route("https://accounts.spotify.com/**", (route) =>
        route.fulfill({ status: 418, contentType: "text/plain", body: "e2e: unexpected Spotify login" })
    );
    await context.route("https://api.spotify.com/v1/me", (route) =>
        route.fulfill(json({ display_name: "E2E DJ", images: [] }))
    );
    await context.route(/https:\/\/api\.spotify\.com\/v1\/me\/player.*/, (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith("/currently-playing")) state.currentlyPlayingRequests++;
        if (state.failWith) return route.fulfill(json({ error: { status: state.failWith } }, state.failWith));
        if (!state.nowPlaying) return route.fulfill({ status: 204 });
        if (path.endsWith("/currently-playing")) {
            return route.fulfill(
                json({ is_playing: true, progress_ms: 200_000 - state.remainingMs, item: trackJson(state.nowPlaying) })
            );
        }
        if (path.endsWith("/queue")) {
            return route.fulfill(
                json({ currently_playing: trackJson(state.nowPlaying), queue: state.upNext.map(trackJson) })
            );
        }
        return route.fulfill(json({ is_playing: true }));
    });

    await context.route("https://walls.test/**", (route) => {
        const request = route.request();
        if (request.method() === "POST") {
            state.wallsLogs.push(request.postDataJSON());
            return route.fulfill(json({ ok: true }));
        }
        const dance = state.wallsDance;
        return route.fulfill(json({ match: dance ? { dance: { name: dance, displayName: dance } } : null }));
    });

    await context.route("https://loic.lescoat.me/**", (route) =>
        route.fulfill(json({ distance: 0.1, tutorial_url: "https://www.youtube.com/watch?v=e2e", best_match: "" }))
    );
    await context.route("https://i.scdn.co/**", (route) =>
        route.fulfill({ status: 200, contentType: "image/png", body: png(4, 4) })
    );
    await context.route("https://fonts.googleapis.com/**", (route) =>
        route.fulfill({ status: 200, contentType: "text/css", body: "" })
    );
    await context.route("https://cdnjs.cloudflare.com/**", (route) => route.abort());
}

export function defaultMockState(): MockState {
    return {
        nowPlaying: TRACKS.copperhead,
        upNext: [TRACKS.boot, TRACKS.achy, TRACKS.chattahoochee],
        remainingMs: 3_000,
        failWith: null,
        wallsDance: "Copperhead Road Dance",
        currentlyPlayingRequests: 0,
        wallsLogs: [],
    };
}

export const test = base.extend<{ mock: MockState }>({
    mock: [
        async ({ context }, use) => {
            const state = defaultMockState();
            await installMocks(context, state);
            await use(state);
        },
        { auto: true },
    ],
});

export { expect };

// ---------- Page helpers ----------

export const live = (page: Page) => page.locator("#backgroundContainer");

export const nowPlayingTitles = (page: Page) =>
    live(page).locator(".bg-widget-currentlyPlaying .bg-now-playing-title");

export const upNextNames = (page: Page) => live(page).locator(".bg-widget-upNext .bg-track-name");

export const liveWidget = (page: Page, action: string) => live(page).locator(`[data-action="${action}"]`);

export async function openQueuePage(page: Page) {
    await page.goto("queue.html");
    await expect(liveWidget(page, "settingsButton")).toBeVisible();
}

export async function openEditor(page: Page) {
    await liveWidget(page, "settingsButton").click();
    await page.locator("#bgSettingsEditBtn").click();
    await expect(page.locator("#bgEditorOverlay")).toBeVisible();
}

/** Reads the stored media files straight from IndexedDB. */
export function storedAssets(page: Page) {
    return page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open("spotifyQueueBgEditor");
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        const assets = await new Promise<Array<{ mimeType: string; blob: Blob }>>((resolve, reject) => {
            const req = db.transaction("assets").objectStore("assets").getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        db.close();
        return Promise.all(
            assets.map(async (a) => ({
                mimeType: a.mimeType,
                size: a.blob.size,
                head: [...new Uint8Array(await a.blob.slice(0, 64).arrayBuffer())],
            }))
        );
    });
}
