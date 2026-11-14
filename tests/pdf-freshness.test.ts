import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { freshnessState, pdfFreshness, pdfOutputName } from "../electron/pdf-freshness";

describe("PDFs older than their documents", () => {
  it("calls a PDF out of date only when its document was edited after it", () => {
    expect(freshnessState(1_000_000, null)).toBe("none");
    expect(freshnessState(1_000_000, 1_005_000)).toBe("current");
    // Saved and exported within the same second: still current.
    expect(freshnessState(1_000_500, 1_000_000)).toBe("current");
    expect(freshnessState(1_010_000, 1_000_000)).toBe("stale");
  });

  it("names a job's PDFs the way export does", () => {
    expect(pdfOutputName("Alex_Morgan_Northstar_Resume.md", "resume", "Alex_Morgan")).toBe("Alex_Morgan_Resume.pdf");
    expect(pdfOutputName("Alex_Morgan_Northstar_Resume.md", "resume")).toBe("Alex_Morgan_Resume.pdf");
    expect(pdfOutputName("cover_letter.md", "cover-letter", "Alex_Morgan")).toBe("cover_letter.pdf");
  });

  it("reports each document of a job: no PDF, current, or out of date after an edit", async () => {
    const root = await mkdtemp(join(tmpdir(), "sensei-pdf-fresh-"));
    const job = join(root, "jobs", "northstar-analyst");
    await mkdir(join(job, "pdfs"), { recursive: true });
    const at = (seconds: number) => new Date(Date.UTC(2026, 10, 14, 12, 0, seconds));
    const file = async (path: string, when: Date) => { await writeFile(path, "x"); await utimes(path, when, when); };
    await file(join(job, "Alex_Morgan_Northstar_Resume.md"), at(0));
    await file(join(job, "cover_letter.md"), at(0));
    await file(join(job, "evaluation.md"), at(0));
    expect(await pdfFreshness(root, "northstar-analyst", "Alex_Morgan")).toEqual([
      { source: "jobs/northstar-analyst/Alex_Morgan_Northstar_Resume.md", kind: "resume", pdf: null, state: "none" },
      { source: "jobs/northstar-analyst/cover_letter.md", kind: "cover-letter", pdf: null, state: "none" },
    ]);
    await file(join(job, "pdfs", "Alex_Morgan_Resume.pdf"), at(10));
    await file(join(job, "pdfs", "cover_letter.pdf"), at(10));
    expect((await pdfFreshness(root, "northstar-analyst", "Alex_Morgan")).map((item) => item.state)).toEqual(["current", "current"]);
    // The resume is edited after its PDF was made.
    await file(join(job, "Alex_Morgan_Northstar_Resume.md"), at(40));
    const after = await pdfFreshness(root, "northstar-analyst", "Alex_Morgan");
    expect(after.map((item) => [item.kind, item.state])).toEqual([["resume", "stale"], ["cover-letter", "current"]]);
    expect(after[0]!.pdf).toBe("jobs/northstar-analyst/pdfs/Alex_Morgan_Resume.pdf");
    expect(await pdfFreshness(root, "no-such-job")).toEqual([]);
    for (const bad of ["../x", "a/b", "", 3]) await expect(pdfFreshness(root, bad)).rejects.toThrow("isn't a job");
  });
});
