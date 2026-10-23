import {
    WIDGET_INFO,
    type BackgroundProject,
    type BgElement,
    type MediaElement,
    type TextElement,
    type WidgetElement,
    type WidgetFieldGroup,
} from "../types/backgroundProject.ts";
import { renderAnimationInspector, type AnimationInspectorHandlers } from "./animationInspector.ts";
import { previewWidgetAnimations } from "./widgetAnimations.ts";
import { CURATED_FONTS, ensureFontsLoaded } from "./fonts.ts";

/** What the inspector panel needs from the editor. */
export type InspectorHost = {
    getProject(): BackgroundProject | null;
    selectedElement(): BgElement | null;
    isUndeletable(el: BgElement): boolean;
    pushUndo(): void;
    /** One undo snapshot per continuous edit (typing, dragging a colour picker). */
    pushUndoOnce(gesture: string): void;
    endUndoGesture(gesture: string): void;
    setDirty(dirty: boolean): void;
    refreshScene(): Promise<void>;
    /** Re-renders the artboard and keeps `id` selected. */
    rerenderSelecting(id: string): Promise<void>;
    findNode(id: string): HTMLElement | null;
    replaceSelectedMedia(file: File): Promise<void>;
};

/** Used until `setupInspector` runs: nothing is selected and edits go nowhere. */
const DETACHED_HOST: InspectorHost = {
    getProject: () => null,
    selectedElement: () => null,
    isUndeletable: () => false,
    pushUndo: () => {},
    pushUndoOnce: () => {},
    endUndoGesture: () => {},
    setDirty: () => {},
    refreshScene: async () => {},
    rerenderSelecting: async () => {},
    findNode: () => null,
    replaceSelectedMedia: async () => {},
};

let host: InspectorHost = DETACHED_HOST;

function $(id: string): HTMLElement | null {
    return document.getElementById(id);
}

function widgetHasField(el: WidgetElement, group: WidgetFieldGroup): boolean {
    return WIDGET_INFO[el.widget].fields.includes(group);
}

/** The selected element if it has font settings (a text element or a widget with text). */
function styledElement(): TextElement | WidgetElement | null {
    const el = host.selectedElement();
    if (el?.type === "text") return el;
    if (el?.type === "widget" && widgetHasField(el, "text")) return el;
    return null;
}

function selectedWidget(): WidgetElement | null {
    const el = host.selectedElement();
    return el?.type === "widget" ? el : null;
}

function setShown(id: string, shown: boolean) {
    const node = $(id);
    if (node) node.hidden = !shown;
}

function setInputValue(id: string, value: string) {
    const el = $(id) as HTMLInputElement | HTMLTextAreaElement | null;
    if (el) el.value = value;
}

function setSelectValue(id: string, value: string) {
    const el = $(id) as HTMLSelectElement | null;
    if (el) el.value = value;
}

function updateWidgetInspector(el: WidgetElement) {
    const info = WIDGET_INFO[el.widget];
    const panel = $("bgInspectorWidget");
    panel?.querySelectorAll<HTMLElement>("[data-wgroup]").forEach((group) => {
        group.hidden = !widgetHasField(el, group.dataset.wgroup as WidgetFieldGroup);
    });

    const name = $("bgInWidgetName");
    if (name) name.textContent = info.name;

    const hints: string[] = [];
    if (host.isUndeletable(el)) hints.push("This is how you get back to the editor, so it can't be deleted.");
    if (info.mainOnly) hints.push("Only shown in the main window.");
    const hint = $("bgInWidgetHint");
    if (hint) {
        hint.textContent = hints.join(" ");
        hint.hidden = hints.length === 0;
    }

    const caption = $("bgInLabelCaption");
    if (caption) caption.textContent = el.widget === "qrCode" ? "Caption" : "Label";
    setInputValue("bgInLabel", el.label);

    const hasBackground = /^#[0-9a-f]{6}$/i.test(el.background);
    if (hasBackground) setInputValue("bgInWBackground", el.background);
    const noBackground = $("bgInWNoBackground") as HTMLInputElement | null;
    if (noBackground) noBackground.checked = !hasBackground;

    setInputValue("bgInWRadius", String(el.borderRadius));
    setInputValue("bgInWCount", String(el.itemCount));
    setSelectValue("bgInWLayout", el.layout);
    const setChecked = (id: string, checked: boolean) => {
        const input = $(id) as HTMLInputElement | null;
        if (input) input.checked = checked;
    };
    setChecked("bgInWShowArt", el.showAlbumArt);
    setChecked("bgInWShowSong", el.showSongTitle);
    setChecked("bgInWShowDance", el.showDanceTitle);
    setSelectValue("bgInWTextPosition", el.textPosition);
    setSelectValue("bgInDanceFont", el.danceFontFamily);
    setInputValue("bgInDanceFontSize", String(el.danceFontSize));
    setSelectValue("bgInDanceWeight", el.danceFontWeight);
    if (/^#[0-9a-f]{6}$/i.test(el.danceColor)) setInputValue("bgInDanceColor", el.danceColor);
    setChecked("bgInDanceItalic", el.danceFontStyle === "italic");

    const showIn = $("bgInWShowIn") as HTMLSelectElement | null;
    if (showIn) {
        showIn.value = info.mainOnly ? "main" : el.showIn;
        showIn.disabled = !!info.mainOnly;
    }
    const autoHide = $("bgInWAutoHide") as HTMLInputElement | null;
    if (autoHide) autoHide.checked = el.autoHide;

    const animations = $("bgInWAnimations");
    if (animations) renderAnimationInspector(animations, el, animationHandlers);
}

const animationHandlers: AnimationInspectorHandlers = {
    edit: async (apply) => {
        const el = selectedWidget();
        if (!el) return;
        host.pushUndo();
        apply(el);
        host.setDirty(true);
        await host.rerenderSelecting(el.id);
    },
    preview: () => {
        const el = host.selectedElement();
        const node = el ? host.findNode(el.id) : null;
        if (node) previewWidgetAnimations(node);
    },
};

/** Shows the panels and values for the current selection (or the canvas when nothing is selected). */
export function updateInspector() {
    const empty = $("bgInspectorEmpty");
    const common = $("bgInspectorCommon");
    const textPanel = $("bgInspectorText");
    const mediaPanel = $("bgInspectorMedia");
    const widgetPanel = $("bgInspectorWidget");
    const el = host.selectedElement();

    const deleteBtn = $("bgDeleteBtn") as HTMLButtonElement | null;
    if (deleteBtn) deleteBtn.disabled = !el || host.isUndeletable(el);

    if (!el) {
        empty?.removeAttribute("hidden");
        common?.setAttribute("hidden", "");
        textPanel?.setAttribute("hidden", "");
        mediaPanel?.setAttribute("hidden", "");
        widgetPanel?.setAttribute("hidden", "");
        setShown("bgInspectorDanceText", false);
        // <input type="color"> only accepts #rrggbb
        const project = host.getProject();
        if (project && /^#[0-9a-f]{6}$/i.test(project.canvas.fill)) {
            setInputValue("bgInCanvasFill", project.canvas.fill);
        }
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

    widgetPanel?.toggleAttribute("hidden", el.type !== "widget");
    if (el.type === "widget") updateWidgetInspector(el);
    const hasDanceText = el.type === "widget" && widgetHasField(el, "danceText");
    setShown("bgInspectorDanceText", hasDanceText);
    setShown("bgInTextHeading", hasDanceText);

    const styled = styledElement();
    textPanel?.toggleAttribute("hidden", !styled);
    if (styled) {
        setShown("bgInTextRow", styled.type === "text");
        setShown("bgInAlignRow", styled.type === "text" || widgetHasField(styled, "align"));
        setShown("bgInShadowRow", styled.type === "widget");
        if (styled.type === "text") setInputValue("bgInText", styled.text);
        setInputValue("bgInFontSize", String(styled.fontSize));
        setInputValue("bgInColor", styled.color);
        setSelectValue("bgInFont", styled.fontFamily);
        setSelectValue("bgInWeight", styled.fontWeight);
        setSelectValue("bgInAlign", styled.align);
        const italic = $("bgInItalic") as HTMLInputElement | null;
        if (italic) italic.checked = styled.fontStyle === "italic";
        const shadow = $("bgInShadow") as HTMLInputElement | null;
        if (shadow && styled.type === "widget") shadow.checked = styled.textShadow;
    }

    mediaPanel?.toggleAttribute("hidden", el.type !== "image" && el.type !== "video");
    if (el.type === "image" || el.type === "video") {
        setSelectValue("bgInObjectFit", el.objectFit);
    }
}

function wireInspector() {
    const bindNumber = (id: string, apply: (el: BgElement, v: number) => void) => {
        $(id)?.addEventListener("change", async () => {
            const el = host.selectedElement();
            const input = $(id) as HTMLInputElement;
            if (!el || !input) return;
            host.pushUndo();
            apply(el, Number(input.value));
            host.setDirty(true);
            await host.rerenderSelecting(el.id);
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
        const el = host.selectedElement() as TextElement | null;
        const input = $("bgInText") as HTMLTextAreaElement | null;
        if (!el || el.type !== "text" || !input) return;
        host.pushUndoOnce("text");
        el.text = input.value;
        host.setDirty(true);
        const node = host.findNode(el.id);
        if (node) node.textContent = el.text;
    });

    // `change` doesn't fire if the text was typed and then reverted, so also end on blur.
    $("bgInText")?.addEventListener("change", () => host.endUndoGesture("text"));
    $("bgInText")?.addEventListener("blur", () => host.endUndoGesture("text"));

    const bindTextSelect = (id: string, key: "fontFamily" | "fontWeight" | "align") => {
        $(id)?.addEventListener("change", async () => {
            const el = styledElement();
            const input = $(id) as HTMLSelectElement | HTMLInputElement;
            if (!el) return;
            host.pushUndo();
            (el as unknown as Record<string, string>)[key as string] = input.value;
            if (key === "fontFamily") await ensureFontsLoaded([input.value]);
            host.setDirty(true);
            await host.rerenderSelecting(el.id);
        });
    };

    bindTextSelect("bgInFont", "fontFamily");
    bindTextSelect("bgInWeight", "fontWeight");
    bindTextSelect("bgInAlign", "align");

    $("bgInFontSize")?.addEventListener("change", async () => {
        const el = styledElement();
        const input = $("bgInFontSize") as HTMLInputElement;
        if (!el) return;
        host.pushUndo();
        el.fontSize = Math.max(8, Number(input.value) || el.fontSize);
        host.setDirty(true);
        await host.rerenderSelecting(el.id);
    });

    $("bgInColor")?.addEventListener("input", async () => {
        const el = styledElement();
        const input = $("bgInColor") as HTMLInputElement;
        if (!el) return;
        host.pushUndoOnce("color");
        el.color = input.value;
        host.setDirty(true);
        const node = host.findNode(el.id);
        if (node) node.style.color = el.color;
    });
    $("bgInColor")?.addEventListener("change", () => host.endUndoGesture("color"));
    $("bgInColor")?.addEventListener("blur", () => host.endUndoGesture("color"));

    $("bgInCanvasFill")?.addEventListener("input", () => {
        const input = $("bgInCanvasFill") as HTMLInputElement;
        const project = host.getProject();
        if (!project) return;
        host.pushUndoOnce("canvasFill");
        project.canvas.fill = input.value;
        host.setDirty(true);
        const scene = $("bgEditorArtboard")?.querySelector(".bg-scene") as HTMLElement | null;
        if (scene) scene.style.background = input.value;
    });
    $("bgInCanvasFill")?.addEventListener("change", () => host.endUndoGesture("canvasFill"));
    $("bgInCanvasFill")?.addEventListener("blur", () => host.endUndoGesture("canvasFill"));

    $("bgInReplaceMedia")?.addEventListener("click", () => {
        ($("bgMediaReplaceInput") as HTMLInputElement | null)?.click();
    });
    $("bgMediaReplaceInput")?.addEventListener("change", async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        (e.target as HTMLInputElement).value = "";
        if (file) await host.replaceSelectedMedia(file);
    });

    $("bgInItalic")?.addEventListener("change", async () => {
        const el = styledElement();
        const input = $("bgInItalic") as HTMLInputElement;
        if (!el) return;
        host.pushUndo();
        el.fontStyle = input.checked ? "italic" : "normal";
        host.setDirty(true);
        await host.rerenderSelecting(el.id);
    });

    const bindWidget = (
        id: string,
        apply: (el: WidgetElement, input: HTMLInputElement & HTMLSelectElement) => void
    ) => {
        $(id)?.addEventListener("change", async () => {
            const el = selectedWidget();
            const input = $(id) as HTMLInputElement & HTMLSelectElement;
            if (!el || !input) return;
            host.pushUndo();
            apply(el, input);
            host.setDirty(true);
            await host.rerenderSelecting(el.id);
        });
    };

    bindWidget("bgInShadow", (el, input) => {
        el.textShadow = input.checked;
    });
    bindWidget("bgInWBackground", (el, input) => {
        el.background = input.value;
    });
    bindWidget("bgInWNoBackground", (el, input) => {
        const picked = ($("bgInWBackground") as HTMLInputElement | null)?.value || "#333333";
        el.background = input.checked ? "transparent" : picked;
    });
    bindWidget("bgInWRadius", (el, input) => {
        el.borderRadius = Math.max(0, Number(input.value) || 0);
    });
    bindWidget("bgInWCount", (el, input) => {
        el.itemCount = Math.min(10, Math.max(1, Math.round(Number(input.value)) || 1));
    });
    bindWidget("bgInWLayout", (el, input) => {
        el.layout = input.value === "horizontal" || input.value === "vertical" ? input.value : "auto";
    });
    bindWidget("bgInWShowArt", (el, input) => {
        el.showAlbumArt = input.checked;
    });
    bindWidget("bgInWShowSong", (el, input) => {
        el.showSongTitle = input.checked;
    });
    bindWidget("bgInWShowDance", (el, input) => {
        el.showDanceTitle = input.checked;
    });
    bindWidget("bgInWTextPosition", (el, input) => {
        el.textPosition = input.value as WidgetElement["textPosition"];
    });
    bindWidget("bgInDanceFont", (el, input) => {
        el.danceFontFamily = input.value;
    });
    bindWidget("bgInDanceFontSize", (el, input) => {
        el.danceFontSize = Math.max(8, Number(input.value) || el.danceFontSize);
    });
    bindWidget("bgInDanceWeight", (el, input) => {
        el.danceFontWeight = input.value;
    });
    bindWidget("bgInDanceColor", (el, input) => {
        el.danceColor = input.value;
    });
    bindWidget("bgInDanceItalic", (el, input) => {
        el.danceFontStyle = input.checked ? "italic" : "normal";
    });
    bindWidget("bgInWShowIn", (el, input) => {
        el.showIn = input.value as WidgetElement["showIn"];
    });
    bindWidget("bgInWAutoHide", (el, input) => {
        el.autoHide = input.checked;
    });

    // Typing re-renders the widget live; one undo step per edit, like the text box.
    $("bgInLabel")?.addEventListener("input", async () => {
        const el = selectedWidget();
        const input = $("bgInLabel") as HTMLInputElement | null;
        if (!el || !input) return;
        host.pushUndoOnce("label");
        el.label = input.value;
        host.setDirty(true);
        await host.refreshScene();
    });
    $("bgInLabel")?.addEventListener("change", () => host.endUndoGesture("label"));
    $("bgInLabel")?.addEventListener("blur", () => host.endUndoGesture("label"));

    $("bgInObjectFit")?.addEventListener("change", async () => {
        const el = host.selectedElement() as MediaElement | null;
        const input = $("bgInObjectFit") as HTMLSelectElement;
        if (!el || (el.type !== "image" && el.type !== "video")) return;
        host.pushUndo();
        el.objectFit = input.value as MediaElement["objectFit"];
        host.setDirty(true);
        await host.rerenderSelecting(el.id);
    });
}

function populateFontSelect() {
    for (const id of ["bgInFont", "bgInDanceFont"]) {
        const select = $(id) as HTMLSelectElement | null;
        if (!select || select.options.length > 0) continue;
        for (const font of CURATED_FONTS) {
            const opt = document.createElement("option");
            opt.value = font;
            opt.textContent = font;
            opt.style.fontFamily = font;
            select.appendChild(opt);
        }
    }
}

export function setupInspector(inspectorHost: InspectorHost) {
    host = inspectorHost;
    populateFontSelect();
    wireInspector();
}
