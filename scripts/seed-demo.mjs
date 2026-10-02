import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const demoPath = join(root, "examples", "demo-workspace");
const dataPath = join(root, "data");

if (!existsSync(demoPath)) {
  console.error(`Demo workspace directory not found at: ${demoPath}`);
  process.exit(1);
}

if (process.argv.includes("--clean") && existsSync(dataPath)) {
  await rm(dataPath, { recursive: true, force: true });
}

await mkdir(dataPath, { recursive: true });
await cp(demoPath, dataPath, { recursive: true });
console.log("JobSensei: Successfully seeded data/ from examples/demo-workspace/.");
