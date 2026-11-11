// Recruiter plan R8 (P1): the Recruiter Edition is the recruiter's tool. Adding a candidate is the whole setup, nothing
// asks the candidate to describe themselves, and the edition stops at applying. Fictional candidates only.
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { featuresFor } from "../src/shared/edition";
import { readyToSend, setDraftsMarkApplied, statusLabel, effectiveStatus } from "../src/shared/tracker";
import { applyIntake } from "../electron/candidate-intake";
import { createCandidateProfile, readCandidateProfile } from "../electron/candidate-profile";
import { readActiveContextManifest } from "../electron/context";
import { computeReadiness } from "../electron/setup-readiness";
import { SettingsStore } from "../electron/settings";
import { updateJobTracker } from "../electron/tracker";

const temps: string[] = [];
const edition = process.env.JOBSENSEI_EDITION;
afterEach(async () => {
  setDraftsMarkApplied(true);
  if (edition === undefined) delete process.env.JOBSENSEI_EDITION; else process.env.JOBSENSEI_EDITION = edition;
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const exists = (path: string) => stat(path).then(() => true, () => false);
const RESUME = "# **ALEX MORGAN**\nalex@example.com\n\n## **SKILLS**\n**Tools:** Excel, Zendesk\n\n## **PROFESSIONAL EXPERIENCE**\n### **Northstar Labs**\n*Support Specialist* | *2023 - Present*\n- Answered customer tickets about billing and data exports.\n- Wrote help articles for common setup problems.\n\n## **EDUCATION**\n### **Example University**\nBachelor of Arts\n";

async function candidateFolder() {
  const root = await mkdtemp(join(tmpdir(), "sensei-intake-"));
  temps.push(root);
  const folder = join(root, "candidate");
  const outside = join(root, "from-recruiter");
  for (const dir of [folder, outside, join(folder, "context", "structured"), join(folder, "resumes")]) await mkdir(dir, { recursive: true });
  await writeFile(join(outside, "Alex Morgan resume.md"), RESUME);
  await writeFile(join(outside, "linkedin.txt"), "Alex Morgan, support specialist at Northstar Labs since 2023. Trained new support hires.\n");
  const store = new SettingsStore(join(folder, ".sensei", "app"));
  await createCandidateProfile(folder, { fullName: "Alex Morgan", artifactPrefix: "Alex_Morgan" }, await store.get());
  return { folder, outside, store };
}

describe("adding a candidate is the whole setup", () => {
  it("copies the resume, adds the recruiter's files and notes, and checks them for Agy", async () => {
    const { folder, outside, store } = await candidateFolder();
    const result = await applyIntake(folder, store, { resumePath: join(outside, "Alex Morgan resume.md"), files: [join(outside, "linkedin.txt")], notes: "- Speaks Spanish with customers." });
    expect(result.resume).toMatchObject({ ok: true });
    expect((await store.get()).baseResumePath).toBe("resumes/Alex-Morgan-resume.md");
    expect((await readCandidateProfile(folder))?.sources.baseResumePath).toBe("resumes/Alex-Morgan-resume.md");
    expect(result.files).toEqual(["context/structured/linkedin.txt", "context/structured/recruiter-notes.md"]);
    expect((await readActiveContextManifest(folder))?.selectedCareerPaths).toEqual(expect.arrayContaining(result.files));
    expect(await exists(join(outside, "Alex Morgan resume.md"))).toBe(true); // the recruiter's original is untouched
  });

  it("refuses a resume type the app can't keep the layout of", async () => {
    const { folder, outside, store } = await candidateFolder();
    await writeFile(join(outside, "resume.pages"), "x");
    await expect(applyIntake(folder, store, { resumePath: join(outside, "resume.pages") })).rejects.toThrow("Word (.docx) or Markdown (.md)");
  });

  it("lists only the recruiter's items: resume, files and notes, targets, cover letters, private names (no name, story, voice)", async () => {
    const { folder, outside, store } = await candidateFolder();
    await applyIntake(folder, store, { resumePath: join(outside, "Alex Morgan resume.md") });
    const readiness = await computeReadiness({ workspacePath: folder, profile: await readCandidateProfile(folder), settings: await store.get(), manifest: null, contextFileCount: 0, agy: { installed: true, signedIn: true }, features: featuresFor("recruiter") });
    expect(readiness.items.map((item) => item.id)).toEqual(["resume", "agy", "context", "targets", "private-names", "cover-letter"]);
    expect(readiness.ready).toBe(true);
    expect(readiness.items.find((item) => item.id === "resume")?.title).toBe("Base resume");
  });

  it("asks for the career story and voice only once cover letters are turned on", async () => {
    const { folder, outside, store } = await candidateFolder();
    await applyIntake(folder, store, { resumePath: join(outside, "Alex Morgan resume.md") });
    const profile = (await readCandidateProfile(folder))!;
    profile.preferences.coverLetter.enabled = true;
    const readiness = await computeReadiness({ workspacePath: folder, profile, settings: await store.get(), manifest: null, contextFileCount: 0, agy: { installed: true, signedIn: true }, features: featuresFor("recruiter") });
    expect(readiness.items.filter((item) => item.id === "story" || item.id === "voice").map((item) => item.title)).toEqual(["Career story (for cover letters)", "Writing voice (for cover letters)"]);
  });
});

describe("the edition stops at applying", () => {
  const drafted = { tracker: null, hasApplicationMaterials: true, interviewRoundLabel: null };
  it("shows drafted jobs as Ready to send until the recruiter marks them applied", () => {
    setDraftsMarkApplied(featuresFor("recruiter").draftsMarkApplied);
    expect(effectiveStatus(drafted)).toBe("saved");
    expect(readyToSend(drafted)).toBe(true);
    expect(statusLabel(drafted)).toBe("Ready to send");
    expect(statusLabel({ ...drafted, tracker: { status: "applied", appliedAt: "2026-11-10" } })).toBe("Applied");
  });

  it("keeps the solo rule: drafts mean applied", () => {
    setDraftsMarkApplied(featuresFor("solo").draftsMarkApplied);
    expect(statusLabel(drafted)).toBe("Applied");
    expect(readyToSend(drafted)).toBe(false);
  });

  it("sets no follow-up date when a recruiter marks a job applied", async () => {
    const { folder } = await candidateFolder();
    await mkdir(join(folder, "jobs", "northstar-support"), { recursive: true });
    process.env.JOBSENSEI_EDITION = "recruiter";
    const tracker = await updateJobTracker(folder, "northstar-support", { status: "applied" });
    expect(tracker.nextFollowUpAt).toBeNull();
    expect(tracker.appliedAt).not.toBeNull();
    delete process.env.JOBSENSEI_EDITION;
    await mkdir(join(folder, "jobs", "juniper-support"), { recursive: true });
    expect((await updateJobTracker(folder, "juniper-support", { status: "applied" })).nextFollowUpAt).not.toBeNull();
  });
});

describe("no interview actions in the Recruiter Edition", () => {
  it("leaves interviews out of the edition the job menu reads", async () => {
    expect(featuresFor("recruiter").interviews).toBe(false);
    const source = await readFile(new URL("../src/renderer/job-actions.ts", import.meta.url), "utf8");
    expect(source).toMatch(/if \(FEATURES\.interviews\) \{[\s\S]*Prepare recruiter interview[\s\S]*Analyze latest debrief[\s\S]*\n {2}\}/);
  });
});
