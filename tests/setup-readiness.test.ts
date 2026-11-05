import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeReadiness, type ReadinessInput } from "../electron/setup-readiness";
import { RESUME_PDF_ONLY } from "../src/shared/readiness";
import { candidateProfileSchema, type ContextManifest } from "../src/shared/schemas";

const DEMO_RESUME = resolve("examples/demo-workspace/resumes/Alex_Morgan_Resume.md");

const profile = (overrides: Record<string, unknown> = {}) => candidateProfileSchema.parse({
  schemaVersion: 1,
  identity: { fullName: "Alex Morgan", artifactPrefix: "Alex_Morgan" },
  sources: { baseResumePath: "resumes/Alex_Morgan_Resume.md" },
  career: {},
  preferences: { resume: {}, coverLetter: {} },
  truth: {},
  updatedAt: "2026-11-04T00:00:00.000Z",
  ...overrides,
});

describe("setup readiness", () => {
  let dir = "";
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });
  async function workspace() {
    dir = await mkdtemp(join(tmpdir(), "readiness-"));
    await mkdir(join(dir, "resumes"), { recursive: true });
    return dir;
  }
  const input = (overrides: Partial<ReadinessInput>): ReadinessInput => ({ workspacePath: dir, profile: null, settings: null, manifest: null, contextFileCount: 0, agy: { installed: true, signedIn: null }, ...overrides });
  const item = (readiness: Awaited<ReturnType<typeof computeReadiness>>, id: string) => readiness.items.find((entry) => entry.id === id)!;

  it("an empty workspace is not ready and names the first missing step", async () => {
    await workspace();
    const readiness = await computeReadiness(input({}));
    expect(readiness.ready).toBe(false);
    expect(readiness.blocker).toMatch(/^Finish setup first: your name and file prefix\./);
    expect(item(readiness, "resume").state).toBe("missing");
    expect(item(readiness, "story-bank").state).toBe("later");
  });

  it("a readable Markdown resume, a profile, and an installed Agy are enough to start", async () => {
    await workspace();
    await copyFile(DEMO_RESUME, join(dir, "resumes", "Alex_Morgan_Resume.md"));
    const readiness = await computeReadiness(input({ profile: profile() }));
    expect(item(readiness, "resume")).toMatchObject({ state: "done", detail: expect.stringMatching(/read \d+ jobs?, skills, and education/) });
    // What the app read is listed so the user can confirm it: one line per job, then skills and education.
    expect(item(readiness, "resume").lines[0]).toMatch(/\(\d+ bullets?\)$/);
    expect(item(readiness, "resume").lines.some((line) => /^Skills: \d+ lines? · Education: \d+ lines?/.test(line))).toBe(true);
    expect(readiness.ready).toBe(true);
    expect(readiness.blocker).toBeNull();
  });

  it("a PDF-only resume is a problem with the Setup wording; a PDF with its Markdown version beside it works", async () => {
    await workspace();
    await writeFile(join(dir, "resumes", "resume.pdf"), "%PDF-1.4 not a real pdf");
    const pdfOnly = await computeReadiness(input({ profile: profile({ sources: { baseResumePath: "resumes/resume.pdf" } }) }));
    expect(item(pdfOnly, "resume")).toMatchObject({ state: "problem", detail: RESUME_PDF_ONLY });
    expect(pdfOnly.ready).toBe(false);
    await copyFile(DEMO_RESUME, join(dir, "resumes", "resume.md"));
    await writeFile(join(dir, "resumes", "resume.pdf"), "%PDF-1.4 changed");
    const withCompanion = await computeReadiness(input({ profile: profile({ sources: { baseResumePath: "resumes/resume.pdf" } }) }));
    expect(item(withCompanion, "resume").state).toBe("done");
    // Removing the companion is noticed even though the PDF itself didn't change.
    await rm(join(dir, "resumes", "resume.md"));
    expect(item(await computeReadiness(input({ profile: profile({ sources: { baseResumePath: "resumes/resume.pdf" } }) })), "resume").state).toBe("problem");
  });

  it("Agy must be installed; a sign-in screen is reported as a problem", async () => {
    await workspace();
    await copyFile(DEMO_RESUME, join(dir, "resumes", "Alex_Morgan_Resume.md"));
    expect((await computeReadiness(input({ profile: profile(), agy: { installed: false, signedIn: null } }))).blocker).toMatch(/agy signed in/i);
    // Installed but not yet seen signed in: shown as a step to do, but jobs can be queued (the queue waits for Agy).
    const unknown = await computeReadiness(input({ profile: profile(), agy: { installed: true, signedIn: null } }));
    expect(item(unknown, "agy").state).toBe("missing");
    expect(unknown.ready).toBe(true);
    const waiting = await computeReadiness(input({ profile: profile(), agy: { installed: true, signedIn: false } }));
    expect(item(waiting, "agy").state).toBe("problem");
    expect(item((await computeReadiness(input({ profile: profile(), agy: { installed: true, signedIn: true } }))), "agy").state).toBe("done");
  });

  it("recommended steps follow the profile and the checked context files", async () => {
    await workspace();
    await copyFile(DEMO_RESUME, join(dir, "resumes", "Alex_Morgan_Resume.md"));
    // Readiness reads only the checked career paths from the manifest.
    const manifest = { selectedCareerPaths: ["context/structured/work.md", "context/structured/README.md"] } as unknown as ContextManifest;
    const unchecked = await computeReadiness(input({ profile: profile(), contextFileCount: 3 }));
    expect(item(unchecked, "context")).toMatchObject({ state: "missing", detail: expect.stringMatching(/none checked for Agy/) });
    const checked = await computeReadiness(input({ manifest, contextFileCount: 3, profile: profile({ career: { transitionSummary: "Support engineer moving into solutions work." }, truth: { confidentialNames: ["Orbit Health"] } }) }));
    expect(item(checked, "context")).toMatchObject({ state: "done", detail: "1 file checked for Agy (2 more not checked)." });
    expect(item(checked, "story").state).toBe("done");
    expect(item(checked, "private-names").state).toBe("done");
    expect(item(checked, "logistics")).toMatchObject({ state: "missing", detail: expect.stringMatching(/^Missing: location, work authorization/) });
  });
});
