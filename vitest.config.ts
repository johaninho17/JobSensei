import { defineConfig } from "vitest/config";
import { EDITION_INFO, featuresFor, parseEdition } from "./src/shared/edition";

// Renderer modules read FEATURES.<name> and EDITION, which the build replaces with literals (vite.config.ts).
// Tests get the same literals for the edition in JOBSENSEI_EDITION (solo by default).
const edition = parseEdition(process.env.JOBSENSEI_EDITION);
const define: Record<string, string> = { EDITION: JSON.stringify(EDITION_INFO[edition]) };
for (const [name, on] of Object.entries(featuresFor(edition))) define[`FEATURES.${name}`] = JSON.stringify(on);

export default defineConfig({
  define,
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
