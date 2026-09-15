import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { ClaimValidationError, validateCoverLetterAuditJson, validateResumeAuditJson } from "../electron/application-artifacts";
import { buildContextManifest } from "../electron/context";
import { createEvidenceSnapshot } from "../electron/evidence-snapshot";
import { finalizeApplication } from "../electron/application-finalize";
import type { EvidenceSnapshot } from "../src/shared/schemas";

async function fixtureWorkspace(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "sensei-evidence-"));
  await Promise.all([
    mkdir(join(workspace, ".sensei"), { recursive: true }),
    mkdir(join(workspace, "context", "structured"), { recursive: true }),
    mkdir(join(workspace, "context", "broad"), { recursive: true }),
    mkdir(join(workspace, "resumes"), { recursive: true }),
    mkdir(join(workspace, "jobs", "sample-role"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(workspace, "resumes", "base.md"), `# **ALEX MORGAN**
alex@example.com

## **SKILLS**
**Engineering:** TypeScript

## **PROFESSIONAL EXPERIENCE**
### **Northstar Labs**
*Solutions Engineer* | *2024 - Present*
- Supported API integrations.
- Documented integration setup.
- Tested SDK examples.
- Troubleshot authentication failures.
- Translated customer requirements.
- Coordinated implementation feedback.
- Built internal workflow tools.
- Reviewed data mappings.
- Added automated checks.
- Supported deployment validation.

## **EDUCATION**
### **Example University**
Bachelor of Science
`),
    writeFile(join(workspace, "context", "denylist.md"), `# Career Claim Denylist

| Rule ID | Blocked claim or upgrade | Required safe handling |
| --- | --- | --- |
| deny:example:unsupported-ownership | Unsupported platform ownership | Use testing scope only. |
| deny:example:unsupported-metric | Unsupported 20 percent | Remove it. |
`),
    writeFile(join(workspace, "context", "application_voice_profile.md"), `# Application Voice Profile

- source_role: application-style-policy
- factual_authority: none

Use plain professional language after factual drafting.
`),
    writeFile(join(workspace, "context", "structured", "README.md"), "# Retrieval guidance"),
    writeFile(join(workspace, "context", "structured", "work.md"), `# Work

- source_role: direct project notes
- confidence: high

## Evidence Inventory

| Evidence ID | Year | Project | Explicit claim | Scope note | Source locator | Confidence | Public use |
| --- | --- | --- | --- | --- | --- | --- | --- |
| context:work:api | 2025 | Northstar Labs | Configured and tested API integrations for customer workflows. | Configuration and testing scope. | Project notes, API section | high | eligible |
| context:work:metric | 2025 | Northstar Labs | Tested 12 API workflows. | Testing scope. | Project notes, test section | high | eligible |
`),
    writeFile(join(workspace, "context", "broad", "notes.md"), "Raw clarification that must not become independent proof."),
    writeFile(join(workspace, "jobs", "sample-role", "job.json"), JSON.stringify({ company: "Sample", title: "Engineer" })),
    writeFile(join(workspace, "jobs", "sample-role", "original_jd.txt"), "Sample needs API integration and customer workflow experience."),
  ]);
  await buildContextManifest(
    workspace,
    {
      structuredPaths: ["context/structured/work.md", "context/structured/README.md"],
      broadPaths: ["context/broad/notes.md"],
      careerPaths: [],
      jobPaths: [],
      jobIds: [],
    },
    { baseResumePath: "resumes/base.md", secondaryResumePaths: [], linkedinProfilePath: null },
  );
  return workspace;
}

function auditSnapshot(): EvidenceSnapshot {
  return {
    schemaVersion: 1,
    snapshotId: "snapshot-1",
    jobId: "sample-role",
    generatedAt: "2026-07-29T00:00:00.000Z",
    manifestGeneratedAt: "2026-07-29T00:00:00.000Z",
    manifestHash: "manifest-1",
    baseResumePath: "resumes/base.md",
    secondaryResumePaths: [],
    selectedStructuredPaths: ["context/structured/work.md"],
    selectedBroadPaths: [],
    selectedJobFiles: [],
    policyPaths: ["context/denylist.md"],
    sourceFiles: [],
    evidenceRows: [{
      evidenceId: "context:work:api",
      year: "2025",
      startYear: 2025,
      endYear: 2026,
      isOngoing: true,
      recencyBand: "current",
      project: "Northstar Labs",
      employer: "Northstar Labs",
      claim: "Configured and tested API integrations for customer workflows.",
      scope: "Configuration and testing scope.",
      sourcePath: "context/structured/work.md",
      sourceFamily: null,
      sourceLocator: "API section",
      confidence: "high",
      classification: "verified",
      eligibility: "eligible",
    }, {
      evidenceId: "context:work:customer",
      year: "2026",
      project: "Northstar Labs",
      employer: "Northstar Labs",
      claim: "Translated customer requirements into technical workflow support.",
      scope: "Customer-facing support contribution.",
      sourcePath: "context/structured/work.md",
      sourceFamily: null,
      sourceLocator: "Customer section",
      confidence: "high",
      classification: "verified",
      eligibility: "eligible",
    }],
    denylistRules: [
      { ruleId: "deny:example:unsupported-ownership", blockedClaim: "Unsupported platform ownership", safeHandling: "Use testing scope only." },
      { ruleId: "deny:example:unsupported-metric", blockedClaim: "Unsupported 20 percent", safeHandling: "Remove it." },
    ],
  };
}

describe("context-authoritative evidence", () => {
  it("creates a hashed snapshot from selected evidence, excludes indexes, and always includes policy", async () => {
    const workspace = await fixtureWorkspace();
    const snapshot = await createEvidenceSnapshot(workspace, "sample-role");
    expect(snapshot.baseResumePath).toBe("resumes/base.md");
    expect(snapshot.selectedStructuredPaths).toEqual(["context/structured/work.md"]);
    expect(snapshot.selectedBroadPaths).toEqual(["context/broad/notes.md"]);
    expect(snapshot.sourceFiles.some((source) => source.path === "context/denylist.md" && source.sourceRole === "policy")).toBe(true);
    expect(snapshot.sourceFiles.some((source) => source.path === "context/application_voice_profile.md" && source.sourceRole === "policy")).toBe(true);
    expect(snapshot.policyPaths).toContain("context/application_voice_profile.md");
    expect(snapshot.evidenceRows.some((row) => row.sourcePath === "context/application_voice_profile.md")).toBe(false);
    expect(snapshot.sourceFiles.some((source) => source.path === "context/structured/README.md")).toBe(false);
    expect(snapshot.evidenceRows.some((row) => row.evidenceId === "context:work:api" && row.eligibility === "eligible")).toBe(true);
    expect(snapshot.denylistRules).toHaveLength(2);
    const hidden = await readFile(join(workspace, "jobs", "sample-role", ".sensei", "evidence_snapshot.json"), "utf8");
    expect(JSON.parse(hidden).snapshotId).toBe(snapshot.snapshotId);
    const compactText = await readFile(join(workspace, "jobs", "sample-role", ".sensei", "application_context.json"), "utf8");
    const compact = JSON.parse(compactText);
    expect(compact.schemaVersion).toBe(2);
    expect(compact.evidenceRows.map((row: { evidenceId: string }) => row.evidenceId)).toEqual(snapshot.applicationRouting?.selectedEvidenceIds);
    expect(compact).not.toHaveProperty("canonicalResume");
    expect(compact).not.toHaveProperty("candidateProfile");
    expect(compact).not.toHaveProperty("routes");
    expect(compact).not.toHaveProperty("stylePolicy");
    expect(Buffer.byteLength(compactText)).toBeLessThan(65_000);
  });

  it("materializes the single generated bundle into public drafts and derived verification state", async () => {
    const workspace = await fixtureWorkspace();
    const snapshot = await createEvidenceSnapshot(workspace, "sample-role");
    const run = JSON.parse(await readFile(join(workspace, "jobs", "sample-role", ".sensei", "application_run.json"), "utf8"));
    const bullets = Array.from({ length: 10 }, (_, index) => ({
      text: `Configured and tested API integration workflow ${index + 1}.`,
      evidenceIds: ["context:work:api"],
    }));
    await writeFile(join(workspace, "jobs", "sample-role", ".sensei", "application_bundle.json"), JSON.stringify({
      schemaVersion: 1,
      applicationRunId: run.runId,
      evidenceSnapshotId: snapshot.snapshotId,
      canonicalBaselineId: snapshot.canonicalResume?.baselineId,
      evaluationMarkdown: `# Application Evaluation

### Requirement Scoring
| Requirement | Category | Weight | Material | Classification | Evidence |
| --- | --- | ---: | --- | --- | --- |
| API integration | core | 40% | yes | direct | context:work:api |
| API testing | technical | 25% | yes | direct | context:work:api |
| Customer workflow support | scope | 15% | yes | strong_transferable | context:work:api |
| Reliable delivery | outcomes | 10% | yes | strong_transferable | context:work:metric |
| Product domain | domain | 5% | no | adjacent_transferable | context:work:api |
| Learnable tooling | learning | 5% | no | strong_transferable | context:work:metric |`,
      resume: {
        skillsLines: [{ text: "**Engineering:** TypeScript, API integration and testing", evidenceIds: ["context:work:api"] }],
        employers: [{ name: "Northstar Labs", bullets }],
      },
      coverLetter: {
        date: "September 15, 2026",
        recipientLines: ["Hiring Manager", "Sample"],
        salutation: "Dear Hiring Manager,",
        bodyParagraphs: [
          { sentences: [{ text: "I configured and tested API integrations for customer workflows.", evidenceIds: ["context:work:api"] }] },
          { sentences: [{ text: "I also tested twelve API workflows.", evidenceIds: ["context:work:metric"] }] },
          { sentences: [{ text: "Thank you for your consideration.", evidenceIds: [] }] },
        ],
        closing: "Sincerely,",
      },
      excludedClaims: [],
      warnings: [],
    }), "utf8");

    await finalizeApplication(workspace, "sample-role", false);

    const resume = await readFile(join(workspace, "jobs", "sample-role", "Candidate_Sample_Resume.md"), "utf8");
    const evidence = JSON.parse(await readFile(join(workspace, "jobs", "sample-role", ".sensei", "application_evidence.json"), "utf8"));
    expect(resume).toContain("Configured and tested API integration workflow 1.");
    expect(evidence.resume.claimMappings).toHaveLength(11);
    expect(evidence.coverLetter.careerArc).toHaveLength(2);
  });

  it("keeps employer context separate from candidate evidence", async () => {
    const workspace = await fixtureWorkspace();
    await mkdir(join(workspace, "context", "structured", "company"), { recursive: true });
    await writeFile(join(workspace, "context", "structured", "company", "northstar-profile.md"), `# Northstar Labs

- source_role: employer-context
- source_family: northstar-company-profile
- confidence: medium
- public_use: employer-scope-calibration-only

## Employer Context Inventory

| Context key | Topic | Publicly described context | Scope boundary | Source locator |
| --- | --- | --- | --- | --- |
| northstar-company:scale | Scale | Public company-size range is 11-50 employees. | Not candidate evidence. | Company page |
`);
    await buildContextManifest(
      workspace,
      { structuredPaths: ["context/structured/work.md", "context/structured/company/northstar-profile.md"], broadPaths: [], careerPaths: [], jobPaths: [], jobIds: [] },
      { baseResumePath: "resumes/base.md", secondaryResumePaths: [], linkedinProfilePath: null },
    );
    const snapshot = await createEvidenceSnapshot(workspace, "sample-role");
    const source = snapshot.sourceFiles.find((candidate) => candidate.path === "context/structured/company/northstar-profile.md");
    expect(source?.sourceRole).toBe("employer-context");
    expect(source?.sourceFamily).toBe("northstar-profile");
    expect(snapshot.evidenceRows.some((row) => row.sourcePath.includes("company/northstar-profile"))).toBe(false);
  });

  it("includes secondary resume text as historical reference without promoting it to evidence", async () => {
    const workspace = await fixtureWorkspace();
    await writeFile(join(workspace, "resumes", "secondary.md"), "# Older Resume\nBuilt an older internal reporting tool.\n");
    await buildContextManifest(
      workspace,
      { structuredPaths: ["context/structured/work.md"], broadPaths: [], careerPaths: [], jobPaths: [], jobIds: [] },
      { baseResumePath: "resumes/base.md", secondaryResumePaths: ["resumes/secondary.md"], linkedinProfilePath: null },
    );
    const snapshot = await createEvidenceSnapshot(workspace, "sample-role");
    const secondary = snapshot.sourceFiles.find((source) => source.path === "resumes/secondary.md");
    expect(secondary?.sourceRole).toBe("secondary-resume");
    expect(secondary?.contextText).toContain("older internal reporting tool");
    expect(snapshot.evidenceRows.some((row) => row.sourcePath === "resumes/secondary.md")).toBe(false);
  });

  it("attaches sentence and source details to evidence overlap warnings", () => {
    const snapshot = auditSnapshot();
    const audit = {
      schemaVersion: 1,
      artifactType: "resume" as const,
      publicArtifact: "Alex_Morgan_Sample_Resume.md",
      validationStatus: "passed" as const,
      evidenceSnapshotId: snapshot.snapshotId,
      manifestHash: snapshot.manifestHash,
      baseResumePath: snapshot.baseResumePath,
      claimMappings: [{ publicText: "Led unrelated quantum finance operations.", claimType: "candidate" as const, evidenceIds: ["context:work:api"], sourcePaths: ["context/structured/work.md"], timeline: "current" as const, ownership: "led" }],
      sideBySideChanges: [],
      suggestedAdditionalBullets: [],
    };
    try {
      validateResumeAuditJson(audit, { publicMarkdown: "* Led unrelated quantum finance operations.", publicArtifactName: audit.publicArtifact, snapshot });
      throw new Error("Expected evidence overlap validation to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(ClaimValidationError);
      expect((error as ClaimValidationError).explanation.sentence).toBe("Led unrelated quantum finance operations.");
      expect((error as ClaimValidationError).explanation.sources[0]).toMatchObject({ evidenceId: "context:work:api", sourcePath: "context/structured/work.md" });
    }
  });

  it("rejects stale, unselected, resume-only, metric, ownership, and denylisted resume claims", () => {
    const snapshot = auditSnapshot();
    const publicText = "* Configured and tested API integrations for customer workflows.\n* Translated customer requirements into technical workflow support.";
    const valid = {
      schemaVersion: 1,
      artifactType: "resume",
      publicArtifact: "Alex_Morgan_Sample_Resume.md",
      validationStatus: "passed",
      evidenceSnapshotId: snapshot.snapshotId,
      manifestHash: snapshot.manifestHash,
      baseResumePath: snapshot.baseResumePath,
      claimMappings: [
        { publicText: "Configured and tested API integrations for customer workflows.", claimType: "candidate", evidenceIds: ["context:work:api"], sourcePaths: ["context/structured/work.md"], timeline: "current", ownership: "tested" },
        { publicText: "Translated customer requirements into technical workflow support.", claimType: "candidate", evidenceIds: ["context:work:customer"], sourcePaths: ["context/structured/work.md"], timeline: "transition", ownership: "supported" },
      ],
      sideBySideChanges: [
        { employer: "Northstar Labs", originalText: "Maintained integrations.", tailoredText: "Configured and tested API integrations for customer workflows.", evidenceIds: ["context:work:api"], reason: "Surfaces direct selected evidence." },
        { employer: "Northstar Labs", originalText: "Supported customers.", tailoredText: "Translated customer requirements into technical workflow support.", evidenceIds: ["context:work:customer"], reason: "Surfaces direct selected evidence." },
        { employer: "Skills", originalText: "General tools", tailoredText: "API integrations", evidenceIds: ["context:work:api"], reason: "Surfaces a supported job keyword." },
      ],
      suggestedAdditionalBullets: [],
    } as const;
    expect(() => validateResumeAuditJson(valid, { publicMarkdown: publicText, publicArtifactName: valid.publicArtifact, snapshot })).not.toThrow();
    expect(() => validateResumeAuditJson({ ...valid, evidenceSnapshotId: "stale" }, { publicMarkdown: publicText, publicArtifactName: valid.publicArtifact, snapshot })).toThrow(/stale evidence snapshot/i);
    expect(() => validateResumeAuditJson(valid, { publicMarkdown: "* Claimed unsupported platform ownership.", publicArtifactName: valid.publicArtifact, snapshot })).toThrow(/deny:example:unsupported-ownership|mapping/i);
    const metricText = "* Configured and tested 20 API integrations.\n* Translated customer requirements into technical workflow support.";
    const metricAudit = { ...valid, claimMappings: [{ ...valid.claimMappings[0], publicText: "Configured and tested 20 API integrations." }, valid.claimMappings[1]], sideBySideChanges: [{ ...valid.sideBySideChanges[0], tailoredText: "Configured and tested 20 API integrations." }, valid.sideBySideChanges[1], valid.sideBySideChanges[2]] };
    expect(() => validateResumeAuditJson(metricAudit, { publicMarkdown: metricText, publicArtifactName: valid.publicArtifact, snapshot })).toThrow(/deny:example:unsupported-metric|metric/i);
  });

  it("requires a grounded prior-to-transition career arc for cover letters", () => {
    const snapshot = auditSnapshot();
    const publicText = "Earlier, I configured and tested API integrations for customer workflows. My responsibilities later grew to translating customer requirements into technical workflow support. I enjoy work that brings technical problem solving closer to customers.";
    const audit = {
      schemaVersion: 1,
      artifactType: "cover-letter",
      publicArtifact: "cover_letter.md",
      validationStatus: "passed",
      evidenceSnapshotId: snapshot.snapshotId,
      manifestHash: snapshot.manifestHash,
      baseResumePath: snapshot.baseResumePath,
      claimMappings: [
        { publicText: "Earlier, I configured and tested API integrations for customer workflows.", claimType: "candidate", evidenceIds: ["context:work:api"], sourcePaths: ["context/structured/work.md"], timeline: "prior", ownership: "tested" },
        { publicText: "My responsibilities later grew to translating customer requirements into technical workflow support.", claimType: "candidate", evidenceIds: ["context:work:customer"], sourcePaths: ["context/structured/work.md"], timeline: "transition", ownership: "supported" },
        { publicText: "I enjoy work that brings technical problem solving closer to customers.", claimType: "non-factual", evidenceIds: [], sourcePaths: [], timeline: null, ownership: "non-factual" },
      ],
      careerArc: [
        { stage: "Tested customer integrations", timeline: "prior", evidenceIds: ["context:work:api"] },
        { stage: "Transition into customer workflow support", timeline: "transition", evidenceIds: ["context:work:customer"] },
      ],
    } as const;
    expect(() => validateCoverLetterAuditJson(audit, { publicMarkdown: publicText, publicArtifactName: "cover_letter.md", snapshot })).not.toThrow();
    const noTransition = { ...audit, careerArc: [{ stage: "Current work", timeline: "current", evidenceIds: ["context:work:api"] }] };
    expect(() => validateCoverLetterAuditJson(noTransition, { publicMarkdown: publicText, publicArtifactName: "cover_letter.md", snapshot })).toThrow();
    const falseCurrentText = "Earlier, I configured and tested API integrations for customer workflows. I currently translate customer requirements into technical workflow support.";
    const falseCurrent = {
      ...audit,
      claimMappings: [
        audit.claimMappings[0],
        { ...audit.claimMappings[1], publicText: "I currently translate customer requirements into technical workflow support.", timeline: "current" as const },
      ],
      careerArc: [
        audit.careerArc[0],
        { stage: "Customer workflow support", timeline: "current" as const, evidenceIds: ["context:work:customer"] },
      ],
    };
    expect(() => validateCoverLetterAuditJson(falseCurrent, { publicMarkdown: falseCurrentText, publicArtifactName: "cover_letter.md", snapshot })).toThrow(/explicitly ongoing/i);
  });

});
