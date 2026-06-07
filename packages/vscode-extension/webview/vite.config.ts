import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: __dirname,
  base: "./",
  publicDir: path.resolve(__dirname, "../../../examples"),
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: false
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    copyPublicDir: false,
    lib: {
      entry: path.resolve(__dirname, "src/main.ts"),
      name: "GeometryWorkbenchWebview",
      formats: ["iife"],
      fileName: () => "webview.js"
    },
    rollupOptions: {
      output: {
        assetFileNames: "webview.[ext]",
        chunkFileNames: "webview-[hash].js"
      }
    }
  }
});

