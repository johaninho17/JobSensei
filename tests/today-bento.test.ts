// Today in Bento (ledger U77, #126): one "Do this next" step picked in a fixed order, and the same Today sections and
// actions as before, now in cards. Fictional jobs only.
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { TodayData } from "../src/shared/today";
import { pickNextStep } from "../src/shared/today-next";

type Input = Pick<TodayData, "due" | "questions" | "search">;
const empty = (): Input => ({ due: { followUps: [], interviewsThisWeek: [], closedPostings: [], stale: [] }, questions: [], search: { lastRun: null, newCount: 0, top: [] } });
const match = (id: string, score: number, agy?: number) => ({ id, title: `Role ${id}`, company: "Northstar Labs", location: null, fit: { score }, agyFit: agy === undefined ? null : { score: agy } }) as unknown as Input["search"]["top"][number];
const question = { id: "q1", text: "Where did you use SQL?" } as unknown as Input["questions"][number];

describe("Do this next (#126)", () => {
  it("is nothing when there's nothing to do", () => {
    expect(pickNextStep(empty())).toBeNull();
  });

  it("goes interview → follow-up → closed posting → question → best match", () => {
    const input = empty();
    input.search.top = [match("a", 3.1), match("b", 3.0, 4.6)];
    expect(pickNextStep(input)).toMatchObject({ kind: "match", matchId: "b", score: 4.6 });
    input.questions = [question];
    expect(pickNextStep(input)).toMatchObject({ kind: "question", questionId: "q1" });
    input.due.closedPostings = [{ jobId: "job3", company: "Northstar Labs", title: "Analyst", since: "2026-11-20" } as Input["due"]["closedPostings"][number]];
    expect(pickNextStep(input)).toMatchObject({ kind: "closed", jobId: "job3", label: "Northstar Labs, Analyst" });
    input.due.followUps = [{ id: "job1", label: "Northstar Labs, Analyst", days: 1 }, { id: "job2", label: "Harbor Co, Lead", days: 4 }];
    expect(pickNextStep(input)).toMatchObject({ kind: "follow-up", jobId: "job2", days: 4 });
    input.due.interviewsThisWeek = [{ id: "job5", label: "B", date: "2026-11-27", round: "hiring_manager" }, { id: "job4", label: "A", date: "2026-11-25", round: "recruiter" }];
    expect(pickNextStep(input)).toMatchObject({ kind: "interview", jobId: "job4", date: "2026-11-25" });
  });
});

describe("Today layout (#126)", () => {
  it("puts Today in a bento page with one brass hero, KPIs, and every section it had", async () => {
    const view = await readFile("src/renderer/TodayView.tsx", "utf8");
    expect(view).toContain('<section className="today bento-page">');
    expect(view.match(/tone="hero"/g)).toHaveLength(1);
    expect(view).toContain("pickNextStep(today)");
    for (const kpi of ["FEATURES.interviews && <Kpi", "FEATURES.jobSearch && <Kpi", "FEATURES.tune && tuneFiles !== null && <Kpi"]) expect(view).toContain(kpi);
    for (const id of ["today-questions", "today-answers", "today-activity"]) expect(view).toContain(`<Section id="${id}"`);
    for (const id of ["today-due", "today-search", "today-insights"]) expect(view).toContain(`<div id="${id}">`);
    for (const action of ["closePosting(", "keepPosting(", 'matchAction(item.id, "draft")', 'matchAction(item.id, "save")', "<QuestionCard"]) expect(view).toContain(action);
    expect(view).toContain("<FitRing rating={score}");
    expect(view).not.toContain("Ask 3 more");
  });

  it("the Tune tile opens Career context on its Tune tab", async () => {
    const app = await readFile("src/renderer/App.tsx", "utf8");
    expect(app).toContain('onOpenTune={() => void showPage("context-home").then(() => setContextStart("tune"))}');
    expect(app).toContain('startView={currentLocation.kind === "setup-home" ? "setup" : contextStart}');
    expect(await readFile("src/renderer/SetupAndContext.tsx", "utf8")).toContain('if ((startView === "tune" && tune) || (startView === "setup" && setup)) setView(startView);');
  });

  it("job cards are compact: fit ring, one meta line, a status dot instead of an edge, no footer (U79)", async () => {
    const jobs = await readFile("src/renderer/JobsHome.tsx", "utf8");
    const card = jobs.slice(jobs.indexOf("function JobCard("), jobs.indexOf("</article>;", jobs.indexOf("function JobCard(")));
    expect(card).toContain("<FitRing rating={job.rating} size={40} />");
    expect(card).toContain('className="job-card-meta"');
    expect(card).toContain("status-dot");
    expect(card).not.toContain("stripe");
    expect(card).not.toContain(">Open job<");
    expect(card).toContain("tabIndex={0}");
  });

  it("only the hero has a coloured edge, and cards take padding from the density tokens (U79)", async () => {
    const [layout, tokens, bento, today] = await Promise.all(["src/renderer/layout.css", "src/renderer/tokens.css", "src/renderer/BentoPrimitives.tsx", "src/renderer/TodayView.tsx"].map((path) => readFile(path, "utf8")));
    expect(layout).not.toMatch(/stripe-(leaf|accent|risk|brass)/);
    expect(layout).toContain(".bento-card.is-hero { border-left: 4px solid var(--brass);");
    expect(bento).not.toContain("stripe");
    expect(today).not.toContain("stripe");
    for (const token of ["--card-pad:", "--card-pad-x:", "--card-gap:"]) expect(tokens).toContain(token);
    expect(layout).toContain(".bento-card { display: grid; gap: var(--space-2); min-width: 0; padding: var(--card-pad) var(--card-pad-x); }");
  });
});

describe("job card status dot (U79)", () => {
  it("interviewing leaf, applied pine, a blocker while saved risk, otherwise none", async () => {
    const { jobDotOf: jobEdgeOf } = await import("../src/shared/job-organize");
    const job = (status: string | null, mustHaves: Array<{ requirement: string; status: "met" | "learnable" | "blocker" }> = []) => ({ tracker: status ? { status } : null, hasApplicationMaterials: false, mustHaves }) as unknown as Parameters<typeof jobEdgeOf>[0];
    expect(jobEdgeOf(job("interviewing"))).toBe("leaf");
    expect(jobEdgeOf(job("offer"))).toBe("leaf");
    expect(jobEdgeOf(job("applied"))).toBe("accent");
    expect(jobEdgeOf(job(null, [{ requirement: "License", status: "blocker" }]))).toBe("risk");
    expect(jobEdgeOf(job(null))).toBeNull();
    expect(jobEdgeOf(job("rejected", [{ requirement: "License", status: "blocker" }]))).toBeNull();
  });
});

describe("Profile page (U78)", () => {
  it("Setup and Career context are one page: Setup is its first tab, one sidebar item", async () => {
    const [app, context] = await Promise.all(["src/renderer/App.tsx", "src/renderer/SetupAndContext.tsx"].map((path) => readFile(path, "utf8")));
    expect(app).toContain('currentLocation.kind === "context-home" || currentLocation.kind === "setup-home" ? <ContextHome key={currentLocation.kind}');
    expect(app).toContain("setup={setupHomeBlock}");
    expect(app).toContain("const setupHomeBlock = <SetupHome embedded ");
    expect(context).toContain('...(setup ? [{ id: "setup" as const, label: "Setup" }] : [])');
    expect(context).toContain('<PageHead title={setup ? "Profile" : "Career context"}');
  });
});

describe("Jobs header and sidebar views (U79, #156)", () => {
  it("statuses move to the sidebar and a header menu; Add jobs is a header button; Sort and Group sit in View", async () => {
    const [jobs, app] = await Promise.all(["src/renderer/JobsHome.tsx", "src/renderer/App.tsx"].map((path) => readFile(path, "utf8")));
    expect(jobs).not.toContain("<SubTabs");
    expect(jobs).toContain('<PageHead title="Jobs"');
    expect(jobs).toContain('{addOpen ? "Close" : "Add jobs"}');
    expect(jobs).toContain("if (!open && !visible.length) return null;");
    expect(jobs).toMatch(/<summary>View<\/summary>[\s\S]*Sort jobs[\s\S]*Group jobs/);
    expect(app).toContain('className="side-sub"');
    expect(app).toContain("jobsTabsWithCounts(jobs)");
    expect(app).toContain("setJobsStatusGroup(view.id); void showPage(\"jobs-home\");");
  });

  it("the setup line can be hidden until its missing steps change, but not while setup blocks adding jobs", async () => {
    const jobs = await readFile("src/renderer/JobsHome.tsx", "utf8");
    expect(jobs).toContain("if (readiness.ready && dismissed === signature) return null;");
    expect(jobs).toContain("{readiness.ready && <button className=\"setup-banner-close\"");
  });
});

describe("Today and the job page, compact (U79, #157)", () => {
  it("Due, New matches, and For the coming days are one tabbed card; KPIs stack beside the hero", async () => {
    const view = await readFile("src/renderer/TodayView.tsx", "utf8");
    expect(view.match(/className="today-lists"/g)).toHaveLength(1);
    expect(view).toContain('<SubTabs<TodayList> idPrefix="today-lists"');
    expect(view).toContain('className={`kpi-stack${next ? "" : " is-row"}`}');
    expect(view).toContain('className="activity-chips"');
  });

  it("the job page's next step and check line sit in the header card, and the Fit card doesn't repeat the score", async () => {
    const page = await readFile("src/renderer/JobWorkspace.tsx", "utf8");
    const head = page.slice(page.indexOf('<header className="job-head">'), page.indexOf("</header>", page.indexOf('<header className="job-head">')));
    expect(head).toContain('className="next-bar"');
    expect(head).toContain('className="review-line"');
    expect(page.match(/className="next-bar"/g)).toHaveLength(1);
    expect(page).not.toContain("job.rating.toFixed(1)}</strong> of 5");
    expect(page).not.toContain('className="fit-bar"');
  });
});

describe("One page header (U82, #165)", () => {
  it("every page uses PageHead, and no page keeps a help paragraph under its title", async () => {
    const { readdir } = await import("node:fs/promises");
    const files = (await readdir("src/renderer")).filter((file) => file.endsWith(".tsx") && file !== "BentoPrimitives.tsx");
    for (const file of files) expect(await readFile(`src/renderer/${file}`, "utf8"), file).not.toContain('className="page-head');
    for (const file of ["TodayView", "JobsHome", "JobSearchView", "InterviewsHome", "SetupAndContext", "AgyView", "DocsView", "Pipeline", "Postings", "Reports", "Candidates", "CandidateProfile"]) expect(await readFile(`src/renderer/${file}.tsx`, "utf8"), file).toContain("<PageHead");
    expect(await readFile("src/renderer/layout.css", "utf8")).not.toContain(".page-head p {");
  });

  it("Favorites appears only when a job is starred", async () => {
    const app = await readFile("src/renderer/App.tsx", "utf8");
    expect(app).toContain("{!FEATURES.candidates && favoriteJobs.length > 0 && <section className=\"side-recent\"");
    expect(app).not.toContain("Star a job (☆) in Jobs to keep it here.");
  });
});

describe("Quieter job page (U82, #166)", () => {
  it("the header keeps status, ring, short location, and the settings score; the rest is in its menu", async () => {
    const page = await readFile("src/renderer/JobWorkspace.tsx", "utf8");
    const head = page.slice(page.indexOf('<header className="job-head">'), page.indexOf("</header>", page.indexOf('<header className="job-head">')));
    expect(head).toContain('job.applicationStage && trackerStatus === "saved" && <StatusPill');
    expect(head).toContain("{shortLocation(job.location)}");
    expect(head).toContain("Settings <strong");
    expect(head).toMatch(/<details className="jobs-more job-head-more">[\s\S]*Added \{formatJobDate[\s\S]*Edit details/);
    expect(page).toContain('<details className="jobs-more pdf-menu">');
    expect(page.match(/<PdfTextSizeSelect/g)).toHaveLength(1);
  });

  it("short locations keep the place and the work setup", async () => {
    const { shortLocation } = await import("../src/renderer/JobWorkspace");
    expect(shortLocation("San Francisco, CA (Remote / Telecommute - United States)")).toBe("San Francisco, CA · Remote");
    expect(shortLocation("Austin, TX")).toBe("Austin, TX");
    expect(shortLocation("Remote (US)")).toBe("Remote");
    expect(shortLocation("Denver, CO (Hybrid)")).toBe("Denver, CO · Hybrid");
  });

  it("documents show file details as a tip, not a line", async () => {
    const docs = await readFile("src/renderer/Documents.tsx", "utf8");
    expect(docs).toContain('<InfoTip label="File details">');
    expect(docs).not.toContain("Local artifact");
  });
});

