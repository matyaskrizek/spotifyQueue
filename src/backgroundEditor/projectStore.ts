import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import {
    ACTIVE_PROJECT_ID_KEY,
    ACTIVE_PROJECT_REV_KEY,
    LEGACY_BG_IMG_KEY,
    createEmptyProject,
    createDefaultMediaElement,
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
        });
    }
    return dbPromise;
}

export async function saveProject(project: BackgroundProject): Promise<void> {
    const db = await getDb();
    project.updatedAt = Date.now();
    await db.put("projects", project);
}

export async function getProject(id: string): Promise<BackgroundProject | undefined> {
    const db = await getDb();
    return db.get("projects", id);
}

export async function listProjects(): Promise<BackgroundProject[]> {
    const db = await getDb();
    const all = await db.getAllFromIndex("projects", "by-updated");
    return all.reverse();
}

export async function deleteProject(id: string): Promise<void> {
    const db = await getDb();
    const project = await db.get("projects", id);
    if (project) {
        const assetIds = new Set(
            project.elements
                .filter((el): el is Extract<typeof el, { assetId: string }> => "assetId" in el)
                .map((el) => el.assetId)
        );
        await db.delete("projects", id);
        for (const assetId of assetIds) {
            const stillUsed = (await listProjects()).some((p) =>
                p.elements.some((el) => "assetId" in el && el.assetId === assetId)
            );
            if (!stillUsed) await db.delete("assets", assetId);
        }
    }
    if (getActiveProjectId() === id) {
        clearActiveProject();
    }
}

export async function saveAsset(asset: BgAsset): Promise<void> {
    const db = await getDb();
    await db.put("assets", asset);
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
