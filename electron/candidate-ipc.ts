// Candidate list IPC (Recruiter Edition, recruiter plan R1). Loaded only when the edition has `features.candidates`.
import { ipcMain } from "electron";
import { artifactPrefixFor, candidateStatusSchema, type CandidatesState } from "../src/shared/candidates";
import { createCandidateProfile } from "./candidate-profile";
import { addCandidate, candidatePath, readRecruiterSettings, readRoster, renameCandidate, setActiveCandidate, setCandidateStatus } from "./candidates";
import { SettingsStore } from "./settings";
import { join } from "node:path";

export type CandidateContext = {
  /** The recruiter folder that holds `recruiter/` and `candidates/`. */
  root: () => string;
  /** Why switching must wait (a job running for the current candidate), or null. */
  busyReason: () => Promise<string | null>;
  /** Re-points the app at a candidate's folder: settings, watcher, caches, Agy home. The renderer then reloads. */
  openCandidate: (id: string, folder: string) => Promise<void>;
  /** Leaves no candidate open (after archiving the active one). */
  closeCandidate: () => Promise<void>;
};

/** Settings for one candidate live in their own folder, never in the recruiter's app settings. */
export function candidateSettingsStore(folder: string): SettingsStore {
  return new SettingsStore(join(folder, ".sensei", "app"));
}

const text = (value: unknown, field: string) => {
  if (typeof value !== "string" || !value.trim() || value.length > 120) throw new Error(`Enter the ${field}.`);
  return value.trim();
};

export function registerCandidateIpc(ctx: CandidateContext): void {
  const state = async (): Promise<CandidatesState> => {
    const root = ctx.root();
    const [roster, settings] = await Promise.all([readRoster(root), readRecruiterSettings(root)]);
    const active = roster.candidates.find((candidate) => candidate.id === settings.activeCandidateId && candidate.status !== "archived");
    return { candidates: roster.candidates, activeId: active?.id ?? null };
  };
  const switchTo = async (id: string) => {
    const busy = await ctx.busyReason();
    if (busy) throw new Error(busy);
    const folder = await setActiveCandidate(ctx.root(), id);
    await ctx.openCandidate(id, folder);
  };

  ipcMain.handle("candidates:state", state);
  /** Adds a candidate (their folder and profile with name and file prefix), then opens them. */
  ipcMain.handle("candidates:add", async (_event, name: unknown) => {
    const busy = await ctx.busyReason();
    if (busy) throw new Error(busy);
    const displayName = text(name, "candidate's name");
    const entry = await addCandidate(ctx.root(), displayName);
    const folder = await candidatePath(ctx.root(), entry.id);
    await createCandidateProfile(folder, { fullName: displayName, artifactPrefix: artifactPrefixFor(displayName) }, await candidateSettingsStore(folder).get());
    await switchTo(entry.id);
    return entry;
  });
  ipcMain.handle("candidates:switch", async (_event, id: unknown) => switchTo(String(id ?? "")));
  ipcMain.handle("candidates:rename", async (_event, id: unknown, name: unknown) => renameCandidate(ctx.root(), String(id ?? ""), text(name, "candidate's name")));
  ipcMain.handle("candidates:set-status", async (_event, id: unknown, status: unknown) => {
    const next = candidateStatusSchema.parse(status);
    const current = await state();
    if (next === "archived" && current.activeId === id) {
      const busy = await ctx.busyReason();
      if (busy) throw new Error(busy);
    }
    const entry = await setCandidateStatus(ctx.root(), String(id ?? ""), next);
    if (next === "archived" && current.activeId === id) await ctx.closeCandidate();
    return entry;
  });
}
