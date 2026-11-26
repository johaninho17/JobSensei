// Issues #238, #244: one flat folder of recordings named by company and stage, and no leftovers. Fictional companies.
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyWorkspaceTidy, jobFor, planTidy, planWorkspaceTidy, stageOf, undoWorkspaceTidy } from "../electron/tidy-files";
import { matchJob } from "../electron/content-refresh";
import { jobAtCompany, recordingFolder, recordingName } from "../src/shared/recordings";

const jobs = [
  { id: "northwind-solutions-engineer", reached: true },
  { id: "bluebird-support-engineer", reached: false },
  { id: "bluebird-customer-engineer", reached: true },
  { id: "kestrel-forward-deployed-engineer", reached: true },
  { id: "blue-harbor-success-engineer", reached: true },
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
  it("links a company to its job: the only one, or the only one that reached interviews; spacing in names doesn't matter", () => {
    expect(jobFor("Northwind", jobs)).toBe("northwind-solutions-engineer");
    expect(jobFor("bluebird", jobs)).toBe("bluebird-customer-engineer");
    expect(jobFor("kestrel-forward-deployed-engineer", jobs)).toBe("kestrel-forward-deployed-engineer");
    expect(jobFor("BlueHarbor", jobs)).toBe("blue-harbor-success-engineer");
    expect(jobAtCompany("blue-harbor-success-engineer", "blueharbor")).toBe(true);
    expect(jobFor("osprey", jobs)).toBeNull();
  });
  it("the scan links a flat recording to its job by its name", () => {
    const ids = jobs.map((job) => job.id);
    expect(matchJob("debrief/northwind-recruiter.md", ids)).toBe("northwind-solutions-engineer");
    expect(matchJob("debrief/bluebird-customer-engineer-recruiter.md", ids)).toBe("bluebird-customer-engineer");
    expect(matchJob("debrief/bluebird-recruiter.md", ids)).toBeNull();
    expect(matchJob("debrief/blueharbor-recruiter.md", ids)).toBe("blue-harbor-success-engineer");
    expect(matchJob("debrief/Northwind/call.md", ids)).toBe("northwind-solutions-engineer");
  });
  it("adds new recordings straight to debrief/ with a tidy name", () => {
    expect(recordingFolder("interview", "northwind-solutions-engineer")).toBe("debrief");
    expect(recordingFolder("practice", null)).toBe("debrief");
    expect(recordingName("Pat Lee Interview.txt", "interview", "northwind", "recruiter")).toBe("northwind-recruiter.txt");
    expect(recordingName("Call (1).md", "practice", null, null)).toBe("mock-call.md");
  });
});

describe("the plan", () => {
  it("puts every recording straight in debrief/ with one name pattern; interview memory stays", () => {
    const plan = planTidy({ jobs, leftovers: [], recordings: [
      "debrief/Northwind/Pat Lee Interview-recruiter.md",
      "debrief/Northwind/Sam Roe Interview-hiring-manager.md",
      "debrief/Northwind/mock-interviews/mock_interview_2.md",
      "debrief/bluebird_recruiter.md",
      "debrief/kestrel-forward-deployed-engineer/Kestrel_recruiter.md",
      "debrief/osprey_recruiter.md",
      "debrief/Onsiteco_recruiter.md",
      "debrief/team_interview_review.md",
      "debrief/interview-memory/role-index.json",
      "debrief/northwind-solutions-engineer/northwind-technical.md",
      "debrief/bluebird-customer-engineer/bluebird-technical.md",
      "debrief/notes/team-scan.txt",
      "jobs/northwind-solutions-engineer/transcripts/recruiter-screen/2026-07-31_20-13-32_live_transcript.md",
      "jobs/northwind-solutions-engineer/transcripts/mock-call/Payroll_call_otter_ai/Payroll_call_transcript.txt",
    ] });
    expect(Object.fromEntries(plan.moves.map((step) => [step.from, step.to]))).toEqual({
      "debrief/Northwind/Pat Lee Interview-recruiter.md": "debrief/northwind-recruiter.md",
      "debrief/Northwind/Sam Roe Interview-hiring-manager.md": "debrief/northwind-hiring-manager.md",
      "debrief/Northwind/mock-interviews/mock_interview_2.md": "debrief/mock-2.md",
      "debrief/bluebird_recruiter.md": "debrief/bluebird-customer-engineer-recruiter.md",
      "debrief/kestrel-forward-deployed-engineer/Kestrel_recruiter.md": "debrief/kestrel-recruiter.md",
      "debrief/osprey_recruiter.md": "debrief/osprey-recruiter.md",
      "debrief/Onsiteco_recruiter.md": "debrief/onsiteco-recruiter.md",
      "debrief/team_interview_review.md": "debrief/team-interview-review.md",
      "debrief/northwind-solutions-engineer/northwind-technical.md": "debrief/northwind-technical.md",
      "debrief/bluebird-customer-engineer/bluebird-technical.md": "debrief/bluebird-customer-engineer-technical.md",
      "debrief/notes/team-scan.txt": "debrief/team-scan.txt",
      "jobs/northwind-solutions-engineer/transcripts/recruiter-screen/2026-07-31_20-13-32_live_transcript.md": "debrief/northwind-recruiter-2026-07-31-2013.md",
      "jobs/northwind-solutions-engineer/transcripts/mock-call/Payroll_call_otter_ai/Payroll_call_transcript.txt": "debrief/northwind-mock.txt",
    });
  });
  it("never gives two files one name, and a second run changes nothing", () => {
    const first = planTidy({ jobs, leftovers: [], existing: ["debrief/northwind-recruiter.md"], recordings: ["debrief/northwind-recruiter.md", "debrief/Northwind/northwind_recruiter.md", "debrief/osprey_recruiter.md"] });
    expect(first.moves.map((step) => step.to)).toEqual(["debrief/osprey-recruiter.md", "debrief/northwind-recruiter-2.md"]);
    const after = ["debrief/northwind-recruiter.md", ...first.moves.map((step) => step.to)];
    expect(planTidy({ jobs, leftovers: [], recordings: after, existing: after }).moves).toEqual([]);
  });
});

describe("apply and undo on a workspace", () => {
  let root = "";
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });
  it("moves files, backs up leftovers, keeps the ledger and cited paths in step, removes empty folders, and undoes it all", async () => {
    root = await mkdtemp(join(tmpdir(), "tidy-"));
    const put = async (path: string, text = "x") => { await mkdir(join(root, path, ".."), { recursive: true }); await writeFile(join(root, path), text); };
    await put("jobs/northwind-solutions-engineer/original_jd.md"); await put("jobs/northwind-solutions-engineer/original_jd.txt");
    await put("jobs/northwind-solutions-engineer/interviews/01-recruiter/prep.md");
    await put("debrief/Northwind/Pat Lee Interview-recruiter.md", "transcript"); await put("debrief/Northwind/.DS_Store");
    await put("debrief/interview-memory/role-index.json", "{}");
    await put("run.paste-rerun.json", "{}");
    await put("context/structured/interview-stories.md", "Imported from: debrief/Northwind/Pat Lee Interview-recruiter.md\nStory text stays.");
    await put(".sensei/content-sources.json", JSON.stringify({ files: { "debrief/Northwind/Pat Lee Interview-recruiter.md": { status: "imported" } } }));
    const plan = await planWorkspaceTidy(root);
    expect(plan.moves.map((step) => step.to)).toEqual(["debrief/northwind-recruiter.md"]);
    expect(plan.toBackup.map((item) => item.path).sort()).toEqual(["debrief/Northwind/.DS_Store", "jobs/northwind-solutions-engineer/original_jd.txt", "run.paste-rerun.json"]);
    await applyWorkspaceTidy(root, new Date("2026-11-26T12:00:00Z"));
    expect((await readdir(join(root, "debrief"))).sort()).toEqual(["interview-memory", "northwind-recruiter.md"]);
    expect(JSON.parse(await readFile(join(root, ".sensei/content-sources.json"), "utf8")).files).toHaveProperty(["debrief/northwind-recruiter.md"]);
    expect(await readFile(join(root, "context/structured/interview-stories.md"), "utf8")).toBe("Imported from: debrief/northwind-recruiter.md\nStory text stays.");
    await undoWorkspaceTidy(root);
    expect(await readFile(join(root, "debrief/Northwind/Pat Lee Interview-recruiter.md"), "utf8")).toBe("transcript");
    expect((await readdir(root)).includes("run.paste-rerun.json")).toBe(true);
    expect(await readFile(join(root, "context/structured/interview-stories.md"), "utf8")).toContain("debrief/Northwind/Pat Lee Interview-recruiter.md");
  });
});
