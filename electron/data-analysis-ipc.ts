// Data analysis IPC (Profile page, #200). Loaded only when the edition has `features.dataAnalysis` (src/shared/edition.ts).
import { ipcMain } from "electron";
import { FINDINGS_JSON_SCHEMA } from "../src/shared/data-analysis";
import { readCandidateProfile } from "./candidate-profile";
import { decideFinding, readAnalysis, runAnalysis, type Decision } from "./data-analysis";
import type { FeatureContext } from "./feature-context";
import { listJobFolders } from "./job-folders";
import { headlessAgy } from "./question-agent";
import { resolveAgyExecutable } from "./terminal";

const DECISIONS: Decision[] = ["accept", "edit", "ask", "refuse"];

export function registerDataAnalysisIpc(ctx: FeatureContext): void {
  let running = false;
  const changed = () => ctx.mainWindow()?.webContents.send("analysis:changed");

  ipcMain.handle("analysis:get", async () => readAnalysis(ctx.requireWorkspace(), running));
  // Runs in the background (U44): the page can be left; the result arrives through analysis:changed.
  ipcMain.handle("analysis:run", async () => {
    if (running) return;
    const agyPath = resolveAgyExecutable();
    if (!agyPath) throw new Error("Agy isn't installed, so the check can't run.");
    const workspace = ctx.requireWorkspace();
    running = true;
    changed();
    void (async () => {
      try {
        const agyHome = await ctx.agyHomeFor(workspace);
        await runAnalysis(workspace, headlessAgy({ agyPath, agyHome, cwd: workspace, timeoutSeconds: 300, jsonSchema: FINDINGS_JSON_SCHEMA }), {
          jobs: await listJobFolders(workspace), profile: await readCandidateProfile(workspace).catch(() => null),
        });
      } catch (error) {
        console.error("Data analysis failed:", error);
      } finally {
        running = false;
        changed();
      }
    })();
  });
  ipcMain.handle("analysis:decide", async (_event, id: unknown, decision: unknown, row: unknown) => {
    if (!DECISIONS.includes(decision as Decision)) throw new Error("Unknown choice.");
    const workspace = ctx.requireWorkspace();
    const result = await decideFinding(workspace, String(id), decision as Decision, row && typeof row === "object" ? row as Record<string, string> : null);
    if (result.changed) ctx.mainWindow()?.webContents.send("workspace:changed", [result.changed]);
    if (decision === "ask") ctx.mainWindow()?.webContents.send("profile-questions:changed");
    changed();
    return result;
  });
}
