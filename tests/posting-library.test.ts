// Recruiter plan R5: one posting for several candidates. Fictional candidates and postings only.
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { matchCandidate, yearlyPay } from "../src/shared/candidate-match";
import { EMPTY_CANDIDATE_TARGETS, type CandidateTargets } from "../src/shared/schemas";
import { addCandidate, candidatePath } from "../electron/candidates";
import { readJobQueue } from "../electron/job-queue";
import { nextQueuedCandidate, sendPosting, stageLibraryPaste, suggestCandidates } from "../electron/posting-library";

const temps: string[] = [];
afterEach(async () => { await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
const exists = (path: string) => stat(path).then(() => true, () => false);
const targets = (value: Partial<CandidateTargets>): CandidateTargets => ({ ...EMPTY_CANDIDATE_TARGETS, ...value });

const posting = {
  title: "Senior Support Engineer", company: "Northstar Labs", location: "Denver, CO", url: "https://jobs.example.com/northstar/123",
  pay: { text: "$90,000–$110,000/year", min: 90_000, max: 110_000, currency: "USD", period: "year" as const, line: "" },
  workSetup: { mode: "hybrid" as const, daysInOffice: 3, text: "Hybrid" }, seniority: "senior" as const,
  workAuthorization: "We are unable to sponsor visas for this role.",
};

describe("who a posting suits (matchCandidate)", () => {
  it("suggests a candidate whose targets fit, with a reason for each", () => {
    const match = matchCandidate(posting, targets({ roles: ["Support Engineer"], workModes: ["hybrid", "remote"], locations: ["Denver"], level: "senior", salaryFloor: 85_000 }));
    expect(match.suggested).toBe(true);
    expect(match.reasons.map((reason) => reason.text)).toEqual(['Title matches "Support Engineer"', "Hybrid fits", "In Denver", "Level fits (senior)", "Pays up to $110,000, above their $85,000 floor"]);
  });

  it("says why a candidate isn't suggested", () => {
    const match = matchCandidate(posting, targets({ roles: ["Account Executive"], workModes: ["remote"], salaryFloor: 130_000 }));
    expect(match.suggested).toBe(false);
    expect(match.reasons.filter((reason) => !reason.good).map((reason) => reason.text)).toEqual([
      "Not one of their roles (Account Executive)", "Hybrid; they want remote", "Pays up to $110,000; their floor is $130,000",
    ]);
  });

  it("rules out a candidate who needs sponsorship when the posting won't sponsor", () => {
    const match = matchCandidate(posting, targets({ roles: ["Support Engineer"], needsSponsorship: true }));
    expect(match).toMatchObject({ suggested: false, blocker: "Needs sponsorship; this posting won't sponsor" });
  });

  it("warns when the candidate already has the posting, by link or by company and title", () => {
    expect(matchCandidate(posting, targets({ roles: ["Support Engineer"] }), [{ jobId: "northstar-support", url: "https://jobs.example.com/northstar/123?src=x", company: null, title: null }]).duplicate).toBe("Already has this job (northstar-support)");
    expect(matchCandidate(posting, targets({}), [{ jobId: null, url: null, company: "Northstar Labs", title: "Senior Support Engineer" }]).duplicate).toBe("Already queued for this posting");
  });

  it("never suggests a candidate with no targets, and says how to add them", () => {
    const match = matchCandidate(posting, EMPTY_CANDIDATE_TARGETS);
    expect(match.suggested).toBe(false);
    expect(match.reasons.at(-1)?.text).toMatch(/No job targets set yet/);
  });

  it("turns hourly and monthly pay into yearly pay", () => {
    expect(yearlyPay({ ...posting.pay, min: 40, max: 50, period: "hour" })).toEqual({ min: 83_200, max: 104_000 });
    expect(yearlyPay({ ...posting.pay, min: 8_000, max: null, period: "month" })).toEqual({ min: 96_000, max: null });
  });
});

const JD = `# Support Engineer\n\n**Company:** Northstar Labs  \n**Location:** Denver, CO\n\nNorthstar Labs is hiring a Support Engineer to help customers set up integrations and solve problems quickly.\n\n## Requirements\n- 3+ years in technical support\n- Experience with REST APIs\n- Clear written communication\n\n## What you'll do\n- Answer customer tickets about integrations and data imports, and follow each issue through to a fix.\n- Write short guides for common setup problems so customers can solve them on their own.\n- Work with engineers to reproduce bugs and explain their impact to customers in plain words.\n- Join onboarding calls for new accounts and help them connect their first data source.\n`;

async function recruiterRoot() {
  const root = await mkdtemp(join(tmpdir(), "sensei-library-"));
  temps.push(root);
  const alex = await addCandidate(root, "Alex Morgan", { suffix: "7k2f", seed: false });
  const jordan = await addCandidate(root, "Jordan Lee", { suffix: "q9w3", seed: false });
  const profile = (name: string, value: Partial<CandidateTargets>) => ({ schemaVersion: 1, identity: { fullName: name, artifactPrefix: name.replace(" ", "_") }, sources: { baseResumePath: null }, career: {}, preferences: { resume: {}, coverLetter: {}, targets: targets(value) }, truth: {}, updatedAt: "2026-11-10T00:00:00.000Z" });
  for (const [entry, value] of [[alex, { roles: ["Support Engineer"] }], [jordan, { roles: ["Account Executive"] }]] as const) {
    const folder = await candidatePath(root, entry.id);
    await mkdir(join(folder, "profile"), { recursive: true });
    await writeFile(join(folder, "profile", "candidate.json"), JSON.stringify(profile(entry.displayName, value)));
    await mkdir(join(folder, ".sensei", "app"), { recursive: true });
    await writeFile(join(folder, ".sensei", "app", "settings.json"), JSON.stringify({ baseResumePath: "resumes/base.md" }));
  }
  return { root, alex, jordan };
}

describe("posting library (recruiter plan R5)", () => {
  it("ranks candidates for a saved posting, best match first", async () => {
    const { root } = await recruiterRoot();
    await stageLibraryPaste(root, JD, "paste-abc123");
    const rows = await suggestCandidates(root, "paste-abc123");
    expect(rows.map((row) => [row.name, row.suggested])).toEqual([["Alex Morgan", true], ["Jordan Lee", false]]);
  });

  it("copies the posting into each chosen candidate's own folder and queue; the open candidate's item goes back to the window", async () => {
    const { root, alex, jordan } = await recruiterRoot();
    await stageLibraryPaste(root, JD, "paste-abc123");
    const sent = await sendPosting(root, "paste-abc123", [alex.id, jordan.id], alex.id);
    expect(sent.queued).toEqual([jordan.id]);
    expect(sent.active?.label).toBe("Northstar Labs, Support Engineer");
    const alexFolder = await candidatePath(root, alex.id);
    const jordanFolder = await candidatePath(root, jordan.id);
    expect(await exists(join(alexFolder, ".sensei", "staged-jds", `${sent.active!.pasteId}.md`))).toBe(true);
    expect((await readJobQueue(alexFolder)).items).toEqual([]);
    const jordanQueue = await readJobQueue(jordanFolder);
    expect(jordanQueue.items).toHaveLength(1);
    expect(await readFile(join(jordanFolder, ".sensei", "staged-jds", `${jordanQueue.items[0]!.id}.md`), "utf8")).toContain("Support Engineer");
  });

  it("warns about a duplicate once the posting is queued, and points the queue at the candidate with work waiting", async () => {
    const { root, alex, jordan } = await recruiterRoot();
    await stageLibraryPaste(root, JD, "paste-abc123");
    await sendPosting(root, "paste-abc123", [jordan.id], alex.id);
    expect((await suggestCandidates(root, "paste-abc123")).find((row) => row.id === jordan.id)?.duplicate).toBe("Already queued for this posting");
    expect(await nextQueuedCandidate(root, alex.id)).toEqual({ id: jordan.id, name: "Jordan Lee", waiting: 1 });
    expect(await nextQueuedCandidate(root, jordan.id)).toBeNull();
  });

  it("flags a candidate with no base resume instead of queuing a run that would fail", async () => {
    const { root, jordan } = await recruiterRoot();
    await rm(join(await candidatePath(root, jordan.id), ".sensei", "app", "settings.json"));
    await stageLibraryPaste(root, JD, "paste-abc123");
    expect((await suggestCandidates(root, "paste-abc123")).find((row) => row.id === jordan.id)).toMatchObject({ suggested: false, blocker: "No base resume yet (open them, then Setup)" });
  });

  it("refuses posting IDs that could leave the library", async () => {
    const { root } = await recruiterRoot();
    await expect(suggestCandidates(root, "../../etc")).rejects.toThrow("not a valid posting ID");
  });
});

describe("pipeline across candidates (recruiter plan R5)", () => {
  it("lists every candidate's jobs, changes several statuses at once, and exports with the candidate first", async () => {
    const { listPipeline, setPipelineStatus } = await import("../electron/pipeline");
    const { pipelineToCsv } = await import("../src/shared/jobs-csv");
    const { root, alex, jordan } = await recruiterRoot();
    for (const [entry, jobId] of [[alex, "northstar-support"], [jordan, "juniper-sales"]] as const) {
      const jobPath = join(await candidatePath(root, entry.id), "jobs", jobId);
      await mkdir(jobPath, { recursive: true });
      await writeFile(join(jobPath, "original_jd.md"), JD);
    }
    const rows = await listPipeline(root);
    expect(rows.map((row) => [row.candidateName, row.id]).sort()).toEqual([["Alex Morgan", "northstar-support"], ["Jordan Lee", "juniper-sales"]]);
    const done = await setPipelineStatus(root, rows.map((row) => ({ candidateId: row.candidateId, jobId: row.id })), "applied");
    expect(done.map((entry) => entry.previous)).toEqual(["saved", "saved"]);
    const after = await listPipeline(root);
    expect(after.every((row) => row.tracker?.status === "applied")).toBe(true);
    const csv = pipelineToCsv(after);
    expect(csv.split("\r\n")[0]).toBe("﻿Candidate,Company,Title,Status,Applied,Follow up,Fit,Interview,Location,Added,Notes,Job ID");
    expect(csv).toContain("Jordan Lee,");
    await expect(setPipelineStatus(root, [{ candidateId: alex.id, jobId: "northstar-support" }], "hired")).rejects.toThrow();
  });
});
