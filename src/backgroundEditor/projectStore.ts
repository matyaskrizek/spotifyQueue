import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import {
    ACTIVE_PROJECT_ID_KEY,
    ACTIVE_PROJECT_REV_KEY,
    LEGACY_BG_IMG_KEY,
    createEmptyProject,
    createDefaultMediaElement,
    normalizeProject,
    type BackgroundProject,
    type BgAsset,
    DESIGN_WIDTH,
    DESIGN_HEIGHT,
} from "../types/backgroundProject.ts";

interface BgEditorDB extends DBSchema {
    projects: {
        key: string;
        value: BackgroundProject;
        indexes: { "by-updated": number };
    };
    assets: {
        key: string;
        value: BgAsset;
    };
}

const DB_NAME = "spotifyQueueBgEditor";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<BgEditorDB>> | null = null;

function getDb() {
    if (!dbPromise) {
        dbPromise = openDB<BgEditorDB>(DB_NAME, DB_VERSION, {
            upgrade(db) {
                const projects = db.createObjectStore("projects", { keyPath: "id" });
                projects.createIndex("by-updated", "updatedAt");
                db.createObjectStore("assets", { keyPath: "id" });
            },
        }).catch((err) => {
            // Don't cache the failure; storage may be available on the next call.
            dbPromise = null;
            throw err;
        });
    }
    return dbPromise;
}

/** For tests: drops the cached connection so the next call opens the current `indexedDB`. */
export async function resetDbConnectionForTests(): Promise<void> {
    const db = await dbPromise?.catch(() => null);
    db?.close();
    dbPromise = null;
}

export async function saveProject(project: BackgroundProject): Promise<void> {
    const db = await getDb();
    project.updatedAt = Date.now();
    await db.put("projects", project);
}

export async function getProject(id: string): Promise<BackgroundProject | undefined> {
    const db = await getDb();
    const project = await db.get("projects", id);
    return project && normalizeProject(project);
}

export async function listProjects(): Promise<BackgroundProject[]> {
    const db = await getDb();
    const all = await db.getAllFromIndex("projects", "by-updated");
    return all.reverse();
}

/** Assets freed by this are removed by the next `pruneOrphanAssets()`. */
export async function deleteProject(id: string): Promise<void> {
    const db = await getDb();
    await db.delete("projects", id);
    if (getActiveProjectId() === id) {
        clearActiveProject();
    }
}

// Every open editor (in any tab) holds this lock in shared mode while it may have
// unsaved assets; pruning takes it exclusively, so it's skipped while one is open.
const EDITOR_SESSION_LOCK = "spotifyQueueBgEditorSession";

/**
 * Resolves once the shared lock is held. The returned function releases it and
 * resolves when the lock is actually free (release itself is asynchronous).
 */
export async function holdEditorSession(): Promise<() => Promise<void>> {
    if (!navigator.locks) return async () => {};
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
        release = resolve;
    });
    let released!: Promise<unknown>;
    await new Promise<void>((granted) => {
        released = navigator.locks.request(EDITOR_SESSION_LOCK, { mode: "shared" }, () => {
            granted();
            return held;
        });
    });
    return async () => {
        release();
        await released;
    };
}

/**
 * Deletes assets no saved project references (left behind by deleted/replaced
 * elements or discarded edits). The caller must not hold unsaved editor state.
 * Does nothing while an editor is open in another tab. Returns the deleted asset ids.
 */
export async function pruneOrphanAssets(): Promise<string[]> {
    if (!navigator.locks) return deleteUnreferencedAssets();
    return navigator.locks.request(
        EDITOR_SESSION_LOCK,
        { mode: "exclusive", ifAvailable: true },
        async (lock) => (lock ? deleteUnreferencedAssets() : [])
    );
}

async function deleteUnreferencedAssets(): Promise<string[]> {
    const db = await getDb();
    const projects = await db.getAll("projects");
    const used = new Set(
        projects.flatMap((p) =>
            p.elements.flatMap((el) => ("assetId" in el ? [el.assetId] : []))
        )
    );
    const removed: string[] = [];
    for (const assetId of await db.getAllKeys("assets")) {
        if (!used.has(assetId)) {
            await db.delete("assets", assetId);
            removed.push(assetId);
        }
    }
    return removed;
}

export async function saveAsset(asset: BgAsset): Promise<void> {
    const db = await getDb();
    await db.put("assets", asset);
}

async function contentAssetId(blob: Blob): Promise<string> {
    // crypto.subtle only exists on secure origins (https / localhost).
    if (!crypto.subtle) return crypto.randomUUID();
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Stores media under the SHA-256 of its bytes, so the same file added twice, or the
 * same project imported twice, is only kept once. Returns the asset id.
 */
export async function storeAssetBlob(blob: Blob, mimeType: string, name: string): Promise<string> {
    const id = await contentAssetId(blob);
    const db = await getDb();
    if ((await db.getKey("assets", id)) === undefined) {
        await db.put("assets", { id, mimeType, blob, name });
    }
    return id;
}

export function isQuotaError(err: unknown): boolean {
    return err instanceof DOMException && err.name === "QuotaExceededError";
}

let persistenceRequested = false;

/** Asks the browser not to evict saved backgrounds when the disk runs low. */
export function requestPersistentStorage(): void {
    if (persistenceRequested || !navigator.storage?.persist) return;
    persistenceRequested = true;
    void navigator.storage
        .persisted()
        .then((persisted) => persisted || navigator.storage.persist())
        .catch(() => undefined);
}

export async function getAsset(id: string): Promise<BgAsset | undefined> {
    const db = await getDb();
    return db.get("assets", id);
}

export async function getAssetsForProject(project: BackgroundProject): Promise<BgAsset[]> {
    const ids = project.elements
        .filter((el): el is Extract<typeof el, { assetId: string }> => "assetId" in el)
        .map((el) => el.assetId);
    const unique = [...new Set(ids)];
    const assets: BgAsset[] = [];
    for (const id of unique) {
        const asset = await getAsset(id);
        if (asset) assets.push(asset);
    }
    return assets;
}

export function getActiveProjectId(): string | null {
    return localStorage.getItem(ACTIVE_PROJECT_ID_KEY);
}

export function setActiveProjectId(id: string): void {
    localStorage.setItem(ACTIVE_PROJECT_ID_KEY, id);
    localStorage.setItem(ACTIVE_PROJECT_REV_KEY, Date.now().toString());
}

export function clearActiveProject(): void {
    localStorage.removeItem(ACTIVE_PROJECT_ID_KEY);
    localStorage.setItem(ACTIVE_PROJECT_REV_KEY, Date.now().toString());
}

export function bumpActiveProjectRev(): void {
    localStorage.setItem(ACTIVE_PROJECT_REV_KEY, Date.now().toString());
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
    const res = await fetch(dataUrl);
    return res.blob();
}

/** One-time migration from legacy single-image localStorage background. */
export async function migrateLegacyBackgroundIfNeeded(): Promise<void> {
    if (getActiveProjectId()) return;
    const legacy = localStorage.getItem(LEGACY_BG_IMG_KEY);
    if (!legacy) return;

    try {
        const blob = await dataUrlToBlob(legacy);
        const assetId = crypto.randomUUID();
        await saveAsset({
            id: assetId,
            mimeType: blob.type || "image/jpeg",
            blob,
            name: "legacy-background",
        });

        const project = createEmptyProject("Migrated Background");
        project.elements.push(
            createDefaultMediaElement("image", assetId, {
                x: 0,
                y: 0,
                width: DESIGN_WIDTH,
                height: DESIGN_HEIGHT,
                zIndex: 0,
            })
        );
        await saveProject(project);
        setActiveProjectId(project.id);
        localStorage.removeItem(LEGACY_BG_IMG_KEY);
    } catch (err) {
        console.warn("Failed to migrate legacy background:", err);
    }
}

export async function getActiveProject(): Promise<BackgroundProject | null> {
    await migrateLegacyBackgroundIfNeeded();
    const id = getActiveProjectId();
    if (!id) return null;
    return (await getProject(id)) ?? null;
}
