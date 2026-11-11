// electron-builder config for both editions: `electron-builder --config build-config/edition.cjs` after `npm run build`
// with the same JOBSENSEI_EDITION. Solo is package.json's "build" block unchanged. Other editions get their own name,
// app ID, and installer names, and leave out every module and Agy file of the features they don't have
// (src/shared/edition.ts owns the lists; this reads its compiled copy).
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const base = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).build;
const { EDITION_INFO, FEATURE_AGENT_ENTRIES, FEATURE_MODULES, agentsMdFor, featureText, featuresFor, parseEdition } = require(join(root, "dist-electron", "src", "shared", "edition.js"));

const edition = parseEdition(process.env.JOBSENSEI_EDITION);
const features = featuresFor(edition);
const info = EDITION_INFO[edition];
const off = (map) => Object.entries(map).filter(([, feature]) => !features[feature]).map(([entry]) => entry);

// PRIVACY.md and TERMS.md ship in every edition with only that edition's lines (the app shows the same text).
mkdirSync(join(root, "dist-electron"), { recursive: true });
for (const name of ["PRIVACY.md", "TERMS.md"]) writeFileSync(join(root, "dist-electron", name), featureText(features, readFileSync(join(root, name), "utf8")));
const editionDocs = (resource) => (resource.from === "PRIVACY.md" || resource.from === "TERMS.md" ? { ...resource, from: `dist-electron/${resource.from}` } : resource);

let config = { ...base, extraResources: base.extraResources.map(editionDocs) };
if (edition !== "solo") {
  // AGENTS.md ships with only this edition's sections.
  const agentsMd = join(root, "dist-electron", "AGENTS.md");
  mkdirSync(join(root, "dist-electron"), { recursive: true });
  writeFileSync(agentsMd, agentsMdFor(features, readFileSync(join(root, "AGENTS.md"), "utf8")));
  config = {
    ...base,
    appId: info.appId,
    productName: info.productName,
    artifactName: `${info.artifactName}-\${version}-\${os}-\${arch}.\${ext}`,
    extraMetadata: { jobsenseiEdition: edition },
    files: [...base.files, ...off(FEATURE_MODULES).map((name) => `!dist-electron/electron/${name}.js`)],
    extraResources: base.extraResources.map((resource) => {
      if (resource.from === ".agents") return { ...resource, filter: [...resource.filter, ...off(FEATURE_AGENT_ENTRIES).flatMap((entry) => [`!${entry}`, `!${entry}/**/*`])] };
      if (resource.from === "AGENTS.md") return { ...resource, from: "dist-electron/AGENTS.md" };
      return editionDocs(resource);
    }),
  };
}
module.exports = config;
