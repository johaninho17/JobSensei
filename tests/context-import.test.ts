import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { importContextFiles } from "../electron/context-import";

describe("adding career files from the app", () => {
  let dir = "";
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("copies files into the chosen folder, keeps originals, never overwrites, and skips duplicates and unreadable types", async () => {
    dir = await mkdtemp(join(tmpdir(), "context-import-"));
    const outside = join(dir, "downloads");
    const workspace = join(dir, "workspace");
    await mkdir(outside, { recursive: true });
    await mkdir(join(workspace, "context", "structured"), { recursive: true });
    await writeFile(join(workspace, "context", "structured", "projects.md"), "# Existing projects\n");
    await writeFile(join(outside, "projects.md"), "# Northstar Labs projects\n- Fixed customer imports\n");
    await writeFile(join(outside, "review.txt"), "Annual review text");
    await writeFile(join(outside, "photo.png"), "not text");
    await mkdir(join(outside, "folder"));

    const first = await importContextFiles(workspace, [join(outside, "projects.md"), join(outside, "review.txt"), join(outside, "photo.png"), join(outside, "folder")], "structured");
    expect(first.added).toEqual(["context/structured/projects-2.md", "context/structured/review.txt"]);
    expect(first.skipped.map((item) => item.name)).toEqual(["photo.png", "folder"]);
    expect(await readFile(join(workspace, "context", "structured", "projects.md"), "utf8")).toBe("# Existing projects\n");
    expect(await readFile(join(outside, "projects.md"), "utf8")).toMatch(/Northstar/);

    // Adding the same file again points to the copy already there instead of making another one.
    const again = await importContextFiles(workspace, [join(outside, "review.txt")], "structured");
    expect(again.added).toEqual(["context/structured/review.txt"]);
    expect(again.skipped[0]!.reason).toBe("already added as review.txt");
    expect((await readdir(join(workspace, "context", "structured"))).sort()).toEqual(["projects-2.md", "projects.md", "review.txt"]);

    const notes = await importContextFiles(workspace, [join(outside, "review.txt")], "broad");
    expect(notes.added).toEqual(["context/broad/review.txt"]);
  });
});
