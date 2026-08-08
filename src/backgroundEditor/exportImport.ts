import JSZip from "jszip";
import type { BackgroundProject, BgAsset } from "../types/backgroundProject.ts";
import {
    getAssetsForProject,
    saveAsset,
    saveProject,
    setActiveProjectId,
} from "./projectStore.ts";

function extForMime(mime: string): string {
    if (mime.includes("png")) return "png";
    if (mime.includes("webp")) return "webp";
    if (mime.includes("gif")) return "gif";
    if (mime.includes("webm")) return "webm";
    if (mime.includes("mp4")) return "mp4";
    if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
    return "bin";
}

export async function exportProjectZip(project: BackgroundProject): Promise<Blob> {
    const zip = new JSZip();
    const assets = await getAssetsForProject(project);
    zip.file("project.json", JSON.stringify(project, null, 2));

    const folder = zip.folder("assets");
    if (folder) {
        for (const asset of assets) {
            const ext = extForMime(asset.mimeType);
            folder.file(`${asset.id}.${ext}`, asset.blob);
            folder.file(
                `${asset.id}.meta.json`,
                JSON.stringify({ id: asset.id, mimeType: asset.mimeType, name: asset.name })
            );
        }
    }
    return zip.generateAsync({ type: "blob" });
}

export async function downloadProjectZip(project: BackgroundProject): Promise<void> {
    const blob = await exportProjectZip(project);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.name.replace(/[^\w\-]+/g, "_") || "background"}.bgproj.zip`;
    a.click();
    URL.revokeObjectURL(url);
}

export async function importProjectZip(
    file: File,
    options?: { activate?: boolean }
): Promise<BackgroundProject> {
    const zip = await JSZip.loadAsync(file);
    const projectFile = zip.file("project.json");
    if (!projectFile) throw new Error("Invalid project: missing project.json");

    const raw = await projectFile.async("string");
    const project = JSON.parse(raw) as BackgroundProject;
    if (!project?.id || !Array.isArray(project.elements)) {
        throw new Error("Invalid project.json");
    }

    // Remap ids so imports never collide with existing projects/assets.
    const idMap = new Map<string, string>();
    const newProjectId = crypto.randomUUID();
    project.id = newProjectId;
    project.updatedAt = Date.now();
    if (!project.name) project.name = file.name.replace(/\.bgproj\.zip$/i, "") || "Imported";

    for (const el of project.elements) {
        const oldElId = el.id;
        el.id = crypto.randomUUID();
        idMap.set(oldElId, el.id);
        if ("assetId" in el) {
            const oldAsset = el.assetId;
            if (!idMap.has(`asset:${oldAsset}`)) {
                idMap.set(`asset:${oldAsset}`, crypto.randomUUID());
            }
            el.assetId = idMap.get(`asset:${oldAsset}`)!;
        }
    }

    const assetFolder = zip.folder("assets");
    if (assetFolder) {
        const metas = Object.keys(zip.files).filter(
            (p) => p.startsWith("assets/") && p.endsWith(".meta.json")
        );
        for (const metaPath of metas) {
            const metaRaw = await zip.file(metaPath)!.async("string");
            const meta = JSON.parse(metaRaw) as Pick<BgAsset, "id" | "mimeType" | "name">;
            const newId = idMap.get(`asset:${meta.id}`);
            if (!newId) continue;

            const base = metaPath.replace(/\.meta\.json$/, "");
            const candidates = Object.keys(zip.files).filter(
                (p) => p.startsWith(base + ".") && !p.endsWith(".meta.json")
            );
            const dataPath = candidates[0];
            if (!dataPath) continue;
            const blob = await zip.file(dataPath)!.async("blob");
            await saveAsset({
                id: newId,
                mimeType: meta.mimeType || blob.type || "application/octet-stream",
                blob,
                name: meta.name || "asset",
            });
        }
    }

    await saveProject(project);
    if (options?.activate !== false) {
        setActiveProjectId(project.id);
    }
    return project;
}
