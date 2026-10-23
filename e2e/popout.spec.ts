import { expect, live, liveWidget, nowPlayingTitles, openEditor, openQueuePage, test } from "./fixtures.ts";

test("the pop-out shows its own controls and follows the main window", async ({ page, context }) => {
    await openQueuePage(page);

    const [popout] = await Promise.all([context.waitForEvent("page"), liveWidget(page, "popoutButton").click()]);
    await expect(nowPlayingTitles(popout)).toHaveText(["Copperhead Road", "Copperhead Road Dance"]);
    await expect(liveWidget(popout, "fullscreenButton")).toBeAttached();
    await expect(liveWidget(popout, "settingsButton")).toHaveCount(0);
    await expect(liveWidget(popout, "popoutButton")).toHaveCount(0);

    // A saved design shows up in the pop-out without reloading it.
    await openEditor(page);
    await page.locator("#bgAddTextBtn").click();
    await page.locator("#bgInText").fill("Shared headline");
    await page.locator("#bgEditorSaveBtn").click();
    await expect(live(popout)).toContainText("Shared headline");

    // So do partner dance mode and a manually set dance.
    await page.locator("#bgEditorCloseBtn").click();
    await liveWidget(page, "setDanceButton").click();
    await page.locator("#danceNameInput").fill("Tush Push");
    await page.locator("#danceNameSubmit").click();
    await expect(nowPlayingTitles(popout).nth(1)).toHaveText("Tush Push");

    await liveWidget(page, "partnerDanceButton").click();
    await expect(nowPlayingTitles(popout).nth(1)).toHaveText("Partner Dance");
});

test("still shows the queue and settings button when browser storage is blocked", async ({ page }) => {
    await page.addInitScript(() => {
        localStorage.setItem("activeBackgroundProjectId", "saved-project");
        IDBFactory.prototype.open = () => {
            throw new DOMException("The user denied permission to access the database.", "SecurityError");
        };
    });

    await openQueuePage(page);

    await expect(nowPlayingTitles(page)).toHaveText(["Copperhead Road", "Copperhead Road Dance"]);
});
