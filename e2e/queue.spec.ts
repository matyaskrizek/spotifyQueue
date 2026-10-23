import { TRACKS, expect, liveWidget, nowPlayingTitles, openQueuePage, test, upNextNames } from "./fixtures.ts";

test("shows the playing song, its dance and what's up next", async ({ page, mock }) => {
    await openQueuePage(page);

    await expect(nowPlayingTitles(page)).toHaveText(["Copperhead Road", "Copperhead Road Dance"]);
    await expect(upNextNames(page)).toHaveText([TRACKS.boot.name, TRACKS.achy.name, TRACKS.chattahoochee.name]);

    // Each play is logged to walls.dance once, with the dance that was shown.
    await expect.poll(() => mock.wallsLogs).toEqual([
        { song: "Copperhead Road", artist: "Steve Earle", bar: "e2e-bar", dance: "Copperhead Road Dance" },
    ]);
});

test("falls back to the built-in dance list when walls.dance has no match", async ({ page, mock }) => {
    mock.wallsDance = null;
    // Listed in public/LineDanceMasterList.txt.
    mock.nowPlaying = { id: "t-uptown", name: "Uptown Funk", artist: "Mark Ronson" };
    await openQueuePage(page);

    await expect(nowPlayingTitles(page)).toHaveText(["Uptown Funk", "Body Rock"]);
});

test("follows the song when Spotify moves on", async ({ page, mock }) => {
    await openQueuePage(page);
    await expect(nowPlayingTitles(page).first()).toHaveText("Copperhead Road");

    mock.nowPlaying = TRACKS.boot;
    mock.upNext = [TRACKS.achy];
    mock.wallsDance = "Boot Scootin' Boogie";

    await expect(nowPlayingTitles(page)).toHaveText(["Boot Scootin' Boogie", "Boot Scootin' Boogie"], {
        timeout: 15_000,
    });
    await expect(upNextNames(page)).toHaveText([TRACKS.achy.name]);
});

test("Set Dance overrides the dance and records the correction", async ({ page, mock }) => {
    await openQueuePage(page);
    await expect(nowPlayingTitles(page).nth(1)).toHaveText("Copperhead Road Dance");

    await liveWidget(page, "setDanceButton").click();
    await page.locator("#danceNameInput").fill("Electric Slide");
    await page.locator("#danceNameSubmit").click();

    await expect(nowPlayingTitles(page).nth(1)).toHaveText("Electric Slide");
    await expect.poll(() => mock.wallsLogs.at(-1)?.dance).toBe("Electric Slide");
});

test("partner dance mode replaces the dance title", async ({ page }) => {
    await openQueuePage(page);
    await liveWidget(page, "partnerDanceButton").click();
    await expect(nowPlayingTitles(page).nth(1)).toHaveText("Partner Dance");
});

test("backs off exponentially while Spotify keeps failing", async ({ page, mock }) => {
    mock.failWith = 503;
    await page.clock.install();
    await page.goto("queue.html");
    await expect.poll(() => mock.currentlyPlayingRequests).toBe(1);

    // Step the page clock a second at a time, giving each poll's request a moment to complete.
    const requestTimes: number[] = [0];
    for (let second = 1; second <= 40; second++) {
        await page.clock.runFor(1_000);
        await page.waitForTimeout(25);
        if (mock.currentlyPlayingRequests > requestTimes.length) requestTimes.push(second);
    }

    const gaps = requestTimes.slice(1).map((t, i) => t - requestTimes[i]);
    expect(gaps).toHaveLength(3);
    // 5 s, then 10 s, then 20 s, give or take the one-second step.
    for (const [gap, expected] of gaps.map((g, i) => [g, [5, 10, 20][i]])) {
        expect(Math.abs(gap - expected)).toBeLessThanOrEqual(1);
    }
});
