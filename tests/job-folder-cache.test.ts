import { mkdtemp, mkdir, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { invalidateJobCache, listJobFolders, listJobTree } from "../electron/job-folders";

async function workspaceWithJob(): Promise<{ root: string; job: string }> {
  const root = await mkdtemp(join(tmpdir(), "sensei-job-cache-"));
  const job = join(root, "jobs", "northstar-solutions-engineer");
  await mkdir(join(job, ".sensei"), { recursive: true });
  await writeFile(join(job, ".sensei", "job.json"), JSON.stringify({ company: "Northstar Labs", title: "Solutions Engineer" }));
  await writeFile(join(job, "notes.md"), "short");
  await pinTimes([join(job, ".sensei", "job.json"), join(job, "notes.md"), join(job, ".sensei"), job]);
  return { root, job };
}

/** Rewrites a file but restores its old mtime, so only a reread could see the new content. */
async function rewriteKeepingMtime(path: string, content: string): Promise<void> {
  const before = await stat(path);
  await writeFile(path, content);
  await utimes(path, before.atime, before.mtime);
}

/** Whole-second times, so restoring them is exact (utimes drops sub-millisecond precision). */
async function pinTimes(paths: string[]): Promise<void> {
  const fixed = new Date("2026-10-01T00:00:00Z");
  for (const path of paths) await utimes(path, fixed, fixed);
}

describe("per-job refresh cache", () => {
  it("does not reread a job whose inputs are unchanged, and rereads it when one changes", async () => {
    const { root, job } = await workspaceWithJob();
    expect((await listJobFolders(root))[0].title).toBe("Solutions Engineer");
    await rewriteKeepingMtime(join(job, ".sensei", "job.json"), JSON.stringify({ company: "Northstar Labs", title: "Changed" }));
    expect((await listJobFolders(root))[0].title).toBe("Solutions Engineer");
    const later = new Date(Date.now() + 5_000);
    await utimes(join(job, ".sensei", "job.json"), later, later);
    expect((await listJobFolders(root))[0].title).toBe("Changed");
  });

  it("picks up a tracker write in .sensei without any watcher event", async () => {
    const { root, job } = await workspaceWithJob();
    expect((await listJobFolders(root))[0].tracker).toBeNull();
    await writeFile(join(job, ".sensei", "tracker.json"), JSON.stringify({ status: "applied", appliedAt: "2026-10-20", followUpAt: null, notes: "", history: [] }));
    const later = new Date(Date.now() + 5_000);
    await utimes(join(job, ".sensei", "tracker.json"), later, later);
    expect((await listJobFolders(root))[0].tracker?.status).toBe("applied");
  });

  it("refreshes a job tree after a watcher event for that job, and after files are added", async () => {
    const { root, job } = await workspaceWithJob();
    const size = async () => (await listJobTree(root))[0].children?.find((node) => node.name === "notes.md")?.sizeBytes;
    expect(await size()).toBe(5);
    await rewriteKeepingMtime(join(job, "notes.md"), "a much longer note");
    expect(await size()).toBe(5);
    invalidateJobCache(root, "jobs/northstar-solutions-engineer/notes.md");
    expect(await size()).toBe(18);
    await writeFile(join(job, "cover_letter.md"), "Dear team");
    const later = new Date(Date.now() + 5_000);
    await utimes(job, later, later);
    expect((await listJobTree(root))[0].children?.map((node) => node.name)).toContain("cover_letter.md");
  });
});
