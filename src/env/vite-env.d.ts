/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_SPOTIFY_CLIENT_ID: string;
    readonly VITE_SPOTIFY_CLIENT_SECRET: string;
    readonly VITE_WALLS_DANCE_API_KEY: string;
    readonly VITE_WALLS_BAR: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
