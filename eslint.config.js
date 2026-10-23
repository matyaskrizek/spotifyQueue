import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "dist-e2e/**",
      "node_modules/**",
      "coverage/**",
      ".chrome-test-profile/**",
      "playwright-report/**",
      "test-results/**",
      "**/.wrangler/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,js,mjs}"],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    files: ["scripts/**", "*.config.{js,ts,mjs}"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ["workers/**"],
    languageOptions: {
      globals: { ...globals.serviceworker },
    },
  },
);
