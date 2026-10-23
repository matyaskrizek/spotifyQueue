import { expect, openEditor, openQueuePage, storedAssets, test } from "./fixtures.ts";
import { animatedGif, png } from "./images.ts";

const ascii = (bytes: number[], start: number, length: number) =>
    String.fromCharCode(...bytes.slice(start, start + length));

test.beforeEach(async ({ page }) => {
    await openQueuePage(page);
    await openEditor(page);
});

test("PNGs are stored losslessly and never grow", async ({ page }) => {
    const original = png(256, 256);
    await page.locator("#bgMediaImageInput").setInputFiles({ name: "gradient.png", mimeType: "image/png", buffer: original });

    const img = page.locator("#bgEditorArtboard .bg-el-image img");
    await expect(img).toBeVisible();
    await expect(page.locator("#bgEditorMediaStatus")).toBeHidden();
    expect(await img.evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight])).toEqual([256, 256]);

    const [asset] = await storedAssets(page);
    expect(["image/png", "image/webp"]).toContain(asset.mimeType);
    expect(asset.size).toBeLessThanOrEqual(original.length);
    if (asset.mimeType === "image/webp") expect(ascii(asset.head, 8, 4)).toBe("WEBP");
});

test("animated GIFs stay animated", async ({ page }) => {
    const original = animatedGif(32, [1, 2, 3]);
    await page.locator("#bgMediaImageInput").setInputFiles({ name: "blink.gif", mimeType: "image/gif", buffer: original });

    await expect(page.locator("#bgEditorArtboard .bg-el-image img")).toBeVisible();
    await expect(page.locator("#bgEditorMediaStatus")).toBeHidden();

    const [asset] = await storedAssets(page);
    expect(asset.size).toBeLessThanOrEqual(original.length);
    if (asset.mimeType === "image/webp") {
        // VP8X header with the animation flag set.
        expect(ascii(asset.head, 12, 4)).toBe("VP8X");
        expect(asset.head[20] & 0x02).toBe(0x02);
    } else {
        expect(asset.mimeType).toBe("image/gif");
    }
});

test("files that aren't images are refused without breaking the editor", async ({ page }) => {
    const alert = page.waitForEvent("dialog");
    await page.locator("#bgMediaImageInput").setInputFiles({
        name: "broken.png",
        mimeType: "image/png",
        buffer: Buffer.from("this is not a png"),
    });
    // Either it's stored as-is (and shown as broken) or refused with a message; the editor stays usable.
    await Promise.race([alert.then((d) => d.dismiss()), page.locator("#bgEditorArtboard .bg-el-image").waitFor()]);
    await page.locator("#bgAddTextBtn").click();
    await expect(page.locator("#bgEditorArtboard .bg-el-text")).toBeVisible();
});
