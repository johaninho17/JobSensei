// Recruiter plan R3 / ledger R3: tailoring keeps each candidate's own resume format, whatever its length or layout.
// Fixtures are fictional (tests/fixtures/resumes/README.md). Layouts the app can't read yet are `it.fails`: they
// document the gap and turn red the day R3 fixes it, so the marker must then be removed.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCanonicalResumeBaseline } from "../electron/canonical-resume";

const fixtures = join(__dirname, "fixtures", "resumes");
const load = (file: string) => loadCanonicalResumeBaseline(fixtures, file);
const shape = async (file: string) => {
  const baseline = await load(file);
  return baseline.employers.map((employer) => [employer.name, employer.title, employer.dateRange, employer.originalBulletCount]);
};

describe("base resumes the app reads today", () => {
  it("reads a half-page resume as it is: two roles, short bullets", async () => {
    expect(await shape("half-page-retail.md")).toEqual([
      ["Larkfield Home Goods", "Shift Lead", "Aug 2022 - Present", 3],
      ["Bramble Street Market", "Cashier", "Jun 2020 - Jul 2022", 2],
    ]);
  });

  it("reads a one-page resume with a summary and its own section names", async () => {
    const baseline = await load("one-page-summary-sales.md");
    expect(baseline.originalSummaryLines?.length).toBe(1);
    expect(baseline.originalSkillsLines).toHaveLength(2);
    expect(baseline.employers.map((employer) => employer.originalBulletCount)).toEqual([5, 3, 2]);
  });

  it("keeps the half-page resume smaller than the one-page one", async () => {
    const [half, one] = await Promise.all([load("half-page-retail.md"), load("one-page-summary-sales.md")]);
    expect(half.footprint.wordCount).toBeLessThan(one.footprint.wordCount * 0.7);
  });
});

describe("known gaps for R3", () => {
  it.fails("reads a two-page resume with a field-specific skills heading and sections after Education", async () => {
    const baseline = await load("two-page-nursing.md");
    expect(baseline.employers).toHaveLength(5);
    expect(baseline.educationLines.join("\n")).toContain("Delta State University");
  });

  it.fails("reads a resume that puts Experience before Skills", async () => {
    expect(await shape("experience-first-finance.md")).toHaveLength(2);
  });

  it.fails("reads a recent graduate's resume that starts with Education", async () => {
    expect(await shape("education-first-graduate.md")).toHaveLength(2);
  });

  it.fails("measures bullets under an \"Experience\" or \"Work Experience\" heading, as the parser reads them", async () => {
    for (const file of ["half-page-retail.md", "one-page-summary-sales.md"]) {
      const baseline = await load(file);
      const parsed = baseline.employers.reduce((sum, employer) => sum + employer.originalBulletCount, 0);
      expect(baseline.footprint.experienceBulletCount, file).toBe(parsed);
    }
  });
});
