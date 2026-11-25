// Issue #161: logistics and choice questions are answered from the candidate profile, never by Agy, never guessed.
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ashbyFields, greenhouseFields, leverFields, writtenQuestions } from "../electron/application-questions";
import { saveProfileFact } from "../electron/candidate-facts";
import { QuestionAgent } from "../electron/question-agent";
import { chooseOption, factFor, isBlankFact, profileAnswer, withProfileAnswers, yourAnswer } from "../src/shared/profile-answers";
import { candidateProfileSchema, type ApplicationQuestion, type CandidateProfile } from "../src/shared/schemas";

const demo = () => candidateProfileSchema.parse(JSON.parse(readFileSync("examples/demo-workspace/profile/candidate.json", "utf8")));
function withFacts(facts: Partial<CandidateProfile["preferences"]["interview"]>, answers: Partial<CandidateProfile["preferences"]["applicationFacts"]["answers"]> = {}): CandidateProfile {
  const profile = demo();
  return { ...profile, preferences: { ...profile.preferences, interview: { ...profile.preferences.interview, ...facts }, applicationFacts: { ...profile.preferences.applicationFacts, answers: { ...profile.preferences.applicationFacts.answers, ...answers } } } };
}
const q = (label: string, options?: string[]): ApplicationQuestion => ({ id: "q:1", label, wordLimit: null, writeYourself: false, required: true, logistics: true, ...(options ? { options } : {}) });

describe("which profile fact a question asks for", () => {
  it.each([
    ["Will you now or in the future require sponsorship for employment visa status?", "sponsorship"],
    ["Are you legally authorized to work in the United States?", "workAuthorization"],
    ["What are your salary expectations?", "compensation"],
    ["When can you start?", "noticePeriod"],
    ["Are you open to relocating to Austin?", "relocation"],
    ["Are you able to work onsite three days a week?", "workArrangement"],
    ["Where are you currently located?", "location"],
    ["How did you hear about this role?", "heardAbout"],
    ["What are your pronouns?", "pronouns"],
    ["How many years of professional experience do you have?", "yearsExperience"],
    ["How many years of post-graduate work experience do you have?", "yearsExperience"],
    ["Please select the country where you currently reside.", "location"],
    ["Are you legally authorized to work in the country where the job is located?", "workAuthorization"],
    ["Have you held a security clearance?", null],
  ])("%s → %s", (label, key) => expect(factFor(label)).toBe(key));
});

describe("picking an option from a fact", () => {
  it("follows a Yes or No stated at the start of the fact", () => {
    expect(chooseOption("No, I don't need sponsorship", ["Yes", "No"])).toBe("No");
    expect(chooseOption("Yes – US citizen", ["Yes, I am authorized", "No, I am not"])).toBe("Yes, I am authorized");
  });
  it("matches an option the fact contains, the longest winning", () => {
    expect(chooseOption("Remote or hybrid", ["Remote", "Hybrid", "Onsite"])).toBe("Remote");
    expect(chooseOption("LinkedIn", ["Company website", "LinkedIn", "Referral"])).toBe("LinkedIn");
  });
  it("picks the option whose range holds a number, never the longest text match", () => {
    expect(chooseOption("6", ["Less than 6 years", "6 or more years"])).toBe("6 or more years");
    expect(chooseOption("4", ["0-2", "3-5", "6+"])).toBe("3-5");
    expect(chooseOption("2", ["Under 3 years", "More than 3 years"])).toBe("Under 3 years");
    expect(chooseOption("6", ["Entry level", "Senior"])).toBeNull();
  });
  it("matches whole words only, so No never picks Not sure", () => {
    expect(chooseOption("No", ["Not sure", "Maybe"])).toBeNull();
  });
  it("picks nothing when no option clearly fits, and never reads N/A as No", () => {
    expect(chooseOption("US citizen", ["Yes", "No"])).toBeNull();
    expect(chooseOption("N/A", ["Yes", "No"])).toBeNull();
  });
});

describe("answers from the profile", () => {
  it("answers a text question with the fact, word for word", () => {
    expect(profileAnswer(q("What are your salary expectations?"), withFacts({ compensation: "$120k base" }))).toMatchObject({ decision: "answer", text: "$120k base", source: "profile", factKey: "compensation" });
  });
  it("asks for a blank fact instead of guessing", () => {
    const answer = profileAnswer(q("What are your salary expectations?"), withFacts({ compensation: "" }));
    expect(answer).toMatchObject({ decision: "skip", text: null, factKey: "compensation" });
    expect(isBlankFact(answer)).toBe(true);
  });
  it("picks the matching option, or asks you to pick when none fits", () => {
    const profile = withFacts({}, { sponsorship: "No" });
    expect(profileAnswer(q("Do you require visa sponsorship?", ["Yes", "No"]), profile)).toMatchObject({ decision: "answer", text: "No", source: "profile" });
    const none = profileAnswer(q("Do you require visa sponsorship?", ["H-1B", "TN", "Other"]), profile);
    expect(none).toMatchObject({ decision: "skip", factKey: "sponsorship", reason: expect.stringMatching(/Your profile says "No"/) });
    expect(isBlankFact(none)).toBe(false);
  });
  it("keeps your own answers and Agy's forced answers when the profile is re-applied", () => {
    const questions = [q("How did you hear about this role?"), { ...q("What are your pronouns?"), id: "q:2" }, { ...q("Notice period?"), id: "q:3", force: true }];
    const forced = { ...yourAnswer("q:3", "Agy text"), source: undefined };
    const answers = withProfileAnswers(questions, [yourAnswer("q:1", "A friend"), forced], withFacts({}, { pronouns: "she/her" }));
    expect(answers).toEqual([expect.objectContaining({ id: "q:1", text: "A friend", source: "you" }), expect.objectContaining({ id: "q:2", text: "she/her", source: "profile" }), forced]);
  });
});

describe("choice questions are kept with their options", () => {
  it("reads options from Greenhouse, Ashby (Boolean is Yes/No), and Lever", () => {
    const greenhouse = greenhouseFields({ questions: [{ label: "Do you require sponsorship?", required: true, fields: [{ type: "multi_value_single_select", values: [{ label: "Yes" }, { label: "No" }] }] }] });
    const ashby = ashbyFields({ data: { jobPosting: { applicationForm: { sections: [{ fieldEntries: [{ field: { type: "Boolean", title: "Are you authorized to work in the US?" }, isRequired: true }] }] } } } });
    const card = JSON.stringify({ fields: [{ type: "multiple-choice", text: "Open to relocation?", required: true, options: [{ text: "Yes" }, { text: "No" }] }] }).replace(/"/g, "&quot;");
    const lever = leverFields(`<input type="hidden" value="${card}">`);
    for (const fields of [greenhouse, ashby, lever]) {
      const [question] = writtenQuestions(fields);
      expect(question).toMatchObject({ logistics: true, options: ["Yes", "No"] });
    }
  });
  it("still drops contact and EEO fields and choices without options", () => {
    expect(writtenQuestions([{ label: "Gender", type: "choice", required: false, description: "", options: ["Woman", "Man"] }, { label: "Pick one", type: "choice", required: false, description: "" }])).toEqual([]);
  });
});

describe("the background answerer uses the profile and never calls Agy for form questions", () => {
  async function workspaceWithProfile(profile: CandidateProfile) {
    const root = await mkdtemp(join(tmpdir(), "sensei-profile-answers-"));
    await mkdir(join(root, "profile"), { recursive: true });
    await mkdir(join(root, "jobs", "demo-job", ".sensei"), { recursive: true });
    await writeFile(join(root, "profile", "candidate.json"), JSON.stringify(profile));
    return root;
  }

  it("answers, saves a typed fact to the profile, and lets you answer one for this job", async () => {
    const root = await workspaceWithProfile(withFacts({ compensation: "$95k" }));
    let called = false;
    const agent = new QuestionAgent({ workspace: () => root, runner: async () => { called = true; throw new Error("no"); } });
    await agent.ask("demo-job", "What are your salary expectations?\n\nWhat are your pronouns?\n\nHave you held a security clearance?");
    expect(called).toBe(false);
    const first = (await agent.get("demo-job"))!;
    expect(first.status).toBe("done");
    expect(first.answers).toEqual([
      expect.objectContaining({ id: "q:1", text: "$95k", source: "profile" }),
      expect.objectContaining({ id: "q:2", decision: "skip", factKey: "pronouns" }),
      expect.objectContaining({ id: "q:3", decision: "skip" }),
    ]);
    // Typed once in the Questions tab: saved to the profile, and this job follows it.
    await saveProfileFact(root, "pronouns", "they/them");
    const saved = candidateProfileSchema.parse(JSON.parse(await readFile(join(root, "profile", "candidate.json"), "utf8")));
    expect(saved.preferences.applicationFacts.answers.pronouns).toBe("they/them");
    expect((await agent.get("demo-job"))!.answers[1]).toMatchObject({ text: "they/them", source: "profile" });
    // A question with no profile fact: your answer, for this job only.
    await agent.setAnswer("demo-job", "q:3", "No");
    const last = (await agent.get("demo-job"))!;
    expect(last.answers[2]).toMatchObject({ text: "No", source: "you" });
    expect(await readFile(join(root, "jobs", "demo-job", "application_answers.md"), "utf8")).toContain("they/them");
    expect(called).toBe(false);
  });

  it("saves logistics facts to their one owner, interview logistics", async () => {
    const root = await workspaceWithProfile(withFacts({}));
    const next = await saveProfileFact(root, "noticePeriod", "Two weeks");
    expect(next.preferences.interview.noticePeriod).toBe("Two weeks");
    expect(next.preferences.applicationFacts.answers).not.toHaveProperty("noticePeriod");
  });
});
