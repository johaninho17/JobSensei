// Recruiter plan R8 P4: Mark applied keeps proof of what was sent. Fictional candidate only.
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { attachConfirmation, readSubmission, recordSubmission, undoSubmission } from "../electron/submission";
import { readJobTracker } from "../electron/tracker";

const temps: string[] = [];
afterEach(async () => { await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
const exists = (path: string) => stat(path).then(() => true, () => false);

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "sensei-submission-"));
  temps.push(root);
  const job = join(root, "jobs", "northstar-support");
  await mkdir(join(job, ".sensei"), { recursive: true });
  await writeFile(join(job, "Alex_Morgan_Northstar_Labs_Resume.md"), "# Alex Morgan\n- Answered customer tickets.\n");
  await writeFile(join(job, "cover_letter.md"), "Dear Hiring Manager,\n");
  await writeFile(join(job, ".sensei", "posting.json"), JSON.stringify({ board: "greenhouse", url: "https://boards.greenhouse.io/northstar/jobs/1" }));
  // Stands in for the app's PDF export: writes the PDF where the export would and reports it.
  const exportPdf = async (relativePath: string) => {
    const name = relativePath.endsWith("_Resume.md") ? "Alex_Morgan_Northstar_Labs_Resume.pdf" : "Alex_Morgan_Cover_Letter.pdf";
    await mkdir(join(root, "jobs", "northstar-support", "pdfs"), { recursive: true });
    await writeFile(join(root, "jobs", "northstar-support", "pdfs", name), `%PDF ${relativePath}`);
    return { relativePath: `jobs/northstar-support/pdfs/${name}`, name, artifactType: "resume" as const, pageCount: 1, pageFillRatio: null, validationStatus: "passed" as const };
  };
  return { root, exportPdf };
}

describe("proof of what was sent", () => {
  it("freezes the PDFs, notes the platform and resume version, and marks the job applied on that day", async () => {
    const { root, exportPdf } = await workspace();
    const sent = await recordSubmission(root, "northstar-support", exportPdf, new Date(2026, 10, 11, 9, 30));
    expect(sent).toMatchObject({ date: "2026-11-11", platform: "Greenhouse", url: "https://boards.greenhouse.io/northstar/jobs/1", screenshot: null });
    expect(sent.files).toEqual(["jobs/northstar-support/submitted/2026-11-11/Alex_Morgan_Northstar_Labs_Resume.pdf", "jobs/northstar-support/submitted/2026-11-11/Alex_Morgan_Cover_Letter.pdf"]);
    expect(sent.resumeVersion).toMatch(/^[0-9a-f]{8}$/);
    for (const file of sent.files) expect(await exists(join(root, file))).toBe(true);
    expect(await readJobTracker(join(root, "jobs", "northstar-support"))).toMatchObject({ status: "applied", appliedAt: "2026-11-11" });
    expect(await readSubmission(root, "northstar-support")).toEqual(sent);
  });

  it("adds a confirmation screenshot beside the sent files", async () => {
    const { root, exportPdf } = await workspace();
    await recordSubmission(root, "northstar-support", exportPdf, new Date(2026, 10, 11));
    const shot = join(root, "confirmation-from-recruiter.png");
    await writeFile(shot, "png");
    const updated = await attachConfirmation(root, "northstar-support", shot);
    expect(updated.screenshot).toBe("jobs/northstar-support/submitted/2026-11-11/confirmation.png");
    expect(await readFile(join(root, updated.screenshot!), "utf8")).toBe("png");
    await expect(attachConfirmation(root, "northstar-support", join(root, "notes.txt"))).rejects.toThrow("image");
  });

  it("undo returns the job to Ready to send and keeps the frozen copies", async () => {
    const { root, exportPdf } = await workspace();
    const sent = await recordSubmission(root, "northstar-support", exportPdf, new Date(2026, 10, 11));
    await undoSubmission(root, "northstar-support");
    expect(await readSubmission(root, "northstar-support")).toBeNull();
    expect((await readJobTracker(join(root, "jobs", "northstar-support")))?.status).toBe("saved");
    expect(await exists(join(root, sent.files[0]!))).toBe(true);
  });

  it("refuses a job without a tailored resume", async () => {
    const { root, exportPdf } = await workspace();
    await mkdir(join(root, "jobs", "empty-job"), { recursive: true });
    await expect(recordSubmission(root, "empty-job", exportPdf)).rejects.toThrow("no tailored resume");
  });
});
