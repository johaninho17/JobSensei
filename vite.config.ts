import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { EDITION_INFO, featuresFor, parseEdition } from "./src/shared/edition";

// The edition is fixed at build time (JOBSENSEI_EDITION). Each `FEATURES.<name>` in the renderer becomes a literal,
// so screens an edition leaves out are dropped from its bundle, not just hidden (src/shared/edition.ts owns the list).
const edition = parseEdition(process.env.JOBSENSEI_EDITION);
const define: Record<string, string> = { EDITION: JSON.stringify(EDITION_INFO[edition]) };
for (const [name, on] of Object.entries(featuresFor(edition))) define[`FEATURES.${name}`] = JSON.stringify(on);

export default defineConfig({
  plugins: [react()],
  define,
  // Relative asset paths: production loads index.html from disk (file://), where "/assets" points at the drive root.
  base: "./",
  build: {
    outDir: "dist-renderer",
    emptyOutDir: true,
  },
});
