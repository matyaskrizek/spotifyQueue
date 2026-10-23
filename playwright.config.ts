import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;
const ORIGIN = `http://127.0.0.1:${PORT}`;

export default defineConfig({
    testDir: "e2e",
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
    use: {
        baseURL: `${ORIGIN}/spotifyQueue/`,
        trace: "retain-on-failure",
    },
    projects: [
        {
            name: "chromium",
            use: {
                ...devices["Desktop Chrome"],
                viewport: { width: 1600, height: 900 },
                // PW_CHANNEL=chrome runs against an installed Google Chrome instead of downloading Chromium.
                channel: process.env.PW_CHANNEL,
            },
        },
    ],
    webServer: {
        // A separate build so test-only env values never end up in dist/.
        command: `npx vite build --outDir dist-e2e --emptyOutDir && npx vite preview --outDir dist-e2e --host 127.0.0.1 --port ${PORT} --strictPort`,
        url: `${ORIGIN}/spotifyQueue/queue.html`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        env: {
            VITE_SPOTIFY_CLIENT_ID: "e2e-client",
            VITE_WALLS_DANCE_API_KEY: "e2e-walls-key",
            VITE_WALLS_API_BASE: "https://walls.test",
            VITE_WALLS_BAR: "e2e-bar",
        },
    },
});
