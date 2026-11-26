// Screenshots of the built app's pages (ledger U77, U78) for visual QA: light and dark, wide and narrow, with the Agy
// panel open and closed. Runs on a scratch copy of the fictional demo workspace, never on data/.
// Usage: npm run build && node scripts/screenshot-pages.mjs <out-dir> [Today,Jobs,...]  (sidebar names; default Jobs)
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { _electron } from "playwright-core";

const out = resolve(process.argv[2] ?? "screenshots");
const pages = (process.argv[3] ?? "Jobs").split(",").map((name) => name.trim()).filter(Boolean);
const root = process.cwd();
const require = createRequire(import.meta.url);
const scratch = await mkdtemp(join(tmpdir(), "sensei-shot-"));
const workspace = join(scratch, "workspace");
await cp(join(root, "examples", "demo-workspace"), workspace, { recursive: true });
await mkdir(out, { recursive: true });
const app = await _electron.launch({
  executablePath: require("electron"),
  args: [join(root, "dist-electron", "electron", "main.js")],
  env: { ...process.env, SENSEI_WORKSPACE: workspace, SENSEI_USER_DATA: join(scratch, "user-data") },
});
try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  const size = (width, height) => app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h), [width, height]);
  // Sidebar pages by name; "Job" opens the first job, "Job posting" its posting, "Job resume" its resume.
  const open = async (name) => {
    await page.locator(".app-sidebar button", { hasText: name.startsWith("Job") && name !== "Job Search" ? "Jobs" : name }).first().click();
    await page.waitForTimeout(700);
    if (name === "Job" || name === "Job posting" || name === "Job resume") { await page.locator(".job-card").first().click(); await page.waitForTimeout(800); }
    if (name === "Job posting") { await page.getByRole("tab", { name: "Posting" }).first().click(); await page.waitForTimeout(800); }
    if (name === "Job resume") { await page.getByRole("tab", { name: "Resume", exact: true }).first().click(); await page.waitForTimeout(800); }
  };
  const toggle = page.locator(".topbar-toggle");
  const panelOpen = async () => (await toggle.getAttribute("aria-pressed")) === "true";
  const togglePanel = () => toggle.click().then(() => page.waitForTimeout(500));

  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => { window.localStorage.setItem("sensei-theme-v2", value); }, theme);
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    for (const name of pages) for (const [label, width] of [["wide", 1480], ["narrow", 1000]]) {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      await size(width, 940);
      await open(name);
      if (name === "Settings") { await page.screenshot({ path: join(out, `${slug}-${theme}-${label}.png`) }); await page.keyboard.press("Escape"); await page.waitForTimeout(400); continue; }
      if (await panelOpen()) await togglePanel();
      await page.screenshot({ path: join(out, `${slug}-${theme}-${label}.png`), fullPage: false });
      await togglePanel();
      await page.screenshot({ path: join(out, `${slug}-${theme}-${label}-agy.png`), fullPage: false });
      const overflow = await page.evaluate(() => { const pane = document.querySelector(".viewer-panel"); return pane ? pane.scrollWidth > pane.clientWidth + 1 : false; });
      console.log(`${name} ${theme} ${label}: ${overflow ? "SIDE SCROLL" : "no side scroll"} with the Agy panel open`);
      await togglePanel();
    }
  }
} finally {
  await app.close();
  await rm(scratch, { recursive: true, force: true });
}
console.log(`Screenshots in ${out}`);
