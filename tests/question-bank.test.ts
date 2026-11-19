// #113 part 1 (ledger I22): question cards written as JSON, rendered by the app into the card format, and never
// replacing a question_bank.md edited by hand without the user's choice. Fictional candidate only.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkInterviewRound } from "../electron/interview-check";
import { pendingInterviewDocs, renderInterviewDoc, resolvePendingInterviewDoc } from "../electron/interview-render";

const renderRoundQuestionBank = (root: string, job: string, round: string, title: string) => renderInterviewDoc(root, job, round, "question_bank", title);
const hasPendingQuestionBank = async (root: string, job: string, round: string) => (await pendingInterviewDocs(root, job, round)).includes(`${round}/question_bank.md`);
const resolvePendingQuestionBank = (root: string, job: string, round: string, choice: "replace" | "keep") => resolvePendingInterviewDoc(root, job, `${round}/question_bank.md`, choice);
import { questionBankSchema, renderQuestionBank, type QuestionBankInput } from "../src/shared/question-bank";
import { parseInterviewCards } from "../src/renderer/interview-cards";

const temps: string[] = [];
afterEach(async () => { await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

const JOB = "northstar-support-analyst";
const ROUND = "01-recruiter-screen";

const BANK: QuestionBankInput = {
  schemaVersion: 1,
  primary: [
    {
      question: "Tell me about a time a customer import kept failing",
      whyTheyAsk: "checks ownership",
      say: ["2024: customer import stalled for a week", "found the bad column", "wrote the fix guide"],
      proof: { text: "Fixed a stalled customer import", ids: ["S1"] },
      followUp: { question: "What was the result?", cue: "imports ran again" },
      landOn: "found it, fixed it, documented it",
    },
    {
      question: "How would you handle a nightly load that got slow?",
      whyTheyAsk: "checks approach on a gap",
      say: ["check what changed", "read the slow query", "fix and watch"],
      approach: ["reproduce", "measure", "fix the worst step"],
      landOn: "measure before changing",
      careful: "no production access claims",
    },
  ],
  gaps: [{ question: "Have you used Kubernetes", gap: "Experience with Kubernetes", closestExperience: { text: "ran the import containers", ids: ["context:work:imports"] }, rampPlan: "managed cluster course, then a small deploy", landOn: "Docker daily, Kubernetes next" }],
  questionsToAsk: ["What does success look like in the first three months?"],
};

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "sensei-bank-"));
  temps.push(root);
  const write = async (path: string, content: string) => { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), content); };
  await write(`jobs/${JOB}/.sensei/job.json`, JSON.stringify({ company: "Northstar Labs", title: "Support Analyst" }));
  await write(`jobs/${JOB}/original_jd.md`, "# Support Analyst\n\n## Requirements\n- Experience with Kubernetes.\n");
  return { root, write, bankPath: join(root, "jobs", JOB, "interviews", ROUND, "question_bank.md") };
}

describe("question cards as JSON (#113)", () => {
  it("render into the card format the app reads, the same every time", () => {
    const bank = questionBankSchema.parse(BANK);
    const markdown = renderQuestionBank(bank, "Recruiter screen");
    expect(renderQuestionBank(questionBankSchema.parse(JSON.parse(JSON.stringify(BANK))), "Recruiter screen")).toBe(markdown);
    expect(markdown).toContain("### Question 1: Tell me about a time a customer import kept failing?");
    expect(markdown).toContain("- **Proof:** Fixed a stalled customer import (S1)");
    expect(markdown).toContain("- **Your approach:** 1) reproduce 2) measure 3) fix the worst step");
    const cards = parseInterviewCards(markdown);
    expect(cards.map((card) => card.kind)).toEqual(["question", "question", "gap", "ask"]);
    expect(cards[0]!.cues).toEqual(["2024: customer import stalled for a week", "found the bad column", "wrote the fix guide"]);
    expect(cards[0]!.followUp).toContain("What was the result?");
    expect(cards[1]!.approach).toHaveLength(3);
    expect(cards[2]!.ramp).toBe("managed cluster course, then a small deploy");
  });

  it("keep each field on one line and reject a card without its required fields", () => {
    const bank = questionBankSchema.parse({ ...BANK, primary: [{ ...BANK.primary[0]!, whyTheyAsk: "checks\nownership" }] });
    expect(bank.primary[0]!.whyTheyAsk).toBe("checks ownership");
    expect(questionBankSchema.safeParse({ ...BANK, primary: [{ ...BANK.primary[0]!, landOn: "" }] }).success).toBe(false);
    expect(questionBankSchema.safeParse({ ...BANK, schemaVersion: 2 }).success).toBe(false);
  });
});

describe("writing question_bank.md (#113)", () => {
  it("writes it, rewrites it while untouched, and waits for the user once it was edited by hand", async () => {
    const { root, write, bankPath } = await workspace();
    await write(`jobs/${JOB}/interviews/${ROUND}/question_bank.json`, JSON.stringify(BANK));
    expect((await renderRoundQuestionBank(root, JOB, ROUND, "Recruiter screen")).kind).toBe("written");
    const first = await readFile(bankPath, "utf8");

    // Untouched since the app wrote it: a new JSON replaces it.
    await write(`jobs/${JOB}/interviews/${ROUND}/question_bank.json`, JSON.stringify({ ...BANK, questionsToAsk: ["How does the team hand off work?"] }));
    expect((await renderRoundQuestionBank(root, JOB, ROUND, "Recruiter screen")).kind).toBe("written");
    expect(await readFile(bankPath, "utf8")).toContain("How does the team hand off work?");

    // Edited by hand: the new version waits, the user's file stays.
    await writeFile(bankPath, `${first}\nMy own note.\n`);
    expect((await renderRoundQuestionBank(root, JOB, ROUND, "Recruiter screen")).kind).toBe("pending");
    expect(await readFile(bankPath, "utf8")).toContain("My own note.");
    expect(await hasPendingQuestionBank(root, JOB, ROUND)).toBe(true);

    // Keep mine drops the new version; Replace (after another run) puts it in place.
    await resolvePendingQuestionBank(root, JOB, ROUND, "keep");
    expect(await hasPendingQuestionBank(root, JOB, ROUND)).toBe(false);
    expect(await readFile(bankPath, "utf8")).toContain("My own note.");
    await renderRoundQuestionBank(root, JOB, ROUND, "Recruiter screen");
    await resolvePendingQuestionBank(root, JOB, ROUND, "replace");
    expect(await readFile(bankPath, "utf8")).not.toContain("My own note.");
    expect(await hasPendingQuestionBank(root, JOB, ROUND)).toBe(false);
  });

  it("interview:check writes the Markdown from the JSON, and reports a bank that doesn't match the format", async () => {
    const { root, write, bankPath } = await workspace();
    await write(`jobs/${JOB}/interviews/${ROUND}/question_bank.json`, JSON.stringify(BANK));
    const report = await checkInterviewRound(root, JOB, ROUND);
    expect(report.issues.map((issue) => issue.code)).not.toContain("QUESTION_BANK_MISSING");
    expect(await readFile(bankPath, "utf8")).toContain("## Primary for this round");

    await write(`jobs/${JOB}/interviews/${ROUND}/question_bank.json`, JSON.stringify({ ...BANK, primary: [] }));
    const invalid = await checkInterviewRound(root, JOB, ROUND);
    expect(invalid.issues.find((issue) => issue.code === "QUESTION_BANK_JSON_INVALID")?.severity).toBe("error");
  });

  it("leaves a round without JSON alone (older rounds keep their Markdown)", async () => {
    const { root, write, bankPath } = await workspace();
    await write(`jobs/${JOB}/interviews/${ROUND}/question_bank.md`, "# Old bank\n\n## Primary for this round\n\n### Question 1: Why here?\n- **Land on:** the work\n");
    expect((await renderRoundQuestionBank(root, JOB, ROUND, "Recruiter screen")).kind).toBe("none");
    expect(await readFile(bankPath, "utf8")).toContain("# Old bank");
  });
});

describe("Agy's instructions (#113)", () => {
  it("tell Agy to write question_bank.json, never question_bank.md, with I18's card fields", async () => {
    const skill = await readFile(".agents/skills/jobsensei-interview-pipeline/SKILL.md", "utf8");
    expect(skill).toContain("`interviews/<round-id>/question_bank.json`");
    expect(skill).toContain("Never write `prep.md` or `question_bank.md`");
    for (const key of ["whyTheyAsk", "say", "proof", "approach", "followUp", "landOn", "careful", "questionsToAsk"]) expect(skill).toContain(`"${key}"`);
    expect(skill).not.toContain("### Question <N>:");
  });
});
