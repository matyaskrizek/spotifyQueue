export const CURATED_FONTS = [
    "Montserrat",
    "Oswald",
    "Playfair Display",
    "Roboto",
    "Bebas Neue",
    "Lora",
    "Poppins",
    "Raleway",
    "Anton",
    "Pacifico",
] as const;

const loaded = new Set<string>();

function buildGoogleFontsUrl(families: string[]): string {
    const params = families
        .map((f) => `family=${encodeURIComponent(f)}:ital,wght@0,400;0,700;1,400;1,700`)
        .join("&");
    return `https://fonts.googleapis.com/css2?${params}&display=swap`;
}

export function ensureFontsLoaded(families: string[] = [...CURATED_FONTS]): Promise<void> {
    const needed = families.filter((f) => !loaded.has(f));
    if (needed.length === 0) return Promise.resolve();

    const href = buildGoogleFontsUrl(needed);
    const existing = document.querySelector(`link[data-bg-fonts="${href}"]`);
    if (!existing) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        link.dataset.bgFonts = href;
        document.head.appendChild(link);
    }

    needed.forEach((f) => loaded.add(f));

    if (document.fonts?.ready) {
        return document.fonts.ready.then(() => undefined);
    }
    return Promise.resolve();
}
