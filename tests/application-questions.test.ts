import { describe, expect, it } from "vitest";
import { ashbyFields, fetchApplicationForm, formSource, greenhouseFields, isLogistics, leverFields, parsePastedQuestions, sentenceLimit, wordLimit, writtenQuestions } from "../electron/application-questions";

// Fictional labels in the shapes seen on real Greenhouse, Ashby, and Lever forms (2026-10-27/28).
// true = plainly logistics (skipped without asking Agy); false = sent to Agy, which decides.
const LABELS: Array<[string, boolean]> = [
  ["Tell us about a customer outcome you delivered in your most recent role: a go-live or a renewal. What was the result, and what did you do to get there?", false],
  ["What's the most recent tool you taught yourself for work? What did you learn along the way? [150 words max. Please write this one yourself.]", false],
  ["Please elaborate on your experience building integrations with REST APIs", false],
  ["In 2-3 sentences, please describe your deepest experience turning complex data into actionable insights.", false],
  ["(In 2-3 sentences) What about Northstar's mission or approach makes you excited to contribute your specific skills here, and not somewhere else?", false],
  ["Why do you want to work at Northstar Labs?", false],
  ["How would you explain a data gap to a partner who depends on the numbers?", false],
  ["How did you find this job posting?", true],
  ["How did you hear about us?", true],
  ["Who referred you?", true],
  ["What is your required base salary per the range listed?", true],
  ["Are you authorized to work in the United States?", true],
  ["This role requires onsite work Monday to Friday. Are you able to do this?", true],
  ["Where do you plan on working from (for payroll tax purposes)?", true],
  ["What is your earliest start date?", true],
  ["Here's some encoded text. Figure out the secret and submit it below. Tell us how you did it.", true],
];

describe("written question filter", () => {
  it("marks only plain logistics; every real question goes to Agy", () => {
    for (const [label, logistics] of LABELS) expect(isLogistics(label), label).toBe(logistics);
  });

  it("drops uploads, choices, and contact fields, and keeps text questions with their logistics flag", () => {
    const questions = writtenQuestions([
      { label: "First Name", type: "short", required: true, description: "" },
      { label: "Preferred First Name", type: "short", required: false, description: "" },
      { label: "Email", type: "short", required: true, description: "" },
      { label: "LinkedIn Profile", type: "short", required: true, description: "" },
      { label: "Resume/CV", type: "file", required: true, description: "" },
      { label: LABELS[3]![0], type: "long", required: true, description: "" },
      { label: "Do you have at least 6 months of experience?", type: "choice", required: true, description: "" },
      { label: LABELS[7]![0], type: "short", required: true, description: "" },
    ]);
    expect(questions.map((question) => [question.label, question.logistics])).toEqual([[LABELS[3]![0], false], [LABELS[7]![0], true]]);
    expect(questions[0]).toMatchObject({ sentenceLimit: 3, wordLimit: 75 });
  });

  it("reads word, character, and sentence limits and write-it-yourself requests", () => {
    expect(wordLimit("[150 words max]")).toBe(150);
    expect(wordLimit("Please keep it under 200 words")).toBe(200);
    expect(wordLimit("Maximum 1000 characters")).toBe(167);
    expect(wordLimit("Tell us about a project")).toBeNull();
    expect(sentenceLimit("(In 2-3 sentences) What about…")).toBe(3);
    expect(sentenceLimit("In one sentence, why?")).toBe(1);
    expect(sentenceLimit("Tell us about a project")).toBeNull();
    const [question] = writtenQuestions([{ label: LABELS[1]![0], type: "long", required: true, description: "" }]);
    expect(question).toMatchObject({ id: "q:1", wordLimit: 150, writeYourself: true, logistics: false });
  });

  it("parses pasted questions one per line or one per block, flags logistics, and trims stray commas", () => {
    const lines = parsePastedQuestions("1. Tell us about a hard customer.\n- How did you find this job posting?,\n");
    expect(lines.map((q) => [q.label, q.logistics])).toEqual([["Tell us about a hard customer.", false], ["How did you find this job posting?", true]]);
    const blocks = parsePastedQuestions("Describe a launch you owned.\nWhat changed?\n\nWhat tool did you learn last? [100 words max]");
    expect(blocks.map((q) => [q.label, q.wordLimit])).toEqual([["Describe a launch you owned. What changed?", null], ["What tool did you learn last? [100 words max]", 100]]);
  });
});

describe("form readers", () => {
  it("reads Greenhouse, Ashby, and Lever forms into fields", () => {
    expect(greenhouseFields({ questions: [
      { label: "First Name", required: true, fields: [{ type: "input_text" }] },
      { label: LABELS[0]![0], required: true, fields: [{ type: "textarea" }] },
      { label: "Resume/CV", required: false, fields: [{ type: "input_file" }] },
    ] }).map((field) => field.type)).toEqual(["short", "long", "file"]);
    expect(ashbyFields({ data: { jobPosting: { applicationForm: { sections: [{ fieldEntries: [
      { field: { type: "Email", title: "Email" }, isRequired: true },
      { field: { type: "LongText", title: LABELS[2]![0] }, isRequired: true },
      { field: { type: "Boolean", title: LABELS[11]![0] }, isRequired: true },
    ] }] } } } }).map((field) => field.type)).toEqual(["short", "long", "choice"]);
    const card = JSON.stringify({ text: "Role questions", fields: [{ type: "textarea", text: LABELS[0]![0], required: true }, { type: "text", text: LABELS[6]![0], required: true }] }).replaceAll('"', "&quot;");
    const fields = leverFields(`<div><input type="hidden" value="${card}" name="cards[x][baseTemplate]" /></div>`);
    expect(fields.map((field) => [field.type, field.required])).toEqual([["long", true], ["short", true]]);
    expect(writtenQuestions(fields).map((q) => [q.label, q.logistics])).toEqual([[LABELS[0]![0], false], [LABELS[6]![0], false]]);
  });

  it("knows which links have readable forms and leaves every other board alone", async () => {
    expect(formSource("https://job-boards.greenhouse.io/northstar/jobs/123?utm_source=x")).toEqual({ board: "greenhouse", parts: ["northstar", "123"] });
    expect(formSource("https://jobs.ashbyhq.com/northstar/abc-123?utm_source=x")).toEqual({ board: "ashby", parts: ["northstar", "abc-123"] });
    expect(formSource("https://jobs.lever.co/northstar/abc-123")).toEqual({ board: "lever", parts: ["https://jobs.lever.co", "northstar", "abc-123"] });
    expect(formSource("https://northstar.wd5.myworkdayjobs.com/en-US/careers/job/123")).toBeNull();
    let called = false;
    const fetcher = (async () => { called = true; return new Response("{}"); }) as unknown as typeof fetch;
    expect(await fetchApplicationForm("https://careers.example.com/jobs/1", fetcher)).toBeNull();
    expect(called).toBe(false);
  });
});
