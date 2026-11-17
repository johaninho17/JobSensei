import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain script module shared with the issue commands
import { TITLE_PATTERN, featureLabels, indexMarkdown, issueBody, numberList } from "../scripts/issue-lib.mjs";

describe("issue flow helpers", () => {
  it("accepts titles with a type, a known scope, and an issue number", () => {
    expect(TITLE_PATTERN.test("fix(workspace): open role links in the browser (refs #4)")).toBe(true);
    expect(TITLE_PATTERN.test("feat(agy): Agy page shell (refs #31, FEAT-012)")).toBe(true);
    for (const bad of ["fixed stuff", "feat: big update", "fix(kitchen): sink (refs #2)", "fix(ui): no issue number"]) expect(TITLE_PATTERN.test(bad)).toBe(false);
  });

  it("writes an issue body with its feature and links", () => {
    const body = issueBody({ features: featureLabels("feat-002"), dependsOn: numberList("#4, 5"), problem: "Links do nothing.", acceptance: ["Links open"] });
    expect(body).toContain("**Feature:** FEAT-002");
    expect(body).toContain("**Depends on:** #4, #5 · **Blocks:** none");
    expect(body).toContain("- [ ] Links open");
    expect(() => featureLabels("jobs")).toThrow();
  });

  it("groups open issues by priority in the index and leaves closed ones out", () => {
    const label = (name: string) => ({ name });
    const text = indexMarkdown([
      { number: 7, title: "Later", state: "OPEN", labels: [label("P2"), label("FEAT-005")] },
      { number: 4, title: "Links | open", state: "OPEN", labels: [label("P1"), label("FEAT-002"), label("status:blocked")] },
      { number: 1, title: "Done", state: "CLOSED", labels: [label("P0")] },
      { number: 9, title: "Someday", state: "OPEN", labels: [label("P1"), label("future")] },
    ]);
    expect(text.indexOf("## P1")).toBeLessThan(text.indexOf("## P2"));
    expect(text).toContain("| #4 | Links \\| open | FEAT-002 | yes |");
    expect(text).not.toContain("Done");
    expect(text.indexOf("## Later (future)")).toBeGreaterThan(text.indexOf("## P2"));
    expect(text.indexOf("Someday")).toBeGreaterThan(text.indexOf("## Later (future)"));
    expect(text).toContain("3 open, 1 of them for later.");
  });

  it("prints a new issue without creating it on a dry run", () => {
    const out = execFileSync(process.execPath, ["scripts/create-issue.mjs", "--title", "Example", "--feature", "FEAT-009", "--problem", "Example problem.", "--depends-on", "3", "--dry-run"], { encoding: "utf8" });
    expect(out).toContain("Labels: P2, FEAT-009, status:blocked");
  });
});
