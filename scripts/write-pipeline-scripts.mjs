// Build step: records which pipeline commands exist (from package.json scripts) in dist-electron,
// because the installed app's package.json has no scripts. Read by writeSenseiLauncher (electron/agy-home.ts).
// Only this edition's commands are listed (src/shared/edition.ts, compiled by the step before this one).
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const { featuresFor, includedCommand, parseEdition } = createRequire(import.meta.url)("../dist-electron/src/shared/edition.js");
const features = featuresFor(parseEdition(process.env.JOBSENSEI_EDITION));
const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts ?? {};
const pipeline = {};
for (const [name, command] of Object.entries(scripts)) {
  const match = /\bnode (dist-electron\/electron\/[\w.-]+\.js)\s*$/.exec(command);
  if (match && includedCommand(features, name)) pipeline[name] = match[1];
}
mkdirSync("dist-electron", { recursive: true });
writeFileSync("dist-electron/pipeline-scripts.json", `${JSON.stringify(pipeline, null, 2)}\n`);
console.log(`pipeline commands: ${Object.keys(pipeline).join(", ")}`);
