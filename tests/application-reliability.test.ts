import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  canonicalCoverLetterDrifts,
  canonicalResumeDrifts,
  composeCanonicalCoverLetter,
  composeCanonicalResume,
  loadCanonicalResumeBaseline,
} from "../electron/canonical-resume";
import { createCandidateProfile, readCandidateProfile } from "../electron/candidate-profile";
import { initializeWorkspace } from "../electron/workspace-init";
import { summarizeWorkspace } from "../electron/workspace";

const fictionalResume = `# **ALEX MORGAN**
alex@example.com | +1 555 010 2020 | linkedin.com/in/alex-morgan
Portland, OR, USA

## **SKILLS**
**Engineering:** TypeScript, Node.js, REST APIs
**Cloud:** Docker, PostgreSQL
**Delivery:** Technical discovery, documentation
**Languages:** English

## **PROFESSIONAL EXPERIENCE**
### **Northstar Labs**
*Solutions Engineer* | *2024 - Present* | *Portland, OR, USA*
- Supported customer-facing API integrations.
- Translated customer requirements into technical workflows.
- Tested SDK endpoints for customer use cases.
- Documented platform setup and troubleshooting guidance.
- Coordinated proof-of-concept feedback with product teams.

### **River Studio**
*Software Developer* | *2022 - 2024* | *Remote*
- Built TypeScript interfaces.
- Debugged application workflows.
- Integrated REST APIs.
- Added automated tests.
- Supported deployment troubleshooting.

## **EDUCATION**
### **Example University**
*Bachelor of Science in Computer Science*
`;

async function fixtureWorkspace(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "sensei-release-"));
  await initializeWorkspace(workspace);
  await mkdir(join(workspace, "resumes"), { recursive: true });
  await writeFile(join(workspace, "resumes", "base.md"), fictionalResume, "utf8");
  return workspace;
}

describe("application reliability", () => {
  it("creates a fresh cross-platform workspace without a profile", async () => {
    const workspace = await fixtureWorkspace();
    const summary = await summarizeWorkspace(workspace, join(workspace, ".."), {
      workspacePath: workspace,
      baseResumePath: null,
      secondaryResumePaths: [],
      linkedinProfilePath: null,
      theme: "day",
    });
    expect(summary.hasCandidateProfile).toBe(false);
    expect(summary.hasBaseResume).toBe(false);
    await expect(readFile(join(workspace, "profile", "candidate.json"), "utf8")).rejects.toThrow();
  });

  it("stores and reloads a generic candidate profile", async () => {
    const workspace = await fixtureWorkspace();
    const profile = await createCandidateProfile(workspace, {
      fullName: "Alex Morgan",
      artifactPrefix: "Alex_Morgan",
    }, {
      schemaVersion: 1,
      workspacePath: workspace,
      baseResumePath: "resumes/base.md",
      secondaryResumePaths: [],
      linkedinProfilePath: null,
      updatedAt: new Date().toISOString(),
    });
    expect(profile.identity.artifactPrefix).toBe("Alex_Morgan");
    expect((await readCandidateProfile(workspace))?.identity.fullName).toBe("Alex Morgan");
  });

  it("composes only editable resume content and protects identity and chronology", async () => {
    const workspace = await fixtureWorkspace();
    const baseline = await loadCanonicalResumeBaseline(workspace, "resumes/base.md");
    const composed = composeCanonicalResume(baseline, {
      skillsLines: baseline.originalSkillsLines,
      employers: baseline.employers.map((employer) => ({
        name: employer.name,
        bullets: employer.originalBullets.map((_, index) => `Documented evidence-backed contribution ${index + 1}.`),
      })),
    });
    expect(canonicalResumeDrifts(composed, baseline)).toEqual([]);
    expect(canonicalResumeDrifts(composed.replace("alex@example.com", "changed@example.com"), baseline).map((drift) => drift.code)).toContain("CONTACT_DRIFT");
    expect(canonicalResumeDrifts(composed.replace("2024 - Present", "2023 - Present"), baseline).map((drift) => drift.code)).toContain("EMPLOYMENT_DATE_DRIFT");
  });

  it("builds a cover letter from the protected candidate header", async () => {
    const workspace = await fixtureWorkspace();
    const baseline = await loadCanonicalResumeBaseline(workspace, "resumes/base.md");
    const cover = composeCanonicalCoverLetter(baseline, {
      date: "September 15, 2026",
      recipientLines: ["Hiring Manager", "Example Labs"],
      salutation: "Dear Hiring Manager,",
      bodyParagraphs: ["A grounded introduction.", "A grounded career example.", "A concise closing."],
      closing: "Sincerely,",
    });
    expect(canonicalCoverLetterDrifts(cover, baseline)).toEqual([]);
    expect(cover).toContain("ALEX MORGAN");
    expect(cover).toContain("alex@example.com");
  });

  it("sanitizes broken bold markers where closing asterisks leak into the contact line", async () => {
    const workspace = await fixtureWorkspace();
    const brokenHeaderResume = fictionalResume.replace(
      "# **ALEX MORGAN**\nalex@example.com",
      "**ALEX MORGAN\n**+1 (555) 019-2831 | alex@example.com",
    );
    await writeFile(join(workspace, "resumes/broken.md"), brokenHeaderResume, "utf8");
    const baseline = await loadCanonicalResumeBaseline(workspace, "resumes/broken.md");
    expect(baseline.headerLines[0]).toBe("**ALEX MORGAN**");
    expect(baseline.headerLines[1]).toBe("+1 (555) 019-2831 | alex@example.com | +1 555 010 2020 | linkedin.com/in/alex-morgan");

    const composed = composeCanonicalResume(baseline, {
      skillsLines: baseline.originalSkillsLines,
      employers: baseline.employers.map((employer) => ({
        name: employer.name,
        bullets: employer.originalBullets.map((_, index) => `Contribution ${index + 1}.`),
      })),
    });
    expect(composed).toContain("**ALEX MORGAN**\n+1 (555) 019-2831 | alex@example.com");
    expect(composed).not.toContain("**+1 (555)");
  });
});
