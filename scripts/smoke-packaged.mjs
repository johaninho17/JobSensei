// Starts the packaged app (release/) with an empty workspace and throwaway settings, and fails unless the window
// renders and the workspace loads (see runSmokeCheck in electron/main.ts). Used by the release workflow on macOS
// and Windows before a draft release is published. Usage: node scripts/smoke-packaged.mjs
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

// The app's name follows the edition it was built as (JOBSENSEI_EDITION; src/shared/edition.ts).
const { EDITION_INFO, parseEdition } = createRequire(import.meta.url)("../dist-electron/src/shared/edition.js");
const name = EDITION_INFO[parseEdition(process.env.JOBSENSEI_EDITION)].productName;
const release = resolve("release");
function executable() {
  if (process.platform === "win32") return join(release, "win-unpacked", `${name}.exe`);
  if (process.platform === "darwin") {
    const folder = readdirSync(release).find((entry) => /^mac/.test(entry) && existsSync(join(release, entry, `${name}.app`)));
    return folder ? join(release, folder, `${name}.app`, "Contents", "MacOS", name) : null;
  }
  return join(release, "linux-unpacked", "jobsensei");
}

const app = executable();
if (!app || !existsSync(app)) {
  console.error(`Packaged app not found under ${release}.`);
  process.exit(1);
}
const scratch = mkdtempSync(join(tmpdir(), "jobsensei-smoke-"));
const out = join(scratch, "smoke.json");
const env = { ...process.env, SENSEI_SMOKE_OUT: out, SENSEI_WORKSPACE: join(scratch, "workspace"), SENSEI_USER_DATA: join(scratch, "user-data") };
console.log(`Starting ${app}`);
const child = spawn(app, [], { env, stdio: "inherit" });
const killer = setTimeout(() => { console.error("The app did not exit within 120 seconds."); child.kill(); }, 120_000);
child.on("exit", (code) => {
  clearTimeout(killer);
  const result = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : null;
  console.log(result ? JSON.stringify(result, null, 2) : "No smoke result was written.");
  process.exit(result?.ok && code === 0 ? 0 : 1);
});
