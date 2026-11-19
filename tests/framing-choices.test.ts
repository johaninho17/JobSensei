// #97: keep or revert each line the framing setting flags. Fictional candidate only (examples/demo-workspace).
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { baseBulletInPlace, loadCanonicalResumeBaseline } from "../electron/canonical-resume";
import { linesPastFraming } from "../electron/application-validation";
import { lineKey, type RatedLine } from "../electron/stretch-score";
import type { FramingLine } from "../src/shared/schemas";

const made: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.resetModules(); await Promise.all(made.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

const BASE = "resumes/Alex_Morgan_Resume.md";
const BASE_BULLET = "Implemented a centralized Redis caching layer and connection pooling strategy, reducing core PostgreSQL database read latency by 42% during peak traffic bursts.";
const DRAFTED = "Owned the enterprise-wide caching strategy across every platform domain.";

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sensei-framing-"));
  made.push(root);
  await mkdir(join(root, "resumes"), { recursive: true });
  await cp(join("examples/demo-workspace", BASE), join(root, BASE));
  return root;
}

describe("what Revert puts back (#97)", () => {
  it("is the base resume's bullet in the same role and position", async () => {
    const root = await workspace();
    const baseline = await loadCanonicalResumeBaseline(root, BASE);
    const base = await readFile(join(root, BASE), "utf8");
    const drafted = base.replace(BASE_BULLET, DRAFTED);
    expect(baseBulletInPlace(drafted, baseline, DRAFTED, lineKey)).toBe(BASE_BULLET);
    // A line the base resume already has, or one that isn't a role bullet, has nothing to go back to.
    expect(baseBulletInPlace(base, baseline, BASE_BULLET, lineKey)).toBeNull();
    expect(baseBulletInPlace(drafted, baseline, "A sentence that is nowhere in the resume.", lineKey)).toBeNull();
    // When the role gained a bullet, positions no longer line up, so nothing is offered.
    const added = drafted.replace(`- ${DRAFTED}`, `- Ran a brand new program for all partners.\n- ${DRAFTED}`);
    expect(baseBulletInPlace(added, baseline, DRAFTED, lineKey)).toBeNull();
  });

  it("flags the lines past the setting, and only unsupported ones at beyond", () => {
    const lines: RatedLine[] = [0, 1, 2, 3].map((level) => ({ text: `line ${level}`, artifact: "resume", level: level as RatedLine["level"], reason: "" }));
    expect(linesPastFraming(lines, "framed").map((line) => line.level)).toEqual([3]);
    expect(linesPastFraming(lines, "reworded").map((line) => line.level)).toEqual([2, 3]);
    expect(linesPastFraming(lines, "beyond").map((line) => line.level)).toEqual([3]);
  });
});

describe("keep and revert (#97)", () => {
  /** A job whose resume has one flagged line; the validator is stubbed to flag it while it is in the file. */
  async function job(revertTo: string | null) {
    const root = await workspace();
    const folder = join(root, "jobs", "acme-support");
    await mkdir(join(folder, ".sensei"), { recursive: true });
    const resume = join(folder, "Alex_Acme_Resume.md");
    await writeFile(resume, `**ALEX MORGAN**\n\n**PROFESSIONAL EXPERIENCE**\n\n- First line.\n- ${DRAFTED}\n`);
    const validation = await import("../electron/application-validation");
    vi.spyOn(validation, "validateJobApplication").mockImplementation(async () => {
      const text = await readFile(resume, "utf8");
      const kept = JSON.parse(await readFile(join(folder, ".sensei/framing-choices.json"), "utf8").catch(() => "{\"kept\":[]}")).kept as string[];
      const framingLines: FramingLine[] = text.includes(DRAFTED) ? [{ text: DRAFTED, artifact: "resume", level: 2, reason: "Stronger than its evidence: owned.", revertTo, kept: kept.includes(DRAFTED) }] : [];
      return { framingLines } as never;
    });
    const choices = await import("../electron/framing-choices");
    return { root, resume, folder, choices };
  }

  it("Revert swaps only that bullet for the base line", async () => {
    const { root, resume, choices } = await job(BASE_BULLET);
    expect(await choices.revertFramingLine(root, "acme-support", DRAFTED)).toEqual([]);
    expect(await readFile(resume, "utf8")).toBe(`**ALEX MORGAN**\n\n**PROFESSIONAL EXPERIENCE**\n\n- First line.\n- ${BASE_BULLET}\n`);
  });

  it("Keep records the line, which then shows as kept", async () => {
    const { root, folder, choices } = await job(null);
    const lines = await choices.keepFramingLine(root, "acme-support", DRAFTED);
    expect(lines.map((line) => line.kept)).toEqual([true]);
    expect(JSON.parse(await readFile(join(folder, ".sensei/framing-choices.json"), "utf8"))).toEqual({ kept: [DRAFTED] });
    // Keeping it twice doesn't add it twice.
    await choices.keepFramingLine(root, "acme-support", DRAFTED);
    expect(JSON.parse(await readFile(join(folder, ".sensei/framing-choices.json"), "utf8")).kept).toHaveLength(1);
  });

  it("refuses Revert when the base resume has no line in that place", async () => {
    const { root, resume, choices } = await job(null);
    await expect(choices.revertFramingLine(root, "acme-support", DRAFTED)).rejects.toThrow(/no line in that place/);
    expect(await readFile(resume, "utf8")).toContain(DRAFTED);
  });
});
