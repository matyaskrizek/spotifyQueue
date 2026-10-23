import { readFile } from "node:fs/promises";
import { defaultMockState, expect, installMocks, live, openEditor, openQueuePage, test } from "./fixtures.ts";
import { png } from "./images.ts";

test("a saved design survives a reload", async ({ page }) => {
    await openQueuePage(page);
    await openEditor(page);

    await page.locator("#bgAddTextBtn").click();
    await page.locator("#bgInText").fill("Welcome to line dance night");
    await expect(page.locator("#bgEditorDirty")).toBeVisible();
    await page.locator("#bgEditorSaveBtn").click();
    await expect(page.locator("#bgEditorDirty")).toBeHidden();

    // Selecting an element without moving it isn't an edit.
    const text = page.locator("#bgEditorArtboard .bg-el-text");
    const box = (await text.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator("#bgEditorDirty")).toBeHidden();

    await page.locator("#bgEditorCloseBtn").click();
    await expect(page.locator("#bgEditorOverlay")).toBeHidden();
    await expect(live(page)).toContainText("Welcome to line dance night");

    await page.reload();
    await expect(live(page)).toContainText("Welcome to line dance night");
});

test("cancel discards unsaved edits", async ({ page }) => {
    await openQueuePage(page);
    await openEditor(page);
    await page.locator("#bgAddTextBtn").click();
    await page.locator("#bgInText").fill("Never saved");

    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#bgEditorCancelBtn").click();

    await expect(page.locator("#bgEditorOverlay")).toBeHidden();
    await expect(live(page)).not.toContainText("Never saved");
});

test("side panels resize by dragging, remember their width and reset on double-click", async ({ page }) => {
    await openQueuePage(page);
    await openEditor(page);
    const toolbar = page.locator(".bg-editor-toolbar");
    const inspector = page.locator(".bg-editor-inspector");
    const width = async (locator: typeof toolbar) => (await locator.boundingBox())!.width;
    expect(Math.round(await width(toolbar))).toBe(72);
    expect(Math.round(await width(inspector))).toBe(260);

    const drag = async (selector: string, dx: number) => {
        const box = (await page.locator(selector).boundingBox())!;
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + dx, y, { steps: 5 });
        await page.mouse.up();
    };
    await drag(".bg-editor-resize-handle.left", 100);
    await drag(".bg-editor-resize-handle.right", -140);
    expect(Math.round(await width(toolbar))).toBe(172);
    expect(Math.round(await width(inspector))).toBe(400);

    await page.reload();
    await openEditor(page);
    expect(Math.round(await width(toolbar))).toBe(172);
    expect(Math.round(await width(inspector))).toBe(400);

    await page.locator(".bg-editor-resize-handle.left").dblclick();
    expect(Math.round(await width(toolbar))).toBe(72);
});

test("an exported project imports into a fresh browser with its media", async ({ page, browser }) => {
    await openQueuePage(page);
    await openEditor(page);
    await page.locator("#bgAddTextBtn").click();
    await page.locator("#bgInText").fill("Exported design");
    await page.locator("#bgMediaImageInput").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: png(64, 48) });
    await expect(page.locator("#bgEditorArtboard .bg-el-image img")).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#bgEditorExportBtn").click()]);
    expect(download.suggestedFilename()).toMatch(/\.bgproj\.zip$/);
    const zip = await readFile((await download.path())!);

    const fresh = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    await installMocks(fresh, defaultMockState());
    const other = await fresh.newPage();
    await openQueuePage(other);
    await expect(live(other)).not.toContainText("Exported design");

    other.once("dialog", (dialog) => dialog.accept());
    await other.locator("#bgProjectImportInput").setInputFiles({
        name: download.suggestedFilename(),
        mimeType: "application/zip",
        buffer: zip,
    });

    await expect(live(other)).toContainText("Exported design");
    const image = live(other).locator(".bg-el-image img");
    await expect(image).toBeVisible();
    expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(64);
    await fresh.close();
});
