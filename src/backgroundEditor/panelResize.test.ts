import { describe, expect, it } from "vitest";
import { fitPanels } from "./panelResize.ts";

describe("fitPanels", () => {
    it("keeps the preferred widths when there's room", () => {
        expect(fitPanels(1920, 120, 400)).toEqual([120, 400]);
    });

    it("clamps preferences to each panel's limits", () => {
        expect(fitPanels(3000, 10, 5000)).toEqual([64, 640]);
    });

    it("shrinks the inspector first so the canvas keeps 240px", () => {
        // 1000 - 240 = 760 for both panels; the toolbar keeps its 200.
        expect(fitPanels(1000, 200, 640)).toEqual([200, 560]);
    });

    it("then shrinks the toolbar once the inspector is at its minimum", () => {
        // 600 - 240 = 360: inspector stops at 220, toolbar gets the remaining 140.
        expect(fitPanels(600, 280, 640)).toEqual([140, 220]);
    });

    it("never goes below the minimums, even if the canvas has to", () => {
        expect(fitPanels(300, 280, 640)).toEqual([64, 220]);
    });
});
