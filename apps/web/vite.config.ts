/// <reference types="vitest/config" />
import path from "node:path";
import basicSsl from "@vitejs/plugin-basic-ssl";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// The dev server proxies the API, WebSocket and vision stream so the browser
// only ever talks to one origin. That keeps CORS simple and lets a phone on
// the same Wi-Fi use the app via https://<laptop-ip>:5173 (KORTEX_HTTPS=1).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, "../.."), "");
  const apiTarget = env.KORTEX_API_URL || "http://127.0.0.1:8000";
  const visionTarget = `http://127.0.0.1:${env.VISION_PORT || "8100"}`;
  const https = process.env.KORTEX_HTTPS === "1";

  return {
    envDir: path.resolve(__dirname, "../.."),
    plugins: [react(), tailwindcss(), ...(https ? [basicSsl()] : [])],
    resolve: { alias: { "@": path.resolve(__dirname, "src") } },
    server: {
      host: true,
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": { target: apiTarget, changeOrigin: true },
        "/ws": { target: apiTarget.replace(/^http/, "ws"), ws: true, changeOrigin: true },
        "/vision": {
          target: visionTarget,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/vision/, ""),
        },
      },
    },
    build: {
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("recharts") || id.includes("d3-")) return "charts";
            if (id.includes("@zxing")) return "scanner";
          },
        },
      },
    },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      css: false,
    },
  };
});
