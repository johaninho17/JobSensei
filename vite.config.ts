import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { EDITION_INFO, featureText, featuresFor, parseEdition } from "./src/shared/edition";

// The edition is fixed at build time (JOBSENSEI_EDITION). Each `FEATURES.<name>` in the renderer becomes a literal,
// so screens an edition leaves out are dropped from its bundle, not just hidden (src/shared/edition.ts owns the list).
const edition = parseEdition(process.env.JOBSENSEI_EDITION);
const define: Record<string, string> = { EDITION: JSON.stringify(EDITION_INFO[edition]) };
for (const [name, on] of Object.entries(featuresFor(edition))) define[`FEATURES.${name}`] = JSON.stringify(on);

// The in-app docs (docs/app/*.md) keep only this edition's parts, so left-out features never reach its bundle.
const editionDocs = {
  name: "jobsensei-edition-docs",
  enforce: "pre" as const,
  load(id: string) {
    const match = /^(.*[\\/]docs[\\/]app[\\/][^\\/]+\.md)\?raw$/.exec(id);
    if (!match) return null;
    return `export default ${JSON.stringify(featureText(featuresFor(edition), readFileSync(match[1]!, "utf8")))};`;
  },
};

export default defineConfig({
  plugins: [editionDocs, react()],
  define,
  // Relative asset paths: production loads index.html from disk (file://), where "/assets" points at the drive root.
  base: "./",
  build: {
    outDir: "dist-renderer",
    emptyOutDir: true,
  },
});
