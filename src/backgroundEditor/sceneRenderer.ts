import {
    WIDGET_INFO,
    createEmptyProject,
    isHexColor,
    type BackgroundProject,
    type BgElement,
    type TextElement,
    type MediaElement,
    type WidgetElement,
} from "../types/backgroundProject.ts";
import { getActiveProject, getAsset } from "./projectStore.ts";
import { ensureFontsLoaded } from "./fonts.ts";
import { buildWidget, refreshWidgets } from "./widgets.ts";
import { mountWidgetAnimations } from "./widgetAnimations.ts";
import { isPopoutWindow } from "../windowLoaders/windowRole.ts";

const objectUrls = new Map<string, string>();

/** Release cached object URLs for assets that were deleted from storage. */
export function revokeAssetUrls(assetIds: Iterable<string>) {
    for (const id of assetIds) {
        const url = objectUrls.get(id);
        if (url) URL.revokeObjectURL(url);
        objectUrls.delete(id);
    }
}

async function resolveAssetUrl(assetId: string): Promise<string | null> {
    const cached = objectUrls.get(assetId);
    if (cached) return cached;
    const asset = await getAsset(assetId);
    if (!asset) return null;
    const url = URL.createObjectURL(asset.blob);
    objectUrls.set(assetId, url);
    return url;
}

function applyBaseStyles(node: HTMLElement, el: BgElement) {
    node.className = "bg-el";
    node.dataset.elId = el.id;
    node.style.position = "absolute";
    node.style.left = `${el.x}px`;
    node.style.top = `${el.y}px`;
    node.style.width = `${el.width}px`;
    node.style.height = `${el.height}px`;
    node.style.transform = `rotate(${el.rotation}deg)`;
    node.style.transformOrigin = "center center";
    node.style.zIndex = String(el.zIndex);
    node.style.opacity = String(el.opacity);
    node.style.boxSizing = "border-box";
    node.style.overflow = "hidden";
    node.style.userSelect = "none";
}

function renderTextElement(el: TextElement, editable: boolean): HTMLElement {
    const node = document.createElement("div");
    applyBaseStyles(node, el);
    node.classList.add("bg-el-text");
    node.style.display = "flex";
    node.style.alignItems = "center";
    node.style.justifyContent =
        el.align === "left" ? "flex-start" : el.align === "right" ? "flex-end" : "center";
    node.style.fontFamily = `"${el.fontFamily}", sans-serif`;
    node.style.fontSize = `${el.fontSize}px`;
    node.style.fontWeight = el.fontWeight;
    node.style.fontStyle = el.fontStyle;
    node.style.color = el.color;
    node.style.textAlign = el.align;
    node.style.whiteSpace = "pre-wrap";
    node.style.wordBreak = "break-word";
    node.style.lineHeight = "1.15";
    node.style.padding = "4px";
    node.style.outline = "none";
    node.textContent = el.text;
    if (editable) {
        node.contentEditable = "false";
        node.spellcheck = false;
        node.style.cursor = "move";
    }
    return node;
}

async function renderMediaElement(el: MediaElement): Promise<HTMLElement> {
    const wrapper = document.createElement("div");
    applyBaseStyles(wrapper, el);
    wrapper.classList.add(el.type === "video" ? "bg-el-video" : "bg-el-image");

    const url = await resolveAssetUrl(el.assetId);
    if (!url) {
        wrapper.style.background = "rgba(255,0,0,0.3)";
        wrapper.textContent = "Missing media";
        return wrapper;
    }

    if (el.type === "video") {
        const video = document.createElement("video");
        video.src = url;
        video.autoplay = true;
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.style.width = "100%";
        video.style.height = "100%";
        video.style.objectFit = el.objectFit;
        video.style.pointerEvents = "none";
        void video.play().catch(() => undefined);
        wrapper.appendChild(video);
    } else {
        const img = document.createElement("img");
        img.src = url;
        img.alt = "";
        img.draggable = false;
        img.style.width = "100%";
        img.style.height = "100%";
        img.style.objectFit = el.objectFit;
        img.style.pointerEvents = "none";
        wrapper.appendChild(img);
    }
    return wrapper;
}

function renderWidgetElement(el: WidgetElement, editable: boolean): HTMLElement {
    const node = document.createElement("div");
    applyBaseStyles(node, el);
    buildWidget(node, el, editable);
    if (editable) node.style.cursor = "move";
    return node;
}

export async function renderElementNode(el: BgElement, editable: boolean): Promise<HTMLElement> {
    if (el.type === "text") return renderTextElement(el, editable);
    if (el.type === "widget") return renderWidgetElement(el, editable);
    return renderMediaElement(el);
}

// Project files can be imported from anywhere; a free-form CSS background
// would let one load external url() images.
function safeCanvasFill(fill: string | undefined): string {
    return isHexColor(fill) ? fill : "#000000";
}

export type SceneFitMode = "cover" | "contain";

function fitSceneToViewport(
    scene: HTMLElement,
    project: BackgroundProject,
    host: HTMLElement,
    fit: SceneFitMode
) {
    const apply = () => {
        const hostW = host.clientWidth || window.innerWidth;
        const hostH = host.clientHeight || window.innerHeight;
        const scale =
            fit === "contain"
                ? Math.min(hostW / project.designWidth, hostH / project.designHeight)
                : Math.max(hostW / project.designWidth, hostH / project.designHeight);
        const offsetX = (hostW - project.designWidth * scale) / 2;
        const offsetY = (hostH - project.designHeight * scale) / 2;
        scene.style.width = `${project.designWidth}px`;
        scene.style.height = `${project.designHeight}px`;
        scene.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
        scene.style.transformOrigin = "top left";
        scene.dataset.scale = String(scale);
    };
    apply();
    return apply;
}

// Keyed per container: the live background and the editor artboard render independently.
const resizeHandlers = new WeakMap<HTMLElement, () => void>();
const renderGenerations = new WeakMap<HTMLElement, number>();

/** Invalidates any in-flight render into `container` and returns the new generation. */
function nextGeneration(container: HTMLElement): number {
    const generation = (renderGenerations.get(container) ?? 0) + 1;
    renderGenerations.set(container, generation);
    return generation;
}

function detachResizeHandler(container: HTMLElement) {
    const handler = resizeHandlers.get(container);
    if (handler) {
        window.removeEventListener("resize", handler);
        resizeHandlers.delete(container);
    }
}

/** Re-fits a rendered scene after its container changed size without a window resize. */
export function refitScene(container: HTMLElement): void {
    resizeHandlers.get(container)?.();
}

export function clearScene(container: HTMLElement): void {
    nextGeneration(container);
    detachResizeHandler(container);
    container.replaceChildren();
}

export type RenderSceneOptions = {
    container: HTMLElement;
    project: BackgroundProject;
    editable?: boolean;
    fit?: SceneFitMode;
    /** Elements rejected here are not rendered. */
    filter?: (el: BgElement) => boolean;
    onElementClick?: (id: string, event: MouseEvent) => void;
    onElementDblClick?: (id: string, event: MouseEvent) => void;
};

/** Resolves to null when a newer render into the same container superseded this one. */
export async function renderScene(options: RenderSceneOptions): Promise<HTMLElement | null> {
    const {
        container,
        project,
        editable = false,
        fit = "cover",
        filter,
        onElementClick,
        onElementDblClick,
    } = options;

    const generation = nextGeneration(container);

    const elements = filter ? project.elements.filter(filter) : project.elements;
    const fonts = elements.flatMap((el) =>
        el.type === "text"
            ? [el.fontFamily]
            : el.type === "widget"
              ? [el.fontFamily, el.danceFontFamily]
              : []
    );
    await ensureFontsLoaded(fonts.length ? fonts : undefined);

    const scene = document.createElement("div");
    scene.className = "bg-scene";
    scene.style.position = "absolute";
    scene.style.left = "0";
    scene.style.top = "0";
    scene.style.background = safeCanvasFill(project.canvas.fill);
    scene.style.overflow = "hidden";
    scene.style.willChange = "transform";

    const sorted = [...elements].sort((a, b) => a.zIndex - b.zIndex);
    for (const el of sorted) {
        const node = await renderElementNode(el, editable);
        if (editable) {
            if (el.type !== "text") node.style.cursor = "move";
            node.addEventListener("mousedown", (e) => {
                // Don't steal the gesture while inline-editing text.
                if ((e.target as HTMLElement).closest?.('[contenteditable="true"]')) return;
                e.stopPropagation();
                onElementClick?.(el.id, e);
            });
            node.addEventListener("dblclick", (e) => {
                e.stopPropagation();
                e.preventDefault();
                onElementDblClick?.(el.id, e);
            });
        }
        scene.appendChild(node);
        if (el.type === "widget") mountWidgetAnimations(node, el, editable);
    }

    if (renderGenerations.get(container) !== generation) return null;

    detachResizeHandler(container);
    container.replaceChildren(scene);
    // Playback updates that arrived while media was loading only reached attached widgets.
    refreshWidgets(scene);
    const applyFit = fitSceneToViewport(scene, project, container, fit);
    resizeHandlers.set(container, applyFit);
    window.addEventListener("resize", applyFit);

    return scene;
}

export async function renderActiveBackground(
    containerId = "backgroundContainer"
): Promise<void> {
    const container = document.getElementById(containerId);
    if (!container) return;

    const generation = nextGeneration(container);
    let project: BackgroundProject;
    try {
        project = (await getActiveProject()) ?? getFallbackProject();
    } catch (err) {
        // Every control, including the way into the editor, lives in the project.
        console.error("Couldn't load the saved background; showing the default layout:", err);
        project = getFallbackProject();
    }
    if (renderGenerations.get(container) !== generation) return;
    // Letterbox bars blend into the design instead of showing a different color.
    container.style.background = safeCanvasFill(project.canvas.fill);
    await renderScene({
        container,
        project,
        editable: false,
        // Contain keeps widgets near the edges on screen; the live page matches the editor exactly.
        fit: "contain",
        filter: isVisibleInThisWindow,
    });
}

let fallbackProject: BackgroundProject | null = null;

/** Default layout shown until the user saves a project of their own. */
function getFallbackProject(): BackgroundProject {
    fallbackProject ??= createEmptyProject("Default");
    return fallbackProject;
}

function isVisibleInThisWindow(el: BgElement): boolean {
    if (el.type !== "widget") return true;
    const showIn = WIDGET_INFO[el.widget].mainOnly ? "main" : el.showIn;
    if (showIn === "both") return true;
    return (showIn === "popout") === isPopoutWindow();
}

export function findElementNode(container: HTMLElement, id: string): HTMLElement | null {
    return container.querySelector(`[data-el-id="${id}"]`);
}
