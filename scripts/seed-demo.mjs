import { cp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const demoPath = join(root, "examples", "demo-workspace");
const dataPath = join(root, "data");

if (!existsSync(demoPath)) {
  console.error(`Demo workspace directory not found at: ${demoPath}`);
  process.exit(1);
}

// Safety check: Prevent accidental destruction of live user career data in data/
let isRealCandidate = false;
const candidateJson = join(dataPath, "profile", "candidate.json");
if (existsSync(candidateJson)) {
  try {
    const parsed = JSON.parse(await readFile(candidateJson, "utf8"));
    if (parsed.identity?.fullName && parsed.identity.fullName !== "Alex Morgan") {
      isRealCandidate = true;
    }
  } catch {}
}
const resumesDir = join(dataPath, "resumes");
if (existsSync(resumesDir)) {
  try {
    const files = await readdir(resumesDir);
    if (files.some((f) => f.endsWith(".md") && f !== "Alex_Morgan_Resume.md")) {
      isRealCandidate = true;
    }
  } catch {}
}
if (isRealCandidate && !process.argv.includes("--allow-overwrite-personal-data")) {
  console.error("Safety guard: Refusing to seed demo data into data/. Real candidate data detected.");
  console.error("To test the demo workspace, point JobSensei directly to examples/demo-workspace/ or run in an isolated directory.");
  process.exit(1);
}

if (process.argv.includes("--clean") && existsSync(dataPath)) {
  await rm(dataPath, { recursive: true, force: true });
}

await mkdir(dataPath, { recursive: true });
await cp(demoPath, dataPath, { recursive: true });
console.log("JobSensei: Successfully seeded data/ from examples/demo-workspace/.");
