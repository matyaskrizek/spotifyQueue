import type { BackgroundProject, BgElement, TextElement, MediaElement } from "../types/backgroundProject.ts";
import { getActiveProject, getAsset } from "./projectStore.ts";
import { ensureFontsLoaded } from "./fonts.ts";

const objectUrls = new Map<string, string>();

function revokeAllObjectUrls() {
    for (const url of objectUrls.values()) URL.revokeObjectURL(url);
    objectUrls.clear();
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

export async function renderElementNode(el: BgElement, editable: boolean): Promise<HTMLElement> {
    if (el.type === "text") return renderTextElement(el, editable);
    return renderMediaElement(el);
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

let resizeHandler: (() => void) | null = null;

export type RenderSceneOptions = {
    container: HTMLElement;
    project: BackgroundProject;
    editable?: boolean;
    fit?: SceneFitMode;
    onElementClick?: (id: string, event: MouseEvent) => void;
    onElementDblClick?: (id: string, event: MouseEvent) => void;
};

export async function renderScene(options: RenderSceneOptions): Promise<HTMLElement> {
    const {
        container,
        project,
        editable = false,
        fit = "cover",
        onElementClick,
        onElementDblClick,
    } = options;

    if (resizeHandler) {
        window.removeEventListener("resize", resizeHandler);
        resizeHandler = null;
    }

    // Keep object URLs across re-renders of the same session; revoke only when clearing to empty.
    container.innerHTML = "";

    const fonts = project.elements
        .filter((el): el is TextElement => el.type === "text")
        .map((el) => el.fontFamily);
    await ensureFontsLoaded(fonts.length ? fonts : undefined);

    const scene = document.createElement("div");
    scene.className = "bg-scene";
    scene.style.position = "absolute";
    scene.style.left = "0";
    scene.style.top = "0";
    scene.style.background = project.canvas.fill || "#000";
    scene.style.overflow = "hidden";
    scene.style.willChange = "transform";

    const sorted = [...project.elements].sort((a, b) => a.zIndex - b.zIndex);
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
    }

    container.appendChild(scene);
    const applyFit = fitSceneToViewport(scene, project, container, fit);
    resizeHandler = applyFit;
    window.addEventListener("resize", applyFit);

    return scene;
}

export async function renderActiveBackground(
    containerId = "backgroundContainer"
): Promise<void> {
    const container = document.getElementById(containerId);
    if (!container) return;

    const project = await getActiveProject();
    if (!project) {
        revokeAllObjectUrls();
        container.innerHTML = "";
        return;
    }
    await renderScene({ container, project, editable: false });
}

export function findElementNode(container: HTMLElement, id: string): HTMLElement | null {
    return container.querySelector(`[data-el-id="${id}"]`);
}
