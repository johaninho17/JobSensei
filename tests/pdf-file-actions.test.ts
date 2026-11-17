import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { backupName, jobPdfPath, skipInBackup } from "../electron/pdf-file-actions";
import { zipFolder } from "../electron/zip-folder";

describe("a job's PDFs outside the app (#127)", () => {
  it("lets only a job's own PDFs be dragged out, copied, or shown", async () => {
    const root = await mkdtemp(join(tmpdir(), "sensei-pdf-actions-"));
    await mkdir(join(root, "jobs", "northstar-analyst", "pdfs"), { recursive: true });
    await writeFile(join(root, "jobs", "northstar-analyst", "pdfs", "Alex_Morgan_Resume.pdf"), "%PDF-1.7");
    await writeFile(join(root, "jobs", "northstar-analyst", "Alex_Morgan_Northstar_Resume.md"), "# Alex");
    await expect(jobPdfPath(root, "jobs/northstar-analyst/pdfs/Alex_Morgan_Resume.pdf")).resolves.toBe(join(root, "jobs", "northstar-analyst", "pdfs", "Alex_Morgan_Resume.pdf"));
    for (const bad of ["jobs/northstar-analyst/Alex_Morgan_Northstar_Resume.md", "resumes/base.pdf", "jobs/../secrets/pdfs/a.pdf", "jobs/northstar-analyst/pdfs/../../x.pdf", "/etc/passwd", 42]) {
      await expect(jobPdfPath(root, bad)).rejects.toThrow("isn't one of this job's PDFs");
    }
    await expect(jobPdfPath(root, "jobs/northstar-analyst/pdfs/cover_letter.pdf")).rejects.toThrow("no longer exists");
  });

  it("backs up the workspace without caches or rebuilt copies", async () => {
    expect(skipInBackup(".sensei/npm-cache/_cacache/index")).toBe(true);
    expect(skipInBackup(".agents/.backups/2026-11-01/AGENTS.md")).toBe(true);
    expect(skipInBackup("jobs/a/.DS_Store")).toBe(true);
    expect(skipInBackup("jobs/a/.sensei/tracker.json")).toBe(false);
    expect(skipInBackup("resumes/base.docx")).toBe(false);
    expect(backupName("Alex_Morgan", new Date("2026-11-17T10:00:00Z"))).toBe("Alex_Morgan_JobSensei_backup_2026-11-17.zip");
    expect(backupName(null, new Date("2026-11-17T10:00:00Z"))).toBe("JobSensei_backup_2026-11-17.zip");

    const root = await mkdtemp(join(tmpdir(), "sensei-backup-"));
    await mkdir(join(root, "jobs", "a", ".sensei"), { recursive: true });
    await mkdir(join(root, ".sensei", "npm-cache"), { recursive: true });
    await writeFile(join(root, "jobs", "a", ".sensei", "tracker.json"), "{}");
    await writeFile(join(root, ".sensei", "npm-cache", "big"), "cache");
    const target = join(await mkdtemp(join(tmpdir(), "sensei-backup-out-")), "backup.zip");
    expect(await zipFolder(root, target, "JobSensei-backup", skipInBackup)).toBe(1);
    const zip = (await readFile(target)).toString("latin1");
    expect(zip).toContain("JobSensei-backup/jobs/a/.sensei/tracker.json");
    expect(zip).not.toContain("npm-cache");
  });
});
