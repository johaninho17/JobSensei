import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { fileAnswers, readAnswerInbox } from "../electron/answer-filing";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { candidateQuestions, mergeQuestions } from "../src/shared/profile-questions";
import { answerQuestion, removeQuestion } from "../electron/profile-questions";
import type { JobFolderSummary } from "../src/shared/schemas";

const NOW = new Date("2026-11-10T12:00:00Z");
const job = (id: string, patch: Partial<JobFolderSummary> = {}): JobFolderSummary => ({
  id, relativePath: `jobs/${id}`, name: id, title: "Solutions Engineer", company: "Northstar Labs", createdAt: "2026-10-01T10:00:00Z", modifiedAt: "2026-10-01T10:00:00Z",
  artifactCount: 3, applicationStage: null, rating: 3.6, ratingDecision: null, ratingConfidence: null, ratingHighlights: [], ratingGaps: [], mustHaves: [], requirementGaps: [],
  stretch: null, location: null, interviewRoundLabel: null, interviewRoundCount: 0, role: null, hasApplicationMaterials: true, tracker: null, health: null, gapTerms: [], ...patch,
}) as JobFolderSummary;
const tracker = (patch: Record<string, unknown>) => ({ schemaVersion: 1, status: "applied", appliedAt: "2026-10-01", nextFollowUpAt: null, notes: "", history: [], interviews: [], outcome: null, updatedAt: null, ...patch }) as never;

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "sensei-questions-"));
  await mkdir(join(root, ".sensei"), { recursive: true });
  return root;
}

describe("Profile questions", () => {
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

describe("Profile answers go to their owners", () => {
  it("queues a skill answer, and Agy's filing puts it in the right career record (never a separate answers file)", async () => {
    const root = await workspace();
    await mkdir(join(root, "context/structured"), { recursive: true });
    await writeFile(join(root, "context/structured/northstar.md"), [
      "# Evidence: Northstar Labs work", "", "- years: 2024-present", "", "## Evidence Inventory", "",
      "| Evidence ID | Year | Project | Explicit claim | Scope note | Source locator | Confidence | Public use |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      "| context:northstar:onboarding | 2025 | Onboarding | Onboarded customers. | | Work email | high | eligible |", "",
    ].join("\n"));
    await writeFile(join(root, ".sensei/today-questions.json"), JSON.stringify({ questions: mergeQuestions([], [{ id: "skill:salesforce", kind: "skill", subject: "Salesforce", options: [], text: "Have you used Salesforce?", why: "" }], NOW) }));
    const result = await answerQuestion(root, "skill:salesforce", "Built reports and dashboards in Salesforce for a customer success team at Northstar Labs.", NOW);
    expect(result).toEqual({ queued: true });
    expect(await readFile(join(root, "context/structured/answers-from-today.md"), "utf8").catch(() => null)).toBeNull();
    expect((await readAnswerInbox(root)).map((answer) => answer.status)).toEqual(["pending"]);
    await expect(answerQuestion(root, "skill:salesforce", "again", NOW)).rejects.toThrow("already answered");

    // Agy (stubbed) picks the Northstar work record; the app writes the row there, after a backup.
    let prompt = "";
    const runner = async (text: string) => {
      prompt = text;
      const [answer] = await readAnswerInbox(root);
      return { conversationId: null, response: JSON.stringify({ skipped: [], filings: [{ answerId: answer!.id, file: "context/structured/northstar.md", evidenceId: "context:northstar:salesforce-reports", year: "2025", project: "Northstar Labs", claim: "Built Salesforce reports and dashboards for the customer success team.", scope: "Reports and dashboards only.", publicUse: "eligible" }] }) };
    };
    const filed = await fileAnswers(root, runner, NOW);
    expect(prompt).toContain(".agents/workflows/jobsensei-file-answers.md");
    expect(prompt).toContain("context/structured/northstar.md");
    expect(filed.filed.map((answer) => answer.filedTo)).toEqual(["context/structured/northstar.md"]);
    const record = await readFile(join(root, "context/structured/northstar.md"), "utf8");
    expect(record).toContain("| context:northstar:salesforce-reports | 2025 | Northstar Labs | Built Salesforce reports and dashboards for the customer success team. |");
    expect(record.indexOf("salesforce-reports")).toBeGreaterThan(record.indexOf("context:northstar:onboarding"));
    expect((await readAnswerInbox(root))[0]).toMatchObject({ status: "filed", evidenceId: "context:northstar:salesforce-reports" });
    // A file Agy invents is refused; the answer waits for the next run.
    await writeFile(join(root, ".sensei/today-questions.json"), JSON.stringify({ questions: mergeQuestions([], [{ id: "skill:kotlin", kind: "skill", subject: "Kotlin", options: [], text: "Kotlin?", why: "" }], NOW) }));
    await answerQuestion(root, "skill:kotlin", "Coursework only.", NOW);
    const second = await fileAnswers(root, async () => ({ conversationId: null, response: JSON.stringify({ skipped: [], filings: [{ answerId: (await readAnswerInbox(root))[1]!.id, file: "context/structured/made-up.md", evidenceId: "x", year: "2020", project: "x", claim: "x", scope: "x", publicUse: "eligible" }] }) }), NOW);
    expect(second.filed).toEqual([]);
    expect((await readAnswerInbox(root))[1]!.status).toBe("pending");
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
  it("updates the row that already covers the subject, removes one the answer contradicts, and adds nothing new", async () => {
    const root = await workspace();
    await mkdir(join(root, "context/structured"), { recursive: true });
    const file = "context/structured/northstar.md";
    await writeFile(join(root, file), [
      "# Evidence: Northstar Labs work", "", "## Evidence Inventory", "",
      "| Evidence ID | Year | Project | Explicit claim | Scope note | Source locator | Confidence | Public use |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      "| context:northstar:looker | 2025 | Reporting | Built Looker dashboards. | Dashboards only. | Work email | high | eligible |",
      "| context:northstar:kotlin | 2024 | Mobile | Wrote Kotlin services. | | Old resume | medium | eligible |", "",
    ].join("\n"));
    await writeFile(join(root, ".sensei/today-questions.json"), JSON.stringify({ questions: mergeQuestions([], [
      { id: "skill:looker", kind: "skill", subject: "Looker", options: [], text: "Looker?", why: "" },
      { id: "skill:kotlin", kind: "skill", subject: "Kotlin", options: [], text: "Kotlin?", why: "" },
      { id: "skill:dbt", kind: "skill", subject: "dbt", options: [], text: "dbt?", why: "" },
    ], NOW) }));
    await answerQuestion(root, "skill:looker", "I also modeled the LookML for those dashboards.", NOW);
    await answerQuestion(root, "skill:kotlin", "I never wrote Kotlin there; that was Java.", NOW);
    await answerQuestion(root, "skill:dbt", "Some dbt models.", NOW);
    let prompt = "";
    const [looker, kotlin, dbt] = await readAnswerInbox(root);
    const result = await fileAnswers(root, async (text) => { prompt = text; return { conversationId: null, response: JSON.stringify({ skipped: [], filings: [
      { answerId: looker!.id, action: "update", file, evidenceId: "context:northstar:looker", year: "2025", project: "Reporting", claim: "Built Looker dashboards and modeled their LookML.", scope: "Dashboards and their LookML.", publicUse: "eligible" },
      { answerId: kotlin!.id, action: "remove", file, evidenceId: "context:northstar:kotlin", year: "2024", project: "Mobile", claim: "Wrote Kotlin services.", scope: "", publicUse: "eligible" },
      // An update naming a row that isn't in the file writes nothing and waits.
      { answerId: dbt!.id, action: "update", file, evidenceId: "context:northstar:dbt", year: "2025", project: "Data", claim: "Some dbt models.", scope: "", publicUse: "eligible" },
    ] }) }; }, NOW);
    expect(prompt).toContain("context:northstar:looker | 2025 | Reporting | Built Looker dashboards. | Dashboards only.");
    expect(result.filed.map((answer) => answer.action)).toEqual(["update", "remove"]);
    const record = await readFile(join(root, file), "utf8");
    expect(record).toContain("| context:northstar:looker | 2025 | Reporting | Built Looker dashboards and modeled their LookML. | Dashboards and their LookML. | Work email; updated: Profile question, answered 2026-11-10 | high | eligible |");
    expect(record).not.toContain("Kotlin");
    expect(record.match(/\| context:/g)).toHaveLength(1);
    expect((await readAnswerInbox(root)).map((answer) => answer.status)).toEqual(["filed", "filed", "pending"]);
  });
});
