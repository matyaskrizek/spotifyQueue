// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    ACTIVE_PROJECT_ID_KEY,
    LEGACY_BG_IMG_KEY,
    createDefaultMediaElement,
    createEmptyProject,
    type BackgroundProject,
} from "../types/backgroundProject.ts";
import { installFakeLocks } from "../test/helpers.ts";
import {
    deleteProject,
    getActiveProject,
    getAsset,
    getProject,
    holdEditorSession,
    listProjects,
    pruneOrphanAssets,
    resetDbConnectionForTests,
    saveProject,
    setActiveProjectId,
    storeAssetBlob,
} from "./projectStore.ts";

const blob = (text: string, type = "image/png") => new Blob([text], { type });

function projectUsing(...assetIds: string[]): BackgroundProject {
    const project = createEmptyProject();
    project.elements.push(...assetIds.map((id) => createDefaultMediaElement("image", id)));
    return project;
}

beforeEach(async () => {
    await resetDbConnectionForTests();
});

describe("projects", () => {
    it("saves, reads and lists projects, newest first", async () => {
        const older = createEmptyProject("Older");
        const newer = createEmptyProject("Newer");
        const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
        await saveProject(older);
        now.mockReturnValue(2_000);
        await saveProject(newer);

        expect((await getProject(older.id))?.name).toBe("Older");
        expect((await listProjects()).map((p) => p.name)).toEqual(["Newer", "Older"]);
    });

    it("normalizes projects when reading them", async () => {
        const project = createEmptyProject();
        project.elements = [];
        await saveProject(project);

        const read = await getProject(project.id);
        expect(read?.elements.some((el) => el.type === "widget" && el.widget === "settingsButton")).toBe(true);
    });

    it("clears the active project when it's deleted", async () => {
        const project = createEmptyProject();
        await saveProject(project);
        setActiveProjectId(project.id);

        await deleteProject(project.id);

        expect(await getProject(project.id)).toBeUndefined();
        expect(localStorage.getItem(ACTIVE_PROJECT_ID_KEY)).toBeNull();
        expect(await getActiveProject()).toBeNull();
    });

    it("returns the active project", async () => {
        const project = createEmptyProject("Active");
        await saveProject(project);
        setActiveProjectId(project.id);
        expect((await getActiveProject())?.name).toBe("Active");
    });
});

describe("storeAssetBlob", () => {
    it("names assets by the SHA-256 of their bytes and stores duplicates once", async () => {
        const first = await storeAssetBlob(blob("same bytes"), "image/png", "a.png");
        const second = await storeAssetBlob(blob("same bytes"), "image/png", "b.png");
        const other = await storeAssetBlob(blob("other bytes"), "image/png", "c.png");

        expect(first).toMatch(/^[0-9a-f]{64}$/);
        expect(second).toBe(first);
        expect(other).not.toBe(first);
        // The first upload's metadata is kept.
        expect((await getAsset(first))?.name).toBe("a.png");
    });

    it("keeps the bytes and type", async () => {
        const id = await storeAssetBlob(blob("pixels", "image/webp"), "image/webp", "x.webp");
        const asset = await getAsset(id);
        expect(asset?.mimeType).toBe("image/webp");
        expect(await asset?.blob.text()).toBe("pixels");
    });
});

describe("pruneOrphanAssets", () => {
    let removeLocks: (() => void) | null = null;

    afterEach(() => {
        removeLocks?.();
        removeLocks = null;
    });

    async function storeUsedAndUnused() {
        const used = await storeAssetBlob(blob("used"), "image/png", "used.png");
        const unused = await storeAssetBlob(blob("unused"), "image/png", "unused.png");
        await saveProject(projectUsing(used));
        return { used, unused };
    }

    it("deletes only assets no saved project uses (no Web Locks)", async () => {
        const { used, unused } = await storeUsedAndUnused();

        expect(await pruneOrphanAssets()).toEqual([unused]);
        expect(await getAsset(used)).toBeDefined();
        expect(await getAsset(unused)).toBeUndefined();
    });

    it("does nothing while an editor session is open", async () => {
        removeLocks = installFakeLocks();
        const { unused } = await storeUsedAndUnused();
        const release = await holdEditorSession();

        expect(await pruneOrphanAssets()).toEqual([]);
        expect(await getAsset(unused)).toBeDefined();

        // Resolves only once the lock is free, so pruning can follow straight away.
        await release();
        expect(await pruneOrphanAssets()).toEqual([unused]);
    });
});

describe("legacy background migration", () => {
    it("turns the old single-image background into an active project", async () => {
        localStorage.setItem(LEGACY_BG_IMG_KEY, "data:image/png;base64,iVBORw0KGgo=");
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(blob("legacy pixels")))
        );

        const project = await getActiveProject();

        expect(project?.name).toBe("Migrated Background");
        const media = project?.elements.find((el) => el.type === "image");
        expect(media && "assetId" in media && (await getAsset(media.assetId))?.name).toBe("legacy-background");
        expect(localStorage.getItem(LEGACY_BG_IMG_KEY)).toBeNull();
    });
});

describe("database connection", () => {
    it("retries opening after a failure instead of caching it", async () => {
        const factory = globalThis.indexedDB;
        const open = vi.spyOn(factory, "open").mockImplementationOnce(() => {
            throw new DOMException("blocked", "SecurityError");
        });

        await expect(listProjects()).rejects.toThrow("blocked");
        await expect(listProjects()).resolves.toEqual([]);
        expect(open).toHaveBeenCalledTimes(2);
    });
});
