import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { invalidateSearchIndex, searchWorkspace } from "../electron/search";
import { buildJobActions } from "../src/renderer/job-actions";
import type { InterviewOverview, JobFolderSummary } from "../src/shared/schemas";

async function fixtureWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sensei-search-"));
  for (const path of ["context/structured", "context/fallback-references", "resumes", "cover-letters", "debrief", "jobs/example-labs/.sensei", "jobs/example-labs/interviews/02-technical-challenge"]) {
    await mkdir(join(root, path), { recursive: true });
  }
  await writeFile(join(root, "context/structured/customer-work.md"), "# Customer work\nSupported onboarding and API troubleshooting.", "utf8");
  await writeFile(join(root, "context/fallback-references/hidden.md"), "fallback-only-secret", "utf8");
  await writeFile(join(root, "jobs/example-labs/.sensei/job.json"), JSON.stringify({ company: "Example Labs", title: "Developer Success Engineer" }), "utf8");
  await writeFile(join(root, "jobs/example-labs/.sensei/private.md"), "machine-state-secret", "utf8");
  await writeFile(join(root, "jobs/example-labs/evaluation.md"), "# Evaluation\nExample integration readiness.", "utf8");
  await writeFile(join(root, "jobs/example-labs/interviews/02-technical-challenge/practice_labs.json"), JSON.stringify({ prompt: "Debug webhook retries and idempotency." }), "utf8");
  return root;
}

describe("grouped workspace search", () => {
  it("finds job metadata, career evidence, application files, and interview labs", async () => {
    const root = await fixtureWorkspace();

    const jobs = await searchWorkspace(root, { query: "Example Labs", limit: 50 });
    const career = await searchWorkspace(root, { query: "onboarding", limit: 50 });
    const interview = await searchWorkspace(root, { query: "webhook", limit: 50 });

    expect(jobs.results.some((result) => result.kind === "job" && result.company === "Example Labs")).toBe(true);
    expect(jobs.results.some((result) => result.kind === "application" && result.relativePath === "jobs/example-labs/evaluation.md")).toBe(true);
    expect(career.results).toContainEqual(expect.objectContaining({ kind: "career", relativePath: "context/structured/customer-work.md" }));
    expect(interview.results).toContainEqual(expect.objectContaining({ kind: "interview", relativePath: "jobs/example-labs/interviews/02-technical-challenge/practice_labs.json" }));
    expect(interview.results[0].excerpt).toContain("webhook");
  });

  it("excludes hidden machine state and fallback references", async () => {
    const root = await fixtureWorkspace();

    await expect(searchWorkspace(root, { query: "machine-state-secret", limit: 50 })).resolves.toMatchObject({ results: [] });
    await expect(searchWorkspace(root, { query: "fallback-only-secret", limit: 50 })).resolves.toMatchObject({ results: [] });
  });

  it("invalidates cached content deterministically", async () => {
    const root = await fixtureWorkspace();
    const path = join(root, "context/structured/customer-work.md");
    await searchWorkspace(root, { query: "onboarding", limit: 50 });
    await writeFile(path, "# Customer work\nNewly documented escalation support.", "utf8");

    expect((await searchWorkspace(root, { query: "escalation", limit: 50 })).results).toHaveLength(0);
    invalidateSearchIndex(root);
    expect((await searchWorkspace(root, { query: "escalation", limit: 50 })).results).toHaveLength(1);
  });
});

describe("Job Actions", () => {
  const job: JobFolderSummary = {
    id: "example-labs",
    relativePath: "jobs/example-labs",
    name: "example-labs",
    title: "Developer Success Engineer",
    company: "Example Labs",
    modifiedAt: "2026-07-30T00:00:00.000Z",
    artifactCount: 4,
  };

  it("recommends the interviewer-reported next round and never includes Enter", () => {
    const overview: InterviewOverview = {
      schemaVersion: 2,
      jobId: job.id,
      company: "Example Labs",
      role: job.title,
      currentRoundId: "01-recruiter-screen",
      rounds: [{
        id: "01-recruiter-screen",
        sequence: 1,
        stage: "recruiter_screen",
        label: "Recruiter screen",
        interviewer: null,
        format: null,
        assessmentMode: null,
        scheduledDate: null,
        status: "debriefed",
        legacy: false,
        artifactPaths: { research: null, prep: null, questionBank: null, challengeBrief: null, practiceLabs: null, debriefAnalysis: "jobs/example-labs/interviews/01-recruiter-screen/debrief_analysis.md" },
        debriefSourcePaths: [],
      }],
      knownProcess: [{ stage: "technical_challenge", label: "Implementation challenge", interviewer: null, format: null, sourceType: "reported_by_interviewer" }],
      isLegacy: false,
    };

    const actions = buildJobActions(job, overview, null);
    const recommended = actions.find((action) => action.recommended);

    expect(recommended?.prompt).toBe("Prepare Example Labs technical challenge");
    expect(actions.every((action) => !/[\r\n]/.test(action.prompt))).toBe(true);
  });

  it("keeps Job Actions unavailable without an unambiguous job", () => {
    expect(buildJobActions(null, null, null)).toEqual([]);
  });

  it("places Search before Rescan and removes only the old terminal subtitle", async () => {
    const app = await readFile(join(process.cwd(), "src/renderer/App.tsx"), "utf8");

    expect(app.indexOf('className="topbar-button search-trigger"')).toBeLessThan(app.indexOf(">Rescan</button>"));
    expect(app).toContain("COMMAND CENTER");
    expect(app).not.toContain("Codex / antigravity terminal");
    expect(app).toContain("window.sensei.terminal.insertPrompt");
  });
});
