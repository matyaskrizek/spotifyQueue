import Moveable from "moveable";
import {
    createDefaultMediaElement,
    createDefaultTextElement,
    createEmptyProject,
    type BackgroundProject,
    type BgElement,
    type MediaElement,
    type TextElement,
} from "../types/backgroundProject.ts";
import {
    bumpActiveProjectRev,
    getActiveProject,
    getProject,
    listProjects,
    saveAsset,
    saveProject,
    setActiveProjectId,
} from "./projectStore.ts";
import { downloadProjectZip, importProjectZip } from "./exportImport.ts";
import { CURATED_FONTS, ensureFontsLoaded } from "./fonts.ts";
import { findElementNode, renderActiveBackground, renderScene } from "./sceneRenderer.ts";

let project: BackgroundProject | null = null;
let selectedId: string | null = null;
let moveable: Moveable | null = null;
let dirty = false;
let undoStack: string[] = [];
let redoStack: string[] = [];
let editorOpen = false;
let textEditingId: string | null = null;
let textEditCleanup: (() => void) | null = null;

function $(id: string): HTMLElement | null {
    return document.getElementById(id);
}

function pushUndo() {
    if (!project) return;
    undoStack.push(JSON.stringify(project));
    if (undoStack.length > 50) undoStack.shift();
    redoStack = [];
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

function attachMoveable(target: HTMLElement) {
    destroyMoveable();
    const artboard = $("bgEditorArtboard");
    const scene = artboard?.querySelector(".bg-scene") as HTMLElement | null;
    if (!artboard || !scene || !project) return;

    // Host Moveable inside the scaled scene so handles share the same transform space.
    moveable = new Moveable(scene, {
        target,
        container: scene,
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
    moveable.on("dragEnd", () => syncTransformFromDom(target));

    moveable.on("resize", ({ target: t, width, height, drag }) => {
        const el = t as HTMLElement;
        el.style.width = `${width}px`;
        el.style.height = `${height}px`;
        el.style.left = `${drag.left}px`;
        el.style.top = `${drag.top}px`;
    });
    moveable.on("resizeEnd", () => syncTransformFromDom(target));

    moveable.on("rotate", ({ target: t, rotate }) => {
        (t as HTMLElement).style.transform = `rotate(${rotate}deg)`;
    });
    moveable.on("rotateEnd", () => syncTransformFromDom(target));
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
            setInputValue("bgInText", el.text);
        }
    }

    if (selectedId === id && node) {
        attachMoveable(node);
    }
    updateInspector();
}

function updateInspector() {
    const empty = $("bgInspectorEmpty");
    const common = $("bgInspectorCommon");
    const textPanel = $("bgInspectorText");
    const mediaPanel = $("bgInspectorMedia");
    const el = selectedElement();

    if (!el) {
        empty?.removeAttribute("hidden");
        common?.setAttribute("hidden", "");
        textPanel?.setAttribute("hidden", "");
        mediaPanel?.setAttribute("hidden", "");
        return;
    }

    empty?.setAttribute("hidden", "");
    common?.removeAttribute("hidden");

    setInputValue("bgInOpacity", String(el.opacity));
    setInputValue("bgInX", String(Math.round(el.x)));
    setInputValue("bgInY", String(Math.round(el.y)));
    setInputValue("bgInW", String(Math.round(el.width)));
    setInputValue("bgInH", String(Math.round(el.height)));
    setInputValue("bgInRot", String(Math.round(el.rotation)));

    if (el.type === "text") {
        textPanel?.removeAttribute("hidden");
        mediaPanel?.setAttribute("hidden", "");
        setInputValue("bgInText", el.text);
        setInputValue("bgInFontSize", String(el.fontSize));
        setInputValue("bgInColor", el.color);
        setSelectValue("bgInFont", el.fontFamily);
        setSelectValue("bgInWeight", el.fontWeight);
        setSelectValue("bgInAlign", el.align);
        const italic = $("bgInItalic") as HTMLInputElement | null;
        if (italic) italic.checked = el.fontStyle === "italic";
    } else {
        textPanel?.setAttribute("hidden", "");
        mediaPanel?.removeAttribute("hidden");
        setSelectValue("bgInObjectFit", el.objectFit);
    }
}

function setInputValue(id: string, value: string) {
    const el = $(id) as HTMLInputElement | HTMLTextAreaElement | null;
    if (el) el.value = value;
}

function setSelectValue(id: string, value: string) {
    const el = $(id) as HTMLSelectElement | null;
    if (el) el.value = value;
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

async function addMediaFromFile(file: File, asVideo: boolean) {
    if (!project) return;
    pushUndo();
    const assetId = crypto.randomUUID();
    const isGif = file.type === "image/gif" || /\.gif$/i.test(file.name);
    const type: "image" | "video" = asVideo && !isGif ? "video" : "image";

    await saveAsset({
        id: assetId,
        mimeType: file.type || (type === "video" ? "video/mp4" : "image/png"),
        blob: file,
        name: file.name,
    });

    const el = createDefaultMediaElement(type, assetId, { zIndex: nextZIndex() });
    project.elements.push(el);
    setDirty(true);
    await refreshEditorScene();
    selectElement(el.id);
}

async function deleteSelected() {
    if (!project || !selectedId) return;
    pushUndo();
    project.elements = project.elements.filter((el) => el.id !== selectedId);
    selectedId = null;
    setDirty(true);
    await refreshEditorScene();
}

async function nudgeZ(delta: number) {
    const el = selectedElement();
    if (!el || !project) return;
    pushUndo();
    el.zIndex += delta;
    setDirty(true);
    await refreshEditorScene();
    selectElement(el.id);
}

async function undo() {
    if (!project || undoStack.length === 0) return;
    redoStack.push(JSON.stringify(project));
    project = JSON.parse(undoStack.pop()!) as BackgroundProject;
    selectedId = null;
    setDirty(true);
    await refreshEditorScene();
}

async function redo() {
    if (!project || redoStack.length === 0) return;
    undoStack.push(JSON.stringify(project));
    project = JSON.parse(redoStack.pop()!) as BackgroundProject;
    selectedId = null;
    setDirty(true);
    await refreshEditorScene();
}

async function saveCurrentProject() {
    if (!project) return;
    const nameInput = $("bgProjectName") as HTMLInputElement | null;
    if (nameInput?.value.trim()) project.name = nameInput.value.trim();
    await saveProject(project);
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
    $("bgEditorOverlay")?.setAttribute("hidden", "");
    document.body.classList.remove("bg-editor-open");
    project = null;
    selectedId = null;
    undoStack = [];
    redoStack = [];
    setDirty(false);
}

export async function openBackgroundEditor(options?: {
    projectId?: string;
    fresh?: boolean;
}) {
    await ensureFontsLoaded();
    closeSettingsMenu();

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
    selectedId = null;
    editorOpen = true;

    const nameInput = $("bgProjectName") as HTMLInputElement | null;
    if (nameInput) nameInput.value = project.name;

    $("bgEditorOverlay")?.removeAttribute("hidden");
    document.body.classList.add("bg-editor-open");
    setDirty(dirty);
    await refreshEditorScene();
}

function closeSettingsMenu() {
    $("bgSettingsMenu")?.setAttribute("hidden", "");
}

function toggleSettingsMenu() {
    const menu = $("bgSettingsMenu");
    if (!menu) return;
    if (menu.hasAttribute("hidden")) {
        menu.removeAttribute("hidden");
        void refreshProjectList();
    } else {
        menu.setAttribute("hidden", "");
    }
}

async function refreshProjectList() {
    const list = $("bgSettingsProjectList");
    if (!list) return;
    const projects = await listProjects();
    const activeId = (await getActiveProject())?.id;
    list.innerHTML = "";

    if (projects.length === 0) {
        const empty = document.createElement("p");
        empty.className = "bg-settings-empty";
        empty.textContent = "No saved projects yet.";
        list.appendChild(empty);
        return;
    }

    for (const p of projects) {
        const row = document.createElement("div");
        row.className = "bg-settings-project-row";
        if (p.id === activeId) row.classList.add("active");

        const label = document.createElement("button");
        label.type = "button";
        label.className = "bg-settings-project-name";
        label.textContent = p.name + (p.id === activeId ? " (active)" : "");
        label.addEventListener("click", async () => {
            setActiveProjectId(p.id);
            await renderActiveBackground();
            await refreshProjectList();
        });

        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "bg-settings-mini-btn";
        editBtn.textContent = "Edit";
        editBtn.addEventListener("click", () => openBackgroundEditor({ projectId: p.id }));

        row.append(label, editBtn);
        list.appendChild(row);
    }
}

function wireInspector() {
    const bindNumber = (id: string, apply: (el: BgElement, v: number) => void) => {
        $(id)?.addEventListener("change", async () => {
            const el = selectedElement();
            const input = $(id) as HTMLInputElement;
            if (!el || !input) return;
            pushUndo();
            apply(el, Number(input.value));
            setDirty(true);
            await refreshEditorScene();
            selectElement(el.id);
        });
    };

    bindNumber("bgInOpacity", (el, v) => {
        el.opacity = Math.min(1, Math.max(0, v));
    });
    bindNumber("bgInX", (el, v) => {
        el.x = v;
    });
    bindNumber("bgInY", (el, v) => {
        el.y = v;
    });
    bindNumber("bgInW", (el, v) => {
        el.width = Math.max(8, v);
    });
    bindNumber("bgInH", (el, v) => {
        el.height = Math.max(8, v);
    });
    bindNumber("bgInRot", (el, v) => {
        el.rotation = v;
    });

    $("bgInText")?.addEventListener("input", () => {
        const el = selectedElement() as TextElement | null;
        const input = $("bgInText") as HTMLTextAreaElement | null;
        if (!el || el.type !== "text" || !input) return;
        // Don't push undo on every keystroke; mark dirty and update live DOM
        el.text = input.value;
        setDirty(true);
        const artboard = $("bgEditorArtboard");
        const node = artboard && findElementNode(artboard, el.id);
        if (node) node.textContent = el.text;
    });

    $("bgInText")?.addEventListener("change", () => {
        if (selectedElement()?.type === "text") pushUndo();
    });

    const bindTextSelect = (id: string, key: keyof TextElement) => {
        $(id)?.addEventListener("change", async () => {
            const el = selectedElement() as TextElement | null;
            const input = $(id) as HTMLSelectElement | HTMLInputElement;
            if (!el || el.type !== "text") return;
            pushUndo();
            (el as unknown as Record<string, string>)[key as string] = input.value;
            if (key === "fontFamily") await ensureFontsLoaded([input.value]);
            setDirty(true);
            await refreshEditorScene();
            selectElement(el.id);
        });
    };

    bindTextSelect("bgInFont", "fontFamily");
    bindTextSelect("bgInWeight", "fontWeight");
    bindTextSelect("bgInAlign", "align");

    $("bgInFontSize")?.addEventListener("change", async () => {
        const el = selectedElement() as TextElement | null;
        const input = $("bgInFontSize") as HTMLInputElement;
        if (!el || el.type !== "text") return;
        pushUndo();
        el.fontSize = Number(input.value);
        setDirty(true);
        await refreshEditorScene();
        selectElement(el.id);
    });

    $("bgInColor")?.addEventListener("input", async () => {
        const el = selectedElement() as TextElement | null;
        const input = $("bgInColor") as HTMLInputElement;
        if (!el || el.type !== "text") return;
        el.color = input.value;
        setDirty(true);
        const artboard = $("bgEditorArtboard");
        const node = artboard && findElementNode(artboard, el.id);
        if (node) node.style.color = el.color;
    });

    $("bgInItalic")?.addEventListener("change", async () => {
        const el = selectedElement() as TextElement | null;
        const input = $("bgInItalic") as HTMLInputElement;
        if (!el || el.type !== "text") return;
        pushUndo();
        el.fontStyle = input.checked ? "italic" : "normal";
        setDirty(true);
        await refreshEditorScene();
        selectElement(el.id);
    });

    $("bgInObjectFit")?.addEventListener("change", async () => {
        const el = selectedElement() as MediaElement | null;
        const input = $("bgInObjectFit") as HTMLSelectElement;
        if (!el || (el.type !== "image" && el.type !== "video")) return;
        pushUndo();
        el.objectFit = input.value as MediaElement["objectFit"];
        setDirty(true);
        await refreshEditorScene();
        selectElement(el.id);
    });
}

function populateFontSelect() {
    const select = $("bgInFont") as HTMLSelectElement | null;
    if (!select || select.options.length > 0) return;
    for (const font of CURATED_FONTS) {
        const opt = document.createElement("option");
        opt.value = font;
        opt.textContent = font;
        opt.style.fontFamily = font;
        select.appendChild(opt);
    }
}

export function setupBackgroundEditor() {
    populateFontSelect();
    wireInspector();

    $("bgSettingsBtn")?.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleSettingsMenu();
    });

    document.addEventListener("click", (e) => {
        const menu = $("bgSettingsMenu");
        const btn = $("bgSettingsBtn");
        if (!menu || menu.hasAttribute("hidden")) return;
        const t = e.target as Node;
        if (menu.contains(t) || btn?.contains(t)) return;
        closeSettingsMenu();
    });

    $("bgSettingsEditBtn")?.addEventListener("click", () => openBackgroundEditor());
    $("bgSettingsNewBtn")?.addEventListener("click", () => openBackgroundEditor({ fresh: true }));

    $("bgSettingsImportBtn")?.addEventListener("click", () => {
        ($("bgProjectImportInput") as HTMLInputElement | null)?.click();
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
            alert(`Imported “${imported.name}” and set it as the active background.`);
        } catch (err) {
            console.error(err);
            alert("Failed to import project. Make sure it is a .bgproj.zip file.");
        }
    });

    $("bgEditorCloseBtn")?.addEventListener("click", () => closeEditor(true));
    $("bgEditorCancelBtn")?.addEventListener("click", () => closeEditor(false));
    $("bgEditorSaveBtn")?.addEventListener("click", () => saveCurrentProject());
    $("bgEditorExportBtn")?.addEventListener("click", async () => {
        if (!project) return;
        const nameInput = $("bgProjectName") as HTMLInputElement | null;
        if (nameInput?.value.trim()) project.name = nameInput.value.trim();
        await saveProject(project);
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
    $("bgForwardBtn")?.addEventListener("click", () => nudgeZ(1));
    $("bgBackBtn")?.addEventListener("click", () => nudgeZ(-1));
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
        const meta = e.metaKey || e.ctrlKey;
        if (meta && e.key === "z" && !e.shiftKey) {
            e.preventDefault();
            void undo();
        } else if (meta && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
            e.preventDefault();
            void redo();
        } else if (e.key === "Delete" || e.key === "Backspace") {
            const tag = (e.target as HTMLElement)?.tagName;
            if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) {
                return;
            }
            e.preventDefault();
            void deleteSelected();
        } else if (e.key === "Escape") {
            void closeEditor(true);
        }
    });
}

export { renderActiveBackground };
