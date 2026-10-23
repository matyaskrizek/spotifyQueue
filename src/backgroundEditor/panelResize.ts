type PanelSide = "left" | "right";

type PanelConfig = {
    side: PanelSide;
    cssVar: string;
    storageKey: string;
    defaultWidth: number;
    min: number;
    max: number;
};

const LEFT: PanelConfig = {
    side: "left",
    cssVar: "--bg-toolbar-width",
    storageKey: "bgEditorToolbarWidth",
    defaultWidth: 72,
    min: 64,
    max: 280,
};
const RIGHT: PanelConfig = {
    side: "right",
    cssVar: "--bg-inspector-width",
    storageKey: "bgEditorInspectorWidth",
    defaultWidth: 260,
    min: 220,
    max: 640,
};
const PANELS = [LEFT, RIGHT];

/** The canvas keeps at least this much width; the inspector gives way first, then the toolbar. */
const MIN_CANVAS_WIDTH = 240;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * Widths to show for the preferred toolbar/inspector widths in a body this wide.
 * Panels never go below their minimum, even if the canvas has to.
 */
export function fitPanels(bodyWidth: number, preferredLeft: number, preferredRight: number): [number, number] {
    const room = bodyWidth - MIN_CANVAS_WIDTH;
    let left = clamp(preferredLeft, LEFT.min, LEFT.max);
    let right = clamp(preferredRight, RIGHT.min, RIGHT.max);
    const overflow = left + right - room;
    if (overflow > 0) {
        right = Math.max(RIGHT.min, right - overflow);
        left = Math.max(LEFT.min, Math.min(left, room - right));
    }
    return [Math.round(left), Math.round(right)];
}

/**
 * Adds drag handles on the inner edge of the editor's side panels. Each panel keeps
 * the width the user chose; it's shown narrower only while the window is too small.
 * Call the returned function when the editor opens or the window resizes.
 * `onResize` runs after every width change so the canvas can re-fit.
 */
export function setupPanelResize(body: HTMLElement, onResize: () => void): () => void {
    const preferred = new Map<PanelConfig, number>();
    const applied = new Map<PanelConfig, number>();
    for (const panel of PANELS) {
        const saved = Number(localStorage.getItem(panel.storageKey));
        preferred.set(panel, saved > 0 ? clamp(saved, panel.min, panel.max) : panel.defaultWidth);
    }

    const layout = () => {
        // Hidden (editor closed): nothing to measure yet.
        if (body.clientWidth === 0) return;
        const [left, right] = fitPanels(body.clientWidth, preferred.get(LEFT)!, preferred.get(RIGHT)!);
        for (const [panel, width] of [[LEFT, left], [RIGHT, right]] as const) {
            if (applied.get(panel) === width) continue;
            applied.set(panel, width);
            body.style.setProperty(panel.cssVar, `${width}px`);
        }
        onResize();
    };

    for (const panel of PANELS) {
        const other = panel === LEFT ? RIGHT : LEFT;
        const handle = document.createElement("div");
        handle.className = `bg-editor-resize-handle ${panel.side}`;
        handle.setAttribute("role", "separator");
        handle.setAttribute("aria-orientation", "vertical");
        handle.title = "Drag to resize, double-click to reset";
        body.appendChild(handle);

        handle.addEventListener("pointerdown", (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            handle.setPointerCapture(e.pointerId);
            handle.classList.add("dragging");
            const startX = e.clientX;
            const startWidth = applied.get(panel) ?? preferred.get(panel)!;
            const direction = panel.side === "left" ? 1 : -1;

            const move = (ev: PointerEvent) => {
                const room = body.clientWidth - MIN_CANVAS_WIDTH - (applied.get(other) ?? other.min);
                const width = startWidth + (ev.clientX - startX) * direction;
                preferred.set(panel, Math.round(clamp(width, panel.min, Math.max(panel.min, Math.min(panel.max, room)))));
                layout();
            };
            const end = () => {
                handle.classList.remove("dragging");
                handle.removeEventListener("pointermove", move);
                handle.removeEventListener("pointerup", end);
                handle.removeEventListener("pointercancel", end);
                localStorage.setItem(panel.storageKey, String(preferred.get(panel)));
            };
            handle.addEventListener("pointermove", move);
            handle.addEventListener("pointerup", end);
            handle.addEventListener("pointercancel", end);
        });

        handle.addEventListener("dblclick", () => {
            preferred.set(panel, panel.defaultWidth);
            localStorage.removeItem(panel.storageKey);
            layout();
        });
    }

    return layout;
}
