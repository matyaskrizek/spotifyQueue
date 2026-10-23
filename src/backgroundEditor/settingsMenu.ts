import { positionPopover } from "../windowLoaders/popover.ts";
import { deleteProject, getActiveProject, listProjects, setActiveProjectId } from "./projectStore.ts";
import { renderActiveBackground } from "./sceneRenderer.ts";

/** What the settings menu needs from the editor. */
export type SettingsMenuHost = {
    isEditorOpen(): boolean;
    /** Id of the project open in the editor, if any. */
    editingProjectId(): string | null;
    openEditor(options?: { projectId?: string; fresh?: boolean }): Promise<void>;
    requestImport(): void;
    /** Deletes media no saved project uses. Only safe while the editor is closed. */
    releaseOrphanAssets(): Promise<void>;
};

/** Used until `setupSettingsMenu` runs (e.g. in the pop-out): the list shows, actions do nothing. */
const DETACHED_HOST: SettingsMenuHost = {
    isEditorOpen: () => false,
    editingProjectId: () => null,
    openEditor: async () => {},
    requestImport: () => {},
    releaseOrphanAssets: async () => {},
};

let host: SettingsMenuHost = DETACHED_HOST;
/** Bumped per refresh so overlapping refreshes don't both fill the list. */
let listGeneration = 0;

function $(id: string): HTMLElement | null {
    return document.getElementById(id);
}

export function closeSettingsMenu() {
    $("bgSettingsMenu")?.setAttribute("hidden", "");
}

/** Opens the settings menu next to the settings widget that was clicked. */
export function toggleSettingsMenu(anchor: HTMLElement) {
    const menu = $("bgSettingsMenu");
    if (!menu) return;
    if (menu.hasAttribute("hidden")) {
        menu.removeAttribute("hidden");
        positionPopover(menu, anchor);
        void refreshProjectList().then(() => {
            if (!menu.hasAttribute("hidden")) positionPopover(menu, anchor);
        });
    } else {
        menu.setAttribute("hidden", "");
    }
}

function projectRow(project: { id: string; name: string }, active: boolean): HTMLElement {
    const row = document.createElement("div");
    row.className = "bg-settings-project-row";
    if (active) row.classList.add("active");

    const label = document.createElement("button");
    label.type = "button";
    label.className = "bg-settings-project-name";
    label.textContent = project.name + (active ? " (active)" : "");
    label.addEventListener("click", async () => {
        setActiveProjectId(project.id);
        await renderActiveBackground();
        await refreshProjectList();
    });

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "bg-settings-mini-btn";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => host.openEditor({ projectId: project.id }));

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "bg-settings-mini-btn danger";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", async () => {
        if (host.editingProjectId() === project.id) {
            alert("Close the editor before deleting the project you're editing.");
            return;
        }
        if (!confirm(`Delete “${project.name}”? This can't be undone.`)) return;
        await deleteProject(project.id);
        // With the editor open its undo history may still use these files; prune on close instead.
        if (!host.isEditorOpen()) await host.releaseOrphanAssets();
        await renderActiveBackground();
        await refreshProjectList();
    });

    row.append(label, editBtn, deleteBtn);
    return row;
}

export async function refreshProjectList() {
    const list = $("bgSettingsProjectList");
    if (!list) return;
    const generation = ++listGeneration;
    const projects = await listProjects();
    const activeId = (await getActiveProject())?.id;
    if (generation !== listGeneration) return;

    if (projects.length === 0) {
        const empty = document.createElement("p");
        empty.className = "bg-settings-empty";
        empty.textContent = "No saved projects yet.";
        list.replaceChildren(empty);
        return;
    }
    list.replaceChildren(...projects.map((p) => projectRow(p, p.id === activeId)));
}

export function setupSettingsMenu(menuHost: SettingsMenuHost) {
    host = menuHost;

    document.addEventListener("click", (e) => {
        const menu = $("bgSettingsMenu");
        if (!menu || menu.hasAttribute("hidden")) return;
        const t = e.target as Element;
        if (menu.contains(t) || t.closest?.('[data-action="settingsButton"]')) return;
        closeSettingsMenu();
    });

    $("bgSettingsEditBtn")?.addEventListener("click", () => host.openEditor());
    $("bgSettingsNewBtn")?.addEventListener("click", () => host.openEditor({ fresh: true }));
    $("bgSettingsImportBtn")?.addEventListener("click", () => host.requestImport());
}
