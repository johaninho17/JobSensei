import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyApplicationArtifact,
  validateApplicationArtifact,
} from "../electron/application-artifacts";
import { pdfOutputName } from "../electron/pdf-export";
import { applicationBundleSchema, candidateProfileSchema, pdfExportRequestSchema } from "../src/shared/schemas";

const root = process.cwd();

describe("public application workflow", () => {
  it("classifies generic public artifacts and derives a candidate-safe PDF name", () => {
    expect(classifyApplicationArtifact("Alex_Morgan_Example_Labs_Resume.md")).toBe("resume");
    expect(classifyApplicationArtifact("cover_letter.md")).toBe("cover-letter");
    expect(pdfOutputName("/workspace/jobs/example/Alex_Morgan_Example_Labs_Resume.md", "resume", "Alex_Morgan")).toBe("Alex_Morgan_Resume.pdf");
    expect(pdfExportRequestSchema.parse({ relativePath: "jobs/example/cover_letter.md" }).textSize).toBe("auto");
  });

  it("keeps provenance out of employer-facing artifacts", () => {
    const resume = `# ALEX MORGAN

## SKILLS
TypeScript

## PROFESSIONAL EXPERIENCE
### Northstar Labs
- Built API integrations.

## EDUCATION
Example University

## PROVENANCE
Evidence ID: context:example:1`;
    expect(() => validateApplicationArtifact(resume, "resume")).toThrow(/provenance/i);
  });

  it("accepts a generic candidate profile with configurable preferences", () => {
    const profile = candidateProfileSchema.parse({
      schemaVersion: 1,
      identity: { fullName: "Alex Morgan", artifactPrefix: "Alex_Morgan", email: "alex@example.com", phone: null, location: "Portland, OR, USA", links: [] },
      sources: { baseResumePath: "resumes/base.md", secondaryResumePaths: [], linkedinProfilePath: null },
      career: { employers: [], education: [], transitionSummary: "", preferredRoleFamilies: ["Solutions Engineering"] },
      preferences: {
        resume: { includeSummary: false, totalExperienceBullets: { min: 10, max: 14 }, currentEmployerBullets: { min: 5, max: 7 }, skillsCategories: ["Engineering", "Delivery"] },
        coverLetter: { storyGuidance: ["career progression"], voiceGuidance: ["plain", "practical"] },
      },
      truth: { factualAuthority: "Selected structured career evidence", boundaries: ["Do not invent metrics."] },
      updatedAt: new Date().toISOString(),
    });
    expect(profile.identity.artifactPrefix).toBe("Alex_Morgan");
  });

  it("keeps all public workflow skills profile-driven and Agy-only", async () => {
    const paths = [
      ".agents/skills/jobsensei-application-pipeline/SKILL.md",
      ".agents/skills/jobsensei-application-writer/SKILL.md",
      ".agents/skills/jobsensei-resume-tailor/SKILL.md",
      ".agents/skills/jobsensei-career-evidence/SKILL.md",
      ".agents/skills/jobsensei-job-match/SKILL.md",
      ".agents/skills/jobsensei-interview-pipeline/SKILL.md",
      ".agents/skills/jobsensei-interview-coach/SKILL.md",
    ];
    const skills = await Promise.all(paths.map((path) => readFile(join(root, path), "utf8")));
    expect(skills.every((skill) => /candidate profile|candidateProfile|candidate\.json/i.test(skill))).toBe(true);
    expect(skills.join("\n")).toContain("candidate");
    expect(skills.join("\n")).not.toMatch(/Ollama|Groq|Deepgram|AssemblyAI|SFTP|live interview/i);
  });

  it("keeps removed provider APIs out of renderer and preload code", async () => {
    const [preload, renderer, schemas] = await Promise.all([
      readFile(join(root, "electron/preload.ts"), "utf8"),
      readFile(join(root, "src/renderer/App.tsx"), "utf8"),
      readFile(join(root, "src/shared/schemas.ts"), "utf8"),
    ]);
    const publicCode = `${preload}\n${renderer}\n${schemas}`;
    expect(publicCode).not.toMatch(/gmail:|interviews\.live|liveInterview|GROQ_API_KEY|DEEPGRAM_API_KEY|SENSEI_SFTP/i);
  });

  it("accepts one evidence-linked bundle for a complete application generation pass", () => {
    const bundle = applicationBundleSchema.parse({
      schemaVersion: 1,
      applicationRunId: "run-1",
      evidenceSnapshotId: "snapshot-1",
      canonicalBaselineId: "baseline-1",
      evaluationMarkdown: "# Application Evaluation\n\n### Requirement Scoring",
      resume: {
        skillsLines: [{ text: "**Engineering:** TypeScript", evidenceIds: ["context:work:typescript"] }],
        employers: [{ name: "Northstar Labs", bullets: [{ text: "Built API integrations.", evidenceIds: ["context:work:api"] }] }],
      },
      coverLetter: {
        date: "September 15, 2026",
        recipientLines: ["Hiring Manager", "Example Labs"],
        salutation: "Dear Hiring Manager,",
        bodyParagraphs: [
          { sentences: [{ text: "I began by building application integrations.", evidenceIds: ["context:work:api"] }] },
          { sentences: [{ text: "My work later expanded into customer delivery.", evidenceIds: ["context:work:customer"] }] },
          { sentences: [{ text: "Thank you for your consideration.", evidenceIds: [] }] },
        ],
        closing: "Sincerely,",
      },
      excludedClaims: [],
      warnings: [],
    });
    expect(bundle.resume.employers[0].bullets[0].evidenceIds).toEqual(["context:work:api"]);
    expect(bundle.coverLetter.bodyParagraphs[2].sentences[0].evidenceIds).toEqual([]);
  });

  it("publishes generic repository rules and a product-flow guide", async () => {
    const [rules, guide] = await Promise.all([
      readFile(join(root, "AGENTS.md"), "utf8"),
      readFile(join(root, "PRODUCT_FLOWS.md"), "utf8"),
    ]);
    expect(rules).toContain("application_bundle.json");
    expect(guide).toContain("## Customizing Skills");
    expect(`${rules}\n${guide}`).not.toMatch(/hardcoded candidate|private candidate data|personal employer history/i);
  });
});
