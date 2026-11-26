import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { QuestionAgent, buildQuestionPrompt, checkAnswers, headlessAgy, letterBody, parseAnswerReply, type AgyRunner } from "../electron/question-agent";
import type { ApplicationQuestion } from "../electron/application-questions";
import type { EvidenceSnapshot } from "../src/shared/schemas";

const JOB = "northstar-support-analyst";
const ROWS = [
  { evidenceId: "context:work:imports", claim: "Fixed a stalled customer data import by finding a bad date column and writing the fix guide.", scope: "One customer.", employer: "Northstar Labs", timeline: "2024", eligibility: "eligible" },
  { evidenceId: "context:work:sql", claim: "Wrote SQL reports for the support team.", scope: "Reporting only.", employer: "Northstar Labs", timeline: "2023", eligibility: "eligible" },
];
const STORY_BANK = "# Story Bank\n\n## S1 · Fixed a stalled customer import\n- Themes: ownership\n- Evidence: context:work:imports\n- Cues: import kept failing · found the column · wrote the guide\n- Framing limit: one customer\n";
const QUESTIONS: ApplicationQuestion[] = [
  { id: "q:1", label: "Tell us about a customer outcome you delivered. What did you do?", wordLimit: null, writeYourself: false, required: true },
  { id: "q:2", label: "What tool did you teach yourself last? [100 words max. Please write this one yourself.]", wordLimit: 100, writeYourself: true, required: true },
  { id: "q:3", label: "(In 2-3 sentences) What about Northstar's mission makes you want to work here?", wordLimit: 75, sentenceLimit: 3, writeYourself: false, required: true },
];
const POSTING = "# Support Analyst\n**Source:** https://careers.example.com/northstar/1\n\n## About us\nNorthstar helps small clinics keep patient records clean.\n\n## Apply for this job\nFirst Name\n";
const GOOD = "A customer's data import kept failing, so I traced it to a bad date column, fixed it with them, and wrote the fix guide so support could repeat it.";

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "sensei-questions-"));
  const write = async (path: string, content: string) => { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), content); };
  await write("profile/story_bank.md", STORY_BANK);
  await write("profile/interview_voice.md", "# Interview Voice\n## Phrases I use\n- \"make sure the customer can actually use it\"\n");
  await write(`jobs/${JOB}/original_jd.md`, POSTING);
  await write(`jobs/${JOB}/cover_letter.md`, "**ALEX MORGAN**\nalex@example.com\n\nDear Hiring Team,\n\nI fix data problems for customers.\n\nSincerely,\nAlex Morgan\n");
  await write(`jobs/${JOB}/.sensei/application_context.json`, JSON.stringify({ job: { company: "Northstar Labs", title: "Support Analyst" }, evidenceRows: ROWS, styleRules: ["Plain and warm."] }));
  await write(`jobs/${JOB}/.sensei/evidence_snapshot.json`, JSON.stringify({ jobId: JOB, evidenceRows: ROWS }));
  return root;
}

describe("background question answers", () => {
  it("builds one self-contained prompt: decide first, answer by kind, with the posting, letter, evidence, and limits, and no file paths", () => {
    const prompt = buildQuestionPrompt({ company: "Northstar Labs", title: "Support Analyst", questions: [...QUESTIONS, { id: "q:4", label: "Who referred you?", wordLimit: null, writeYourself: false, required: true, force: true }], evidenceRows: ROWS, styleRules: ["Plain and warm."], stories: [{ id: "S1", title: "Fixed a stalled customer import", themes: [], evidenceIds: ["context:work:imports"], cues: ["found the column"], framingLimit: "one customer" }], phrases: [], posting: POSTING, coverLetter: "I fix data problems for customers." });
    expect(prompt).toContain("context:work:imports: Fixed a stalled customer data import");
    expect(prompt).toContain("S1 · Fixed a stalled customer import");
    expect(prompt).toMatch(/## 1\. Decide, for each question[\s\S]*skip: it is logistics/);
    expect(prompt).toMatch(/motivation \(why us[\s\S]*from the posting below/);
    expect(prompt).toContain("Northstar helps small clinics keep patient records clean.");
    expect(prompt).not.toContain("First Name");
    expect(prompt).toContain("I fix data problems for customers.");
    expect(prompt).toContain("80–130 words");
    expect(prompt).toContain("at most 100 words");
    expect(prompt).toContain("at most 3 sentences, each under 25 words");
    expect(prompt).toMatch(/q:4: Who referred you\?\n.*\n  The candidate asked for this one/);
    expect(prompt).toMatch(/Never mention evidence, records, files/);
    expect(prompt).toMatch(/Never invent a client, deal, metric/);
    expect(prompt).not.toMatch(/\/Users\/|jobs\/|\.sensei|\.md\b/);
  });

  it("checks answers: write-yourself drafts are removed; limits, sentences, filler, file talk, unrecorded results, banned phrases, unknown IDs, and grounding are flagged", () => {
    const snapshot = { jobId: JOB, evidenceRows: ROWS } as unknown as EvidenceSnapshot;
    const rows = new Map(ROWS.map((row) => [row.evidenceId, `${row.claim} ${row.scope}`] as const));
    const context = { evidenceIds: new Set(ROWS.map((row) => row.evidenceId)), stories: [{ id: "S1", title: "", themes: [], evidenceIds: ["context:work:imports"], cues: [], framingLimit: "" }], snapshot, rows };
    const [good, yourself] = checkAnswers(QUESTIONS, [
      { id: "q:1", decision: "answer", kind: "experience", reason: null, text: GOOD, notes: [], evidenceIds: ["context:work:imports"], storyIds: ["S1"] },
      { id: "q:2", decision: "answer", kind: "experience", reason: null, text: "A draft the employer asked not to get.", notes: ["SQL reports you learned fast"], evidenceIds: [], storyIds: [] },
    ], context);
    expect(good!.issues).toEqual([]);
    expect(yourself).toMatchObject({ decision: "notes", text: null, notes: ["SQL reports you learned fast"] });
    expect(yourself!.issues[0]).toMatch(/write it yourself/);
    const [bad] = checkAnswers([QUESTIONS[0]!], [{ id: "q:1", decision: "answer", kind: "experience", reason: null, text: `${"word ".repeat(260)} I set up AWS and ServiceNow for them. I am excited to apply`, notes: [], evidenceIds: ["context:work:imports", "context:work:nope"], storyIds: ["S9"] }], context);
    const issues = bad!.issues.join(" | ");
    expect(issues).toMatch(/words; the limit is about 130/);
    expect(issues).toMatch(/sentence runs \d+ words/);
    expect(issues).toMatch(/Cites context:work:nope, S9/);
    expect(issues).toMatch(/AWS|ServiceNow/);
    expect(issues).toMatch(/Uses the phrase "i am excited to apply"/i);
    const [padded] = checkAnswers([QUESTIONS[2]!], [{ id: "q:3", decision: "answer", kind: "experience", reason: null, text: "I wrote SQL reports for the support team. They were used every week. The team successfully tracked tickets. That led to faster replies. The evidence shows more.", notes: [], evidenceIds: ["context:work:sql"], storyIds: [] }], context);
    const paddedIssues = padded!.issues.join(" | ");
    expect(paddedIssues).toMatch(/5 sentences; the question asks for at most 3/);
    expect(paddedIssues).toMatch(/filler \("successfully"\)/);
    expect(paddedIssues).toMatch(/Talks about your files \("The evidence"\)/i);
    expect(paddedIssues).toMatch(/States a result \("led to/);
    const [goal] = checkAnswers([QUESTIONS[2]!], [{ id: "q:3", decision: "answer", kind: "motivation", reason: null, text: "I want my work to help clinics reduce errors. I wrote SQL reports for a support team.", notes: [], evidenceIds: ["context:work:sql"], storyIds: [] }], context);
    expect(goal!.issues).toEqual([]);
    const [skipped] = checkAnswers([{ ...QUESTIONS[2]!, force: true }], [{ id: "q:3", decision: "skip", kind: "motivation", reason: "Nothing real connects to this mission.", text: null, notes: [], evidenceIds: [], storyIds: [] }], context);
    expect(skipped).toMatchObject({ decision: "skip", text: null, reason: "Nothing real connects to this mission." });
    expect(skipped!.issues[0]).toMatch(/Skipped even though you asked/);
    expect(parseAnswerReply("```json\n{\"answers\":[{\"id\":\"q:1\",\"text\":\"x\",\"notes\":[],\"evidenceIds\":[],\"storyIds\":[]}]}\n```")[0]).toMatchObject({ text: "x", decision: "answer", kind: "other" });
    expect(letterBody("**ALEX**\nalex@example.com\n\nDear Team,\n\nOne.\n\nTwo.\n\nSincerely,\nAlex\n")).toBe("One.\n\nTwo.");
  });

  it("answers pasted questions in the background and saves the answers file and state", async () => {
    const root = await workspace();
    const prompts: string[] = [];
    const runner: AgyRunner = async (prompt) => {
      prompts.push(prompt);
      return { conversationId: "conv-1", response: JSON.stringify({ answers: [{ id: "q:1", text: GOOD, notes: [], evidenceIds: ["context:work:imports"], storyIds: ["S1"] }] }) };
    };
    const updates: string[] = [];
    const agent = new QuestionAgent({ workspace: () => root, runner: async () => runner, onUpdate: (_job, state) => updates.push(state.status) });
    await agent.ask(JOB, "Tell us about a customer outcome you delivered. What did you do?");
    const state = await agent.get(JOB);
    expect(updates).toEqual(["answering", "done"]);
    expect(state).toMatchObject({ status: "done", source: "pasted", conversationId: "conv-1" });
    expect(state!.answers[0]).toMatchObject({ id: "q:1", issues: [] });
    expect(await readFile(join(root, "jobs", JOB, "application_answers.md"), "utf8")).toContain("### Tell us about a customer outcome you delivered.");
    // A second paste keeps the first answer and reuses the conversation.
    await agent.ask(JOB, "Describe a time you learned a tool fast.");
    const after = await agent.get(JOB);
    expect(after!.questions.map((question) => question.id)).toEqual(["q:1", "q:2"]);
    expect(after!.answers.find((answer) => answer.id === "q:1")!.text).toBe(GOOD);
    expect(prompts[1]).not.toContain("customer outcome you delivered");
    // A pasted logistics question is skipped without calling Agy; "Answer anyway" sends it.
    await agent.ask(JOB, "How did you find this job posting?");
    expect(prompts).toHaveLength(2);
    const logistics = await agent.get(JOB);
    // No profile in this workspace, so the fact is asked for (never guessed) and keeps its key for saving in place.
    expect(logistics!.answers.find((answer) => answer.id === "q:3")).toMatchObject({ decision: "skip", factKey: "heardAbout", reason: expect.stringMatching(/Not in your profile yet/) });
    await agent.answerAnyway(JOB, "q:3");
    expect(prompts).toHaveLength(3);
    expect(prompts[2]).toMatch(/q:3: How did you find this job posting\?\n.*\n  The candidate asked for this one/);
  });

  it("does nothing beyond a note for links whose form can't be read, and never calls Agy", async () => {
    const root = await workspace();
    let called = false;
    const agent = new QuestionAgent({ workspace: () => root, runner: async () => { called = true; throw new Error("no"); } });
    await agent.auto(JOB);
    expect(await agent.get(JOB)).toMatchObject({ status: "none", message: expect.stringMatching(/doesn't show its application questions/) });
    expect(called).toBe(false);
  });

  it("runs headless Agy with the app's Agy home and reads its JSON reply", async () => {
    if (process.platform === "win32") return;
    const dir = await mkdtemp(join(tmpdir(), "sensei-fake-agy-"));
    const fake = join(dir, "agy");
    await writeFile(fake, `#!/bin/sh\necho "{\\"status\\":\\"SUCCESS\\",\\"conversation_id\\":\\"c-9\\",\\"response\\":\\"{\\\\\\"answers\\\\\\":[]}\\",\\"home\\":\\"$HOME\\"}"\n`);
    await chmod(fake, 0o755);
    const reply = await headlessAgy({ agyPath: fake, agyHome: join(dir, "home"), cwd: dir })("prompt", { conversationId: null });
    expect(reply).toEqual({ response: "{\"answers\":[]}", conversationId: "c-9" });
  });
});
