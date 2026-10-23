// @vitest-environment happy-dom
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    ACTIVE_PROJECT_ID_KEY,
    createDefaultMediaElement,
    createDefaultTextElement,
    createEmptyProject,
    type BackgroundProject,
    type MediaElement,
} from "../types/backgroundProject.ts";
import { installFakeLocks } from "../test/helpers.ts";
import { NewerProjectFormatError, exportProjectZip, importProjectZip } from "./exportImport.ts";
import * as store from "./projectStore.ts";

const zipFile = (blob: Blob, name = "test.bgproj.zip") => new File([blob], name, { type: "application/zip" });

async function zipOf(files: Record<string, string | Blob>): Promise<File> {
    const zip = new JSZip();
    for (const [path, content] of Object.entries(files)) zip.file(path, content);
    return zipFile(await zip.generateAsync({ type: "blob" }));
}

/** Compression method per entry, read from the zip's local file headers. */
async function compressionMethods(zip: Blob): Promise<Map<string, string>> {
    const bytes = new Uint8Array(await new Response(zip).arrayBuffer());
    const view = new DataView(bytes.buffer);
    const methods = new Map<string, string>();
    for (let pos = 0; view.getUint32(pos, true) === 0x04034b50; ) {
        const method = view.getUint16(pos + 8, true);
        const compressedSize = view.getUint32(pos + 18, true);
        const nameLength = view.getUint16(pos + 26, true);
        const extraLength = view.getUint16(pos + 28, true);
        const name = new TextDecoder().decode(bytes.subarray(pos + 30, pos + 30 + nameLength));
        methods.set(name, method === 8 ? "DEFLATE" : method === 0 ? "STORE" : String(method));
        pos += 30 + nameLength + extraLength + compressedSize;
    }
    return methods;
}

async function savedProjectWithMedia() {
    const imageId = await store.storeAssetBlob(new Blob(["png bytes"], { type: "image/png" }), "image/png", "photo.png");
    const project = createEmptyProject("Party");
    project.canvas.fill = "#112233";
    project.elements.push(
        createDefaultTextElement({ text: "Welcome", x: 12 }),
        createDefaultMediaElement("image", imageId, { width: 300 })
    );
    await store.saveProject(project);
    return { project, imageId };
}

const mediaOf = (project: BackgroundProject) =>
    project.elements.filter((el): el is MediaElement => el.type === "image" || el.type === "video");

beforeEach(async () => {
    await store.resetDbConnectionForTests();
});

describe("exportProjectZip", () => {
    it("writes format 3 without ids or timestamps, compressing only the JSON", async () => {
        const { project, imageId } = await savedProjectWithMedia();

        const zip = await JSZip.loadAsync(await exportProjectZip(project));
        const file = JSON.parse(await zip.file("project.json")!.async("string"));

        expect(file.format).toBe(3);
        expect(file.project).not.toHaveProperty("id");
        expect(file.project).not.toHaveProperty("updatedAt");
        expect(file.project.elements.every((el: object) => !("id" in el))).toBe(true);
        expect(file.assets).toEqual([{ id: imageId, mimeType: "image/png", name: "photo.png", path: `assets/${imageId}.png` }]);

        const methods = await compressionMethods(await exportProjectZip(project));
        expect(methods.get("project.json")).toBe("DEFLATE");
        expect(methods.get(`assets/${imageId}.png`)).toBe("STORE");
    });
});

describe("importProjectZip", () => {
    it("round-trips an export as a new, active project that reuses stored media", async () => {
        const { project, imageId } = await savedProjectWithMedia();
        const exported = await exportProjectZip(project);

        const imported = await importProjectZip(zipFile(exported));

        expect(imported.id).not.toBe(project.id);
        expect(imported).toMatchObject({ name: "Party", canvas: { fill: "#112233" } });
        expect(imported.elements.map((el) => el.type)).toEqual(project.elements.map((el) => el.type));
        expect(new Set(imported.elements.map((el) => el.id)).size).toBe(imported.elements.length);
        expect(imported.elements.some((el) => project.elements.some((orig) => orig.id === el.id))).toBe(false);
        // Same bytes → same content-hash id, so the media isn't stored twice.
        expect(mediaOf(imported).map((el) => el.assetId)).toEqual([imageId]);
        expect(localStorage.getItem(ACTIVE_PROJECT_ID_KEY)).toBe(imported.id);
        expect((await store.getProject(imported.id))?.name).toBe("Party");
    });

    it("can import without activating", async () => {
        const { project } = await savedProjectWithMedia();
        const imported = await importProjectZip(zipFile(await exportProjectZip(project)), { activate: false });
        expect(localStorage.getItem(ACTIVE_PROJECT_ID_KEY)).not.toBe(imported.id);
    });

    it("imports files from before format 3 (asset .meta.json sidecars)", async () => {
        const legacy = createEmptyProject("Legacy");
        legacy.elements.push(createDefaultMediaElement("image", "old-id"));
        const file = await zipOf({
            "project.json": JSON.stringify(legacy, null, 2),
            "assets/old-id.png": new Blob(["legacy png"], { type: "image/png" }),
            "assets/old-id.meta.json": JSON.stringify({ id: "old-id", mimeType: "image/png", name: "old.png" }),
        });

        const imported = await importProjectZip(file);

        const [media] = mediaOf(imported);
        expect(media.assetId).toMatch(/^[0-9a-f]{64}$/);
        const asset = await store.getAsset(media.assetId);
        expect(asset?.name).toBe("old.png");
        expect(await new Response(asset!.blob).text()).toBe("legacy png");
    });

    it("rejects files from a newer version of the app", async () => {
        const file = await zipOf({ "project.json": JSON.stringify({ format: 99, project: {}, assets: [] }) });
        await expect(importProjectZip(file)).rejects.toBeInstanceOf(NewerProjectFormatError);
    });

    it.each([
        ["no project.json", { "readme.txt": "hi" }],
        ["elements that aren't a list", { "project.json": JSON.stringify({ format: 3, project: { elements: {} } }) }],
    ])("rejects a zip with %s", async (_name, files) => {
        await expect(importProjectZip(await zipOf(files))).rejects.toThrow(/Invalid project/);
    });

    it("cleans up bad values instead of trusting the file", async () => {
        const file = await zipOf({
            "project.json": JSON.stringify({
                format: 3,
                project: {
                    name: "",
                    version: 2,
                    canvas: { fill: "red; background: url(https://evil)" },
                    elements: [
                        { type: "text", text: "ok", x: "far left" },
                        { type: "image", objectFit: "cover" },
                        { type: "script", src: "x" },
                    ],
                },
                assets: [],
            }),
        });

        const imported = await importProjectZip(file);

        expect(imported.name).toBe("test");
        expect(imported.canvas.fill).toBe("#000000");
        expect(imported.designWidth).toBe(1920);
        const kinds = imported.elements.map((el) => (el.type === "widget" ? el.widget : el.type));
        expect(kinds).toEqual(["text", "settingsButton"]);
        expect(imported.elements[0]).toMatchObject({ text: "ok", x: createDefaultTextElement().x });
    });

    describe("with Web Locks", () => {
        let removeLocks: () => void;
        beforeEach(() => {
            removeLocks = installFakeLocks();
        });
        afterEach(() => removeLocks());

        it("holds the editor session while storing media, so pruning can't delete it", async () => {
            const { project } = await savedProjectWithMedia();
            const exported = await exportProjectZip(project);
            await store.deleteProject(project.id);
            const realStore = store.storeAssetBlob;
            const pruned: string[][] = [];
            vi.spyOn(store, "storeAssetBlob").mockImplementation(async (...args) => {
                const id = await realStore(...args);
                // Another tab tries to clean up between storing the media and saving the project.
                pruned.push(await store.pruneOrphanAssets());
                return id;
            });

            const imported = await importProjectZip(zipFile(exported));

            expect(pruned).toEqual([[]]);
            expect(await store.getAsset(mediaOf(imported)[0].assetId)).toBeDefined();
        });
    });
});
