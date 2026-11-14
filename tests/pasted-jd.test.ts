import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { loadStagedJobDescription, pruneStagedJobDescriptions, stagePastedJobDescription, stageSavedJob } from "../electron/jd-fetch";
import { stageFetchedJobDescription } from "../electron/evidence-snapshot";
import { pastedJdPrompt } from "../src/shared/job-queue";

const JD = `# Support Analyst\n\nCompany: Northstar Labs\nLocation: Remote\n\n## What you'll do\n${"- Help customers connect their data and fix sync issues.\n".repeat(12)}`;

describe("pasted JD staging", () => {
  it("keeps each paste in its own file and loads it into the snapshot slot only when Agy starts it", async () => {
    const root = await mkdtemp(join(tmpdir(), "sensei-paste-"));
    const meta = await stagePastedJobDescription(root, `${JD}\u0007`, "paste-first1", new Date("2026-10-25T12:00:00Z"));
    expect(meta).toMatchObject({ url: "pasted", company: "Northstar Labs", title: "Support Analyst", location: "Remote", suggestedJobId: "northstar-labs-support-analyst" });
    await stagePastedJobDescription(root, JD.replace("Support Analyst", "Data Analyst"), "paste-second", new Date("2026-10-25T12:01:00Z"));
    // A second paste never touches the first, and nothing is in the snapshot slot yet.
    await expect(readFile(join(root, ".sensei", "fetched_jd.md"), "utf8")).rejects.toThrow();
    const first = await loadStagedJobDescription(root, "paste-first1");
    expect(first.meta.title).toBe("Support Analyst");
    const staged = await readFile(join(root, ".sensei", "fetched_jd.md"), "utf8");
    expect(staged).toContain("# Support Analyst");
    expect(staged).not.toContain("\u0007");
    await stageFetchedJobDescription(root, "northstar-labs-support-analyst");
    expect(await readFile(join(root, "jobs", "northstar-labs-support-analyst", "original_jd.md"), "utf8")).toContain("Help customers connect");
    expect((await loadStagedJobDescription(root, "paste-second")).meta.title).toBe("Data Analyst");
  });

  it("sends a saved job's own posting to the queue so its drafts land in that job's folder", async () => {
    const root = await mkdtemp(join(tmpdir(), "sensei-saved-"));
    const jobId = "northstar-labs-support-analyst-2";
    await mkdir(join(root, "jobs", jobId), { recursive: true });
    await writeFile(join(root, "jobs", jobId, "original_jd.md"), JD);
    const meta = await stageSavedJob(root, jobId, "paste-saved01", new Date("2026-11-14T12:00:00Z"));
    // The suggested ID is the job's own ID (never a fresh one derived from the title), so no second folder appears.
    expect(meta).toMatchObject({ company: "Northstar Labs", title: "Support Analyst", suggestedJobId: jobId });
    expect((await loadStagedJobDescription(root, "paste-saved01")).meta.suggestedJobId).toBe(jobId);
    // The snapshot keeps the job's existing posting.
    expect(await stageFetchedJobDescription(root, jobId)).toBeNull();
    expect(await readdir(join(root, "jobs"))).toEqual([jobId]);
    for (const bad of ["../outside", "", "a/b", 7]) await expect(stageSavedJob(root, bad, "paste-saved02")).rejects.toThrow("isn't a job");
    await mkdir(join(root, "jobs", "empty-job"), { recursive: true });
    await expect(stageSavedJob(root, "empty-job", "paste-saved03")).rejects.toThrow("no saved posting");
  });

  it("refuses an unknown or malformed paste ID, and prunes pastes no queue item uses", async () => {
    const root = await mkdtemp(join(tmpdir(), "sensei-paste-"));
    await expect(loadStagedJobDescription(root, "paste-missing")).rejects.toThrow(/No pasted job description/);
    await expect(loadStagedJobDescription(root, "../../etc")).rejects.toThrow(/paste ID/);
    await stagePastedJobDescription(root, JD, "paste-keep01");
    await stagePastedJobDescription(root, JD, "paste-drop01");
    await pruneStagedJobDescriptions(root, ["paste-keep01"]);
    expect(await readdir(join(root, ".sensei", "staged-jds"))).toHaveLength(4);
    await pruneStagedJobDescriptions(root, ["paste-keep01"], 0);
    expect((await readdir(join(root, ".sensei", "staged-jds"))).sort()).toEqual(["paste-keep01.json", "paste-keep01.md"]);
  });

  it("rejects non-text, too-short, and too-long pastes", async () => {
    const root = await mkdtemp(join(tmpdir(), "sensei-paste-"));
    await expect(stagePastedJobDescription(root, 42, "paste-abc123")).rejects.toThrow(/text/);
    await expect(stagePastedJobDescription(root, "Short note", "paste-abc123")).rejects.toThrow(/too short/);
    await expect(stagePastedJobDescription(root, "x".repeat(200_001), "paste-abc123")).rejects.toThrow(/too long/);
  });

  it("sends Agy one line that names the paste", () => {
    const prompt = pastedJdPrompt("paste-abc123", "Northstar Labs, Support\nAnalyst");
    expect(prompt).toBe("Evaluate the job description I pasted (paste ID paste-abc123: Northstar Labs, Support Analyst) and draft the application");
    expect(prompt).not.toContain("\n");
  });
});

describe("pipeline skill rules for fetching", () => {
  const skill = readFileSync(".agents/skills/jobsensei-application-pipeline/SKILL.md", "utf8");

  it("loads a paste by its ID and never searches for a posting after a failed fetch", () => {
    expect(skill).toContain("sensei jd:fetch --staged <id>");
    expect(skill).not.toMatch(/jd:fetch --staged`/);
    expect(skill).toMatch(/Never look for the posting another way/);
  });

  it("forbids hand edits to .sensei files and renaming outputs", () => {
    expect(skill).toMatch(/Never edit `\.sensei\/` files other than the bundle, and never rename generated files/);
  });

  it("names the employer at snapshot time when the JD has no company line", () => {
    expect(skill).toMatch(/If `jd:fetch` printed `"company": null`, add `--company/);
  });
});

describe("company name for pasted JDs", () => {
  it("records --company in the job metadata, keeping other fields", async () => {
    const { recordJobCompany, companyArgument } = await import("../electron/job-company");
    const { mkdir, writeFile } = await import("node:fs/promises");
    const root = await mkdtemp(join(tmpdir(), "sensei-company-"));
    await mkdir(join(root, "jobs", "northstar-analyst", ".sensei"), { recursive: true });
    await writeFile(join(root, "jobs", "northstar-analyst", ".sensei", "job.json"), JSON.stringify({ id: "northstar-analyst", title: "Analyst" }));
    expect(await recordJobCompany(root, "northstar-analyst", " Northstar\nLabs ")).toBe("Northstar Labs");
    expect(JSON.parse(await readFile(join(root, "jobs", "northstar-analyst", ".sensei", "job.json"), "utf8"))).toEqual({ id: "northstar-analyst", title: "Analyst", company: "Northstar Labs" });
    expect(companyArgument(["node", "x", "job", "--company", "Northstar Labs"])).toBe("Northstar Labs");
    expect(companyArgument(["node", "x", "job", "--company", "--review"])).toBeNull();
  });
});

describe("links fetched by the app (Agy's sandbox has no network)", () => {
  const page = `<html><head><title>Support Analyst</title><script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", title: "Support Analyst", hiringOrganization: { name: "Northstar Labs" }, description: "<p>" + "Help customers fix failing data imports and write clear guides. ".repeat(12) + "</p>" })}</script></head><body></body></html>`;

  it("saves a fetched posting under a paste ID so Agy loads it with --staged", async () => {
    const { stageLinkJobDescription, loadStagedJobDescription } = await import("../electron/jd-fetch");
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const workspace = await mkdtemp(join(tmpdir(), "sensei-link-"));
    const fetcher = (async () => new Response(page, { status: 200 })) as unknown as typeof fetch;
    const meta = await stageLinkJobDescription(workspace, "https://jobs.example.com/northstar/1", "paste-link-0001", fetcher);
    expect(meta).toMatchObject({ company: "Northstar Labs", title: "Support Analyst", url: "https://jobs.example.com/northstar/1" });
    const staged = await loadStagedJobDescription(workspace, "paste-link-0001");
    expect(staged.markdown).toContain("Help customers fix failing data imports");
  });

  it("reports an unreadable page or a network failure as a plain request for a paste", async () => {
    const { stageLinkJobDescription, isNetworkError } = await import("../electron/jd-fetch");
    const offline = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    await expect(stageLinkJobDescription("/tmp/unused", "https://jobs.example.com/x", "paste-link-0002", offline)).rejects.toThrow(/Couldn't open this posting \(fetch failed\)\. Paste the job description instead\./);
    const empty = (async () => new Response("<html><body>Loading…</body></html>", { status: 200 })) as unknown as typeof fetch;
    await expect(stageLinkJobDescription("/tmp/unused", "https://jobs.example.com/y", "paste-link-0003", empty)).rejects.toThrow(/Couldn't read a job description from this page/);
    expect(isNetworkError("fetch failed")).toBe(true);
    expect(isNetworkError("The posting returned HTTP 404.")).toBe(false);
  });
});
