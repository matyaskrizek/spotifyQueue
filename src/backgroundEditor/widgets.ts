import {
    WIDGET_INFO,
    isButtonWidget,
    isHexColor,
    type WidgetElement,
} from "../types/backgroundProject.ts";
import {
    displayedDanceTitle,
    displayedTutorialUrl,
    getPlaybackState,
    subscribePlaybackState,
    type TrackSummary,
} from "../windowLoaders/playbackState.ts";

// qrcode.js is loaded from a CDN in queue.html
declare var QRCode: any;

const TEXT_SHADOW = "2px 2px 6px rgba(0, 0, 0, 0.9)";
const LIST_GAP = 8;
const NOW_PLAYING_GAP = 24;
const TITLE_GAP = 4;

type RegisteredWidget = { el: WidgetElement; editable: boolean };
const registry = new WeakMap<HTMLElement, RegisteredWidget>();

function flexAlign(align: WidgetElement["align"]): string {
    return align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center";
}

function placeholder(text: string): HTMLElement {
    const span = document.createElement("span");
    span.className = "bg-widget-placeholder";
    span.textContent = text;
    return span;
}

/** Turns a node already positioned by the scene renderer into a widget. */
export function buildWidget(node: HTMLElement, el: WidgetElement, editable: boolean): void {
    node.classList.add("bg-widget", `bg-widget-${el.widget}`);
    node.dataset.widget = el.widget;
    node.style.background = isHexColor(el.background) ? el.background : "transparent";
    node.style.borderRadius = `${Math.max(0, el.borderRadius)}px`;
    node.style.fontFamily = `"${el.fontFamily}", sans-serif`;
    node.style.fontSize = `${el.fontSize}px`;
    node.style.fontWeight = el.fontWeight;
    node.style.fontStyle = el.fontStyle;
    node.style.color = isHexColor(el.color) ? el.color : "#ffffff";
    node.style.textShadow = el.textShadow ? TEXT_SHADOW : "none";
    node.style.lineHeight = "1.2";
    if (!editable && el.autoHide) node.classList.add("bg-autohide");
    registry.set(node, { el, editable });

    if (isButtonWidget(el.widget)) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "bg-widget-btn";
        button.dataset.action = el.widget;
        button.textContent = el.label;
        button.setAttribute("aria-label", el.label.trim() || WIDGET_INFO[el.widget].name);
        button.style.justifyContent = flexAlign(el.align);
        button.style.textAlign = el.align;
        if (editable) button.tabIndex = -1;
        else node.classList.add("bg-widget-interactive");
        if (isHexColor(el.background)) node.classList.add("bg-widget-filled");
        node.appendChild(button);
        return;
    }

    if (el.widget === "profile" && !editable) node.classList.add("bg-widget-interactive");
    fillWidget(node);
}

function fillWidget(node: HTMLElement): void {
    const entry = registry.get(node);
    if (!entry) return;
    const { el, editable } = entry;
    const state = getPlaybackState();

    const content: Record<string, unknown> = { kind: el.widget };
    switch (el.widget) {
        case "currentlyPlaying":
            content.url = state.albumArtUrl;
            content.song = state.songTitle;
            content.dance = displayedDanceTitle();
            break;
        case "upNext":
            content.tracks = state.upNext.slice(0, el.itemCount);
            break;
        case "qrCode":
            content.url = displayedTutorialUrl();
            break;
        case "profile":
            content.url = state.profileImageUrl;
            content.name = state.profileName;
            break;
        default:
            return;
    }
    // Skip unchanged widgets so images and QR codes don't flicker on every poll.
    const key = JSON.stringify(content);
    if (node.dataset.contentKey === key) return;
    node.dataset.contentKey = key;

    switch (el.widget) {
        case "currentlyPlaying":
            fillCurrentlyPlaying(node, el, state.albumArtUrl, state.songTitle, displayedDanceTitle(), editable);
            break;
        case "upNext":
            fillTrackList(node, el, state.upNext, editable ? "Up next" : null);
            break;
        case "qrCode":
            fillQrCode(node, el, displayedTutorialUrl(), editable);
            break;
        case "profile":
            fillProfile(node, state.profileImageUrl, state.profileName, editable);
            break;
    }
}

/** "auto" follows the widget's shape: whichever direction gives the bigger artwork. */
function resolveVertical(el: WidgetElement, verticalArt: number, horizontalArt: number): boolean {
    if (el.layout === "vertical") return true;
    if (el.layout === "horizontal") return false;
    return verticalArt >= horizontalArt;
}

function fillCurrentlyPlaying(
    node: HTMLElement,
    el: WidgetElement,
    artUrl: string,
    songTitle: string,
    danceTitle: string,
    editable: boolean
) {
    type Title = { text: string; placeholderText: string; fontSize: number; style?: Partial<CSSStyleDeclaration> };
    const titles: Title[] = [];
    if (el.showSongTitle) {
        titles.push({ text: songTitle, placeholderText: "Song Title", fontSize: el.fontSize });
    }
    if (el.showDanceTitle) {
        titles.push({
            text: danceTitle,
            placeholderText: "Dance Title",
            fontSize: el.danceFontSize,
            style: {
                fontFamily: `"${el.danceFontFamily}", sans-serif`,
                fontSize: `${el.danceFontSize}px`,
                fontWeight: el.danceFontWeight,
                fontStyle: el.danceFontStyle,
                color: isHexColor(el.danceColor) ? el.danceColor : "#ffffff",
            },
        });
    }

    // Titles keep their space while empty so the art doesn't jump when a dance is found.
    const textHeight =
        titles.reduce((sum, t) => sum + t.fontSize * 1.2, 0) + Math.max(0, titles.length - 1) * TITLE_GAP;
    const sectionGap = el.showAlbumArt && titles.length ? NOW_PLAYING_GAP : 0;
    const artSizeFor = (stacked: boolean) =>
        !el.showAlbumArt
            ? 0
            : Math.max(
                  0,
                  stacked
                      ? Math.min(el.width, el.height - textHeight - sectionGap)
                      : Math.min(el.height, titles.length ? el.width * 0.45 : el.width)
              );
    // Auto puts the text below or beside the art, whichever leaves the bigger artwork.
    const position =
        el.textPosition === "auto"
            ? artSizeFor(true) >= artSizeFor(false) ? "below" : "right"
            : el.textPosition;
    const vertical = position === "below" || position === "above";
    const artSize = artSizeFor(vertical);

    const wrap = document.createElement("div");
    wrap.className = "bg-now-playing";
    wrap.style.flexDirection = {
        below: "column",
        above: "column-reverse",
        right: "row",
        left: "row-reverse",
    }[position];
    wrap.style.alignItems = vertical ? flexAlign(el.align) : "center";
    wrap.style.gap = `${sectionGap}px`;

    if (el.showAlbumArt) {
        const art = document.createElement(artUrl ? "img" : "div");
        art.className = "bg-now-playing-art";
        art.style.width = `${artSize}px`;
        art.style.height = `${artSize}px`;
        art.style.borderRadius = `${Math.max(0, el.borderRadius)}px`;
        if (art instanceof HTMLImageElement) {
            art.src = artUrl;
            art.alt = "";
            art.draggable = false;
        } else if (editable) {
            art.classList.add("bg-now-playing-art-placeholder");
            art.appendChild(placeholder("Album Art"));
        } else {
            art.style.visibility = "hidden";
        }
        wrap.appendChild(art);
    }

    if (titles.length) {
        const text = document.createElement("div");
        text.className = "bg-now-playing-titles";
        text.style.gap = `${TITLE_GAP}px`;
        text.style.alignItems = flexAlign(el.align);
        text.style.textAlign = el.align;
        text.style.width = vertical ? "100%" : `${Math.max(0, el.width - artSize - sectionGap)}px`;
        for (const title of titles) {
            const line = document.createElement("div");
            line.className = "bg-now-playing-title";
            // Beside the art there's spare height, so long titles wrap instead of being cut off.
            if (vertical) line.style.height = `${title.fontSize * 1.2}px`;
            else line.classList.add("bg-now-playing-title-wrap");
            if (title.style) Object.assign(line.style, title.style);
            if (title.text) line.textContent = title.text;
            else if (editable) line.appendChild(placeholder(title.placeholderText));
            text.appendChild(line);
        }
        wrap.appendChild(text);
    }
    node.replaceChildren(wrap);
}

function fillTrackList(
    node: HTMLElement,
    el: WidgetElement,
    tracks: TrackSummary[],
    placeholderPrefix: string | null
) {
    const count = Math.min(10, Math.max(1, Math.round(el.itemCount) || 1));
    let items: TrackSummary[] = tracks.slice(0, count);
    if (items.length === 0 && placeholderPrefix) {
        items = Array.from({ length: count }, (_, i) => ({
            id: String(i),
            name: `${placeholderPrefix} ${i + 1}`,
            imageUrl: "",
        }));
    }

    // Size tiles from the widget box so the list always fits what the user drew.
    const labelHeight = el.fontSize * 1.2 + 8;
    const tilesFor = (stacked: boolean) => {
        const slotWidth = stacked ? el.width : (el.width - LIST_GAP * (count - 1)) / count;
        const slotHeight = stacked ? (el.height - LIST_GAP * (count - 1)) / count : el.height;
        return { slotWidth, slotHeight, imageSize: Math.max(0, Math.min(slotWidth, slotHeight - labelHeight)) };
    };
    const vertical = resolveVertical(el, tilesFor(true).imageSize, tilesFor(false).imageSize);
    const { slotWidth, slotHeight, imageSize } = tilesFor(vertical);

    const list = document.createElement("div");
    list.className = "bg-track-list";
    list.style.flexDirection = vertical ? "column" : "row";
    list.style.gap = `${LIST_GAP}px`;

    for (const track of items) {
        const item = document.createElement("div");
        item.className = "bg-track";
        item.style.width = `${slotWidth}px`;
        item.style.height = `${slotHeight}px`;

        const art = document.createElement(track.imageUrl ? "img" : "div");
        art.className = "bg-track-art";
        art.style.width = `${imageSize}px`;
        art.style.height = `${imageSize}px`;
        art.style.borderRadius = `${Math.max(0, el.borderRadius)}px`;
        if (art instanceof HTMLImageElement) {
            art.src = track.imageUrl;
            art.alt = track.name;
            art.draggable = false;
        }

        const label = document.createElement("span");
        label.className = "bg-track-name";
        label.textContent = track.name;

        item.append(art, label);
        list.appendChild(item);
    }
    node.replaceChildren(list);
}

function fillQrCode(node: HTMLElement, el: WidgetElement, url: string | null, editable: boolean) {
    node.replaceChildren();
    node.classList.toggle("bg-widget-empty", !url);
    if (!url && !editable) return;

    const caption = el.label.trim();
    const captionHeight = caption ? el.fontSize * 1.2 * 2 + 6 : 0;
    const size = Math.floor(Math.max(0, Math.min(el.width, el.height - captionHeight)));

    const wrap = document.createElement("div");
    wrap.className = "bg-qr";

    const box = document.createElement("div");
    box.className = "bg-qr-box";
    box.style.width = `${size}px`;
    box.style.height = `${size}px`;
    box.style.borderRadius = `${Math.max(0, el.borderRadius)}px`;
    if (url && typeof QRCode !== "undefined") {
        new QRCode(box, {
            text: url,
            width: size,
            height: size,
            colorDark: "#000000",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.H,
        });
    } else {
        box.classList.add("bg-qr-placeholder");
        box.textContent = "QR";
    }
    wrap.appendChild(box);

    if (caption) {
        const span = document.createElement("span");
        span.className = "bg-qr-caption";
        span.textContent = caption;
        wrap.appendChild(span);
    }
    node.appendChild(wrap);
}

function fillProfile(node: HTMLElement, imageUrl: string, name: string, editable: boolean) {
    const wrap = document.createElement(editable ? "div" : "button");
    wrap.className = "bg-profile";
    if (wrap instanceof HTMLButtonElement) {
        wrap.type = "button";
        wrap.dataset.action = "profile";
        wrap.title = "Log out";
        wrap.setAttribute("aria-label", "Log out of Spotify");
    }

    const img = document.createElement("img");
    img.src = imageUrl || `${import.meta.env.BASE_URL}default-avatar.png`;
    img.alt = name || "Spotify Profile";
    img.draggable = false;
    img.className = "bg-widget-fill-img";
    wrap.appendChild(img);
    node.replaceChildren(wrap);
}

/**
 * Re-lays out a widget for a new size while it's being resized. Works on a copy so
 * the project element only changes when the resize is committed (keeps undo intact).
 */
export function relayoutWidget(node: HTMLElement, width: number, height: number): void {
    const entry = registry.get(node);
    if (!entry) return;
    entry.el = { ...entry.el, width, height };
    delete node.dataset.contentKey;
    fillWidget(node);
}

/** Brings widgets up to date with playback state (e.g. after a scene finishes rendering). */
export function refreshWidgets(root: ParentNode = document) {
    root.querySelectorAll<HTMLElement>(".bg-widget").forEach(fillWidget);
}

subscribePlaybackState(() => refreshWidgets());
