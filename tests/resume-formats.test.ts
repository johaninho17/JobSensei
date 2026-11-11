// Recruiter plan R3 / ledger R3: tailoring keeps each candidate's own resume format, whatever its length or layout.
// Fixtures are fictional (tests/fixtures/resumes/README.md).
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { canonicalResumeDrifts, composeCanonicalResume, loadCanonicalResumeBaseline } from "../electron/canonical-resume";

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

describe("other layouts (fixed in R3)", () => {
  it("reads a two-page resume with a field-specific skills heading and sections after Education", async () => {
    const baseline = await load("two-page-nursing.md");
    expect(baseline.employers).toHaveLength(5);
    expect(baseline.educationLines.join("\n")).toContain("Delta State University");
  });

  it("reads a resume that puts Experience before Skills", async () => {
    expect(await shape("experience-first-finance.md")).toHaveLength(2);
  });

  it("reads a recent graduate's resume that starts with Education", async () => {
    expect(await shape("education-first-graduate.md")).toHaveLength(2);
  });

  it("measures bullets under an \"Experience\" or \"Work Experience\" heading, as the parser reads them", async () => {
    for (const file of ["half-page-retail.md", "one-page-summary-sales.md"]) {
      const baseline = await load(file);
      const parsed = baseline.employers.reduce((sum, employer) => sum + employer.originalBulletCount, 0);
      expect(baseline.footprint.experienceBulletCount, file).toBe(parsed);
    }
  });
});

const FIXTURES = ["half-page-retail.md", "one-page-summary-sales.md", "two-page-nursing.md", "experience-first-finance.md", "education-first-graduate.md"];

describe("a draft keeps the candidate's own format", () => {
  it.each(FIXTURES)("%s comes back in its own order, with its own sections, when rebuilt from its bullets", async (file) => {
    const baseline = await load(file);
    const draft = { skillsLines: baseline.originalSkillsLines, employers: baseline.employers.map((employer) => ({ name: employer.name, bullets: employer.originalBullets })) };
    const rebuilt = composeCanonicalResume(baseline, draft as never);
    expect(canonicalResumeDrifts(rebuilt, baseline)).toEqual([]);
    const headings = (text: string) => text.split("\n").filter((line) => /^\*\*[A-Z ,&]+\*\*$/.test(line.trim()));
    const original = (await import("node:fs")).readFileSync(join(fixtures, file), "utf8");
    expect(headings(rebuilt)).toEqual(headings(original));
  });

  it("keeps sections after Education word for word", async () => {
    const baseline = await load("two-page-nursing.md");
    expect(baseline.sectionOrder).toEqual(["skills", "experience", "education", "extra:0"]);
    expect(baseline.extraSections?.[0]?.lines).toHaveLength(3);
    expect(baseline.educationLines).toHaveLength(2);
  });

  it("refuses a draft that moves a section", async () => {
    const baseline = await load("experience-first-finance.md");
    const draft = { skillsLines: baseline.originalSkillsLines, employers: baseline.employers.map((employer) => ({ name: employer.name, bullets: employer.originalBullets })) };
    const moved = composeCanonicalResume({ ...baseline, sectionOrder: ["skills", "experience", "education"] }, draft as never);
    expect(canonicalResumeDrifts(moved, baseline).map((drift) => drift.code)).toContain("SECTION_STRUCTURE_DRIFT");
  });
});

describe("several roles at one employer", () => {
  it("keeps each role's own bullets when someone was promoted", async () => {
    const baseline = await load("two-page-nursing.md");
    expect(baseline.employers.map((employer) => employer.name)).toEqual(["Oakhollow Regional Medical Center", "Oakhollow Regional Medical Center", "Wrenbrook Skilled Nursing", "Wrenbrook Skilled Nursing", "Halewood Home Health"]);
    const employers = baseline.employers.map((employer, index) => ({ name: employer.name, bullets: [`Role ${index + 1} bullet`] }));
    const text = composeCanonicalResume(baseline, { skillsLines: baseline.originalSkillsLines, employers } as never);
    const order = ["Charge Nurse", "Role 1 bullet", "Registered Nurse, Telemetry", "Role 2 bullet", "Registered Nurse", "Role 3 bullet", "Licensed Vocational Nurse", "Role 4 bullet"];
    let at = 0;
    for (const piece of order) { const next = text.indexOf(piece, at); expect(next, piece).toBeGreaterThanOrEqual(at); at = next; }
  });
});

describe("PDF page rule (ledger R3)", () => {
  it("passes a resume at the base resume's page count and fails it beyond", async () => {
    vi.doMock("electron", () => ({ BrowserWindow: class {} }));
    const { pdfValidationStatus } = await import("../electron/pdf-export");
    expect(pdfValidationStatus("resume", 1, 0.5, 1)).toBe("passed");
    expect(pdfValidationStatus("resume", 2, 1.05, 1)).toBe("warning");
    expect(pdfValidationStatus("resume", 2, 1.5, 1)).toBe("failed");
    expect(pdfValidationStatus("resume", 2, 1, 2)).toBe("passed");
    expect(pdfValidationStatus("resume", 3, 2.5, 2)).toBe("failed");
    expect(pdfValidationStatus("cover-letter", 2, 1, 2)).toBe("failed");
  });
});

describe("resume plan follows the base resume (ledger R3)", () => {
  it("keeps every role's bullet count and adds at most one bullet to at most two roles with extra evidence", async () => {
    const { buildResumePlan } = await import("../electron/evidence-snapshot");
    const baseline = await load("two-page-nursing.md");
    const rows = ["Oakhollow Regional Medical Center", "Wrenbrook Skilled Nursing", "Halewood Home Health"].flatMap((employer, index) =>
      Array.from({ length: [20, 12, 9][index]! }, (_, n) => ({ evidenceId: `${employer}-${n}`, employer, recencyBand: "recent", text: "work", classification: "direct" })));
    const plan = buildResumePlan(rows as never, baseline as never, baseline.footprint, "Charge nurse role", null);
    const base = baseline.employers.map((employer) => employer.originalBulletCount);
    const targets = plan.employerTargets.map((target) => target.targetBullets);
    targets.forEach((target, index) => expect(target - base[index]!).toBeGreaterThanOrEqual(0));
    expect(targets.reduce((sum, value) => sum + value, 0) - base.reduce((sum, value) => sum + value, 0)).toBeLessThanOrEqual(2);
    expect(plan.targetTotalBullets).toBe(targets.reduce((sum, value) => sum + value, 0));
  });

  it("gives a half-page resume a half-page plan, not the old 10–14 bullets", async () => {
    const { buildResumePlan } = await import("../electron/evidence-snapshot");
    const baseline = await load("half-page-retail.md");
    const plan = buildResumePlan([] as never, baseline as never, baseline.footprint, "Operations coordinator", null);
    expect(plan.targetTotalBullets).toBe(5);
    expect(plan.employerTargets.map((target) => target.targetBullets)).toEqual([3, 2]);
  });
});
