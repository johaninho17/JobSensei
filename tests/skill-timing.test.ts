// Agy's skills know when things happened (owner: the career-evidence skill) and tell experiences by naming them.
// Text-only rules for every candidate; this keeps a second wording from appearing beside the owner.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const OWNER = ".agents/skills/jobsensei-career-evidence/SKILL.md";
const POINTERS = [
  ".agents/skills/jobsensei-application-writer/SKILL.md",
  ".agents/skills/jobsensei-interview-pipeline/SKILL.md",
  ".agents/skills/jobsensei-resume-tailor/SKILL.md",
  ".agents/workflows/jobsensei-story-bank.md",
];

describe("timing: then and now", () => {
  it("has one owner, and the other skills point to it", () => {
    expect(read(OWNER)).toContain("## Timing: then and now (owner of this rule)");
    for (const path of POINTERS) expect(read(path), path).toContain("timing rule in the career-evidence skill");
    // The old tense rule lived in the writer; it is replaced by the pointer, not kept beside it.
    expect(read(".agents/skills/jobsensei-application-writer/SKILL.md")).not.toContain("Use present tense only for evidence with `isOngoing: true`");
  });

  it("makes experience answers name the experience and background answers go in order", () => {
    const interview = read(".agents/skills/jobsensei-interview-pipeline/SKILL.md");
    expect(interview).toContain("the first Say point says what the experience was");
    expect(interview).toContain("oldest first, one per employer, school, or phase");
    expect(interview).toContain("answer with the closest real experience");
    const storyBank = read(".agents/workflows/jobsensei-story-bank.md");
    expect(storyBank).toContain("the first cue says what the experience was");
    expect(storyBank).toContain("<how it ended>");
  });
});
