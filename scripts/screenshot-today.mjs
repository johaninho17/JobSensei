// Screenshots of the built app's Today page (ledger U77, #126) for visual QA: light and dark, wide and narrow, with
// the Agy panel open and closed. Runs on a scratch copy of the fictional demo workspace, never on data/.
// Usage: npm run build && node scripts/screenshot-today.mjs <out-dir>
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { _electron } from "playwright-core";

const out = resolve(process.argv[2] ?? "screenshots");
const root = process.cwd();
const require = createRequire(import.meta.url);
const scratch = await mkdtemp(join(tmpdir(), "sensei-shot-"));
const workspace = join(scratch, "workspace");
await cp(join(root, "examples", "demo-workspace"), workspace, { recursive: true });
await mkdir(out, { recursive: true });
// Give the scratch copy's first job an overdue follow-up, so "Do this next" has something to show.
const [firstJob] = await readdir(join(workspace, "jobs"));
if (firstJob) {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await mkdir(join(workspace, "jobs", firstJob, ".sensei"), { recursive: true });
  await writeFile(join(workspace, "jobs", firstJob, ".sensei", "tracker.json"), JSON.stringify({ schemaVersion: 1, status: "applied", appliedAt: yesterday, nextFollowUpAt: yesterday }));
}

const app = await _electron.launch({
  executablePath: require("electron"),
  args: [join(root, "dist-electron", "electron", "main.js")],
  env: { ...process.env, SENSEI_WORKSPACE: workspace, SENSEI_USER_DATA: join(scratch, "user-data") },
});
try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  const size = (width, height) => app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h), [width, height]);
  const openToday = async () => { await page.getByRole("button", { name: "Today", exact: true }).first().click(); await page.locator(".today.bento-page").waitFor(); await page.waitForTimeout(600); };
  const toggle = page.locator(".topbar-toggle");
  const panelOpen = async () => (await toggle.getAttribute("aria-pressed")) === "true";
  const togglePanel = () => toggle.click().then(() => page.waitForTimeout(500));

  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => { window.localStorage.setItem("sensei-theme-v2", value); }, theme);
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    for (const [label, width] of [["wide", 1480], ["narrow", 1000]]) {
      await size(width, 940);
      await openToday();
      if (await panelOpen()) await togglePanel();
      await page.screenshot({ path: join(out, `today-${theme}-${label}.png`), fullPage: false });
      await togglePanel();
      await page.screenshot({ path: join(out, `today-${theme}-${label}-agy.png`), fullPage: false });
      const overflow = await page.evaluate(() => { const pane = document.querySelector(".viewer-panel"); return pane ? pane.scrollWidth > pane.clientWidth + 1 : false; });
      console.log(`${theme} ${label}: ${overflow ? "SIDE SCROLL" : "no side scroll"} with the Agy panel open`);
      await togglePanel();
    }
  }
} finally {
  await app.close();
  await rm(scratch, { recursive: true, force: true });
}
console.log(`Screenshots in ${out}`);
