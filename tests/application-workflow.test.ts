import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyApplicationArtifact,
  resumeArtifactStats,
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

  it("validates resumes with composite headers without throwing and detects bullets accurately", () => {
    const compositeResume = `**ALEX MORGAN — SOLUTIONS ENGINEER**
alex@example.com | linkedin.com/in/alex-morgan

**CORE COMPETENCIES & TECHNICAL SKILLS**
**Solutions Architecture:** Client Onboarding, Technical Discovery, API Guidance
**Software Engineering:** Python, TypeScript, Node.js, REST APIs, Microservices
**AI & Cloud Systems:** GCP, Agent Architectures, Docker, Looker, BigQuery

**PROFESSIONAL EXPERIENCE**
**Northstar Labs** — Customer Solutions Engineer | Sep 2023 - Present
- Led customer technical discovery and architecture planning for enterprise onboarding.
- Guided enterprise onboarding, converting client requirements into API documentation.
- Built and tested AI agent solutions using Agent Development Kit (ADK) and Python SDK.
- Constructed REST APIs and SQL schema mappings to evaluate query performance.
- Troubleshot authentication failures and API connectivity bottlenecks across live deployments.

**Acme Corp** — Software Developer | Apr 2023 - Jul 2023
- Built modular Angular and TypeScript frontend components to optimize user flows.
- Translated complex operational requirements into intuitive user interfaces.
- Conducted unit testing, debugging, and verification to maintain high code quality.

**Example Cloud Systems** — Cloud Developer | Apr 2022 - Oct 2022
- Engineered scalable microservices on GCP with Python data processing pipelines.
- Managed CloudSQL PostgreSQL databases, refining index configurations.
- Designed RESTful API endpoints using Node.js and Express.
- Maintained automated CI/CD deployment pipelines using Docker containers.

**EDUCATION & LANGUAGES**
**Example University** — Master of Science
**Languages:** English, French`;

    const stats = resumeArtifactStats(compositeResume);
    expect(stats.bulletCount).toBe(12);
    expect(stats.experienceWordCount).toBeGreaterThan(100);
    expect(() => validateApplicationArtifact(compositeResume, "resume")).not.toThrow();
  });

  it("strictly prevents private candidate profile data from entering public tests", async () => {
    const candidatePath = join(root, "data/profile/candidate.json");
    try {
      const raw = await readFile(candidatePath, "utf8");
      const profile = JSON.parse(raw);
      const sensitiveTerms: string[] = [
        profile.identity?.fullName,
        profile.identity?.email,
        profile.identity?.phone,
        ...(profile.career?.employers?.map((e: { name: string }) => e.name) || []),
      ].filter((term): term is string => Boolean(term && term.trim().length > 3));

      const testFiles = [
        "tests/application-workflow.test.ts",
        "tests/application-reliability.test.ts",
        "tests/resume-tailoring-similarity.test.ts",
        "tests/evidence-authority.test.ts",
        "tests/fit-scoring.test.ts",
        "tests/interviews.test.ts",
      ];

      for (const relPath of testFiles) {
        const content = await readFile(join(root, relPath), "utf8");
        for (const term of sensitiveTerms) {
          expect(content.toLowerCase()).not.toContain(term.toLowerCase());
        }
      }
    } catch (err: any) {
      if (err.code === "ENOENT" || err.code === "EPERM" || err.code === "EACCES") {
        // In environments without local profile access or restricted perms, pass
        return;
      }
      throw err;
    }
  });
});

