// #202: pages carry no paragraphs that explain the page; explanations live in a tip or the Docs.
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const GONE: Array<[string, string]> = [
  ["AgyMemory.tsx", "Agy keeps a few notes from past conversations"],
  ["AgyView.tsx", "One number for how lenient"],
  ["AgyView.tsx", "How much each kind of requirement counts"],
  ["AgyView.tsx", "Each slider is worth up to"],
  ["AgyView.tsx", "Which model Agy uses and how hard"],
  ["AgyView.tsx", "become adjustable here once they are connected"],
  ["SetupAndContext.tsx", "What employer forms ask for."],
  ["JobSearchView.tsx", "Checked on every run through their public job boards"],
  ["InterviewsHome.tsx", "Real interviews only, as recorded"],
  ["InterviewsHome.tsx", "Tools the posting asked for that"],
  ["InterviewsHome.tsx", "What each update took from a recording."],
  ["App.tsx", "Check each one, then tick it below"],
  ["App.tsx", "Add a job's files when you want Agy to use them"],
  ["TunePanel.tsx", "Its suggestions show up here when it's done."],
];

describe("no help paragraphs (#202)", () => {
  it("keeps the removed explanations out of the pages", async () => {
    for (const [file, text] of GONE) expect(await readFile(`src/renderer/${file}`, "utf8"), `${file}: ${text}`).not.toContain(text);
  });
});
