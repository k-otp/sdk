import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [svelte()],
  // Must match an allowedOrigins entry of your pk_ key exactly:
  // http://localhost:5173 (no trailing slash).
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
});
