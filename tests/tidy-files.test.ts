// Issue #238: one shape for interview recordings and no leftovers. Fictional companies only.
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyWorkspaceTidy, jobFor, planTidy, planWorkspaceTidy, stageOf, undoWorkspaceTidy } from "../electron/tidy-files";

const jobs = [
  { id: "northwind-solutions-engineer", reached: true },
  { id: "bluebird-support-engineer", reached: false },
  { id: "bluebird-customer-engineer", reached: true },
  { id: "kestrel-forward-deployed-engineer", reached: true },
];

describe("names and jobs", () => {
  it("reads the stage from the name", () => {
    expect(stageOf("northwind_hiring_manager (1).md")).toBe("hiring-manager");
    expect(stageOf("Pat Lee Interview-recruiter.md")).toBe("recruiter");
    expect(stageOf("kestrel_recruiter-manager.md")).toBe("recruiter-hiring-manager");
    expect(stageOf("intrerview_transcript.txt")).toBe("interview");
    expect(stageOf("intro_summary.txt")).toBe("intro-summary");
    expect(stageOf("notes1.txt")).toBeNull();
  });
  it("links a company to its job: the only one, or the only one that reached interviews", () => {
    expect(jobFor("Northwind", jobs)).toBe("northwind-solutions-engineer");
    expect(jobFor("bluebird", jobs)).toBe("bluebird-customer-engineer");
    expect(jobFor("kestrel-forward-deployed-engineer", jobs)).toBe("kestrel-forward-deployed-engineer");
    expect(jobFor("osprey", jobs)).toBeNull();
  });
});

describe("the plan", () => {
  it("files every recording in its job folder with one name pattern, and keeps notes, practice and memory apart", () => {
    const plan = planTidy({ jobs, leftovers: [], recordings: [
      "debrief/Northwind/Pat Lee Interview-recruiter.md",
      "debrief/Northwind/Sam Roe Interview-hiring-manager.md",
      "debrief/Northwind/mock-interviews/mock_interview_2.md",
      "debrief/bluebird_recruiter.md",
      "debrief/kestrel-forward-deployed-engineer/Kestrel_recruiter.md",
      "debrief/osprey_recruiter.md",
      "debrief/finchly/finchly1.txt",
      "debrief/team_interview_review.md",
      "debrief/interview-memory/role-index.json",
      "jobs/northwind-solutions-engineer/transcripts/recruiter-screen/2026-07-31_20-13-32_live_transcript.md",
    ] });
    expect(Object.fromEntries(plan.moves.map((step) => [step.from, step.to]))).toEqual({
      "debrief/Northwind/Pat Lee Interview-recruiter.md": "debrief/northwind-solutions-engineer/northwind-recruiter.md",
      "debrief/Northwind/Sam Roe Interview-hiring-manager.md": "debrief/northwind-solutions-engineer/northwind-hiring-manager.md",
      "debrief/Northwind/mock-interviews/mock_interview_2.md": "debrief/mock-interviews/mock-2.md",
      "debrief/bluebird_recruiter.md": "debrief/bluebird-customer-engineer/bluebird-recruiter.md",
      "debrief/kestrel-forward-deployed-engineer/Kestrel_recruiter.md": "debrief/kestrel-forward-deployed-engineer/kestrel-recruiter.md",
      "debrief/osprey_recruiter.md": "debrief/other/osprey-recruiter.md",
      "debrief/finchly/finchly1.txt": "debrief/other/finchly-1.txt",
      "debrief/team_interview_review.md": "debrief/notes/team-interview-review.md",
      "jobs/northwind-solutions-engineer/transcripts/recruiter-screen/2026-07-31_20-13-32_live_transcript.md": "debrief/northwind-solutions-engineer/northwind-recruiter-2026-07-31-2013.md",
    });
  });
  it("never gives two files one name, and leaves already-tidy files alone", () => {
    const plan = planTidy({ jobs, leftovers: [], existing: ["debrief/northwind-solutions-engineer/northwind-recruiter.md"], recordings: ["debrief/northwind-solutions-engineer/northwind-recruiter.md", "debrief/Northwind/northwind_recruiter.md"] });
    expect(plan.moves).toEqual([{ from: "debrief/Northwind/northwind_recruiter.md", to: "debrief/northwind-solutions-engineer/northwind-recruiter-2.md", why: "Recording for job northwind-solutions-engineer" }]);
  });
});

describe("apply and undo on a workspace", () => {
  let root = "";
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });
  it("moves files, backs up leftovers, keeps the import ledger in step, and undoes it all", async () => {
    root = await mkdtemp(join(tmpdir(), "tidy-"));
    const put = async (path: string, text = "x") => { await mkdir(join(root, path, ".."), { recursive: true }); await writeFile(join(root, path), text); };
    await put("jobs/northwind-solutions-engineer/original_jd.md"); await put("jobs/northwind-solutions-engineer/original_jd.txt");
    await put("jobs/northwind-solutions-engineer/interviews/01-recruiter/prep.md");
    await put("debrief/Northwind/Pat Lee Interview-recruiter.md", "transcript"); await put("debrief/Northwind/.DS_Store");
    await put("run.paste-rerun.json", "{}");
    await put("context/structured/interview-stories.md", "Imported from: debrief/Northwind/Pat Lee Interview-recruiter.md\nStory text stays.");
    await put(".sensei/content-sources.json", JSON.stringify({ files: { "debrief/Northwind/Pat Lee Interview-recruiter.md": { status: "imported" } } }));
    const plan = await planWorkspaceTidy(root);
    expect(plan.moves.map((step) => step.to)).toEqual(["debrief/northwind-solutions-engineer/northwind-recruiter.md"]);
    expect(plan.toBackup.map((item) => item.path).sort()).toEqual(["debrief/Northwind/.DS_Store", "jobs/northwind-solutions-engineer/original_jd.txt", "run.paste-rerun.json"]);
    await applyWorkspaceTidy(root, new Date("2026-11-26T12:00:00Z"));
    expect(await readdir(join(root, "debrief"))).toEqual(["northwind-solutions-engineer"]);
    expect(JSON.parse(await readFile(join(root, ".sensei/content-sources.json"), "utf8")).files).toHaveProperty(["debrief/northwind-solutions-engineer/northwind-recruiter.md"]);
    expect((await readdir(root)).includes("run.paste-rerun.json")).toBe(false);
    expect(await readFile(join(root, "context/structured/interview-stories.md"), "utf8")).toBe("Imported from: debrief/northwind-solutions-engineer/northwind-recruiter.md\nStory text stays.");
    await undoWorkspaceTidy(root);
    expect(await readFile(join(root, "debrief/Northwind/Pat Lee Interview-recruiter.md"), "utf8")).toBe("transcript");
    expect((await readdir(root)).includes("run.paste-rerun.json")).toBe(true);
    expect(await readFile(join(root, "context/structured/interview-stories.md"), "utf8")).toContain("debrief/Northwind/Pat Lee Interview-recruiter.md");
    expect(JSON.parse(await readFile(join(root, ".sensei/content-sources.json"), "utf8")).files).toHaveProperty(["debrief/Northwind/Pat Lee Interview-recruiter.md"]);
  });
});

describe("names that fooled the first pass", () => {
  it("reads the stage after the company, and treats a job's mock calls as practice", () => {
    const plan = planTidy({ jobs: [{ id: "northwind-solutions-engineer", reached: true }], leftovers: [], recordings: [
      "debrief/Onsiteco_recruiter.md",
      "jobs/northwind-solutions-engineer/transcripts/mock-call/Payroll_call_otter_ai/Payroll_call_transcript.txt",
      "jobs/northwind-solutions-engineer/transcripts/mock-call/Payroll_call_otter_ai/Payroll_call_summary.txt",
    ] });
    expect(plan.moves.map((step) => step.to).sort()).toEqual(["debrief/mock-interviews/northwind-mock-summary.txt", "debrief/mock-interviews/northwind-mock.txt", "debrief/other/onsiteco-recruiter.md"]);
  });
});

describe("a second run", () => {
  it("changes nothing once files are tidy", () => {
    const first = planTidy({ jobs, leftovers: [], recordings: ["debrief/Northwind/Pat Lee Interview-recruiter.md", "debrief/osprey_recruiter.md", "debrief/Northwind/mock-interviews/mock_interview_2.md", "jobs/northwind-solutions-engineer/transcripts/recruiter-screen/2026-07-31_20-13-32_live_transcript.md"] });
    const second = planTidy({ jobs, leftovers: [], recordings: first.moves.map((step) => step.to), existing: first.moves.map((step) => step.to) });
    expect(second.moves).toEqual([]);
  });
});
