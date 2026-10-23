import type { WidgetElement } from "../types/backgroundProject.ts";
import {
    ANIMATION_INFO,
    AUTO_COLOR,
    MAX_WIDGET_ANIMATIONS,
    createAnimation,
    isAnimationKind,
    type WidgetAnimation,
    type WidgetAnimationKind,
} from "../types/widgetAnimation.ts";

export type AnimationInspectorHandlers = {
    /** Applies a change to the selected widget as one undo step and re-renders. */
    edit: (apply: (el: WidgetElement) => void) => void;
    preview: () => void;
};

const KINDS = Object.keys(ANIMATION_INFO) as WidgetAnimationKind[];

function editAnimation(
    handlers: AnimationInspectorHandlers,
    kind: WidgetAnimationKind,
    apply: (anim: WidgetAnimation) => void
) {
    handlers.edit((el) => {
        const anim = el.animations.find((a) => a.kind === kind);
        if (anim) apply(anim);
    });
}

function range(caption: string, min: number, max: number, step: number, value: number, onChange: (n: number) => void) {
    const label = document.createElement("label");
    label.textContent = caption;
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.addEventListener("change", () => onChange(Number(input.value)));
    label.appendChild(input);
    return label;
}

function renderCard(anim: WidgetAnimation, handlers: AnimationInspectorHandlers): HTMLElement {
    const info = ANIMATION_INFO[anim.kind];
    const card = document.createElement("div");
    card.className = "bg-anim-card";

    const header = document.createElement("div");
    header.className = "bg-anim-card-header";
    const title = document.createElement("span");
    title.textContent = info.name;
    const badge = document.createElement("span");
    badge.className = "bg-anim-card-badge";
    badge.textContent = info.trigger === "loop" ? "Always" : "Song change";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "bg-anim-card-remove";
    remove.textContent = "✕";
    remove.setAttribute("aria-label", `Remove ${info.name}`);
    remove.addEventListener("click", () =>
        handlers.edit((el) => {
            el.animations = el.animations.filter((a) => a.kind !== anim.kind);
        })
    );
    header.append(title, badge, remove);

    const speed = range("Speed", 0.25, 3, 0.25, anim.speed, (n) =>
        editAnimation(handlers, anim.kind, (a) => (a.speed = n))
    );
    const intensity = range("Intensity", 0, 1, 0.05, anim.intensity, (n) =>
        editAnimation(handlers, anim.kind, (a) => (a.intensity = n))
    );

    const colorRow = document.createElement("div");
    colorRow.className = "bg-inspector-row";
    const colorLabel = document.createElement("label");
    colorLabel.textContent = "Color";
    const color = document.createElement("input");
    color.type = "color";
    color.value = anim.color === AUTO_COLOR ? "#ffffff" : anim.color;
    color.disabled = anim.color === AUTO_COLOR;
    color.addEventListener("change", () => editAnimation(handlers, anim.kind, (a) => (a.color = color.value)));
    colorLabel.appendChild(color);

    const autoLabel = document.createElement("label");
    autoLabel.className = "bg-inspector-check";
    const auto = document.createElement("input");
    auto.type = "checkbox";
    auto.checked = anim.color === AUTO_COLOR;
    auto.addEventListener("change", () =>
        editAnimation(handlers, anim.kind, (a) => (a.color = auto.checked ? AUTO_COLOR : color.value))
    );
    autoLabel.append(auto, " From album art");
    colorRow.append(colorLabel, autoLabel);

    card.append(header, speed, intensity, colorRow);
    return card;
}

function renderAddSelect(el: WidgetElement, handlers: AnimationInspectorHandlers): HTMLSelectElement {
    const select = document.createElement("select");
    select.className = "bg-anim-add";
    const full = el.animations.length >= MAX_WIDGET_ANIMATIONS;
    const prompt = document.createElement("option");
    prompt.value = "";
    prompt.textContent = full ? `Up to ${MAX_WIDGET_ANIMATIONS} animations` : "+ Add animation…";
    select.appendChild(prompt);
    select.disabled = full;

    const groups: Array<[string, "loop" | "songChange"]> = [
        ["Always", "loop"],
        ["On song change", "songChange"],
    ];
    for (const [caption, trigger] of groups) {
        const group = document.createElement("optgroup");
        group.label = caption;
        for (const kind of KINDS) {
            if (ANIMATION_INFO[kind].trigger !== trigger) continue;
            if (el.animations.some((a) => a.kind === kind)) continue;
            const option = document.createElement("option");
            option.value = kind;
            option.textContent = ANIMATION_INFO[kind].name;
            group.appendChild(option);
        }
        if (group.children.length) select.appendChild(group);
    }

    select.addEventListener("change", () => {
        const kind = select.value;
        if (!isAnimationKind(kind)) return;
        handlers.edit((target) => {
            if (target.animations.length >= MAX_WIDGET_ANIMATIONS) return;
            if (target.animations.some((a) => a.kind === kind)) return;
            target.animations = [...target.animations, createAnimation(kind)];
        });
    });
    return select;
}

export function renderAnimationInspector(
    container: HTMLElement,
    el: WidgetElement,
    handlers: AnimationInspectorHandlers
): void {
    const parts: HTMLElement[] = el.animations.map((anim) => renderCard(anim, handlers));
    parts.push(renderAddSelect(el, handlers));
    if (el.animations.length) {
        const preview = document.createElement("button");
        preview.type = "button";
        preview.className = "action-btn bg-inspector-btn";
        preview.textContent = "▶ Preview";
        preview.addEventListener("click", handlers.preview);
        parts.push(preview);
    }
    container.replaceChildren(...parts);
}
