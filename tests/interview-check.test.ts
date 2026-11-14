import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildCoverLetterBrief } from "../electron/evidence-snapshot";
import { extractResponsibilityItems } from "../electron/fit-scoring";
import { checkInterviewRound, moneyAmounts } from "../electron/interview-check";
import { buildInterviewContext, parseInterviewVoice, parseStoryBank, questionBankUsage } from "../electron/interview-context";
import { BANNED_PHRASES } from "../electron/evidence-snapshot";

const temps: string[] = [];
afterEach(async () => { await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

const JOB = "northstar-support-analyst";
const JD = [
  "# Support Analyst",
  "",
  "## What you'll do",
  "- Help customers fix failing data imports.",
  "- Write clear troubleshooting guides.",
  "",
  "## Requirements",
  "- 2+ years supporting technical customers.",
  "- Fluency in SQL.",
  "- Experience with Kubernetes.",
  "- Clear communication and a growth mindset.",
  "",
  "## Nice to have",
  "- Snowflake experience.",
].join("\n");

const STORY_BANK = [
  "# Story Bank",
  "",
  "## S1 · Fixed a stalled customer import",
  "- Themes: ownership, hard customer",
  "- Evidence: context:work:imports",
  "- Cues: import kept failing · found the bad column · wrote the guide",
  "- Framing limit: one customer; not the owner of the import service",
  "",
  "## S2 · Learned SQL reporting quickly",
  "- Themes: fast learning",
  "- Evidence: context:work:sql",
  "- Cues: new to the tool · weekly report in two weeks",
  "- Framing limit: reporting only, not database administration",
].join("\n");

const VOICE = [
  "# Interview Voice",
  "## Phrases I use",
  "- \"make sure the customer can actually use it\"",
  "## How I structure answers",
  "- Context, then what I did, then who owned what",
  "## Delivery fixes",
  "- Lead with the answer — Now: context first — Aim: point first — Status (2026-10-24): not started",
  "- End on the point, no apology — Now: ends with sorry — Aim: clean finish — Status (2026-10-24): not started",
].join("\n");

const EVALUATION = [
  "# Application Evaluation",
  "",
  "### Must-Have Requirements",
  "| Requirement | Status | Evidence | Note |",
  "| --- | --- | --- | --- |",
  "| 2+ years supporting technical customers | met | context:work:imports | |",
  "| Experience with Kubernetes | learnable | | Docker only |",
].join("\n");

function card(n: number, example = "S1 · Fixed a stalled customer import", landOn = "found it, fixed it, documented it") {
  return [
    `### Question ${n}: Tell me about question ${n}?`,
    "- **Why they ask:** checks ownership",
    `- **Real example:** ${example}`,
    "- **Cues:** import kept failing · found the column · wrote the guide",
    `- **Land on:** ${landOn}`,
    "",
  ].join("\n");
}

function bank(cards: string[], extra = "") {
  return [
    "# Recruiter Screen",
    "",
    "## Primary for this round",
    "",
    ...cards,
    "## Gap questions",
    "",
    "### Gap 1: Have you used Kubernetes?",
    "- **Gap:** Experience with Kubernetes",
    "- **Closest real experience:** context:work:imports · ran the import containers",
    "- **Ramp plan:** managed cluster course, then a small deploy",
    "- **Land on:** Docker daily, Kubernetes next",
    "",
    "## Likely follow-ups",
    "",
    "## Questions to ask",
    "- What does success look like in the first three months?",
    extra,
  ].join("\n");
}

async function workspace(options: { compensation?: string; notice?: string } = {}) {
  const root = await mkdtemp(join(tmpdir(), "sensei-interview-"));
  temps.push(root);
  const write = async (path: string, content: string) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  };
  await write("profile/candidate.json", JSON.stringify({
    schemaVersion: 1,
    identity: { fullName: "Alex Morgan", artifactPrefix: "Alex_Morgan" },
    sources: { baseResumePath: null },
    career: {},
    preferences: {
      resume: {},
      coverLetter: {},
      interview: { location: "Portland, OR", workAuthorization: "", compensation: options.compensation ?? "", noticePeriod: options.notice ?? "", workArrangement: "Hybrid" },
    },
    truth: {},
    updatedAt: "2026-10-24T00:00:00.000Z",
  }));
  await write("profile/story_bank.md", STORY_BANK);
  await write("profile/interview_voice.md", VOICE);
  await write(`jobs/${JOB}/.sensei/job.json`, JSON.stringify({ company: "Northstar Labs", title: "Support Analyst" }));
  await write(`jobs/${JOB}/original_jd.md`, JD);
  await write(`jobs/${JOB}/evaluation.md`, EVALUATION);
  await write(`jobs/${JOB}/.sensei/evidence_snapshot.json`, JSON.stringify({
    evidenceRows: [
      { evidenceId: "context:work:imports", claim: "Supported technical customers through failing data imports.", scope: "", eligibility: "eligible", employer: "Northstar Labs", year: "2024" },
      { evidenceId: "context:work:sql", claim: "Wrote SQL reports for the support team.", scope: "", eligibility: "eligible", employer: "Northstar Labs", year: "2023" },
    ],
    applicationRouting: { selectedEvidenceIds: ["context:work:imports"] },
  }));
  await write("debrief/interview-memory/role-index.json", JSON.stringify({ roles: [{ family: "support analyst", aliases: ["support engineer"], path: "debrief/interview-memory/support.md" }] }));
  await write("debrief/interview-memory/support.md", "## Recruiter\n- Why are you leaving? (asked in 3 of 4)\n");
  return { root, write };
}

const passingCards = (count: number) => Array.from({ length: count }, (_, index) => card(index + 1, index % 2 ? "S2 · Learned SQL reporting quickly" : "S1 · Fixed a stalled customer import"));

describe("interview:context", () => {
  it("gives the run the JD's work, the candidate's gaps, stories, voice, memory, and blank logistics as null", async () => {
    const { root } = await workspace();
    const { context } = await buildInterviewContext(root, JOB, "recruiter");
    expect(context.roundId).toBe("01-recruiter-screen");
    expect(context.job.responsibilities).toEqual(["Help customers fix failing data imports.", "Write clear troubleshooting guides."]);
    expect(context.job.requiredItems).toEqual(["2+ years supporting technical customers.", "Fluency in SQL.", "Experience with Kubernetes."]);
    expect(context.gaps.map((gap) => gap.requirement)).toEqual(["Experience with Kubernetes"]);
    expect(context.storyBank.stories.map((story) => story.id)).toEqual(["S1", "S2"]);
    expect(context.voice.deliveryFixes).toHaveLength(2);
    expect(context.logistics).toMatchObject({ location: "Portland, OR", compensation: null, workAuthorization: null });
    expect(context.roleMemory?.patterns).toContain("Why are you leaving");
    expect(context.rules.bannedPhrases).toBe(BANNED_PHRASES);
    expect(Array.isArray(context.careerStory)).toBe(true);
  });

  it("lists what earlier rounds already used so later rounds don't repeat it", async () => {
    const { root, write } = await workspace();
    await write(`jobs/${JOB}/interviews/01-recruiter-screen/question_bank.md`, bank(passingCards(6)));
    const { context } = await buildInterviewContext(root, JOB, "hiring-manager");
    expect(context.priorRounds[0]).toMatchObject({ roundId: "01-recruiter-screen", storyIds: ["S1", "S2"] });
    expect(context.priorRounds[0]!.reverseQuestions).toContain("What does success look like in the first three months?");
  });
});

describe("interview:check", () => {
  it("passes a well-formed round and registers it without a hand-written dashboard", async () => {
    const { root, write } = await workspace();
    await write(`jobs/${JOB}/interviews/01-recruiter-screen/prep.md`, "## Before you start\n- Lead with the answer\n");
    await write(`jobs/${JOB}/interviews/01-recruiter-screen/question_bank.md`, bank(passingCards(6)));
    const report = await checkInterviewRound(root, JOB, "01-recruiter-screen");
    expect(report.issues.filter((item) => item.severity === "error")).toEqual([]);
    const interview = JSON.parse(await readFile(join(root, `jobs/${JOB}/interviews/interview.json`), "utf8"));
    expect(interview.rounds[0]).toMatchObject({ id: "01-recruiter-screen", status: "prep_ready" });
    expect(interview.rounds[0].dashboardBrief).toBeUndefined();
  });

  it("blocks invented logistics but accepts the candidate's own figures", async () => {
    const invented = await workspace();
    await invented.write(`jobs/${JOB}/interviews/01-recruiter-screen/prep.md`, "| Compensation | $150,000 – $175k |\n| Notice | 2 weeks notice |\n");
    await invented.write(`jobs/${JOB}/interviews/01-recruiter-screen/question_bank.md`, bank(passingCards(6)));
    const codes = (await checkInterviewRound(invented.root, JOB, "01-recruiter-screen")).issues.map((item) => item.code);
    expect(codes).toEqual(expect.arrayContaining(["INVENTED_COMPENSATION", "INVENTED_NOTICE"]));

    const own = await workspace({ compensation: "$150k+ base", notice: "Two weeks' notice" });
    await own.write(`jobs/${JOB}/interviews/01-recruiter-screen/prep.md`, "| Compensation | $150k+ base |\n| Notice | two weeks notice |\n");
    await own.write(`jobs/${JOB}/interviews/01-recruiter-screen/question_bank.md`, bank(passingCards(6)));
    const ownCodes = (await checkInterviewRound(own.root, JOB, "01-recruiter-screen")).issues.map((item) => item.code);
    expect(ownCodes).not.toContain("INVENTED_COMPENSATION");
    expect(ownCodes).not.toContain("INVENTED_NOTICE");
  });

  it("rejects unknown evidence and story IDs, uncited examples, and question counts outside the round's limits", async () => {
    const { root, write } = await workspace();
    await write(`jobs/${JOB}/interviews/01-recruiter-screen/prep.md`, "## Before you start\n");
    await write(`jobs/${JOB}/interviews/01-recruiter-screen/question_bank.md`, bank([
      card(1, "context:made:up"),
      card(2, "S9 · Not a real story"),
      card(3, "the time I saved a big account"),
    ]));
    const codes = (await checkInterviewRound(root, JOB, "01-recruiter-screen")).issues.map((item) => item.code);
    expect(codes).toEqual(expect.arrayContaining(["UNKNOWN_EVIDENCE_ID", "UNKNOWN_STORY_ID", "CARD_NO_EVIDENCE", "QUESTION_COUNT"]));
  });

  it("flags a process list on an experience question and a prep without a story map", async () => {
    const { root, write } = await workspace();
    await write(`jobs/${JOB}/interviews/01-recruiter-screen/prep.md`, "## Before you start\n");
    await write(`jobs/${JOB}/interviews/01-recruiter-screen/question_bank.md`, bank([
      "### Question 1: Tell me about a time a customer pushed back on a timeline?\n- **Why they ask:** judgment\n- **Say:** a partner wanted a faster go-live · agreed a smaller first step · went live on the new date\n- **Your approach:** 1) listen 2) explain 3) agree\n- **Land on:** a smaller first step",
      ...passingCards(5).slice(1),
    ]));
    const codes = (await checkInterviewRound(root, JOB, "01-recruiter-screen")).issues.map((item) => item.code);
    expect(codes).toEqual(expect.arrayContaining(["APPROACH_ON_EXPERIENCE", "PREP_NO_STORY_MAP"]));
  });

  it("blocks a story reused from an earlier round", async () => {
    const { root, write } = await workspace();
    await write(`jobs/${JOB}/interviews/01-recruiter-screen/question_bank.md`, bank(passingCards(6)));
    await write(`jobs/${JOB}/interviews/02-hiring-manager/prep.md`, "## Before you start\n");
    await write(`jobs/${JOB}/interviews/02-hiring-manager/question_bank.md`, bank(Array.from({ length: 8 }, (_, index) => card(index + 1, "S1 · Fixed a stalled customer import"))));
    const codes = (await checkInterviewRound(root, JOB, "02-hiring-manager")).issues.map((item) => item.code);
    expect(codes).toContain("STORY_REUSED");
  });

  it("warns on scripts, long landing lines, and banned phrases; blocks local paths", async () => {
    const { root, write } = await workspace();
    const script = `“${"I always start by listening carefully to the customer and then I work through every single step until it is fixed for them ".repeat(2)}”`;
    await write(`jobs/${JOB}/interviews/01-recruiter-screen/prep.md`, `I thrive at the intersection of things. See file:///Users/someone/notes.md\n${script}\n`);
    await write(`jobs/${JOB}/interviews/01-recruiter-screen/question_bank.md`, bank([...passingCards(5), card(6, "S1 · Fixed a stalled customer import", "I would say that I always end by making sure the customer is happy")]));
    const codes = (await checkInterviewRound(root, JOB, "01-recruiter-screen")).issues.map((item) => item.code);
    expect(codes).toEqual(expect.arrayContaining(["SCRIPTED_ANSWER", "LAND_ON_TOO_LONG", "BANNED_PHRASE", "LOCAL_PATH"]));
  });

  it("requires practice labs to come from the JD, be knowable, avoid the company's product, and source reported formats", async () => {
    const { root, write } = await workspace();
    await write(`jobs/${JOB}/interviews/03-practical-evaluation/prep.md`, "## Before you start\n");
    await write(`jobs/${JOB}/interviews/03-practical-evaluation/question_bank.md`, bank(passingCards(6)));
    const exercise = {
      id: "fix-import", type: "verbal", title: "Fix an import", difficulty: "practical", timeboxMinutes: 15,
      jobRelevance: "Northstar Labs customers import data.", prompt: "Walk through Northstar Labs' internal ImportHub v3 retry queue.",
      requirements: ["Explain the steps."], hints: ["Start with the error."], solution: "Isolate, test, explain.", explanation: "Shows method.",
      commonMistakes: ["Guessing."], followUpProbes: ["What if it recurs?"], evaluationCriteria: ["Method"],
      scoringRubric: [{ criterion: "Method", points: 5, strongPerformance: "Systematic." }],
    };
    await write(`jobs/${JOB}/interviews/03-practical-evaluation/challenge/practice_labs.json`, JSON.stringify({
      schemaVersion: 1, jobId: JOB, company: "Northstar Labs", role: "Support Analyst", title: "Practice", assessmentMode: "mixed",
      sourceBasis: "reported_process", realPromptSupplied: false, exercises: [exercise],
    }));
    const codes = (await checkInterviewRound(root, JOB, "03-practical-evaluation")).issues.map((item) => item.code);
    expect(codes).toEqual(expect.arrayContaining(["UNSOURCED_REPORTED", "LAB_NOT_FROM_JD", "LAB_KNOWABILITY", "LAB_COMPANY_SPECIFIC"]));
  });

  it("requires research facts to be sourced", async () => {
    const { root, write } = await workspace();
    await write(`jobs/${JOB}/interviews/01-recruiter-screen/prep.md`, "## Before you start\n");
    await write(`jobs/${JOB}/interviews/01-recruiter-screen/question_bank.md`, bank(passingCards(6)));
    await write(`jobs/${JOB}/interviews/company_research.md`, "- Candidates reported a take-home exercise.\n- Sells analytics software (https://example.com, accessed 2026-10-24)\n- Probably 200 staff\n");
    const issues = (await checkInterviewRound(root, JOB, "01-recruiter-screen")).issues;
    expect(issues.map((item) => item.code)).toEqual(expect.arrayContaining(["UNSOURCED_REPORTED", "RESEARCH_UNSOURCED", "RESEARCH_HOMEPAGE_SOURCE"]));
  });
});

describe("interview content v2 rules", () => {
  it("flags slogan landings, a missing key-points section, and research without the decoder, match table, and glossary", async () => {
    const { root, write } = await workspace();
    await write(`jobs/${JOB}/interviews/01-recruiter-screen/prep.md`, "## Before you start\n");
    await write(`jobs/${JOB}/interviews/01-recruiter-screen/question_bank.md`, bank([...passingCards(5), card(6, "S1 · Fixed a stalled customer import", "full-lifecycle bridge for platforms")]));
    await write(`jobs/${JOB}/interviews/company_research.md`, "## What they sell\n- Analytics software (https://example.com/product, accessed 2026-10-25)\n");
    const codes = (await checkInterviewRound(root, JOB, "01-recruiter-screen")).issues.map((item) => item.code);
    expect(codes).toEqual(expect.arrayContaining(["LAND_ON_SLOGAN", "PREP_NO_KEY_POINTS", "RESEARCH_SECTIONS_MISSING"]));
    expect(codes).not.toContain("RESEARCH_HOMEPAGE_SOURCE");
  });

  it("accepts motivation cards with cues only and research in the v2 shape", async () => {
    const { root, write } = await workspace();
    await write(`jobs/${JOB}/interviews/01-recruiter-screen/prep.md`, "## 3 things to get across\n- Imports fixed for real customers (S1)\n## Before you start\n");
    const motivation = ["### Question 1: Why are you looking to leave?", "- **Why they ask:** motivation", "- **Real example:** none", "- **Cues:** want broader customer work · ready for a bigger team", "- **Land on:** growing into customer work", ""].join("\n");
    await write(`jobs/${JOB}/interviews/01-recruiter-screen/question_bank.md`, bank([motivation, ...passingCards(5).map((c) => c.replace(/Question (\d+)/, (_m, n) => `Question ${Number(n) + 1}`))]));
    await write(`jobs/${JOB}/interviews/company_research.md`, ["## The role decoded", "- Fix customer imports (original_jd.md)", "## Requirement match", "| Requirement | Fit | Your evidence | How to say it |", "| --- | --- | --- | --- |", "| SQL | met | S2 | weekly SQL reports (original_jd.md) |", "## Words to know", "- ETL: moving data between systems (https://example.com/docs/etl, accessed 2026-10-25)"].join("\n"));
    const report = await checkInterviewRound(root, JOB, "01-recruiter-screen");
    expect(report.issues.filter((item) => item.severity === "error")).toEqual([]);
    expect(report.issues.map((item) => item.code)).not.toEqual(expect.arrayContaining(["PREP_NO_KEY_POINTS"]));
    expect(report.issues.map((item) => item.code)).not.toContain("RESEARCH_SECTIONS_MISSING");
  });
});

describe("question card v3 (Say / Proof)", () => {
  const v3 = (n: number, say: string, extra: string[] = []) => [
    `### Question ${n}: Tell me about question ${n}?`,
    "- **Why they ask:** checks ownership",
    `- **Say:** ${say}`,
    `- **Proof:** fixed a stalled customer import (${n % 2 ? "S1" : "S2"})`,
    ...extra,
    "- **Land on:** found it, fixed it, documented it",
    "",
  ].join("\n");
  const concrete = "import failed on a bad date column · wrote the fix guide · customer back in two days";

  it("accepts concrete Say points with a cited Proof and follow-ups on a few cards", async () => {
    const { root, write } = await workspace();
    await write(`jobs/${JOB}/interviews/01-recruiter-screen/prep.md`, "## 3 things to get across\n- Fixed failing imports for real customers (S1)\n## Before you start\n- Answer first, then context\n");
    const cards = Array.from({ length: 6 }, (_, i) => v3(i + 1, concrete, i === 0 ? ["- **Likely follow-up:** How did you find the column? → diffed two exports"] : []));
    await write(`jobs/${JOB}/interviews/01-recruiter-screen/question_bank.md`, bank(cards));
    const report = await checkInterviewRound(root, JOB, "01-recruiter-screen");
    const codes = report.issues.map((item) => item.code);
    expect(report.issues.filter((item) => item.severity === "error")).toEqual([]);
    for (const code of ["SAY_TOO_VAGUE", "SAY_POINT_COUNT", "SAY_POINT_TOO_LONG", "FOLLOWUP_EVERYWHERE", "PREP_POINT_TOO_LONG", "PREP_RAW_ID", "PREP_PRAISE"]) expect(codes).not.toContain(code);
  });

  it("warns on vague or long Say points, follow-ups on every card, and wordy key points with IDs", async () => {
    const { root, write } = await workspace();
    await write(`jobs/${JOB}/interviews/01-recruiter-screen/prep.md`, [
      "## 3 things to get across",
      "- Proven track record supporting customers through every kind of import failure and reporting request across many different teams and regions every week (S1)",
      "- Customer imports fixed using context:work:imports and S1 as the main example",
      "## Before you start",
    ].join("\n"));
    const follow = ["- **Likely follow-up:** What next? → more detail"];
    await write(`jobs/${JOB}/interviews/01-recruiter-screen/question_bank.md`, bank([
      v3(1, "clear communication · technical bridge · keeping requirements grounded", follow),
      v3(2, "only two · points here", follow),
      v3(3, `${concrete} · I walked the customer through every single step of the import again`, follow),
      ...Array.from({ length: 3 }, (_, i) => v3(i + 4, concrete, follow)),
    ]));
    const codes = (await checkInterviewRound(root, JOB, "01-recruiter-screen")).issues.map((item) => item.code);
    expect(codes).toEqual(expect.arrayContaining(["SAY_TOO_VAGUE", "SAY_POINT_COUNT", "SAY_POINT_TOO_LONG", "FOLLOWUP_EVERYWHERE", "PREP_POINT_TOO_LONG", "PREP_RAW_ID", "PREP_PRAISE"]));
  });

  it("flags slogan landings like 'fully aligned with role requirements' and still requires an ID on Proof", async () => {
    const { root, write } = await workspace();
    await write(`jobs/${JOB}/interviews/01-recruiter-screen/prep.md`, "## 3 things to get across\n- Imports fixed (S1)\n");
    const slogan = v3(1, concrete).replace("found it, fixed it, documented it", "fully aligned with role requirements");
    const uncited = v3(2, concrete).replace(/\(S2\)/, "");
    await write(`jobs/${JOB}/interviews/01-recruiter-screen/question_bank.md`, bank([slogan, uncited, ...Array.from({ length: 4 }, (_, i) => v3(i + 3, concrete))]));
    const codes = (await checkInterviewRound(root, JOB, "01-recruiter-screen")).issues.map((item) => item.code);
    expect(codes).toEqual(expect.arrayContaining(["LAND_ON_SLOGAN", "CARD_NO_EVIDENCE"]));
    expect(questionBankUsage(bank([v3(1, concrete), v3(2, concrete)])).storyIds).toEqual(["S1", "S2"]);
  });
});

describe("interview parsing and shared rules", () => {
  it("parses the story bank, voice, and question-bank usage formats the skills define", () => {
    expect(parseStoryBank(STORY_BANK)[0]).toMatchObject({ id: "S1", evidenceIds: ["context:work:imports"], themes: ["ownership", "hard customer"] });
    expect(parseInterviewVoice(VOICE).deliveryFixes[0]).toContain("Lead with the answer");
    expect(questionBankUsage(bank(passingCards(2))).storyIds).toEqual(["S1", "S2"]);
    expect(moneyAmounts("$140k or $150,000")).toEqual([140000, 150000]);
    expect(extractResponsibilityItems(JD)).toHaveLength(2);
  });

  it("uses one banned-phrase list for letters and interview prep", () => {
    const brief = buildCoverLetterBrief("# Analyst", null, null);
    for (const phrase of BANNED_PHRASES) expect(brief.prohibitedPatterns).toContain(phrase);
  });

  it("keeps the skills on the new contract", async () => {
    const read = (path: string) => readFile(join(process.cwd(), path), "utf8");
    const skill = await read(".agents/skills/jobsensei-interview-pipeline/SKILL.md");
    expect(skill).toContain("interview:context");
    expect(skill).toContain("interview:check");
    expect(skill).toContain("**Land on:**");
    expect(skill).toMatch(/never write `dashboardBrief`/i);
    expect(skill).toContain("## 3 things to get across");
    // Card v3: Say / Proof, follow-ups only where likely, no follow-ups section.
    expect(skill).toContain("**Say:**");
    expect(skill).toContain("**Proof:**");
    expect(skill).toMatch(/Likely follow-up\*\*: always on pressure cards; on the other cards only where/);
    expect(skill).not.toContain("**Real example:**");
    expect(skill).not.toContain("## Likely follow-ups");
    expect(await read(".agents/skills/jobsensei-interview-pipeline/references/research.md")).toContain("## Requirement match");
    const practical = await read(".agents/skills/jobsensei-interview-pipeline/references/stage-03-practical.md");
    expect(practical).not.toMatch(/telemetry pipelines|token cost|distributed tracing/i);
    expect(practical).toContain("Role family");
    for (const stage of ["stage-01-recruiter", "stage-02-hiring-manager", "stage-03-practical", "stage-04-final-panel"]) {
      expect(await read(`.agents/skills/jobsensei-interview-pipeline/references/${stage}.md`)).not.toContain("Glanceable Talking Cues");
    }
    expect(await read("AGENTS.md")).not.toContain("Interview Rules & Quality Standards");
    // Agy's terminal starts inside the workspace (data/), so the interview flow names workspace-relative paths.
    expect(await read("AGENTS.md")).toMatch(/`data\/profile\/story_bank\.md` → `profile\/story_bank\.md`/);
    for (const file of [".agents/skills/jobsensei-interview-pipeline/SKILL.md", ".agents/workflows/jobsensei-story-bank.md", ".agents/skills/jobsensei-interview-coach/SKILL.md"]) {
      expect(await read(file), file).not.toMatch(/`data\//);
    }
    expect(skill).toContain("`profile/story_bank.md`");
  });
});

describe("story fit for tool and AI questions (#24)", () => {
  it("tool, AI, and project questions pick a project story whose first Say point names the project", async () => {
    const { readFileSync } = await import("node:fs");
    const skill = readFileSync(".agents/skills/jobsensei-interview-pipeline/SKILL.md", "utf8");
    const fit = skill.slice(skill.indexOf("**Story fit.**"), skill.indexOf("## Question card"));
    expect(fit).toMatch(/question about tools, AI use, or projects/);
    expect(fit).toMatch(/first Say point names the project and what it does/);
    expect(fit).toMatch(/never a generic problem/);
    // One owner: the rule lives only in the pipeline skill's story-fit paragraph.
    for (const file of [".agents/skills/jobsensei-interview-coach/SKILL.md", ".agents/workflows/jobsensei-story-bank.md", "AGENTS.md"]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/first Say point names the project/);
    }
  });
});

describe("pressure questions", () => {
  it("are part of every round's rules, with story fit and a story map", async () => {
    const { readFileSync } = await import("node:fs");
    const skill = readFileSync(".agents/skills/jobsensei-interview-pipeline/SKILL.md", "utf8");
    for (const text of ["## Question mix: common and pressure", "**Depth probe**", "**Failure-mode scenario**", "**Pain to product:**", "**Story fit.**", "## Story map", "**Your approach** belongs only on hypotheticals and depth probes"]) expect(skill).toContain(text);
    for (const stage of ["stage-01-recruiter", "stage-02-hiring-manager", "stage-03-practical", "stage-04-final-panel"]) {
      expect(readFileSync(`.agents/skills/jobsensei-interview-pipeline/references/${stage}.md`, "utf8"), stage).toMatch(/pressure questions|failure-mode scenarios/i);
    }
  });
});
