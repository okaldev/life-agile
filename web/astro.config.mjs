// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

// Static build. The Node server (server/src/app.ts) serves dist/ and the API.
export default defineConfig({
  trailingSlash: "ignore",
  build: { format: "directory" },
  integrations: [react()],
  devToolbar: { enabled: false },
  vite: {
    plugins: [tailwindcss()],
    // Dev only: forward API and auth calls to the local Node server.
    server: {
      proxy: {
        "/api": { target: process.env.API_TARGET ?? "http://127.0.0.1:8080" },
        "/auth": { target: process.env.API_TARGET ?? "http://127.0.0.1:8080" },
      },
    },
  },
});
