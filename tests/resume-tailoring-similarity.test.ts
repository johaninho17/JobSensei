import { describe, expect, it } from "vitest";
import { resumeTailoringSimilarity } from "../electron/application-validation";
import type { CanonicalResumeBaseline } from "../src/shared/schemas";

const baseline: CanonicalResumeBaseline = {
  schemaVersion: 1,
  baselineId: "fictional-baseline",
  sourcePath: "resumes/base.md",
  sourceSha256: "fictional-sha",
  structureSource: "markdown",
  headerLines: ["**ALEX MORGAN**", "alex@example.com"],
  skillsHeadingLine: "**SKILLS**",
  professionalHeadingLine: "**PROFESSIONAL EXPERIENCE**",
  employers: [{
    name: "Northstar Labs",
    protectedLines: ["**Northstar Labs**", "*Solutions Engineer* | *2024 - Present*"],
    title: "Solutions Engineer",
    dateRange: "2024 - Present",
    location: null,
    originalBulletCount: 3,
    originalBullets: [
      "Supported customer-facing API integrations.",
      "Documented platform setup and troubleshooting guidance.",
      "Tested SDK endpoints for customer use cases.",
    ],
  }],
  educationHeadingLine: "**EDUCATION**",
  educationLines: ["**Example University**", "Bachelor of Science"],
  originalSkillsLines: ["**Engineering:** TypeScript, Node.js", "**Delivery:** Technical documentation"],
  footprint: {
    sourcePath: "resumes/base.md",
    format: "markdown",
    status: "reliable",
    wordCount: 80,
    experienceBulletCount: 3,
    currentEmployerBulletCount: 3,
    targetWordMin: 72,
    targetWordMax: 88,
    experienceWordCount: 18,
    averageExperienceBulletWords: 6,
    targetExperienceWordMin: 16,
    targetExperienceWordMax: 20,
  },
  warnings: [],
};

function resume(bullets: string[]): string {
  return `**ALEX MORGAN**\nalex@example.com\n\n**SKILLS**\n**Engineering:** TypeScript, Node.js\n**Delivery:** Technical documentation\n\n**PROFESSIONAL EXPERIENCE**\n**Northstar Labs**\n${bullets.map((bullet) => `- ${bullet}`).join("\n")}\n\n**EDUCATION**\n**Example University**`;
}

describe("resume tailoring similarity", () => {
  it("identifies a near-copy of the canonical editable content", () => {
    const result = resumeTailoringSimilarity(resume(baseline.employers[0].originalBullets), baseline, null);
    expect(result.nearIdenticalRatio).toBeGreaterThan(0.8);
    expect(result.substantiveMappedChangeCount).toBe(0);
  });

  it("recognizes that distinct evidence-backed wording is not a near-copy", () => {
    const changed = resume([
      "Scoped API mappings for customer onboarding workflows.",
      "Debugged authentication failures with reproducible endpoint tests.",
      "Turned implementation findings into concise setup guides.",
    ]);
    const result = resumeTailoringSimilarity(changed, baseline, null);
    expect(result.nearIdenticalBulletRatio).toBeLessThan(0.5);
  });
});
