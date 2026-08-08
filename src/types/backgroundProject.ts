export type BgElementType = "image" | "text" | "video";

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

export type BgElement = TextElement | MediaElement;

export type BackgroundProject = {
    id: string;
    name: string;
    version: 1;
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

export function createEmptyProject(name = "Untitled Background"): BackgroundProject {
    return {
        id: crypto.randomUUID(),
        name,
        version: 1,
        designWidth: DESIGN_WIDTH,
        designHeight: DESIGN_HEIGHT,
        canvas: { fill: "#000000" },
        elements: [],
        updatedAt: Date.now(),
    };
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
