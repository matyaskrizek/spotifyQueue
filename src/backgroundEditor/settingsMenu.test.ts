// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "../types/backgroundProject.ts";
import { getProject, resetDbConnectionForTests, saveProject, setActiveProjectId } from "./projectStore.ts";
import { refreshProjectList, setupSettingsMenu, type SettingsMenuHost } from "./settingsMenu.ts";

let list: HTMLElement;

function host(overrides: Partial<SettingsMenuHost> = {}): SettingsMenuHost {
    return {
        isEditorOpen: () => false,
        editingProjectId: () => null,
        openEditor: vi.fn(async () => {}),
        requestImport: vi.fn(),
        releaseOrphanAssets: vi.fn(async () => {}),
        ...overrides,
    };
}

const rowNames = () => [...list.querySelectorAll(".bg-settings-project-name")].map((n) => n.textContent);
const buttonIn = (row: number, label: string) =>
    [...list.querySelectorAll(".bg-settings-project-row")[row].querySelectorAll("button")].find(
        (b) => b.textContent === label
    )!;

beforeEach(async () => {
    await resetDbConnectionForTests();
    document.body.innerHTML = `<div id="bgSettingsMenu"><div id="bgSettingsProjectList"></div></div>`;
    list = document.getElementById("bgSettingsProjectList")!;
});

afterEach(() => {
    document.body.replaceChildren();
});

describe("refreshProjectList", () => {
    it("says so when there are no projects", async () => {
        await refreshProjectList();
        expect(list.textContent).toBe("No saved projects yet.");
    });

    it("lists projects and marks the active one", async () => {
        const a = createEmptyProject("A");
        const b = createEmptyProject("B");
        await saveProject(a);
        await saveProject(b);
        setActiveProjectId(a.id);

        await refreshProjectList();

        expect(rowNames().sort()).toEqual(["A (active)", "B"]);
    });

    it("shows each project once when refreshes overlap", async () => {
        await saveProject(createEmptyProject("Only"));

        await Promise.all([refreshProjectList(), refreshProjectList(), refreshProjectList()]);

        expect(rowNames()).toEqual(["Only"]);
    });
});

describe("project row actions", () => {
    it("won't delete the project open in the editor", async () => {
        const project = createEmptyProject("Editing");
        await saveProject(project);
        setupSettingsMenu(host({ isEditorOpen: () => true, editingProjectId: () => project.id }));
        const alert = vi.fn();
        vi.stubGlobal("alert", alert);
        await refreshProjectList();

        buttonIn(0, "Delete").click();
        await vi.waitFor(() => expect(alert).toHaveBeenCalled());

        expect(await getProject(project.id)).toBeDefined();
    });

    it("deletes after confirmation and cleans up media when the editor is closed", async () => {
        const project = createEmptyProject("Old");
        await saveProject(project);
        const menuHost = host();
        setupSettingsMenu(menuHost);
        vi.stubGlobal("confirm", vi.fn(() => true));
        await refreshProjectList();

        buttonIn(0, "Delete").click();

        await vi.waitFor(() => expect(list.textContent).toBe("No saved projects yet."));
        expect(await getProject(project.id)).toBeUndefined();
        expect(menuHost.releaseOrphanAssets).toHaveBeenCalled();
    });

    it("opens the editor on Edit", async () => {
        const project = createEmptyProject("P");
        await saveProject(project);
        const menuHost = host();
        setupSettingsMenu(menuHost);
        await refreshProjectList();

        buttonIn(0, "Edit").click();

        expect(menuHost.openEditor).toHaveBeenCalledWith({ projectId: project.id });
    });
});
