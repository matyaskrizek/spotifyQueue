// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    ACTIVE_PROJECT_ID_KEY,
    createDefaultMediaElement,
    createDefaultTextElement,
    createEmptyProject,
} from "../types/backgroundProject.ts";
import { resetDbConnectionForTests, saveProject, setActiveProjectId } from "./projectStore.ts";
import { renderActiveBackground, renderScene } from "./sceneRenderer.ts";

const renderedWidgets = (root: ParentNode) =>
    [...root.querySelectorAll<HTMLElement>("[data-widget]")].map((n) => n.dataset.widget);

let container: HTMLElement;

beforeEach(async () => {
    await resetDbConnectionForTests();
    window.name = "";
    container = document.createElement("div");
    container.id = "backgroundContainer";
    document.body.appendChild(container);
});

afterEach(() => {
    document.body.replaceChildren();
});

describe("renderActiveBackground", () => {
    it("renders the saved active project", async () => {
        const project = createEmptyProject();
        project.elements.push(createDefaultTextElement({ text: "Saved design" }));
        await saveProject(project);
        setActiveProjectId(project.id);

        await renderActiveBackground();

        expect(container.textContent).toContain("Saved design");
    });

    it("falls back to the default layout when storage fails", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        localStorage.setItem(ACTIVE_PROJECT_ID_KEY, "some-project");
        vi.spyOn(globalThis.indexedDB, "open").mockImplementation(() => {
            throw new DOMException("storage blocked", "SecurityError");
        });

        await renderActiveBackground();

        // The settings button is the only way into the editor, so it must be there.
        expect(renderedWidgets(container)).toContain("settingsButton");
        expect(console.error).toHaveBeenCalled();
    });

    it("shows main-window widgets in the main window and pop-out widgets in the pop-out", async () => {
        await renderActiveBackground();
        const main = renderedWidgets(container);
        expect(main).toContain("settingsButton");
        expect(main).not.toContain("fullscreenButton");

        window.name = "SpotifyQueuePopout";
        await renderActiveBackground();
        const popout = renderedWidgets(container);
        expect(popout).toContain("fullscreenButton");
        expect(popout).not.toContain("settingsButton");
        expect(popout).toContain("currentlyPlaying");
    });

    it("never uses a non-hex canvas fill", async () => {
        const project = createEmptyProject();
        project.canvas.fill = "url(https://evil.example/track.png)";
        await saveProject(project);
        setActiveProjectId(project.id);

        await renderActiveBackground();

        expect(container.style.background).toBe("#000000");
    });
});

describe("renderScene", () => {
    it("only the newest of overlapping renders reaches the page", async () => {
        const first = createEmptyProject();
        first.elements = [createDefaultTextElement({ text: "first" })];
        const second = createEmptyProject();
        second.elements = [createDefaultTextElement({ text: "second" })];

        const [a, b] = await Promise.all([
            renderScene({ container, project: first }),
            renderScene({ container, project: second }),
        ]);

        expect(a).toBeNull();
        expect(b).not.toBeNull();
        expect(container.textContent).toBe("second");
    });

    it("marks media whose file is missing", async () => {
        const project = createEmptyProject();
        project.elements = [createDefaultMediaElement("image", "no-such-asset")];

        await renderScene({ container, project });

        expect(container.textContent).toContain("Missing media");
    });

    it("renders elements in z-order", async () => {
        const project = createEmptyProject();
        project.elements = [
            createDefaultTextElement({ text: "top", zIndex: 5 }),
            createDefaultTextElement({ text: "bottom", zIndex: 1 }),
        ];

        await renderScene({ container, project });

        expect([...container.querySelectorAll(".bg-el-text")].map((n) => n.textContent)).toEqual(["bottom", "top"]);
    });
});
