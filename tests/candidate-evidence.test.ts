// Ledger T8 and recruiter plan R4: the base resume is evidence (both editions), and in the Recruiter Edition every
// checked candidate file is evidence on its own. Fictional candidate (Alex Morgan / Northstar Labs).
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateResumeAuditJson, type ClaimFailure } from "../electron/application-artifacts";
import { candidateFileRows } from "../electron/candidate-evidence";
import { buildContextManifest } from "../electron/context";
import { createEvidenceSnapshot } from "../electron/evidence-snapshot";
import { normalizeEvidenceClassifications } from "../electron/fit-scoring";
import type { EvidenceSnapshot } from "../src/shared/schemas";

const edition = process.env.JOBSENSEI_EDITION;
afterEach(() => { if (edition === undefined) delete process.env.JOBSENSEI_EDITION; else process.env.JOBSENSEI_EDITION = edition; });

async function workspace(options: { structured?: boolean } = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sensei-candidate-evidence-"));
  for (const dir of [".sensei", "context/structured", "context/broad", "resumes", "jobs/sample-role"]) await mkdir(join(root, dir), { recursive: true });
  await Promise.all([
    writeFile(join(root, "resumes", "base.md"), `# **ALEX MORGAN**
alex@example.com

## **SKILLS**
**Engineering:** TypeScript, REST APIs

## **PROFESSIONAL EXPERIENCE**
### **Northstar Labs**
*Solutions Engineer* | *2024 - Present*
- Supported REST API integrations for customer teams.
- Documented integration setup for new accounts.

### **Juniper Analytics**
*Support Analyst* | *2020 - 2023*
- Answered customer questions about data exports.

## **EDUCATION**
### **Example University**
Bachelor of Science
`),
    writeFile(join(root, "resumes", "older.md"), "# Older Resume\n\n## Juniper Analytics\n- Built a weekly export report in Excel for the support team.\n"),
    writeFile(join(root, "context", "denylist.md"), "# Career Claim Denylist\n"),
    writeFile(join(root, "context", "application_voice_profile.md"), "# Application Voice Profile\n\n- source_role: application-style-policy\n"),
    writeFile(join(root, "context", "structured", "work.md"), `# Work

- source_role: direct project notes

| Evidence ID | Year | Project | Explicit claim | Scope note | Source locator | Confidence | Public use |
| --- | --- | --- | --- | --- | --- | --- | --- |
| context:work:sso | 2025 | Northstar Labs | Set up single sign-on for two customer accounts. | Setup scope. | Notes | medium-low | corroboration required |
`),
    writeFile(join(root, "context", "structured", "recruiter-notes.md"), "# Recruiter notes\n\n- At Northstar Labs, Alex trained new support hires on the ticket queue.\n- Speaks Spanish with customers every week.\n"),
    writeFile(join(root, "context", "broad", "notes.md"), "Alex mentored two junior analysts while at Juniper Analytics in 2022.\n"),
    writeFile(join(root, "jobs", "sample-role", "job.json"), JSON.stringify({ company: "Sample", title: "Support Engineer" })),
    writeFile(join(root, "jobs", "sample-role", "original_jd.txt"), "Sample needs REST API integration and customer onboarding experience."),
  ]);
  await buildContextManifest(
    root,
    { structuredPaths: options.structured === false ? [] : ["context/structured/work.md", "context/structured/recruiter-notes.md"], broadPaths: ["context/broad/notes.md"], careerPaths: [], jobPaths: [], jobIds: [] },
    { baseResumePath: "resumes/base.md", secondaryResumePaths: ["resumes/older.md"], linkedinProfilePath: null },
  );
  return root;
}

function resumeCheck(snapshot: EvidenceSnapshot, bullet: string, ids: string[]): ClaimFailure[] {
  const paths = [...new Set(ids.map((id) => snapshot.evidenceRows.find((row) => row.evidenceId === id)?.sourcePath ?? ""))];
  const markdown = `## Skills\n**Engineering:** TypeScript, REST APIs\n\n## Professional Experience\n**Northstar Labs** — Solutions Engineer\n* ${bullet}`;
  const audit = {
    schemaVersion: 1, validationStatus: "passed", evidenceSnapshotId: snapshot.snapshotId, manifestHash: snapshot.manifestHash, baseResumePath: snapshot.baseResumePath,
    artifactType: "resume", publicArtifact: "Alex_Morgan_Sample_Resume.md",
    claimMappings: [{ publicText: "**Engineering:** TypeScript, REST APIs", claimType: "baseline", evidenceIds: [], sourcePaths: ["resumes/base.md"] }, { publicText: bullet, claimType: "candidate", evidenceIds: ids, sourcePaths: paths, timeline: "current", ownership: "supported" }],
    sideBySideChanges: [], suggestedAdditionalBullets: [], metricOpportunities: [],
  };
  const claimFailures: ClaimFailure[] = [];
  try { validateResumeAuditJson(audit, { publicMarkdown: markdown, publicArtifactName: "Alex_Morgan_Sample_Resume.md", snapshot, leanEvidenceMap: true, claimFailures }); } catch { /* document-level rules are not under test */ }
  return claimFailures;
}

describe("the base resume is evidence (both editions, ledger T8)", () => {
  it("gives every base line its own row, assigned to its role, and always routes them", async () => {
    delete process.env.JOBSENSEI_EDITION;
    const snapshot = await createEvidenceSnapshot(await workspace(), "sample-role");
    const base = snapshot.evidenceRows.filter((row) => row.evidenceId.startsWith("base:"));
    expect(base.map((row) => [row.evidenceId, row.employer])).toEqual([
      ["base:r1:b1", "Northstar Labs"], ["base:r1:b2", "Northstar Labs"], ["base:r2:b1", "Juniper Analytics"], ["base:skills:1", null],
    ]);
    expect(base[0]).toMatchObject({ sourcePath: "resumes/base.md", eligibility: "eligible", recencyBand: "current" });
    for (const row of base) expect(snapshot.applicationRouting?.selectedEvidenceIds).toContain(row.evidenceId);
  });

  it("lets a base-only candidate reword a base line citing it, but not add a tool the line never names", async () => {
    delete process.env.JOBSENSEI_EDITION;
    const snapshot = await createEvidenceSnapshot(await workspace({ structured: false }), "sample-role");
    expect(resumeCheck(snapshot, "Supported customer teams through REST API integrations and their rollout.", ["base:r1:b1"])).toEqual([]);
    const added = resumeCheck(snapshot, "Supported REST API integrations on AWS for customer teams.", ["base:r1:b1"]);
    expect(added.map((failure) => failure.message).join(" ")).toMatch(/AWS/);
  });

  it("refuses a base line from another role under this role", async () => {
    delete process.env.JOBSENSEI_EDITION;
    const snapshot = await createEvidenceSnapshot(await workspace({ structured: false }), "sample-role");
    const failures = resumeCheck(snapshot, "Answered customer questions about data exports.", ["base:r2:b1"]);
    expect(failures.map((failure) => failure.message).join(" ")).toMatch(/Juniper Analytics/);
  });

  it("earns fit credit in the Recruiter Edition, where the resume is often all a candidate has", async () => {
    process.env.JOBSENSEI_EDITION = "recruiter";
    const snapshot = await createEvidenceSnapshot(await workspace({ structured: false }), "sample-role");
    const table = "### Requirement Scoring\n| Requirement | Category | Weight | Material | Classification | Evidence |\n| --- | --- | ---: | --- | --- | --- |\n| REST API integration | core | 100% | yes | direct | base:r1:b1 |";
    const { markdown } = normalizeEvidenceClassifications(table, snapshot);
    expect(markdown).not.toMatch(/\| gap \|/);
  });

  it("earns no fit credit in the solo edition (ledger T5)", async () => {
    delete process.env.JOBSENSEI_EDITION;
    const snapshot = await createEvidenceSnapshot(await workspace({ structured: false }), "sample-role");
    const table = "### Requirement Scoring\n| Requirement | Category | Weight | Material | Classification | Evidence |\n| --- | --- | ---: | --- | --- | --- |\n| REST API integration | core | 100% | yes | direct | base:r1:b1 |";
    const { markdown } = normalizeEvidenceClassifications(table, snapshot);
    expect(markdown).toMatch(/\| gap \|/);
  });

  it("keeps the solo edition's rules for other files: notes and older resumes are not rows", async () => {
    delete process.env.JOBSENSEI_EDITION;
    const snapshot = await createEvidenceSnapshot(await workspace(), "sample-role");
    expect(snapshot.evidenceRows.some((row) => row.evidenceId.startsWith("file:"))).toBe(false);
    expect(snapshot.evidenceRows.find((row) => row.evidenceId === "context:work:sso")?.eligibility).toBe("corroboration-required");
  });
});

describe("every checked candidate file is evidence (Recruiter Edition, plan R4)", () => {
  it("makes rows from notes, recruiter notes, and older resumes, and every row eligible", async () => {
    process.env.JOBSENSEI_EDITION = "recruiter";
    const snapshot = await createEvidenceSnapshot(await workspace(), "sample-role");
    const files = snapshot.evidenceRows.filter((row) => row.evidenceId.startsWith("file:"));
    expect(files.map((row) => [row.sourcePath, row.employer, row.claim])).toEqual(expect.arrayContaining([
      ["context/structured/recruiter-notes.md", "Northstar Labs", "At Northstar Labs, Alex trained new support hires on the ticket queue."],
      ["context/structured/recruiter-notes.md", null, "Speaks Spanish with customers every week."],
      ["context/broad/notes.md", "Juniper Analytics", "Alex mentored two junior analysts while at Juniper Analytics in 2022."],
      ["resumes/older.md", "Juniper Analytics", "Built a weekly export report in Excel for the support team."],
    ]));
    expect(snapshot.evidenceRows.find((row) => row.evidenceId === "context:work:sso")?.eligibility).toBe("eligible");
    expect(snapshot.evidenceRows.every((row) => row.eligibility === "eligible")).toBe(true);
  });

  it("lets a recruiter note back a bullet alone, and still checks its named terms", async () => {
    process.env.JOBSENSEI_EDITION = "recruiter";
    const snapshot = await createEvidenceSnapshot(await workspace(), "sample-role");
    const note = snapshot.evidenceRows.find((row) => row.claim.startsWith("At Northstar Labs"))!.evidenceId;
    expect(resumeCheck(snapshot, "Trained new support hires on the ticket queue.", [note])).toEqual([]);
    const tool = resumeCheck(snapshot, "Trained new support hires on the SQL ticket queue.", [note]);
    expect(tool.map((failure) => failure.message).join(" ")).toMatch(/SQL/);
  });

  it("skips headings and metadata lines and caps a long file", () => {
    const rows = candidateFileRows(`# Notes\n- source_role: notes\n\n## Northstar Labs 2024 - Present\n- Ran weekly onboarding calls for new customer accounts.\n${"- Another real line about the work done here.\n".repeat(100)}`, "context/broad/n.md", null, [{ name: "Northstar Labs", dateRange: "2024 - Present" }]);
    expect(rows[0]).toMatchObject({ evidenceId: "file:broad-n:1", employer: "Northstar Labs", recencyBand: "current" });
    expect(rows).toHaveLength(80);
  });
});

describe("unchanged base lines count for the current role (decision T8, found live 2026-11-11)", () => {
  it("counts base-resume bullets kept under a current role as backed by that role's record", async () => {
    const { currentEmployerRecencyStats } = await import("../electron/application-artifacts");
    const kept = ["Run discovery and product demos for operations buyers.", "Write proposals with legal and finance."];
    const markdown = `**Northstar Labs** — Account Executive | Feb 2022 - Present\n- Manage about 40 mid-market accounts.\n- ${kept[0]}\n- ${kept[1]}\n\n**EDUCATION**\n**Example University**`;
    const audit = { claimMappings: [
      { publicText: "Manage about 40 mid-market accounts.", claimType: "candidate", evidenceIds: ["file:notes:1"] },
      ...kept.map((publicText) => ({ publicText, claimType: "baseline", evidenceIds: [] })),
    ] };
    const snapshot = (band: string) => ({
      canonicalResume: { employers: [{ name: "Northstar Labs", originalBullets: kept }] },
      evidenceRows: [{ evidenceId: "base:r1:b1", recencyBand: band }, { evidenceId: "file:notes:1", recencyBand: "current" }],
    });
    expect(currentEmployerRecencyStats(markdown, audit as never, snapshot("current") as never)).toEqual({ total: 3, recent: 3 });
    expect(currentEmployerRecencyStats(markdown, audit as never, snapshot("historical") as never)).toEqual({ total: 3, recent: 1 });
  });
});
