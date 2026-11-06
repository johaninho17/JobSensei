import { copyFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Settings, SettingsUpdate } from "../src/shared/schemas";
import { schemaVersion, settingsSchema } from "../src/shared/schemas";
import { readJson, writeJsonAtomic } from "./persistence";

const defaultSettings = (): Settings => ({
  schemaVersion,
  workspacePath: null,
  baseResumePath: null,
  secondaryResumePaths: [],
  linkedinProfilePath: null,
  updatedAt: new Date().toISOString(),
});

export class SettingsStore {
  private readonly settingsPath: string;

  constructor(userDataPath: string) {
    this.settingsPath = join(userDataPath, "settings.json");
  }

  /**
   * The saved settings. A file that no longer matches the schema keeps every field that still does (the base
   * resume, workspace, other resumes), so one bad field never wipes the user's choices.
   */
  async get(): Promise<Settings> {
    const stored = await readJson<unknown>(this.settingsPath);
    const parsed = settingsSchema.safeParse(stored);
    if (parsed.success) return parsed.data;
    const raw = stored && typeof stored === "object" ? stored as Record<string, unknown> : {};
    const text = (value: unknown) => typeof value === "string" && value.trim() ? value : null;
    return {
      ...defaultSettings(),
      workspacePath: text(raw.workspacePath),
      baseResumePath: text(raw.baseResumePath),
      secondaryResumePaths: Array.isArray(raw.secondaryResumePaths) ? raw.secondaryResumePaths.filter((value): value is string => typeof value === "string") : [],
      linkedinProfilePath: text(raw.linkedinProfilePath),
    };
  }

  /** Before rewriting a settings file the app couldn't read as-is, keep a copy of it. */
  private async keepUnreadable(): Promise<void> {
    const stored = await readJson<unknown>(this.settingsPath);
    if (stored === null || settingsSchema.safeParse(stored).success) return;
    if (!(await stat(this.settingsPath).catch(() => null))) return;
    await copyFile(this.settingsPath, `${this.settingsPath}.unreadable-${Date.now()}.json`).catch(() => undefined);
  }

  async save(input: SettingsUpdate): Promise<Settings> {
    await this.keepUnreadable();
    const current = await this.get();
    const next = settingsSchema.parse({ ...current, ...input, updatedAt: new Date().toISOString() });
    await writeJsonAtomic(this.settingsPath, next);
    return next;
  }

  async setWorkspace(workspacePath: string | null): Promise<Settings> {
    await this.keepUnreadable();
    const current = await this.get();
    const next = settingsSchema.parse({ ...current, workspacePath, updatedAt: new Date().toISOString() });
    await writeJsonAtomic(this.settingsPath, next);
    return next;
  }
}
