// Recruiter plan R0: left-out screens are absent from the recruiter build, not just hidden.
// Runs against a renderer built with JOBSENSEI_EDITION=recruiter (CI builds it first; skipped otherwise).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const assets = join(__dirname, "..", "dist-renderer", "assets");
const recruiterBuild = process.env.JOBSENSEI_EDITION === "recruiter" && existsSync(assets);

// Text that only the left-out screens contain (interview view, live window, questions, Learnings, Your content).
const LEFT_OUT = ["No interview rounds yet", "Answer anyway", "How far applications got", "Update from", "Delivery fixes", "Story bank", "Interview prep uses these exactly", "Check watched companies", "Job search finished",
  // Recruiter plan R8: the edition stops at applying and never treats a candidate as the user.
  "Prepare recruiter interview", "Start current-round mock", "Analyze latest debrief", "Went to interview", "Follow up on", "Follow-up due",
  "Get JobSensei ready", "Make it better", "facts about you", "tailor your application", "Tone and positioning presets", "Role themes and reusable bullets", "Interactive clarifying questions", "Claims I never make", "scores your fit", "application and interview prep"];

describe.skipIf(!recruiterBuild)("recruiter renderer bundle", () => {
  it("contains none of the left-out screens", () => {
    const code = readdirSync(assets).filter((name) => name.endsWith(".js")).map((name) => readFileSync(join(assets, name), "utf8")).join("\n");
    expect(LEFT_OUT.filter((text) => code.includes(text))).toEqual([]);
    expect(code).toContain("Recruiter Edition");
    // Only FEATURES.<name> is replaced at build time; a bare FEATURES left in the bundle crashes the page that uses it.
    expect(code).not.toMatch(/\bFEATURES\b/);
  });
});
