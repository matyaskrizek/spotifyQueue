import { sanitizeAnimations, type WidgetAnimation } from "./widgetAnimation.ts";

export type BgElementType = "image" | "text" | "video" | "widget";

export type BgElementBase = {
    id: string;
    type: BgElementType;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    zIndex: number;
    opacity: number;
};

export type TextElement = BgElementBase & {
    type: "text";
    text: string;
    fontFamily: string;
    fontSize: number;
    fontWeight: string;
    fontStyle: "normal" | "italic";
    color: string;
    align: "left" | "center" | "right";
};

export type MediaElement = BgElementBase & {
    type: "image" | "video";
    assetId: string;
    objectFit: "cover" | "contain" | "fill";
};

export type WidgetKind =
    | "currentlyPlaying"
    | "upNext"
    | "qrCode"
    | "profile"
    | "settingsButton"
    | "popoutButton"
    | "fullscreenButton"
    | "partnerDanceButton"
    | "hideQueueButton"
    | "refreshButton"
    | "setDanceButton";

export type WidgetVisibility = "main" | "popout" | "both";

/** Inspector field groups a widget kind supports. */
export type WidgetFieldGroup =
    | "label"
    | "text"
    | "align"
    | "background"
    | "radius"
    | "count"
    | "layout"
    | "nowPlaying"
    | "textPosition"
    | "danceText"
    | "visibility";

export type TextPosition = "auto" | "below" | "above" | "left" | "right";

/** A live element (now playing, queue, control button) placed like any other element. */
export type WidgetElement = BgElementBase & {
    type: "widget";
    widget: WidgetKind;
    /** Button text, or the QR code caption. */
    label: string;
    fontFamily: string;
    fontSize: number;
    fontWeight: string;
    fontStyle: "normal" | "italic";
    color: string;
    align: "left" | "center" | "right";
    textShadow: boolean;
    /** "#rrggbb" or "transparent". */
    background: string;
    borderRadius: number;
    showIn: WidgetVisibility;
    /** Fade out until the mouse moves (like the old fullscreen button). */
    autoHide: boolean;
    itemCount: number;
    /**
     * Up Next stacking direction. "auto" picks whichever direction gives the
     * largest artwork for the widget's size.
     */
    layout: "auto" | "vertical" | "horizontal";
    /** Currently Playing parts. The song title uses the main font fields. */
    showAlbumArt: boolean;
    showSongTitle: boolean;
    showDanceTitle: boolean;
    /** Where the titles sit relative to the album art; "auto" follows the widget's shape. */
    textPosition: TextPosition;
    danceFontFamily: string;
    danceFontSize: number;
    danceFontWeight: string;
    danceFontStyle: "normal" | "italic";
    danceColor: string;
    animations: WidgetAnimation[];
};

export type BgElement = TextElement | MediaElement | WidgetElement;

export type BackgroundProject = {
    id: string;
    name: string;
    version: 1 | 2;
    designWidth: number;
    designHeight: number;
    canvas: { fill: string };
    elements: BgElement[];
    updatedAt: number;
};

export type BgAsset = {
    id: string;
    mimeType: string;
    blob: Blob;
    name: string;
};

export const DESIGN_WIDTH = 1920;
export const DESIGN_HEIGHT = 1080;

export const ACTIVE_PROJECT_ID_KEY = "activeBackgroundProjectId";
export const ACTIVE_PROJECT_REV_KEY = "activeBackgroundProjectRev";
export const LEGACY_BG_IMG_KEY = "customBackgroundImage";

export const PROJECT_VERSION = 2;

export function isHexColor(value: unknown): value is string {
    return typeof value === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value);
}

type WidgetInfo = {
    name: string;
    group: "Now Playing" | "Queue" | "Controls";
    fields: WidgetFieldGroup[];
    /** Only works in the main window (needs the editor or owns logging). */
    mainOnly?: boolean;
    /** At least one must exist, otherwise the editor becomes unreachable. */
    required?: boolean;
    defaults: Partial<WidgetElement>;
};

const BUTTON_FIELDS: WidgetFieldGroup[] = ["label", "text", "align", "background", "radius", "visibility"];
export const WIDGET_INFO: Record<WidgetKind, WidgetInfo> = {
    currentlyPlaying: {
        name: "Currently Playing",
        group: "Now Playing",
        fields: ["nowPlaying", "textPosition", "text", "align", "danceText", "background", "radius"],
        defaults: { width: 1000, height: 620, fontSize: 54, danceFontSize: 54, borderRadius: 12 },
    },
    upNext: {
        name: "Up Next (Queue)",
        group: "Queue",
        fields: ["count", "layout", "text", "background", "radius"],
        defaults: { width: 200, height: 760, fontSize: 18, borderRadius: 10, itemCount: 3, layout: "auto" },
    },
    qrCode: {
        name: "Tutorial QR Code",
        group: "Queue",
        fields: ["label", "text", "background", "radius"],
        defaults: {
            width: 200,
            height: 250,
            fontSize: 15,
            borderRadius: 10,
            label: "Scan QR code to see video tutorial :)",
        },
    },
    profile: {
        name: "Profile Picture",
        group: "Controls",
        fields: ["radius", "visibility"],
        defaults: { width: 72, height: 72, borderRadius: 36, showIn: "main" },
    },
    settingsButton: {
        name: "Settings Button",
        group: "Controls",
        fields: BUTTON_FIELDS,
        mainOnly: true,
        required: true,
        defaults: {
            width: 64,
            height: 64,
            label: "⚙",
            fontSize: 36,
            fontWeight: "400",
            background: "#1db954",
            borderRadius: 32,
            showIn: "main",
        },
    },
    popoutButton: {
        name: "Pop-out Button",
        group: "Controls",
        fields: BUTTON_FIELDS,
        mainOnly: true,
        defaults: { width: 120, label: "Pop-out", background: "#1db954", showIn: "main" },
    },
    fullscreenButton: {
        name: "Fullscreen Button",
        group: "Controls",
        fields: BUTTON_FIELDS,
        defaults: {
            width: 180,
            label: "⛶ Fullscreen",
            background: "#222222",
            showIn: "popout",
            autoHide: true,
        },
    },
    partnerDanceButton: {
        name: "Partner Dance Button",
        group: "Controls",
        fields: BUTTON_FIELDS,
        defaults: { width: 170, label: "Partner Dance", background: "#ff7e5f", showIn: "main" },
    },
    hideQueueButton: {
        name: "Hide Queue Button",
        group: "Controls",
        fields: BUTTON_FIELDS,
        defaults: { width: 150, label: "Hide Queue", background: "#5fc7ff", showIn: "main" },
    },
    refreshButton: {
        name: "Refresh Button",
        group: "Controls",
        fields: BUTTON_FIELDS,
        defaults: { width: 120, label: "Refresh", background: "#6a5af9", showIn: "main" },
    },
    setDanceButton: {
        name: "Set Dance Button",
        group: "Controls",
        fields: BUTTON_FIELDS,
        mainOnly: true,
        defaults: {
            width: 140,
            label: "Set Dance",
            background: "#e6a817",
            color: "#1a1a1a",
            textShadow: false,
            showIn: "main",
        },
    },
};

export function isWidgetKind(value: unknown): value is WidgetKind {
    return typeof value === "string" && Object.prototype.hasOwnProperty.call(WIDGET_INFO, value);
}

export function isButtonWidget(kind: WidgetKind): boolean {
    return kind.endsWith("Button");
}

export function createDefaultWidget(kind: WidgetKind, partial?: Partial<WidgetElement>): WidgetElement {
    const info = WIDGET_INFO[kind];
    const button = isButtonWidget(kind);
    const width = info.defaults.width ?? 200;
    const height = info.defaults.height ?? 52;
    return {
        id: crypto.randomUUID(),
        type: "widget",
        widget: kind,
        x: Math.round((DESIGN_WIDTH - width) / 2),
        y: Math.round((DESIGN_HEIGHT - height) / 2),
        width,
        height,
        rotation: 0,
        zIndex: 1,
        opacity: 1,
        label: "",
        fontFamily: "Montserrat",
        fontSize: button ? 18 : 24,
        fontWeight: "700",
        fontStyle: "normal",
        color: "#ffffff",
        align: "center",
        textShadow: true,
        background: button ? "#333333" : "transparent",
        borderRadius: button ? 12 : 0,
        showIn: "both",
        autoHide: false,
        itemCount: 3,
        layout: "vertical",
        showAlbumArt: true,
        showSongTitle: true,
        showDanceTitle: true,
        textPosition: "auto",
        danceFontFamily: "Montserrat",
        danceFontSize: 54,
        danceFontWeight: "700",
        danceFontStyle: "normal",
        danceColor: "#f0f0f0",
        animations: [],
        ...info.defaults,
        ...partial,
    };
}

/** Mirrors the original fixed layout so existing setups look the same after migrating. */
export function createDefaultWidgetLayout(baseZIndex = 1): WidgetElement[] {
    const buttonY = DESIGN_HEIGHT - 20 - 52;
    const layout: Array<[WidgetKind, Partial<WidgetElement>]> = [
        ["upNext", { x: 10, y: 20 }],
        ["qrCode", { x: 10, y: 810 }],
        ["currentlyPlaying", { x: 460, y: 230 }],
        ["settingsButton", { x: 1754, y: 20 }],
        ["profile", { x: 1832, y: 16 }],
        ["setDanceButton", { x: 1152, y: buttonY }],
        ["popoutButton", { x: 1304, y: buttonY }],
        ["partnerDanceButton", { x: 1436, y: buttonY }],
        ["hideQueueButton", { x: 1618, y: buttonY }],
        ["refreshButton", { x: 1780, y: buttonY }],
        ["fullscreenButton", { x: 1720, y: buttonY - 50 }],
    ];
    return layout.map(([kind, partial], index) =>
        createDefaultWidget(kind, { ...partial, zIndex: baseZIndex + index })
    );
}

export function createEmptyProject(name = "Untitled Background"): BackgroundProject {
    return {
        id: crypto.randomUUID(),
        name,
        version: PROJECT_VERSION,
        designWidth: DESIGN_WIDTH,
        designHeight: DESIGN_HEIGHT,
        canvas: { fill: "#000000" },
        elements: createDefaultWidgetLayout(),
        updatedAt: Date.now(),
    };
}

const LEGACY_NOW_PLAYING_KINDS: string[] = ["albumArt", "songTitle", "danceTitle"];

/** Fields that only accept these values; anything else keeps the default. */
const ALLOWED_VALUES: Record<string, readonly string[]> = {
    align: ["left", "center", "right"],
    fontStyle: ["normal", "italic"],
    danceFontStyle: ["normal", "italic"],
    objectFit: ["cover", "contain", "fill"],
    showIn: ["main", "popout", "both"],
    layout: ["auto", "vertical", "horizontal"],
    textPosition: ["auto", "below", "above", "left", "right"],
};

/**
 * Copies fields from `source` whose type matches the default (numbers must be finite,
 * enum-like strings must be a known value). Mutates `defaults`.
 */
function mergeMatchingFields<T extends object>(defaults: T, source: Record<string, unknown>): T {
    const target = defaults as Record<string, unknown>;
    for (const key of Object.keys(target)) {
        const value = source[key];
        if (typeof value !== typeof target[key]) continue;
        if (typeof value === "number" && !Number.isFinite(value)) continue;
        if (typeof value === "string" && ALLOWED_VALUES[key] && !ALLOWED_VALUES[key].includes(value)) continue;
        target[key] = value;
    }
    return defaults;
}

/**
 * Upgrades projects saved before widgets existed (they get the default layout on
 * top of their design), fills fields missing from older/imported widgets, and
 * guarantees a settings button so the editor stays reachable. Mutates and returns.
 */
export function normalizeProject(project: BackgroundProject): BackgroundProject {
    let replacedNowPlaying = false;
    const elements: unknown[] = Array.isArray(project.elements) ? project.elements : [];
    project.elements = elements.flatMap((raw): BgElement[] => {
        if (!raw || typeof raw !== "object") return [];
        const el = raw as BgElement;
        // Imported files can hold anything; keep only fields whose type matches the default.
        if (el.type === "text") {
            return [mergeMatchingFields(createDefaultTextElement(), el as Record<string, unknown>)];
        }
        if (el.type === "image" || el.type === "video") {
            if (typeof el.assetId !== "string" || !el.assetId) return [];
            return [
                mergeMatchingFields(createDefaultMediaElement(el.type, el.assetId), el as Record<string, unknown>),
            ];
        }
        if (el.type !== "widget") return [];
        // Early widget builds had separate album art / song / dance title pieces.
        if (LEGACY_NOW_PLAYING_KINDS.includes(el.widget)) {
            if (replacedNowPlaying) return [];
            replacedNowPlaying = true;
            return [createDefaultWidget("currentlyPlaying", { x: 460, y: 230, zIndex: el.zIndex })];
        }
        if (!isWidgetKind(el.widget)) return [];
        const source = el as Record<string, unknown>;
        const merged = mergeMatchingFields(createDefaultWidget(el.widget), source) as Record<string, unknown>;
        merged.animations = sanitizeAnimations(source.animations);
        // Currently Playing used to share one text style and a vertical/horizontal layout.
        if (el.widget === "currentlyPlaying" && typeof source.textPosition !== "string") {
            merged.textPosition =
                source.layout === "vertical" ? "below" : source.layout === "horizontal" ? "right" : "auto";
            merged.danceFontFamily = merged.fontFamily;
            merged.danceFontSize = merged.fontSize;
            merged.danceFontWeight = merged.fontWeight;
            merged.danceFontStyle = merged.fontStyle;
            merged.danceColor = merged.color;
        }
        return [merged as WidgetElement];
    });

    const topZ = () => Math.max(0, ...project.elements.map((el) => el.zIndex)) + 1;

    if (project.version !== PROJECT_VERSION) {
        project.elements.push(...createDefaultWidgetLayout(topZ()));
        project.version = PROJECT_VERSION;
    }

    const hasRequired = (kind: WidgetKind) =>
        project.elements.some((el) => el.type === "widget" && el.widget === kind);
    for (const kind of Object.keys(WIDGET_INFO) as WidgetKind[]) {
        if (WIDGET_INFO[kind].required && !hasRequired(kind)) {
            const fallback = createDefaultWidgetLayout().find((w) => w.widget === kind);
            project.elements.push({ ...(fallback ?? createDefaultWidget(kind)), zIndex: topZ() });
        }
    }
    return project;
}

export function createDefaultTextElement(partial?: Partial<TextElement>): TextElement {
    return {
        id: crypto.randomUUID(),
        type: "text",
        x: 660,
        y: 440,
        width: 600,
        height: 120,
        rotation: 0,
        zIndex: 1,
        opacity: 1,
        text: "Double-click to edit",
        fontFamily: "Montserrat",
        fontSize: 64,
        fontWeight: "700",
        fontStyle: "normal",
        color: "#ffffff",
        align: "center",
        ...partial,
    };
}

export function createDefaultMediaElement(
    type: "image" | "video",
    assetId: string,
    partial?: Partial<MediaElement>
): MediaElement {
    return {
        id: crypto.randomUUID(),
        type,
        assetId,
        x: 460,
        y: 240,
        width: 1000,
        height: 600,
        rotation: 0,
        zIndex: 1,
        opacity: 1,
        objectFit: "cover",
        ...partial,
    };
}
