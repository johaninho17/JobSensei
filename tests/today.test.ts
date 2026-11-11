import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildToday, candidateQuestions, mergeQuestions, ratingAccuracy } from "../src/shared/today";
import { answerQuestion, checkClosedPostings, keepPosting, readClosedPostings, removeQuestion, ANSWERS_FILE } from "../electron/today";
import { provenLinesFor } from "../electron/proven-lines";
import { companyResearchFor } from "../electron/interview-context";
import { likeInterviewed, searchLearning } from "../electron/job-search";
import { rankInbox } from "../src/shared/job-search";
import type { JobFolderSummary } from "../src/shared/schemas";

const NOW = new Date("2026-11-10T12:00:00Z");
const job = (id: string, patch: Partial<JobFolderSummary> = {}): JobFolderSummary => ({
  id, relativePath: `jobs/${id}`, name: id, title: "Solutions Engineer", company: "Northstar Labs", createdAt: "2026-10-01T10:00:00Z", modifiedAt: "2026-10-01T10:00:00Z",
  artifactCount: 3, applicationStage: null, rating: 3.6, ratingDecision: null, ratingConfidence: null, ratingHighlights: [], ratingGaps: [], mustHaves: [], requirementGaps: [],
  stretch: null, location: null, interviewRoundLabel: null, interviewRoundCount: 0, role: null, hasApplicationMaterials: true, tracker: null, health: null, gapTerms: [], ...patch,
}) as JobFolderSummary;
const tracker = (patch: Record<string, unknown>) => ({ schemaVersion: 1, status: "applied", appliedAt: "2026-10-01", nextFollowUpAt: null, notes: "", history: [], interviews: [], outcome: null, updatedAt: null, ...patch }) as never;

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "sensei-today-"));
  await mkdir(join(root, ".sensei"), { recursive: true });
  return root;
}

describe("Today questions", () => {
  const base = { jobs: [] as JobFolderSummary[], gapTerms: [], knownTerms: () => false, searchTitlesWithoutMatches: [], blankLogistics: [], hasUpcomingInterview: false, now: NOW };

  it("asks nothing on a day with no real gap", () => {
    expect(candidateQuestions(base)).toEqual([]);
  });

  it("asks about a tool that keeps coming up as a gap, but not one the user's files already show", () => {
    const asked = candidateQuestions({ ...base, gapTerms: [{ term: "Salesforce", noInterview: 3, interviewed: 1 }, { term: "Kotlin", noInterview: 4, interviewed: 0 }], knownTerms: (term) => term === "Kotlin" });
    expect(asked.map((question) => question.id)).toEqual(["skill:salesforce"]);
  });

  it("asks what happened after an interview two weeks ago with no outcome, and about missing logistics before an interview", () => {
    const jobs = [job("northstar-se", { tracker: tracker({ status: "interviewing", interviews: [{ round: "recruiter", date: "2026-10-20", note: "", source: "user" }] }) })];
    const asked = candidateQuestions({ ...base, jobs, blankLogistics: ["compensation"], hasUpcomingInterview: true });
    expect(asked.map((question) => question.id)).toEqual(["outcome:northstar-se", "logistics:compensation"]);
    expect(asked[0].options).toEqual(["Still in process", "Rejected", "Offer", "I withdrew"]);
  });

  it("keeps open questions across days and never brings back answered or removed ones", () => {
    const fresh = candidateQuestions({ ...base, gapTerms: [{ term: "Salesforce", noInterview: 3, interviewed: 0 }] });
    const first = mergeQuestions([], fresh, NOW);
    expect(mergeQuestions(first, fresh, new Date("2026-11-11T12:00:00Z"))).toEqual(first);
    const answered = first.map((question) => ({ ...question, status: "answered" as const }));
    expect(mergeQuestions(answered, fresh, NOW).filter((question) => question.status === "open")).toEqual([]);
  });
});

describe("Today answers go to their owners", () => {
  it("saves a skill answer as a career record row in the evidence table format", async () => {
    const root = await workspace();
    await writeFile(join(root, ".sensei/today-questions.json"), JSON.stringify({ questions: mergeQuestions([], [{ id: "skill:salesforce", kind: "skill", subject: "Salesforce", options: [], text: "?", why: "" }], NOW) }));
    const result = await answerQuestion(root, "skill:salesforce", "Built reports and dashboards in Salesforce for a customer success team at Northstar Labs.", NOW);
    expect(result.addedPath).toBe(ANSWERS_FILE);
    const file = await readFile(join(root, ANSWERS_FILE), "utf8");
    expect(file).toContain("- source_role: candidate-confirmed-work-record");
    expect(file).toContain("| context:today-answers:salesforce | 2026 | Salesforce | Built reports and dashboards in Salesforce");
    await expect(answerQuestion(root, "skill:salesforce", "again", NOW)).rejects.toThrow("already answered");
  });

  it("records an outcome in the tracker, and a removed question stays removed", async () => {
    const root = await workspace();
    await mkdir(join(root, "jobs/northstar-se/.sensei"), { recursive: true });
    await writeFile(join(root, ".sensei/today-questions.json"), JSON.stringify({ questions: mergeQuestions([], [
      { id: "outcome:northstar-se", kind: "outcome", subject: "northstar-se", options: ["Rejected"], text: "?", why: "" },
      { id: "skill:kotlin", kind: "skill", subject: "Kotlin", options: [], text: "?", why: "" },
    ], NOW) }));
    await answerQuestion(root, "outcome:northstar-se", "Rejected", NOW);
    const saved = JSON.parse(await readFile(join(root, "jobs/northstar-se/.sensei/tracker.json"), "utf8"));
    expect(saved).toMatchObject({ status: "rejected", outcome: { result: "rejected", date: "2026-11-10" } });
    await removeQuestion(root, "skill:kotlin");
    const stored = JSON.parse(await readFile(join(root, ".sensei/today-questions.json"), "utf8")).questions;
    expect(stored.map((question: { status: string }) => question.status)).toEqual(["answered", "removed"]);
  });
});

describe("closed postings", () => {
  it("flags open jobs no longer on their company's live list, once a day, and respects Keep", async () => {
    const root = await workspace();
    for (const [id, url] of [["northstar-se", "https://jobs.ashbyhq.com/northstar/live-1"], ["northstar-pm", "https://jobs.ashbyhq.com/northstar/gone-2"], ["acme-se", "https://careers.acme.example/7"]]) {
      await mkdir(join(root, `jobs/${id}/.sensei`), { recursive: true });
      await writeFile(join(root, `jobs/${id}/.sensei/posting.json`), JSON.stringify({ url }));
    }
    let reads = 0;
    const fetcher = (async () => { reads += 1; return Response.json({ jobs: [{ title: "Solutions Engineer", jobUrl: "https://jobs.ashbyhq.com/northstar/live-1", isListed: true }] }); }) as typeof fetch;
    const jobs = ["northstar-se", "northstar-pm", "acme-se"].map((id) => job(id, { tracker: tracker({}) }));
    const state = await checkClosedPostings(root, jobs, { fetcher, now: NOW });
    expect(state.closed.map((entry) => entry.jobId)).toEqual(["northstar-pm"]);
    expect(reads).toBe(1);
    await checkClosedPostings(root, jobs, { fetcher, now: NOW });
    expect(reads).toBe(1);
    await keepPosting(root, "northstar-pm");
    expect((await readClosedPostings(root)).closed).toEqual([]);
    expect((await checkClosedPostings(root, jobs, { fetcher, now: NOW, force: true })).closed).toEqual([]);
  });
});

describe("Today page data", () => {
  it("lists what's due and today's activity, and hides closed jobs from closed postings", () => {
    const jobs = [
      job("a", { createdAt: "2026-11-10T09:00:00Z", tracker: tracker({ nextFollowUpAt: "2026-11-08" }) }),
      job("b", { tracker: tracker({ status: "rejected" }) }),
      job("c", { tracker: tracker({ appliedAt: "2026-09-01" }) }),
    ];
    const today = buildToday({ jobs, search: null, closedPostings: [{ jobId: "b", company: null, title: null, since: "2026-11-09" }], interviewDates: [{ jobId: "a", date: "2026-11-12", round: "Hiring manager" }], insights: [], questions: [], now: NOW });
    expect(today.activity.added.map((entry) => entry.id)).toEqual(["a"]);
    expect(today.due.followUps).toEqual([{ id: "a", label: "Northstar Labs, Solutions Engineer", days: 2 }]);
    expect(today.due.interviewsThisWeek[0]).toMatchObject({ id: "a", date: "2026-11-12" });
    expect(today.due.closedPostings).toEqual([]);
    expect(today.due.stale.map((entry) => entry.id)).toEqual(["c"]);
  });

  it("measures the light rating against the full one once there are a few pairs", () => {
    expect(ratingAccuracy([{ light: 4, full: 3.5 }])).toBeNull();
    expect(ratingAccuracy([{ light: 4, full: 3.4 }, { light: 4.2, full: 3.6 }, { light: 3, full: 3 }])).toEqual({ count: 3, averageGap: 0.4, lightHigher: 2 });
  });
});

describe("learning from interviews", () => {
  it("offers lines from resumes that got interviews only when all their evidence is routed to the new job", async () => {
    const root = await workspace();
    await mkdir(join(root, "jobs/won/.sensei"), { recursive: true });
    await writeFile(join(root, "jobs/won/.sensei/tracker.json"), JSON.stringify({ interviews: [{ round: "recruiter" }] }));
    await writeFile(join(root, "jobs/won/.sensei/application_evidence.json"), JSON.stringify({ resume: { claimMappings: [
      { publicText: "Led onboarding for enterprise customers.", claimType: "candidate", evidenceIds: ["context:a:1"] },
      { publicText: "Built dashboards in Looker.", claimType: "framed", evidenceIds: ["context:a:2", "context:b:9"] },
      { publicText: "Unchanged base bullet.", claimType: "baseline", evidenceIds: [] },
    ] } }));
    const lines = await provenLinesFor(root, new Set(["context:a:1", "context:a:2"]), () => "Northstar Labs");
    expect(lines).toEqual([{ text: "Led onboarding for enterprise customers.", evidenceIds: ["context:a:1"], employer: "Northstar Labs", from: "won" }]);
  });

  it("reuses recent company research from another job at the same company", async () => {
    const root = await workspace();
    for (const id of ["northstar-se", "northstar-pm"]) {
      await mkdir(join(root, `jobs/${id}/.sensei`), { recursive: true });
      await writeFile(join(root, `jobs/${id}/.sensei/job.json`), JSON.stringify({ company: "Northstar Labs, Inc." }));
    }
    await mkdir(join(root, "jobs/northstar-se/interviews"), { recursive: true });
    await writeFile(join(root, "jobs/northstar-se/interviews/company_research.md"), "# Research");
    expect(await companyResearchFor(root, "northstar-pm", "Northstar Labs", NOW)).toMatchObject({ path: null, reuseFrom: "jobs/northstar-se/interviews/company_research.md" });
    expect(await companyResearchFor(root, "northstar-pm", "Northstar Labs", new Date(Date.now() + 90 * 86_400_000))).toMatchObject({ reuseFrom: null });
    expect(await companyResearchFor(root, "northstar-se", "Northstar Labs", NOW)).toMatchObject({ path: "jobs/northstar-se/interviews/company_research.md" });
  });

  it("ranks matches like jobs that got interviews a little higher", () => {
    const learned = searchLearning([job("won", { title: "Technical Implementation Specialist", company: "Northstar Labs", tracker: tracker({ interviews: [{ round: "recruiter", date: "2026-11-01", note: "", source: "user" }] }) })]);
    expect(likeInterviewed("Implementation Specialist, Technical", learned)).toBe("Like your Northstar Labs interview");
    expect(likeInterviewed("Account Executive", learned)).toBeNull();
    const item = (id: string, score: number, like: string | null) => ({ id, fit: { score, why: "", covered: 0, total: 0, gaps: [], blockers: [], flags: [] }, agyFit: null, likeInterviewed: like, foundAt: NOW.toISOString(), postedAt: null }) as never;
    expect(rankInbox([item("plain", 3.8, null), item("like", 3.6, "Like your interview")]).map((entry: { id: string }) => entry.id)).toEqual(["like", "plain"]);
  });
});
