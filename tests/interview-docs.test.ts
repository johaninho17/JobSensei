// #113 part 2 (ledger I22): prep notes and company research written as JSON, rendered by the app, checked like any
// prep or research, and never replacing a Markdown file edited by hand without the user's choice. Fictional candidate only.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { companyResearchFor } from "../electron/interview-context";
import { checkInterviewRound } from "../electron/interview-check";
import { pendingInterviewDocs, renderInterviewDoc, resolvePendingInterviewDoc } from "../electron/interview-render";
import { prepSchema, renderPrep, renderResearch, researchSchema, type PrepInput, type ResearchInput } from "../src/shared/interview-docs";

const temps: string[] = [];
afterEach(async () => { await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

const JOB = "northstar-support-analyst";
const ROUND = "01-recruiter-screen";

const PREP: PrepInput = {
  schemaVersion: 1,
  keyPoints: [
    { text: "Kept customer imports running across two data platforms", ids: ["S1"] },
    { text: "Wrote the runbooks support still uses", ids: ["S2"] },
    { text: "Explains data problems to non-technical customers", ids: [] },
  ],
  beforeYouStart: ["Answer first, then context"],
  learnBeforeInterview: ["Northstar Labs sells analytics software to retailers"],
  sections: [
    { heading: "45-second career story", points: ["started in data support", "moved to customer work"] },
    { heading: "Logistics", tables: [{ columns: ["Item", "Answer"], rows: [["Start date", "two weeks"]] }] },
  ],
  storyMap: [{ question: "a customer problem you fixed", story: "S1" }],
};

const RESEARCH: ResearchInput = {
  schemaVersion: 1,
  roleDecoded: [{ text: "Answers integration questions from retail customers", source: "original_jd.md" }],
  requirementMatch: [
    { requirement: "SQL", fit: "met", evidence: "S1", cue: "daily queries on import data" },
    { requirement: "Kubernetes", fit: "gap", cue: "Docker daily, Kubernetes next" },
  ],
  wordsToKnow: [{ term: "ETL", definition: "moving data from one system to another", link: "https://example.com/docs/etl" }],
  pay: "Not posted",
  whatTheySell: [{ text: "Analytics software for retailers", source: "https://example.com/product", accessed: "2026-11-19" }],
  recentNews: [{ date: "2026-10-01", text: "Opened a second office", source: "https://example.com/news/office", accessed: "2026-11-19" }],
  competitors: "Two larger analytics vendors",
  interviewProcess: [{ text: "Probably a recruiter call first", inferred: true }],
};

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "sensei-docs-"));
  temps.push(root);
  const write = async (path: string, content: string) => { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), content); };
  await write(`jobs/${JOB}/.sensei/job.json`, JSON.stringify({ company: "Northstar Labs", title: "Support Analyst" }));
  await write(`jobs/${JOB}/original_jd.md`, "# Support Analyst\n\n## Requirements\n- SQL.\n- Experience with Kubernetes.\n");
  return { root, write };
}

describe("prep notes and research as JSON (#113)", () => {
  it("render prep in the layout the app and its checks read, the same every time", () => {
    const markdown = renderPrep(prepSchema.parse(PREP), "Recruiter screen");
    expect(renderPrep(prepSchema.parse(JSON.parse(JSON.stringify(PREP))), "Recruiter screen")).toBe(markdown);
    const headings = markdown.split("\n").filter((line) => line.startsWith("## "));
    expect(headings).toEqual(["## 3 things to get across", "## Before you start", "## Learn before the interview", "## 45-second career story", "## Logistics", "## Story map"]);
    expect(markdown).toContain("1. Kept customer imports running across two data platforms (S1)");
    expect(markdown).toContain("| Start date | two weeks |");
    expect(markdown).toContain("- a customer problem you fixed → S1");
  });

  it("reject prep without three key points or a section without content", () => {
    expect(prepSchema.safeParse({ ...PREP, keyPoints: PREP.keyPoints.slice(0, 2) }).success).toBe(false);
    expect(prepSchema.safeParse({ ...PREP, sections: [{ heading: "Empty" }] }).success).toBe(false);
  });

  it("render research with every fact sourced or marked inferred, and refuse an unsourced fact or a met row without evidence", () => {
    const markdown = renderResearch(researchSchema.parse(RESEARCH), "Northstar Labs");
    expect(markdown).toContain("## The role decoded");
    expect(markdown).toContain("| SQL | met | S1 | daily queries on import data |");
    expect(markdown).toContain("- 2026-10-01: Opened a second office (https://example.com/news/office · 2026-11-19)");
    expect(markdown).toContain("- Probably a recruiter call first (inferred)");
    expect(researchSchema.safeParse({ ...RESEARCH, whatTheySell: [{ text: "Sells software" }] }).success).toBe(false);
    expect(researchSchema.safeParse({ ...RESEARCH, requirementMatch: [{ requirement: "SQL", fit: "met", cue: "x" }] }).success).toBe(false);
  });
});

describe("interview:check with prep and research JSON (#113)", () => {
  it("writes prep.md and company_research.md, then checks them like any other", async () => {
    const { root, write } = await workspace();
    await write(`jobs/${JOB}/interviews/${ROUND}/prep.json`, JSON.stringify(PREP));
    await write(`jobs/${JOB}/interviews/company_research.json`, JSON.stringify(RESEARCH));
    const report = await checkInterviewRound(root, JOB, ROUND);
    const codes = report.issues.map((issue) => issue.code);
    expect(codes).not.toContain("PREP_MISSING");
    expect(codes).not.toContain("PREP_NO_KEY_POINTS");
    expect(codes).not.toContain("RESEARCH_SECTIONS_MISSING");
    expect(await readFile(join(root, "jobs", JOB, "interviews", ROUND, "prep.md"), "utf8")).toContain("## Story map");
    expect(await readFile(join(root, "jobs", JOB, "interviews", "company_research.md"), "utf8")).toContain("# Northstar Labs: company research");

    await write(`jobs/${JOB}/interviews/company_research.json`, JSON.stringify({ ...RESEARCH, pay: "" }));
    const invalid = await checkInterviewRound(root, JOB, ROUND);
    expect(invalid.issues.find((issue) => issue.code === "RESEARCH_JSON_INVALID")?.severity).toBe("error");
  });

  it("keeps hand-edited prep until the user chooses, and lists research waiting on the round page", async () => {
    const { root, write } = await workspace();
    await write(`jobs/${JOB}/interviews/${ROUND}/prep.json`, JSON.stringify(PREP));
    await write(`jobs/${JOB}/interviews/company_research.json`, JSON.stringify(RESEARCH));
    expect((await renderInterviewDoc(root, JOB, ROUND, "prep", "Recruiter screen")).kind).toBe("written");
    expect((await renderInterviewDoc(root, JOB, ROUND, "research", "Northstar Labs")).kind).toBe("written");
    const prepPath = join(root, "jobs", JOB, "interviews", ROUND, "prep.md");
    const researchPath = join(root, "jobs", JOB, "interviews", "company_research.md");
    await writeFile(prepPath, "My own prep.\n");
    await writeFile(researchPath, "My own research.\n");
    expect((await renderInterviewDoc(root, JOB, ROUND, "prep", "Recruiter screen")).kind).toBe("pending");
    expect((await renderInterviewDoc(root, JOB, ROUND, "research", "Northstar Labs")).kind).toBe("pending");
    expect(await pendingInterviewDocs(root, JOB, ROUND)).toEqual([`${ROUND}/prep.md`, "company_research.md"]);

    await resolvePendingInterviewDoc(root, JOB, `${ROUND}/prep.md`, "replace");
    await resolvePendingInterviewDoc(root, JOB, "company_research.md", "keep");
    expect(await readFile(prepPath, "utf8")).toContain("## 3 things to get across");
    expect(await readFile(researchPath, "utf8")).toBe("My own research.\n");
    expect(await pendingInterviewDocs(root, JOB, ROUND)).toEqual([]);
    await expect(resolvePendingInterviewDoc(root, JOB, "../escape.md", "replace")).rejects.toThrow();
  });

  it("points Agy at this job's research JSON, and reuses another job's at the same company", async () => {
    const { root, write } = await workspace();
    await write("jobs/northstar-other/.sensei/job.json", JSON.stringify({ company: "Northstar Labs" }));
    await write("jobs/northstar-other/interviews/company_research.json", JSON.stringify(RESEARCH));
    expect(await companyResearchFor(root, JOB, "Northstar Labs")).toMatchObject({ path: null, reuseFrom: "jobs/northstar-other/interviews/company_research.json" });
    await write(`jobs/${JOB}/interviews/company_research.json`, JSON.stringify(RESEARCH));
    expect(await companyResearchFor(root, JOB, "Northstar Labs")).toMatchObject({ path: `jobs/${JOB}/interviews/company_research.json` });
  });
});

describe("Agy's instructions (#113)", () => {
  it("tell Agy to write prep.json and company_research.json, never their Markdown", async () => {
    const skill = await readFile(".agents/skills/jobsensei-interview-pipeline/SKILL.md", "utf8");
    const research = await readFile(".agents/skills/jobsensei-interview-pipeline/references/research.md", "utf8");
    expect(skill).toContain("`interviews/<round-id>/prep.json`");
    expect(skill).toContain("Never write `prep.md` or `question_bank.md`");
    expect(skill).toContain("Never write `company_research.md`");
    for (const key of ["keyPoints", "beforeYouStart", "learnBeforeInterview", "sections", "storyMap"]) expect(skill).toContain(`"${key}"`);
    for (const key of ["roleDecoded", "requirementMatch", "wordsToKnow", "pay", "whatTheySell", "recentNews", "competitors", "interviewProcess"]) expect(research).toContain(`"${key}"`);
    expect(research).toContain("never write `company_research.md`");
  });
});
