import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
    base: '/spotifyQueue/',  // required for GitHub Pages (repo name)
    build: {
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'index.html'),
                queue: resolve(__dirname, 'queue.html')
            }
        }
    },
    // The media optimizer worker lazy-loads its WebAssembly encoders, which needs ES module output.
    worker: {
        format: 'es',
    },
    // Pre-bundling moves these packages away from the .wasm files they load via import.meta.url.
    optimizeDeps: {
        exclude: ['@jsquash/png', '@jsquash/webp', 'wasm-webp'],
    },
    server: {
        host: "127.0.0.1", // prefer 127.0.0.1 over localhost (Spotify treats them as different)
        open: "/spotifyQueue/",
        port: 5173,
        // If 5173 is taken, Vite picks the next free port; OAuth uses window.location.origin.
        // Avoid browser CORS by proxying walls.dance through the Vite origin
        proxy: {
            "/walls-api": {
                target: "https://walls.dance",
                changeOrigin: true,
                secure: true,
                rewrite: (path) => path.replace(/^\/walls-api/, ""),
            },
        },
    }
});
