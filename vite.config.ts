import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { createRequire } from "node:module";
import { sentryVitePlugin } from "@sentry/vite-plugin";

const host = process.env.TAURI_DEV_HOST;
const disableSourcemaps = process.env.VITE_DISABLE_SOURCEMAPS === "true";

const require = createRequire(import.meta.url);

const antlr4BrowserEntry = (() => {
  try {
    return require.resolve("antlr4/dist/antlr4.web.mjs");
  } catch {
    return fileURLToPath(
      new URL(
        "./node_modules/.pnpm/node_modules/antlr4/dist/antlr4.web.mjs",
        import.meta.url,
      ),
    );
  }
})();

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    // Only upload source maps in production builds when SENTRY_AUTH_TOKEN is set
    ...(mode === "production" &&
    !disableSourcemaps &&
    process.env.SENTRY_AUTH_TOKEN
      ? [
          sentryVitePlugin({
            org: process.env.SENTRY_ORG || "query-pilot",
            project: process.env.SENTRY_PROJECT_FRONTEND || "query-pilot-frontend",
            authToken: process.env.SENTRY_AUTH_TOKEN,
            telemetry: false, // Disable Sentry CLI telemetry
            sourcemaps: {
              assets: ["./dist/**"],
              filesToDeleteAfterUpload: ["./dist/**/*.map"], // Clean up source maps after upload
            },
          }),
        ]
      : []),
  ],

  // Optimize dependencies for WASM support
  optimizeDeps: {
    exclude: ["@supabase/pg-parser"],
  },

  // Configure asset handling for WASM files
  assetsInclude: ["**/*.wasm"],

  build: {
    // Generate source maps for production (uploaded to Sentry, then deleted)
    sourcemap: mode === "production" && !disableSourcemaps,
  },

  // Configure worker format to ES modules for Web Worker support
  worker: {
    format: "es",
  },

  // Strip console.log/debug in production for performance
  esbuild: {
    drop: mode === "production" ? ["console", "debugger"] : [],
  },

  resolve: {
    conditions: ["import", "default"],
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@components": fileURLToPath(
        new URL("./src/components", import.meta.url),
      ),
      "@lib": fileURLToPath(new URL("./src/lib", import.meta.url)),
      "@hooks": fileURLToPath(new URL("./src/hooks", import.meta.url)),
      "@types": fileURLToPath(new URL("./src/types", import.meta.url)),
      "@utils": fileURLToPath(new URL("./src/utils", import.meta.url)),
      // Fix antlr4 resolution for @dbml/core - use browser bundle via pnpm
      antlr4: antlr4BrowserEntry,
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
