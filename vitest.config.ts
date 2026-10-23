import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.js";

export default mergeConfig(
    viteConfig,
    defineConfig({
        test: {
            restoreMocks: true,
            unstubGlobals: true,
            unstubEnvs: true,
            coverage: {
                provider: "v8",
                include: ["src/**/*.ts", "workers/**/src/**/*.ts"],
                exclude: ["**/*.test.ts", "src/test/**", "**/*.d.ts"],
            },
            projects: [
                {
                    extends: true,
                    test: {
                        name: "app",
                        include: ["src/**/*.test.ts"],
                        environment: "node",
                        setupFiles: ["src/test/setup.ts"],
                        environmentOptions: {
                            happyDOM: { settings: { handleDisabledFileLoadingAsSuccess: true } },
                        },
                    },
                },
                {
                    test: {
                        name: "worker",
                        include: ["workers/**/*.test.ts"],
                        environment: "node",
                    },
                },
            ],
        },
    })
);
