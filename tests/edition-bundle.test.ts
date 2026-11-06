// Recruiter plan R0: left-out screens are absent from the recruiter build, not just hidden.
// Runs against a renderer built with JOBSENSEI_EDITION=recruiter (CI builds it first; skipped otherwise).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const assets = join(__dirname, "..", "dist-renderer", "assets");
const recruiterBuild = process.env.JOBSENSEI_EDITION === "recruiter" && existsSync(assets);

// Text that only the left-out screens contain (interview view, live window, questions, Learnings, Your content).
const LEFT_OUT = ["No interview rounds yet", "Answer anyway", "How far applications got", "Update from", "Delivery fixes", "Story bank", "Interview prep uses these exactly"];

describe.skipIf(!recruiterBuild)("recruiter renderer bundle", () => {
  it("contains none of the left-out screens", () => {
    const code = readdirSync(assets).filter((name) => name.endsWith(".js")).map((name) => readFileSync(join(assets, name), "utf8")).join("\n");
    for (const text of LEFT_OUT) expect(code, text).not.toContain(text);
    expect(code).toContain("Recruiter Edition");
  });
});
