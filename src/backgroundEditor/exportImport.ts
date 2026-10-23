import JSZip from "jszip";
import {
    DESIGN_HEIGHT,
    DESIGN_WIDTH,
    normalizeProject,
    type BackgroundProject,
    type BgAsset,
} from "../types/backgroundProject.ts";
import {
    getAssetsForProject,
    holdEditorSession,
    requestPersistentStorage,
    saveProject,
    setActiveProjectId,
    storeAssetBlob,
} from "./projectStore.ts";
import { sniffMimeType } from "./mediaOptimizer.ts";

/**
 * File format 3: a single minified project.json holding the project and an asset
 * table. Older files kept pretty-printed JSON plus one `<id>.meta.json` per asset.
 */
const FILE_FORMAT = 3;

type AssetEntry = Pick<BgAsset, "id" | "mimeType" | "name"> & { path: string };

type ProjectFile = {
    format: typeof FILE_FORMAT;
    project: Omit<BackgroundProject, "id" | "updatedAt">;
    assets: AssetEntry[];
};

export class NewerProjectFormatError extends Error {
    constructor() {
        super("This project was saved by a newer version of the app. Reload the page to update, then import it again.");
    }
}

/** Deflating these wastes time and saves nothing; they're compressed already. */
const ALREADY_COMPRESSED = /^(image\/(jpeg|png|webp|gif|avif|heic)|video\/)/;

function extForMime(mime: string): string {
    if (mime.includes("png")) return "png";
    if (mime.includes("webp")) return "webp";
    if (mime.includes("gif")) return "gif";
    if (mime.includes("svg")) return "svg";
    if (mime.includes("webm")) return "webm";
    if (mime.includes("mp4")) return "mp4";
    if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
    return "bin";
}

export async function exportProjectZip(project: BackgroundProject): Promise<Blob> {
    const zip = new JSZip();
    const assets = await getAssetsForProject(project);
    const entries: AssetEntry[] = assets.map((asset) => ({
        id: asset.id,
        mimeType: asset.mimeType,
        name: asset.name,
        path: `assets/${asset.id}.${extForMime(asset.mimeType)}`,
    }));

    // Ids and timestamps are replaced on import, so they're left out.
    const file: ProjectFile = {
        format: FILE_FORMAT,
        project: {
            name: project.name,
            version: project.version,
            designWidth: project.designWidth,
            designHeight: project.designHeight,
            canvas: project.canvas,
            elements: project.elements.map((el) => {
                const copy: Record<string, unknown> = { ...el };
                delete copy.id;
                return copy as unknown as BackgroundProject["elements"][number];
            }),
        },
        assets: entries,
    };
    zip.file("project.json", JSON.stringify(file), {
        compression: "DEFLATE",
        compressionOptions: { level: 9 },
    });

    assets.forEach((asset, i) => {
        zip.file(entries[i].path, asset.blob, {
            compression: ALREADY_COMPRESSED.test(asset.mimeType) ? "STORE" : "DEFLATE",
            compressionOptions: { level: 9 },
        });
    });
    return zip.generateAsync({ type: "blob", mimeType: "application/zip" });
}

export async function downloadProjectZip(project: BackgroundProject): Promise<void> {
    const blob = await exportProjectZip(project);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.name.replace(/[^\w\-]+/g, "_") || "background"}.bgproj.zip`;
    a.click();
    // Revoking synchronously can cancel the download in Firefox/Safari
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Format 1/2 files: the project itself, plus `assets/<id>.meta.json` next to each asset. */
async function readLegacyAssetEntries(zip: JSZip): Promise<AssetEntry[]> {
    const paths = Object.keys(zip.files);
    const entries: AssetEntry[] = [];
    for (const metaPath of paths.filter((p) => p.startsWith("assets/") && p.endsWith(".meta.json"))) {
        const meta = JSON.parse(await zip.file(metaPath)!.async("string")) as Partial<AssetEntry>;
        const base = metaPath.replace(/\.meta\.json$/, "");
        const path = paths.find((p) => p.startsWith(base + ".") && !p.endsWith(".meta.json"));
        if (!path || typeof meta.id !== "string") continue;
        entries.push({ id: meta.id, mimeType: meta.mimeType ?? "", name: meta.name ?? "", path });
    }
    return entries;
}

export async function importProjectZip(
    file: File,
    options?: { activate?: boolean }
): Promise<BackgroundProject> {
    const zip = await JSZip.loadAsync(file);
    const projectFile = zip.file("project.json");
    if (!projectFile) throw new Error("Invalid project: missing project.json");

    const parsed = JSON.parse(await projectFile.async("string")) as Partial<ProjectFile> & {
        format?: unknown;
    };
    let project: BackgroundProject;
    let assetEntries: AssetEntry[];
    if (typeof parsed?.format === "number") {
        if (parsed.format > FILE_FORMAT) throw new NewerProjectFormatError();
        project = parsed.project as BackgroundProject;
        assetEntries = Array.isArray(parsed.assets) ? parsed.assets : [];
    } else {
        project = parsed as unknown as BackgroundProject;
        assetEntries = await readLegacyAssetEntries(zip);
    }

    if (!project || !Array.isArray(project.elements)) {
        throw new Error("Invalid project.json");
    }
    if (!/^#[0-9a-f]{6}$/i.test(project.canvas?.fill ?? "")) {
        project.canvas = { fill: "#000000" };
    }
    project.designWidth ||= DESIGN_WIDTH;
    project.designHeight ||= DESIGN_HEIGHT;
    normalizeProject(project);

    project.id = crypto.randomUUID();
    project.updatedAt = Date.now();
    if (!project.name) project.name = file.name.replace(/\.bgproj\.zip$/i, "") || "Imported";

    // Until the project is saved its media looks unreferenced, so keep orphan pruning
    // (in any tab) from deleting it in the meantime.
    const releaseSession = await holdEditorSession();
    try {
        // Stored exactly as packed; ids are content hashes, so re-importing reuses existing media.
        const assetIds = new Map<string, string>();
        for (const entry of assetEntries) {
            const data = typeof entry?.path === "string" ? zip.file(entry.path) : null;
            if (!data || typeof entry.id !== "string") continue;
            const bytes = await data.async("blob");
            const mimeType =
                entry.mimeType || (await sniffMimeType(bytes)) || bytes.type || "application/octet-stream";
            const blob = new Blob([bytes], { type: mimeType });
            assetIds.set(entry.id, await storeAssetBlob(blob, mimeType, entry.name || "asset"));
        }

        for (const el of project.elements) {
            el.id = crypto.randomUUID();
            if ("assetId" in el) el.assetId = assetIds.get(el.assetId) ?? el.assetId;
        }

        await saveProject(project);
    } finally {
        await releaseSession();
    }
    requestPersistentStorage();
    if (options?.activate !== false) {
        setActiveProjectId(project.id);
    }
    return project;
}
