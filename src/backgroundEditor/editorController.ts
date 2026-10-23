import Moveable from "moveable";
import {
    WIDGET_INFO,
    createDefaultMediaElement,
    createDefaultTextElement,
    createDefaultWidget,
    createEmptyProject,
    type BackgroundProject,
    type BgElement,
    type WidgetKind,
} from "../types/backgroundProject.ts";
import { relayoutWidget } from "./widgets.ts";
import { setupInspector, updateInspector } from "./inspector.ts";
import { setupPanelResize } from "./panelResize.ts";
import { closeSettingsMenu, refreshProjectList, setupSettingsMenu } from "./settingsMenu.ts";
import {
    bumpActiveProjectRev,
    getActiveProject,
    getProject,
    holdEditorSession,
    isQuotaError,
    pruneOrphanAssets,
    requestPersistentStorage,
    saveProject,
    setActiveProjectId,
    storeAssetBlob,
} from "./projectStore.ts";
import { NewerProjectFormatError, downloadProjectZip, importProjectZip } from "./exportImport.ts";
import { isOptimizable, optimizeMedia, sniffMimeType } from "./mediaOptimizer.ts";
import { ensureFontsLoaded } from "./fonts.ts";
import {
    clearScene,
    findElementNode,
    refitScene,
    renderActiveBackground,
    renderScene,
    revokeAssetUrls,
} from "./sceneRenderer.ts";

let project: BackgroundProject | null = null;
let selectedId: string | null = null;
let moveable: Moveable | null = null;
let dirty = false;
let undoStack: string[] = [];
let redoStack: string[] = [];
let editorOpen = false;
let textEditingId: string | null = null;
let textEditCleanup: (() => void) | null = null;
let releaseEditorSession: (() => Promise<void>) | null = null;
/** Changes whenever the editor opens or closes a project (not on undo/redo, which swap `project`). */
let editorSession = 0;
/** Fits the side panels to the window; set up in `setupBackgroundEditor`. */
let layoutPanels: () => void = () => {};

/** Resolves once this tab's lock is released, so orphan pruning can run. */
async function endEditorSession() {
    const release = releaseEditorSession;
    releaseEditorSession = null;
    editorSession++;
    await release?.();
}

function $(id: string): HTMLElement | null {
    return document.getElementById(id);
}

function pushUndo() {
    if (!project) return;
    undoStack.push(JSON.stringify(project));
    if (undoStack.length > 50) undoStack.shift();
    redoStack = [];
}

// Inputs that fire on every keystroke/drag (text, color) take one snapshot per edit
// gesture, before the first change, so undo restores the value from before the edit.
const pendingGestures = new Set<string>();

function pushUndoOnce(gesture: string) {
    if (pendingGestures.has(gesture)) return;
    pendingGestures.add(gesture);
    pushUndo();
}

function endUndoGesture(gesture: string) {
    pendingGestures.delete(gesture);
}

function setDirty(value: boolean) {
    dirty = value;
    const badge = $("bgEditorDirty");
    if (badge) badge.hidden = !dirty;
}

function selectedElement(): BgElement | null {
    if (!project || !selectedId) return null;
    return project.elements.find((el) => el.id === selectedId) ?? null;
}

function nextZIndex(): number {
    if (!project || project.elements.length === 0) return 1;
    return Math.max(...project.elements.map((el) => el.zIndex)) + 1;
}

async function refreshEditorScene() {
    if (!project) return;
    const artboard = $("bgEditorArtboard");
    if (!artboard) return;

    const scene = await renderScene({
        container: artboard,
        project,
        editable: true,
        fit: "contain",
        onElementClick: (id) => selectElement(id),
        onElementDblClick: (id) => {
            void beginTextEdit(id);
        },
    });
    // A newer refresh superseded this one
    if (!scene) return;

    scene.addEventListener("mousedown", (e) => {
        if (e.target === scene) {
            if (textEditingId) finishTextEdit();
            selectElement(null);
        }
    });

    if (selectedId && textEditingId !== selectedId) {
        const node = findElementNode(artboard, selectedId);
        if (node) attachMoveable(node);
        else destroyMoveable();
    } else if (!selectedId) {
        destroyMoveable();
    }
    updateInspector();
}

function destroyMoveable() {
    moveable?.destroy();
    moveable = null;
}

/** Counter the artboard's scale-down so handles keep a constant on-screen size. */
function handleZoomFor(scene: HTMLElement): number {
    const scale = Number(scene.dataset.scale) || 1;
    return 1 / scale;
}

function syncMoveableToViewport() {
    const scene = $("bgEditorArtboard")?.querySelector(".bg-scene") as HTMLElement | null;
    if (!moveable || !scene) return;
    moveable.zoom = handleZoomFor(scene);
    moveable.updateRect();
}

function attachMoveable(target: HTMLElement) {
    destroyMoveable();
    const artboard = $("bgEditorArtboard");
    const scene = artboard?.querySelector(".bg-scene") as HTMLElement | null;
    if (!artboard || !scene || !project) return;

    // Host Moveable inside the scaled scene so handles share the same transform space.
    moveable = new Moveable(scene, {
        target,
        container: scene,
        zoom: handleZoomFor(scene),
        draggable: true,
        resizable: true,
        rotatable: true,
        keepRatio: false,
        throttleDrag: 0,
        throttleResize: 0,
        throttleRotate: 0,
        origin: false,
        edge: false,
        // Prevent text selection from fighting drag/resize.
        preventClickEventOnDrag: true,
        hideDefaultLines: false,
        renderDirections: ["nw", "n", "ne", "w", "e", "sw", "s", "se"],
    });

    moveable.on("drag", ({ target: t, left, top }) => {
        (t as HTMLElement).style.left = `${left}px`;
        (t as HTMLElement).style.top = `${top}px`;
    });
    // End events also fire for a plain click; only a real gesture is an edit.
    moveable.on("dragEnd", ({ isDrag }) => {
        if (isDrag) syncTransformFromDom(target);
    });

    moveable.on("resize", ({ target: t, width, height, drag }) => {
        const el = t as HTMLElement;
        el.style.width = `${width}px`;
        el.style.height = `${height}px`;
        el.style.left = `${drag.left}px`;
        el.style.top = `${drag.top}px`;
        relayoutWidget(el, width, height);
    });
    moveable.on("resizeEnd", ({ isDrag }) => {
        if (isDrag) syncTransformFromDom(target);
    });

    moveable.on("rotate", ({ target: t, rotate }) => {
        (t as HTMLElement).style.transform = `rotate(${rotate}deg)`;
    });
    moveable.on("rotateEnd", ({ isDrag }) => {
        if (isDrag) syncTransformFromDom(target);
    });
}

function syncTransformFromDom(node: HTMLElement) {
    const el = selectedElement();
    if (!el || !project) return;
    pushUndo();
    el.x = parseFloat(node.style.left) || 0;
    el.y = parseFloat(node.style.top) || 0;
    el.width = parseFloat(node.style.width) || el.width;
    el.height = parseFloat(node.style.height) || el.height;
    const match = /rotate\((-?[\d.]+)deg\)/.exec(node.style.transform || "");
    el.rotation = match ? parseFloat(match[1]) : 0;
    setDirty(true);
    updateInspector();
}

function selectElement(id: string | null) {
    if (textEditingId && textEditingId !== id) {
        finishTextEdit();
    }

    const artboard = $("bgEditorArtboard");
    if (!artboard) return;

    // Re-attaching Moveable on every mousedown cancels the drag gesture.
    const alreadySelected = id !== null && id === selectedId && moveable !== null;
    if (id !== selectedId) pendingGestures.clear();
    selectedId = id;

    artboard.querySelectorAll(".bg-el.selected").forEach((n) => n.classList.remove("selected"));
    if (id) {
        const node = findElementNode(artboard, id);
        if (node) {
            node.classList.add("selected");
            if (!alreadySelected && textEditingId !== id) {
                attachMoveable(node);
            }
        }
    } else {
        destroyMoveable();
    }
    updateInspector();
}

function beginTextEdit(id: string) {
    if (!project) return;
    const el = project.elements.find((e) => e.id === id);
    if (!el || el.type !== "text") return;

    const artboard = $("bgEditorArtboard");
    const node = artboard && findElementNode(artboard, id);
    if (!node) return;

    if (textEditingId && textEditingId !== id) finishTextEdit();

    selectedId = id;
    artboard.querySelectorAll(".bg-el.selected").forEach((n) => n.classList.remove("selected"));
    node.classList.add("selected", "bg-el-editing");
    destroyMoveable();
    textEditingId = id;

    node.contentEditable = "true";
    node.style.cursor = "text";
    node.style.userSelect = "text";
    node.focus();

    const range = document.createRange();
    range.selectNodeContents(node);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            finishTextEdit();
            return;
        }
        // Keep typing / Enter line-breaks from hitting the editor shortcuts.
        e.stopPropagation();
    };
    const onBlur = () => finishTextEdit();

    node.addEventListener("keydown", onKeyDown);
    node.addEventListener("blur", onBlur);
    textEditCleanup = () => {
        node.removeEventListener("keydown", onKeyDown);
        node.removeEventListener("blur", onBlur);
    };

    updateInspector();
}

function finishTextEdit() {
    if (!textEditingId || !project) return;
    const id = textEditingId;
    const artboard = $("bgEditorArtboard");
    const node = artboard && findElementNode(artboard, id);
    const el = project.elements.find((e) => e.id === id);

    textEditCleanup?.();
    textEditCleanup = null;
    textEditingId = null;

    if (node) {
        node.contentEditable = "false";
        node.style.cursor = "move";
        node.style.userSelect = "none";
        node.classList.remove("bg-el-editing");

        if (el && el.type === "text") {
            const next = node.innerText.replace(/\u00a0/g, " ");
            if (next !== el.text) {
                pushUndo();
                el.text = next;
                setDirty(true);
            }
            // Normalize to plain text (strip any rich HTML from contentEditable).
            node.textContent = el.text;
        }
    }

    if (selectedId === id && node) {
        attachMoveable(node);
    }
    updateInspector();
}

function widgetCount(kind: WidgetKind): number {
    return project?.elements.filter((el) => el.type === "widget" && el.widget === kind).length ?? 0;
}

/** The last settings button can't go, or there'd be no way back into the editor. */
function isUndeletable(el: BgElement): boolean {
    return el.type === "widget" && !!WIDGET_INFO[el.widget].required && widgetCount(el.widget) <= 1;
}

async function addText() {
    if (!project) return;
    pushUndo();
    const el = createDefaultTextElement({ zIndex: nextZIndex() });
    project.elements.push(el);
    setDirty(true);
    await refreshEditorScene();
    selectElement(el.id);
}

function isGifFile(file: File): boolean {
    return file.type === "image/gif" || /\.gif$/i.test(file.name);
}

let mediaJobs = 0;

function trackMediaJob<T>(job: Promise<T>): Promise<T> {
    const status = $("bgEditorMediaStatus");
    mediaJobs++;
    if (status) status.hidden = false;
    return job.finally(() => {
        mediaJobs--;
        if (status && mediaJobs === 0) status.hidden = true;
    });
}

/** Stores the file (losslessly shrunk when possible) and returns its asset id, or null on failure. */
async function storeMediaAsset(file: File, type: "image" | "video"): Promise<string | null> {
    try {
        const mimeType =
            file.type || (await sniffMimeType(file)) || (type === "video" ? "video/mp4" : "image/png");
        const optimized = isOptimizable(mimeType)
            ? await trackMediaJob(optimizeMedia(file, mimeType))
            : null;
        return await storeAssetBlob(optimized ?? file, optimized?.type ?? mimeType, file.name);
    } catch (err) {
        console.error(err);
        alert(
            isQuotaError(err)
                ? "Not enough browser storage to add this file. Delete unused background projects or free up disk space, then try again."
                : "Couldn't add this file."
        );
        return null;
    }
}

async function addMediaFromFile(file: File, asVideo: boolean) {
    if (!project) return;
    const session = editorSession;
    const type: "image" | "video" = asVideo && !isGifFile(file) ? "video" : "image";
    const assetId = await storeMediaAsset(file, type);
    // The editor may have closed or switched projects while the file was being optimized.
    if (!assetId || !project || editorSession !== session) return;
    pushUndo();

    const el = createDefaultMediaElement(type, assetId, { zIndex: nextZIndex() });
    project.elements.push(el);
    setDirty(true);
    await refreshEditorScene();
    selectElement(el.id);
}

async function replaceSelectedMedia(file: File) {
    const selected = selectedElement();
    if (!selected || (selected.type !== "image" && selected.type !== "video")) return;
    const session = editorSession;
    const type: "image" | "video" =
        file.type.startsWith("video/") && !isGifFile(file) ? "video" : "image";
    const assetId = await storeMediaAsset(file, type);
    if (!assetId || !project || editorSession !== session) return;
    // Undo/redo replace the project with a copy, so look the element up again.
    const el = project.elements.find((e) => e.id === selected.id);
    if (!el || (el.type !== "image" && el.type !== "video")) return;
    pushUndo();
    el.assetId = assetId;
    el.type = type;
    setDirty(true);
    await refreshEditorScene();
    selectElement(el.id);
}

async function addWidget(kind: WidgetKind) {
    if (!project) return;
    if (textEditingId) finishTextEdit();
    pushUndo();
    const el = createDefaultWidget(kind, { zIndex: nextZIndex() });
    project.elements.push(el);
    setDirty(true);
    await refreshEditorScene();
    selectElement(el.id);
}

function populateWidgetMenu() {
    const menu = $("bgWidgetMenu");
    if (!menu || menu.childElementCount > 0) return;
    const groups = new Map<string, WidgetKind[]>();
    for (const kind of Object.keys(WIDGET_INFO) as WidgetKind[]) {
        const group = WIDGET_INFO[kind].group;
        groups.set(group, [...(groups.get(group) ?? []), kind]);
    }
    for (const [group, kinds] of groups) {
        const heading = document.createElement("p");
        heading.className = "bg-widget-menu-heading";
        heading.textContent = group;
        menu.appendChild(heading);
        for (const kind of kinds) {
            const item = document.createElement("button");
            item.type = "button";
            item.role = "menuitem";
            item.textContent = WIDGET_INFO[kind].name;
            item.addEventListener("click", () => {
                menu.setAttribute("hidden", "");
                void addWidget(kind);
            });
            menu.appendChild(item);
        }
    }
}

function toggleWidgetMenu() {
    const menu = $("bgWidgetMenu");
    const btn = $("bgAddWidgetBtn");
    const wrap = menu?.parentElement;
    if (!menu || !btn || !wrap) return;
    if (!menu.hasAttribute("hidden")) {
        menu.setAttribute("hidden", "");
        return;
    }
    menu.removeAttribute("hidden");
    const top = btn.getBoundingClientRect().top - wrap.getBoundingClientRect().top;
    menu.style.top = `${Math.max(8, Math.min(top, wrap.clientHeight - menu.offsetHeight - 8))}px`;
}

async function deleteSelected() {
    if (!project || !selectedId) return;
    const el = selectedElement();
    if (el && isUndeletable(el)) return;
    pushUndo();
    project.elements = project.elements.filter((el) => el.id !== selectedId);
    selectedId = null;
    setDirty(true);
    await refreshEditorScene();
}

async function clearCanvas() {
    if (!project) return;
    // Keep one of each required widget so the editor stays reachable.
    const seen = new Set<WidgetKind>();
    const keep = project.elements.filter((el) => {
        if (el.type !== "widget" || !WIDGET_INFO[el.widget].required || seen.has(el.widget)) return false;
        seen.add(el.widget);
        return true;
    });
    if (project.elements.length === keep.length) return;
    if (!confirm("Remove every element from this background? (The settings button stays. You can undo this.)")) return;
    if (textEditingId) finishTextEdit();
    pushUndo();
    project.elements = keep;
    selectedId = null;
    setDirty(true);
    await refreshEditorScene();
}

/** Swap the selected element with its neighbour in stacking order. */
async function moveLayer(direction: 1 | -1) {
    const el = selectedElement();
    if (!el || !project) return;
    const ordered = [...project.elements].sort((a, b) => a.zIndex - b.zIndex);
    const from = ordered.indexOf(el);
    const to = from + direction;
    if (to < 0 || to >= ordered.length) return;
    pushUndo();
    [ordered[from], ordered[to]] = [ordered[to], ordered[from]];
    ordered.forEach((item, index) => {
        item.zIndex = index + 1;
    });
    setDirty(true);
    await refreshEditorScene();
    selectElement(el.id);
}

async function undo() {
    if (!project || undoStack.length === 0) return;
    redoStack.push(JSON.stringify(project));
    project = JSON.parse(undoStack.pop()!) as BackgroundProject;
    pendingGestures.clear();
    selectedId = null;
    setDirty(true);
    await refreshEditorScene();
}

async function redo() {
    if (!project || redoStack.length === 0) return;
    undoStack.push(JSON.stringify(project));
    project = JSON.parse(redoStack.pop()!) as BackgroundProject;
    pendingGestures.clear();
    selectedId = null;
    setDirty(true);
    await refreshEditorScene();
}

async function saveCurrentProject() {
    if (!project) return;
    const nameInput = $("bgProjectName") as HTMLInputElement | null;
    if (nameInput?.value.trim()) project.name = nameInput.value.trim();
    await saveProject(project);
    requestPersistentStorage();
    setActiveProjectId(project.id);
    setDirty(false);
    await renderActiveBackground();
    await refreshProjectList();
}

async function closeEditor(apply: boolean) {
    if (!editorOpen) return;
    if (textEditingId) finishTextEdit();
    if (dirty && apply) {
        const ok = confirm("Save changes to this background project?");
        if (ok) await saveCurrentProject();
        else if (!confirm("Discard unsaved changes?")) return;
    } else if (dirty && !apply) {
        if (!confirm("Discard unsaved changes?")) return;
    } else if (apply && project) {
        setActiveProjectId(project.id);
        bumpActiveProjectRev();
        await renderActiveBackground();
    }

    destroyMoveable();
    editorOpen = false;
    // Otherwise artboard videos keep decoding behind the hidden overlay
    const artboard = $("bgEditorArtboard");
    if (artboard) clearScene(artboard);
    $("bgEditorOverlay")?.setAttribute("hidden", "");
    document.body.classList.remove("bg-editor-open");
    project = null;
    selectedId = null;
    undoStack = [];
    redoStack = [];
    setDirty(false);
    await endEditorSession();
    await releaseOrphanAssets();
}

/** Only safe when no unsaved editor state (including undo history) is held. */
async function releaseOrphanAssets() {
    try {
        revokeAssetUrls(await pruneOrphanAssets());
    } catch (err) {
        console.warn("Failed to clean up unused background media:", err);
    }
}

/** Shared by the settings menu and the editor top bar. */
function requestImport() {
    if (editorOpen && dirty && !confirm("Discard unsaved changes and import a project?")) return;
    ($("bgProjectImportInput") as HTMLInputElement | null)?.click();
}

export async function openBackgroundEditor(options?: {
    projectId?: string;
    fresh?: boolean;
    /** Caller already confirmed discarding unsaved changes. */
    discardConfirmed?: boolean;
}) {
    // The settings menu stays reachable above the editor, so this can replace an open project.
    if (editorOpen && dirty && !options?.discardConfirmed && !confirm("Discard unsaved changes?")) {
        return;
    }
    if (textEditingId) finishTextEdit();
    destroyMoveable();
    closeSettingsMenu();
    project = null;
    undoStack = [];
    redoStack = [];
    await endEditorSession();
    await releaseOrphanAssets();
    releaseEditorSession = await holdEditorSession();
    await ensureFontsLoaded();

    if (options?.fresh) {
        project = createEmptyProject();
        dirty = true;
    } else if (options?.projectId) {
        project = (await getProject(options.projectId)) ?? createEmptyProject();
        dirty = false;
    } else {
        const active = await getActiveProject();
        project = active
            ? (JSON.parse(JSON.stringify(active)) as BackgroundProject)
            : createEmptyProject();
        dirty = false;
    }

    undoStack = [];
    redoStack = [];
    pendingGestures.clear();
    selectedId = null;
    editorOpen = true;

    const nameInput = $("bgProjectName") as HTMLInputElement | null;
    if (nameInput) nameInput.value = project.name;

    $("bgEditorOverlay")?.removeAttribute("hidden");
    document.body.classList.add("bg-editor-open");
    layoutPanels();
    setDirty(dirty);
    await refreshEditorScene();
}

export function setupBackgroundEditor() {
    setupInspector({
        getProject: () => project,
        selectedElement,
        isUndeletable,
        pushUndo,
        pushUndoOnce,
        endUndoGesture,
        setDirty,
        refreshScene: refreshEditorScene,
        rerenderSelecting: async (id) => {
            await refreshEditorScene();
            selectElement(id);
        },
        findNode: (id) => {
            const artboard = $("bgEditorArtboard");
            return artboard && findElementNode(artboard, id);
        },
        replaceSelectedMedia,
    });
    setupSettingsMenu({
        isEditorOpen: () => editorOpen,
        editingProjectId: () => (editorOpen ? project?.id ?? null : null),
        openEditor: (options) => openBackgroundEditor(options),
        requestImport,
        releaseOrphanAssets,
    });

    const editorBody = document.querySelector<HTMLElement>(".bg-editor-body");
    if (editorBody) {
        layoutPanels = setupPanelResize(editorBody, () => {
            const artboard = $("bgEditorArtboard");
            if (!editorOpen || !artboard) return;
            refitScene(artboard);
            syncMoveableToViewport();
        });
    }

    window.addEventListener("resize", () => {
        if (!editorOpen) return;
        layoutPanels();
        // Wait a frame so the renderer's own resize handler has re-scaled the scene first.
        requestAnimationFrame(syncMoveableToViewport);
    });

    populateWidgetMenu();
    $("bgAddWidgetBtn")?.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleWidgetMenu();
    });
    document.addEventListener("click", (e) => {
        const menu = $("bgWidgetMenu");
        if (!menu || menu.hasAttribute("hidden")) return;
        if (!menu.contains(e.target as Node)) menu.setAttribute("hidden", "");
    });
    $("bgProjectImportInput")?.addEventListener("change", async (event) => {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        input.value = "";
        if (!file) return;
        try {
            const imported = await importProjectZip(file, { activate: true });
            await renderActiveBackground();
            closeSettingsMenu();
            if (editorOpen) {
                await openBackgroundEditor({ projectId: imported.id, discardConfirmed: true });
            } else {
                alert(`Imported “${imported.name}” and set it as the active background.`);
            }
        } catch (err) {
            console.error(err);
            alert(
                isQuotaError(err)
                    ? "Not enough browser storage to import this project. Delete unused background projects or free up disk space, then try again."
                    : err instanceof NewerProjectFormatError
                      ? err.message
                      : "Failed to import project. Make sure it is a .bgproj.zip file."
            );
        }
    });

    $("bgEditorImportBtn")?.addEventListener("click", () => requestImport());
    $("bgEditorClearBtn")?.addEventListener("click", () => clearCanvas());
    $("bgEditorCloseBtn")?.addEventListener("click", () => closeEditor(true));
    $("bgEditorCancelBtn")?.addEventListener("click", () => closeEditor(false));
    $("bgEditorSaveBtn")?.addEventListener("click", () => saveCurrentProject());
    $("bgEditorExportBtn")?.addEventListener("click", async () => {
        if (!project) return;
        // The ZIP is built from stored assets, so export saves first like the Save button.
        await saveCurrentProject();
        await downloadProjectZip(project);
    });

    $("bgAddTextBtn")?.addEventListener("click", () => addText());
    $("bgAddImageBtn")?.addEventListener("click", () => {
        ($("bgMediaImageInput") as HTMLInputElement | null)?.click();
    });
    $("bgAddVideoBtn")?.addEventListener("click", () => {
        ($("bgMediaVideoInput") as HTMLInputElement | null)?.click();
    });
    $("bgMediaImageInput")?.addEventListener("change", async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        (e.target as HTMLInputElement).value = "";
        if (file) await addMediaFromFile(file, false);
    });
    $("bgMediaVideoInput")?.addEventListener("change", async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        (e.target as HTMLInputElement).value = "";
        if (file) await addMediaFromFile(file, true);
    });

    $("bgDeleteBtn")?.addEventListener("click", () => deleteSelected());
    $("bgForwardBtn")?.addEventListener("click", () => moveLayer(1));
    $("bgBackBtn")?.addEventListener("click", () => moveLayer(-1));
    $("bgUndoBtn")?.addEventListener("click", () => undo());
    $("bgRedoBtn")?.addEventListener("click", () => redo());

    document.addEventListener("keydown", (e) => {
        if (!editorOpen) return;
        if (textEditingId) {
            if (e.key === "Escape") {
                e.preventDefault();
                finishTextEdit();
            }
            return;
        }
        // Form fields keep their own undo, delete and escape behaviour.
        const target = e.target as HTMLElement | null;
        if (target && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable)) {
            if (e.key === "Escape") target.blur();
            return;
        }
        const meta = e.metaKey || e.ctrlKey;
        if (meta && e.key === "z" && !e.shiftKey) {
            e.preventDefault();
            void undo();
        } else if (meta && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
            e.preventDefault();
            void redo();
        } else if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            void deleteSelected();
        } else if (e.key === "Escape") {
            void closeEditor(true);
        }
    });
}

export { renderActiveBackground };
