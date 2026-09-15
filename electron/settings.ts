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

  async get(): Promise<Settings> {
    const stored = await readJson<unknown>(this.settingsPath);
    const parsed = settingsSchema.safeParse(stored);
    return parsed.success ? parsed.data : defaultSettings();
  }

  async save(input: SettingsUpdate): Promise<Settings> {
    const current = await this.get();
    const next = settingsSchema.parse({ ...current, ...input, updatedAt: new Date().toISOString() });
    await writeJsonAtomic(this.settingsPath, next);
    return next;
  }

  async setWorkspace(workspacePath: string | null): Promise<Settings> {
    const current = await this.get();
    const next = settingsSchema.parse({ ...current, workspacePath, updatedAt: new Date().toISOString() });
    await writeJsonAtomic(this.settingsPath, next);
    return next;
  }
}
