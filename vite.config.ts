import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Relative asset paths: production loads index.html from disk (file://), where "/assets" points at the drive root.
  base: "./",
  build: {
    outDir: "dist-renderer",
    emptyOutDir: true,
  },
});
