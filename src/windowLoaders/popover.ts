const MARGIN = 10;

/**
 * Places a fixed-position popover next to the widget that opened it: below when
 * the anchor is in the top half of the screen, otherwise above, kept on screen.
 */
export function positionPopover(popover: HTMLElement, anchor: HTMLElement): void {
    const rect = anchor.getBoundingClientRect();
    popover.style.position = "fixed";
    popover.style.right = "auto";
    popover.style.bottom = "auto";

    const { width, height } = popover.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    const below = rect.top + rect.height / 2 < viewportH / 2;
    let top = below ? rect.bottom + MARGIN : rect.top - height - MARGIN;
    top = Math.min(Math.max(MARGIN, top), Math.max(MARGIN, viewportH - height - MARGIN));

    // Right-align with the anchor, like a menu dropping from a corner button.
    let left = rect.right - width;
    left = Math.min(Math.max(MARGIN, left), Math.max(MARGIN, viewportW - width - MARGIN));

    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
}
