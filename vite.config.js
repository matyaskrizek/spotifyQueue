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
    server: {
        host: "127.0.0.1", // prefer 127.0.0.1 over localhost (Spotify treats them as different)
        open: "/spotifyQueue/",
        port: 5173,
        strictPort: true, // fail if 5173 is taken instead of picking another port
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
