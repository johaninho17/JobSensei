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

    expect(recommended?.prompt).toMatch(/^Prepare Example Labs .*technical challenge \(job: [a-z0-9-]+\)$/);
    expect(actions.some((action) => action.id === "team-panel-interview" && action.label === "Prepare team panel interview" && /^Prepare Example Labs.* team panel interview \(job: [a-z0-9-]+\)$/.test(action.prompt) && action.group === "Interview")).toBe(true);
    expect(actions.every((action) => !/[\r\n]/.test(action.prompt))).toBe(true);
  });

  it("recommends team panel preparation when advancing to the final stage", () => {
    const job: JobFolderSummary = {
      id: "example-labs",
      relativePath: "jobs/example-labs",
      name: "example-labs",
      title: "Forward Deployed Engineer",
      company: "Example Labs",
      createdAt: "2026-07-28T00:00:00.000Z",
      modifiedAt: "2026-07-28T00:00:00.000Z",
      artifactCount: 3,
      applicationStage: "interview",
      rating: 4.8,
      ratingDecision: "Strong Match",
      ratingConfidence: "high",
      ratingHighlights: [],
      ratingGaps: [],
      location: "San Francisco, CA",
      interviewRoundLabel: "Practical Evaluation",
      hasApplicationMaterials: true,
    };
    const overview: InterviewOverview = {
      schemaVersion: 2,
      jobId: "example-labs",
      company: "Example Labs",
      role: "Forward Deployed Engineer",
      currentRoundId: "03-practical-evaluation",
      rounds: [
        {
          id: "01-recruiter-screen",
          sequence: 1,
          title: "Recruiter screen",
          stage: "recruiter_screen",
          status: "debriefed",
          legacy: false,
          artifactPaths: { research: null, prep: null, questionBank: null, challengeBrief: null, practiceLabs: null, debriefAnalysis: null },
          debriefSourcePaths: [],
        },
        {
          id: "02-hiring-manager",
          sequence: 2,
          title: "Hiring manager",
          stage: "hiring_manager",
          status: "debriefed",
          legacy: false,
          artifactPaths: { research: null, prep: null, questionBank: null, challengeBrief: null, practiceLabs: null, debriefAnalysis: null },
          debriefSourcePaths: [],
        },
        {
          id: "03-practical-evaluation",
          sequence: 3,
          title: "Practical evaluation",
          stage: "practical_evaluation",
          status: "debriefed",
          legacy: false,
          artifactPaths: { research: null, prep: null, questionBank: null, challengeBrief: null, practiceLabs: null, debriefAnalysis: "jobs/example-labs/interviews/03-practical-evaluation/debrief_analysis.md" },
          debriefSourcePaths: [],
        },
      ],
      knownProcess: [
        { stage: "recruiter_screen", label: "Recruiter screen", interviewer: null, format: null, sourceType: "reported" },
        { stage: "hiring_manager", label: "Hiring manager", interviewer: null, format: null, sourceType: "reported" },
        { stage: "practical_evaluation", label: "Practical evaluation", interviewer: null, format: null, sourceType: "reported" },
        { stage: "final_panel", label: "Executive & Team Panel", interviewer: null, format: null, sourceType: "reported" },
      ],
      isLegacy: false,
    };

    const actions = buildJobActions(job, overview, null);
    const recommended = actions.find((action) => action.recommended);

    expect(recommended?.label).toBe("Prepare team panel interview");
    expect(recommended?.prompt).toMatch(/^Prepare Example Labs.* team panel interview \(job: [a-z0-9-]+\)$/);
  });

  it("keeps Job Actions unavailable without an unambiguous job", () => {
    expect(buildJobActions(null, null, null)).toEqual([]);
  });

  it("keeps the trimmed top bar: search, job chip, terminal toggle, one settings menu", async () => {
    const app = await readFile(join(process.cwd(), "src/renderer/App.tsx"), "utf8");
    const header = app.slice(app.indexOf('<header className="topbar">'), app.indexOf("</header>", app.indexOf('<header className="topbar">')));

    expect(header).toContain('className="search-trigger"');
    expect(header).toContain("<TopbarMenu");
    expect(header).not.toContain(">Rescan</button>");
    expect(app).not.toContain('className="statusbar"');
    expect(app).not.toContain("Codex / antigravity terminal");
    expect(app).toContain("window.sensei.terminal.insertPrompt");
  });
});

describe("design system (Phase 3)", () => {
  it("has one owner for color tokens and no all-caps UI labels", async () => {
    const [styles, tokens, app, settings] = await Promise.all(["styles.css", "tokens.css", "App.tsx", "SettingsModal.tsx"].map((file) => readFile(join(process.cwd(), "src/renderer", file), "utf8")));

    expect(tokens).toMatch(/--canvas:[\s\S]*--brass:[\s\S]*:root\[data-theme="light"\]/);
    expect(styles).not.toMatch(/--(?:canvas|ink|brass|leaf|sensei-[a-z-]+):/);
    expect(styles).not.toContain("text-transform: uppercase");
    expect(styles.match(/#[0-9a-fA-F]{6}\b/g)?.length ?? 0).toBeLessThanOrEqual(8);
    for (const source of [app, settings]) expect(source).not.toMatch(/>[A-Z][A-Z &/-]{5,}</);
  });

  it("keeps one navigation model and one interview view", async () => {
    const app = await readFile(join(process.cwd(), "src/renderer/App.tsx"), "utf8");
    const sidebar = app.slice(app.indexOf('className="app-sidebar"'), app.indexOf("</nav>", app.indexOf('className="app-sidebar"')));
    for (const page of ["jobs-home", "interviews-home", "context-home"]) expect(sidebar).toContain(`showPage("${page}")`);
    expect(app.match(/<InterviewView /g)?.length).toBe(2); // job tab and pop-out window
    expect(app).not.toMatch(/function InterviewDashboard|function InterviewGuide/);
    expect(app).toContain('window.localStorage.getItem("sensei-theme-v2") === "dark" ? "dark" : "light"');
  });

  it("lets the user track status from the job page and the board", async () => {
    const app = await readFile(join(process.cwd(), "src/renderer/App.tsx"), "utf8");
    expect(app).toContain('className={`tracker-select is-${trackerStatus}`}');
    expect(app).toContain('className="status-strip"');
    expect(app).toContain('return stored === "list" ? "list" : "cards";');
  });

  it("keeps the terminal panel dark in both themes", async () => {
    const tokens = await readFile(join(process.cwd(), "src/renderer/tokens.css"), "utf8");
    expect(tokens).toMatch(/\.terminal-panel \{[^}]*--canvas: var\(--term-bg\)/);
  });
});
