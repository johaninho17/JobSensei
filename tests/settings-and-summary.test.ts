import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildCoverLetterBrief, compactStyleRules, profileInstructionLines } from "../electron/evidence-snapshot";
import { composeCanonicalResume, loadCanonicalResumeBaseline, summaryIsEditable } from "../electron/canonical-resume";
import { jobDescriptionEchoes } from "../electron/application-validation";
import { deriveVoicePresets } from "../src/shared/voice-presets";
import type { CandidateProfile } from "../src/shared/schemas";

const temps: string[] = [];
afterEach(async () => { await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

function profile(overrides: { career?: Partial<CandidateProfile["career"]>; truth?: Partial<CandidateProfile["truth"]>; includeSummary?: boolean; antiSlop?: "aggressive" | "standard" } = {}): CandidateProfile {
  return {
    schemaVersion: 1,
    identity: { fullName: "Alex Morgan", artifactPrefix: "Alex_Morgan", email: "alex@example.com", phone: null, location: null, links: [] },
    sources: { baseResumePath: "resumes/Alex_Morgan_Resume.md", secondaryResumePaths: [], linkedinProfilePath: null, structuredContextRoots: [], broadContextRoots: [], denylistPath: null, applicationVoicePath: null },
    career: { employers: [], education: [], transitionSummary: "", preferredRoleFamilies: [], ...overrides.career },
    preferences: {
      resume: { includeSummary: overrides.includeSummary ?? false, totalExperienceBullets: { min: 10, max: 14 }, currentEmployerBullets: { min: 6, max: 8 }, skillsCategories: [] },
      coverLetter: {
        storyGuidance: [], voiceGuidance: [],
        narrativePillars: { turningPoints: "Moved from analytics into customer-facing work.", workingStyle: "Stays calm and writes things down when systems break.", personalValues: "Honest timelines." },
      },
      voice: { tonePreset: "direct_outcomes", customGuidance: "Keep it plain.", antiSlopStrictness: overrides.antiSlop ?? "aggressive", interactiveQuestions: "on_gaps", narrativeDepth: "journey_first" },
    },
    truth: { factualAuthority: "evidence", boundaries: [], ...overrides.truth },
    updatedAt: new Date().toISOString(),
  } as CandidateProfile;
}

describe("Settings reach Agy", () => {
  it("sends the story, career direction, tone, and custom guidance as style rules", () => {
    const rules = compactStyleRules("", profile({ career: { transitionSummary: "Analyst moving into solutions work." } }));
    expect(rules).toEqual(expect.arrayContaining([
      "My career direction: Analyst moving into solutions work.",
      "My career story: Moved from analytics into customer-facing work.",
      "How I work: Stays calm and writes things down when systems break.",
      "What I value: Honest timelines.",
      "Custom Tone Guidance: Keep it plain.",
    ]));
    expect(rules.some((rule) => rule.startsWith("Tone & Positioning Style:"))).toBe(true);
  });

  it("sends truth boundaries, confidential names, and anti-slop strictness as instructions", () => {
    const strict = profileInstructionLines(profile({ truth: { boundaries: ["Never claim people management."], confidentialNames: ["Northwind"] } }));
    expect(strict.join("\n")).toContain("Never claim people management.");
    expect(strict.join("\n")).toContain("Northwind");
    expect(strict.join("\n")).toContain("Avoid AI filler");
    const relaxed = profileInstructionLines(profile({ antiSlop: "standard" }));
    expect(relaxed.join("\n")).not.toContain("Avoid AI filler");
  });

  it("no tone preset tells Agy to use a phrase the cover-letter brief bans", () => {
    const banned = buildCoverLetterBrief("# Analyst\n\nCompany: Northstar Labs", null, null).prohibitedPatterns.map((pattern) => pattern.toLowerCase());
    const families = [[], ["Sales", "Business Development"], ["Product Management"], ["Human Resources"], ["Finance"], ["Software Engineering"], ["Customer Success"], ["Operations"]];
    for (const preferredRoleFamilies of families) {
      for (const preset of deriveVoicePresets(profile({ career: { preferredRoleFamilies } }))) {
        const guidance = preset.toneGuidance.toLowerCase();
        expect(banned.filter((pattern) => guidance.includes(pattern)), `${preset.id}`).toEqual([]);
      }
    }
  });
});

describe("cover-letter JD echo detection", () => {
  it("flags six or more words copied from the posting, ignoring company and role names", () => {
    const jd = "You will partner with enterprise customers to design scalable data pipelines across cloud platforms.";
    expect(jobDescriptionEchoes("Dear Hiring Manager,\nI want to design scalable data pipelines across cloud platforms for customers.", jd)).toHaveLength(1);
    expect(jobDescriptionEchoes("Dear Hiring Manager,\nI built reporting for a retail client and fixed their broken imports.", jd)).toEqual([]);
  });
});

describe("resume summary support", () => {
  const resume = (withSummary: boolean) => [
    "**Alex Morgan**",
    "alex@example.com | Portland, OR",
    ...(withSummary ? ["", "## Summary", "Analyst who turns messy data into decisions."] : []),
    "", "## Skills", "**Analytics:** SQL, Python",
    "", "## Professional Experience",
    "**Northstar Labs** | Data Analyst | 2022–Present", "- Built weekly revenue dashboards.", "- Cleaned CRM data.",
    "", "## Education", "B.S. Statistics",
  ].join("\n");

  async function baseline(withSummary: boolean) {
    const workspace = await mkdtemp(join(tmpdir(), "sensei-summary-"));
    temps.push(workspace);
    await mkdir(join(workspace, "resumes"), { recursive: true });
    await writeFile(join(workspace, "resumes", "base.md"), resume(withSummary));
    return loadCanonicalResumeBaseline(workspace, "resumes/base.md");
  }
  const draft = { summary: "Analyst who explains data to customers.", skillsLines: ["**Analytics:** SQL, Python"], employers: [{ name: "Northstar Labs", bullets: ["Built weekly revenue dashboards.", "Cleaned CRM data."] }] };

  it("keeps the summary out of the protected header", async () => {
    const parsed = await baseline(true);
    expect(parsed.summaryHeadingLine).toBe("## Summary");
    expect(parsed.originalSummaryLines).toEqual(["Analyst who turns messy data into decisions."]);
    expect(parsed.headerLines.join(" ")).not.toContain("messy data");
  });

  it("uses the tailored summary only when the toggle is on", async () => {
    const parsed = await baseline(true);
    expect(summaryIsEditable(parsed, profile({ includeSummary: true }))).toBe(true);
    expect(composeCanonicalResume(parsed, draft, { includeSummary: true })).toContain("Analyst who explains data to customers.");
    const off = composeCanonicalResume(parsed, draft, { includeSummary: false });
    expect(off).toContain("Analyst who turns messy data into decisions.");
    expect(off).not.toContain("explains data to customers");
  });

  it("ignores a drafted summary when the base resume has none", async () => {
    const parsed = await baseline(false);
    expect(parsed.summaryHeadingLine).toBeUndefined();
    expect(summaryIsEditable(parsed, profile({ includeSummary: true }))).toBe(false);
    const composed = composeCanonicalResume(parsed, draft, { includeSummary: true });
    expect(composed).not.toContain("Summary");
    expect(composed).not.toContain("explains data to customers");
  });
});
