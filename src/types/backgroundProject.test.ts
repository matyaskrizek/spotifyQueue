import { describe, expect, it } from "vitest";
import {
    PROJECT_VERSION,
    createDefaultMediaElement,
    createDefaultTextElement,
    createDefaultWidget,
    createDefaultWidgetLayout,
    createEmptyProject,
    isHexColor,
    normalizeProject,
    type BackgroundProject,
    type BgElement,
    type WidgetElement,
} from "./backgroundProject.ts";

/** A current-version project holding just these elements plus a settings button. */
function projectWith(...elements: unknown[]): BackgroundProject {
    const project = createEmptyProject("Test");
    project.elements = [createDefaultWidget("settingsButton"), ...(elements as BgElement[])];
    return project;
}

function withoutSettingsButton(project: BackgroundProject): BgElement[] {
    return project.elements.filter((el) => !(el.type === "widget" && el.widget === "settingsButton"));
}

describe("isHexColor", () => {
    it.each(["#fff", "#FFFFFF", "#12345678"])("accepts %s", (value) => {
        expect(isHexColor(value)).toBe(true);
    });

    it.each(["fff", "#ffff", "red", "#gggggg", 123, null, "url(x)"])("rejects %s", (value) => {
        expect(isHexColor(value)).toBe(false);
    });
});

describe("normalizeProject", () => {
    it("keeps valid text, media and widget elements unchanged", () => {
        const text = createDefaultTextElement({ text: "Hello", x: 10 });
        const image = createDefaultMediaElement("image", "asset-1", { objectFit: "contain" });
        const widget = createDefaultWidget("upNext", { itemCount: 5 });
        const project = projectWith(structuredClone(text), structuredClone(image), structuredClone(widget));

        normalizeProject(project);

        expect(withoutSettingsButton(project)).toEqual([text, image, widget]);
    });

    it("replaces wrongly typed and non-finite fields with defaults", () => {
        const defaults = createDefaultTextElement();
        const project = projectWith({
            ...createDefaultTextElement({ id: "t1" }),
            x: "100",
            width: Number.NaN,
            height: Number.POSITIVE_INFINITY,
            text: { evil: true },
            opacity: 0.5,
        });

        normalizeProject(project);

        const [text] = withoutSettingsButton(project);
        expect(text).toMatchObject({
            id: "t1",
            x: defaults.x,
            width: defaults.width,
            height: defaults.height,
            text: defaults.text,
            opacity: 0.5,
        });
    });

    it("replaces values outside the allowed set with defaults", () => {
        const project = projectWith(
            { ...createDefaultTextElement(), align: "diagonal", fontStyle: "bold" },
            { ...createDefaultMediaElement("video", "a"), objectFit: "stretch" },
            { ...createDefaultWidget("currentlyPlaying"), showIn: "everywhere", textPosition: "behind", layout: "grid" }
        );

        normalizeProject(project);

        const [text, video, widget] = withoutSettingsButton(project);
        expect(text).toMatchObject({ align: "center", fontStyle: "normal" });
        expect(video).toMatchObject({ objectFit: "cover" });
        expect(widget).toMatchObject({ showIn: "both", textPosition: "auto" });
        expect((widget as WidgetElement).layout).toBe(createDefaultWidget("currentlyPlaying").layout);
    });

    it("drops media without an asset id, unknown element types and non-objects", () => {
        const project = projectWith(
            { ...createDefaultMediaElement("image", "x"), assetId: 42 },
            { ...createDefaultMediaElement("image", "x"), assetId: "" },
            { type: "iframe", src: "https://example.com" },
            { ...createDefaultWidget("upNext"), widget: "notAWidget" },
            null,
            "text",
            7
        );

        normalizeProject(project);

        expect(withoutSettingsButton(project)).toEqual([]);
    });

    it("treats a non-array elements field as empty", () => {
        const project = createEmptyProject();
        (project as unknown as { elements: unknown }).elements = { 0: "nope" };

        normalizeProject(project);

        expect(project.elements.map((el) => el.type === "widget" && el.widget)).toEqual(["settingsButton"]);
    });

    it("collapses legacy now-playing pieces into one Currently Playing widget", () => {
        const project = projectWith(
            { ...createDefaultWidget("upNext"), widget: "albumArt" },
            { ...createDefaultWidget("upNext"), widget: "songTitle" },
            { ...createDefaultWidget("upNext"), widget: "danceTitle" }
        );

        normalizeProject(project);

        const widgets = withoutSettingsButton(project) as WidgetElement[];
        expect(widgets.map((w) => w.widget)).toEqual(["currentlyPlaying"]);
    });

    it("adds the default widget layout to version 1 projects", () => {
        const text = createDefaultTextElement({ zIndex: 3 });
        const project = { ...createEmptyProject(), version: 1, elements: [text] } as BackgroundProject;

        normalizeProject(project);

        expect(project.version).toBe(PROJECT_VERSION);
        const kinds = project.elements.flatMap((el) => (el.type === "widget" ? [el.widget] : []));
        expect(kinds.sort()).toEqual(createDefaultWidgetLayout().map((w) => w.widget).sort());
        // The added widgets sit above the existing design.
        const widgetZ = project.elements.filter((el) => el.type === "widget").map((el) => el.zIndex);
        expect(Math.min(...widgetZ)).toBeGreaterThan(text.zIndex);
    });

    it("adds a settings button when missing, and only one", () => {
        const project = createEmptyProject();
        project.elements = [createDefaultTextElement()];

        normalizeProject(project);
        normalizeProject(project);

        const buttons = project.elements.filter((el) => el.type === "widget" && el.widget === "settingsButton");
        expect(buttons).toHaveLength(1);
    });

    it("migrates old Currently Playing widgets to separate dance text styles", () => {
        const old = {
            ...createDefaultWidget("currentlyPlaying"),
            layout: "horizontal",
            fontFamily: "Lobster",
            fontSize: 40,
            color: "#ff0000",
        } as Record<string, unknown>;
        delete old.textPosition;
        delete old.danceFontFamily;
        delete old.danceColor;

        const project = projectWith(old);
        normalizeProject(project);

        const [widget] = withoutSettingsButton(project) as WidgetElement[];
        expect(widget).toMatchObject({
            textPosition: "right",
            danceFontFamily: "Lobster",
            danceFontSize: 40,
            danceColor: "#ff0000",
        });
    });

    it("sanitizes widget animations", () => {
        const project = projectWith({
            ...createDefaultWidget("upNext"),
            animations: [{ kind: "pulse", speed: 99 }, { kind: "explode" }],
        });

        normalizeProject(project);

        const [widget] = withoutSettingsButton(project) as WidgetElement[];
        expect(widget.animations).toEqual([{ kind: "pulse", speed: 3, intensity: 0.5, color: "auto" }]);
    });
});
