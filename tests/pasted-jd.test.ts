import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stagePastedJobDescription } from "../electron/jd-fetch";
import { stageFetchedJobDescription } from "../electron/evidence-snapshot";
import { pastedJdPrompt } from "../src/shared/job-queue";

const JD = `# Support Analyst\n\nCompany: Northstar Labs\nLocation: Remote\n\n## What you'll do\n${"- Help customers connect their data and fix sync issues.\n".repeat(12)}`;

describe("pasted JD staging", () => {
  it("stages a pasted JD where jd:fetch stages links, so the snapshot creates original_jd.md", async () => {
    const root = await mkdtemp(join(tmpdir(), "sensei-paste-"));
    const meta = await stagePastedJobDescription(root, `${JD}\u0007`, new Date("2026-10-25T12:00:00Z"));
    expect(meta).toMatchObject({ url: "pasted", company: "Northstar Labs", title: "Support Analyst", location: "Remote", suggestedJobId: "northstar-labs-support-analyst" });
    const staged = await readFile(join(root, ".sensei", "fetched_jd.md"), "utf8");
    expect(staged).not.toContain("\u0007");
    await stageFetchedJobDescription(root, "northstar-labs-support-analyst");
    expect(await readFile(join(root, "jobs", "northstar-labs-support-analyst", "original_jd.md"), "utf8")).toContain("Help customers connect");
  });

  it("rejects non-text, too-short, and too-long pastes", async () => {
    const root = await mkdtemp(join(tmpdir(), "sensei-paste-"));
    await expect(stagePastedJobDescription(root, 42)).rejects.toThrow(/text/);
    await expect(stagePastedJobDescription(root, "Short note")).rejects.toThrow(/too short/);
    await expect(stagePastedJobDescription(root, "x".repeat(200_001))).rejects.toThrow(/too long/);
  });

  it("sends Agy one line", () => {
    expect(pastedJdPrompt()).toBe("Evaluate the job description I pasted and draft the application");
    expect(pastedJdPrompt("focus on\nthe API work")).not.toContain("\n");
  });
});
