import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SettingsStore } from "../electron/settings";

describe("settings store", () => {
  it("keeps the base resume when the saved file has a field it can't read", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sensei-settings-"));
    await writeFile(join(dir, "settings.json"), JSON.stringify({
      workspacePath: "/work/alex",
      baseResumePath: "resumes/Alex_Morgan_Resume.docx",
      secondaryResumePaths: ["resumes/old.docx"],
      updatedAt: 42,
    }));
    const store = new SettingsStore(dir);
    const settings = await store.get();
    expect(settings.baseResumePath).toBe("resumes/Alex_Morgan_Resume.docx");
    expect(settings.secondaryResumePaths).toEqual(["resumes/old.docx"]);

    await store.setWorkspace("/work/alex");
    const saved = JSON.parse(await readFile(join(dir, "settings.json"), "utf8"));
    expect(saved.baseResumePath).toBe("resumes/Alex_Morgan_Resume.docx");
    expect((await readdir(dir)).some((name) => name.startsWith("settings.json.unreadable-"))).toBe(true);
  });
});
