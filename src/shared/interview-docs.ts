// A round's prep notes and the job's company research as data (#113 part 2, ledger I22). Agy writes
// `interviews/<round>/prep.json` and `interviews/company_research.json`; the app checks them and writes `prep.md` and
// `company_research.md` from them, so the layout is the same every run. The interview pipeline skill and its
// `references/research.md` own what goes in each field; `electron/interview-check.ts` owns the quality checks, which
// read the rendered Markdown like any other prep or research file.
import { z } from "zod";

export const PREP_JSON = "prep.json";
export const RESEARCH_JSON = "company_research.json";

/** One line of text: newlines and runs of spaces become one space, so a field can't break the layout. */
const line = z.string().transform((value) => value.replace(/\s+/g, " ").trim()).pipe(z.string().min(1));
const optionalLine = z.string().transform((value) => value.replace(/\s+/g, " ").trim() || undefined).optional();
const cell = z.string().transform((value) => value.replace(/\s+/g, " ").replace(/\|/g, "/").trim());

const table = z.object({
  title: optionalLine,
  columns: z.array(cell).min(1),
  rows: z.array(z.array(cell)).min(1),
}).refine((value) => value.rows.every((row) => row.length === value.columns.length), { message: "every row needs one cell per column" });

const prepSection = z.object({
  heading: line,
  points: z.array(line).default([]),
  tables: z.array(table).default([]),
}).refine((value) => value.points.length > 0 || value.tables.length > 0, { message: "a section needs points or a table" });

export const prepSchema = z.object({
  schemaVersion: z.literal(1),
  /** The three points this interviewer should remember; IDs go in `ids`, never in the text. */
  keyPoints: z.array(z.object({ text: line, ids: z.array(line).default([]) })).length(3),
  beforeYouStart: z.array(line).max(3).default([]),
  learnBeforeInterview: z.array(line).min(1),
  /** The stage reference's sections, in its order. */
  sections: z.array(prepSection).default([]),
  /** Kind of question → the story to use. */
  storyMap: z.array(z.object({ question: line, story: line })).min(1),
});
export type Prep = z.infer<typeof prepSchema>;
export type PrepInput = z.input<typeof prepSchema>;

/** A research fact: a specific source (URL or `original_jd.md`) with its access date, or marked inferred. */
const fact = z.object({
  text: line,
  date: optionalLine,
  source: optionalLine,
  accessed: optionalLine,
  inferred: z.boolean().default(false),
}).refine((value) => Boolean(value.source) || value.inferred, { message: "a fact needs a source or \"inferred\": true" });

export const researchSchema = z.object({
  schemaVersion: z.literal(1),
  roleDecoded: z.array(fact).min(1).max(5),
  requirementMatch: z.array(z.object({
    requirement: line,
    fit: z.enum(["met", "learnable", "gap"]),
    evidence: optionalLine,
    cue: line,
  }).refine((value) => value.fit !== "met" || Boolean(value.evidence), { message: "\"met\" needs a story or evidence ID" })).min(1),
  wordsToKnow: z.array(z.object({ term: line, definition: line, link: optionalLine })).max(10).default([]),
  /** The posted range word for word, or "Not posted". */
  pay: line,
  whatTheySell: z.array(fact).default([]),
  recentNews: z.array(fact).max(3).default([]),
  competitors: optionalLine,
  interviewProcess: z.array(fact).default([]),
});
export type Research = z.infer<typeof researchSchema>;
export type ResearchInput = z.input<typeof researchSchema>;

const withIds = (text: string, ids: string[]) => ids.length ? `${text} (${ids.join(", ")})` : text;

function renderTable(out: string[], value: z.infer<typeof table>) {
  if (value.title) out.push(`**${value.title}**`, "");
  out.push(`| ${value.columns.join(" | ")} |`, `| ${value.columns.map(() => "---").join(" | ")} |`, ...value.rows.map((row) => `| ${row.join(" | ")} |`), "");
}

/** The Markdown the app writes from checked prep notes: the layout the app and its checks read. */
export function renderPrep(prep: Prep, title: string): string {
  const out: string[] = [`# ${title}: prep notes`, "", "## 3 things to get across", ""];
  prep.keyPoints.forEach((point, index) => out.push(`${index + 1}. ${withIds(point.text, point.ids)}`));
  out.push("");
  if (prep.beforeYouStart.length) out.push("## Before you start", "", ...prep.beforeYouStart.map((fix) => `- ${fix}`), "");
  out.push("## Learn before the interview", "", ...prep.learnBeforeInterview.map((item) => `- ${item}`), "");
  for (const section of prep.sections) {
    out.push(`## ${section.heading}`, "");
    if (section.points.length) out.push(...section.points.map((point) => `- ${point}`), "");
    for (const value of section.tables) renderTable(out, value);
  }
  out.push("## Story map", "", ...prep.storyMap.map((entry) => `- ${entry.question} → ${entry.story}`), "");
  return out.join("\n");
}

function factLine(value: z.infer<typeof fact>): string {
  const text = value.date ? `${value.date}: ${value.text}` : value.text;
  if (!value.source) return `- ${text} (inferred)`;
  return `- ${text} (${value.source}${value.accessed ? ` · ${value.accessed}` : ""}${value.inferred ? " · inferred" : ""})`;
}

/** The Markdown the app writes from checked company research, in the research reference's section order. */
export function renderResearch(research: Research, company: string): string {
  const out: string[] = [`# ${company}: company research`, ""];
  out.push("## The role decoded", "", ...research.roleDecoded.map(factLine), "");
  out.push("## Requirement match", "", "| Requirement | Fit | Your evidence | How to say it |", "| --- | --- | --- | --- |");
  for (const row of research.requirementMatch) out.push(`| ${[row.requirement, row.fit, row.evidence ?? "", row.cue].map((value) => value.replace(/\|/g, "/")).join(" | ")} |`);
  out.push("");
  if (research.wordsToKnow.length) out.push("## Words to know", "", ...research.wordsToKnow.map((word) => `- **${word.term}**: ${word.definition}${word.link ? ` (${word.link})` : ""}`), "");
  out.push("## Pay", "", research.pay, "");
  if (research.whatTheySell.length) out.push("## What they sell and who buys it", "", ...research.whatTheySell.map(factLine), "");
  if (research.recentNews.length) out.push("## Recent news", "", ...research.recentNews.map(factLine), "");
  if (research.competitors) out.push("## Competitors", "", research.competitors, "");
  if (research.interviewProcess.length) out.push("## Interview process", "", ...research.interviewProcess.map(factLine), "");
  return out.join("\n");
}
