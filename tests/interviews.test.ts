import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getInterviewOverview, listInterviewRounds } from "../electron/interviews";

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sensei-interviews-"));
  await mkdir(join(root, "jobs"), { recursive: true });
  await mkdir(join(root, "debrief"), { recursive: true });
  return root;
}

async function createJob(root: string, id: string, company = "Northstar Labs"): Promise<string> {
  const path = join(root, "jobs", id);
  await mkdir(join(path, "interviews"), { recursive: true });
  await mkdir(join(path, ".sensei"), { recursive: true });
  await writeFile(join(path, ".sensei", "job.json"), JSON.stringify({ id, company, title: "Forward Deployed Engineer" }), "utf8");
  return path;
}

describe("interview overview", () => {
  it("adapts legacy flat artifacts without moving or rewriting them", async () => {
    const root = await workspace();
    const job = await createJob(root, "northstar-solutions-engineer");
    const interviewPath = join(job, "interviews", "interview.json");
    const original = JSON.stringify({
      jobId: "northstar-solutions-engineer",
      company: "Northstar Labs",
      role: "Forward Deployed Engineer",
      round: "Recruiter Screen / Introductory Call",
      format: "30-Minute Video / Phone Call",
      scheduledDate: "2026-07-29",
      status: "interview_prep_ready",
    });
    await writeFile(interviewPath, original, "utf8");
    await writeFile(join(job, "interviews", "prep.md"), "# Prep", "utf8");
    await writeFile(join(job, "interviews", "question_bank.md"), "# Questions", "utf8");
    await mkdir(join(root, "debrief", "northstar-labs"), { recursive: true });
    await writeFile(join(root, "debrief", "northstar-labs", "intro_transcript.txt"), "Raw transcript", "utf8");
    await writeFile(join(root, "debrief", "northstar-labs", "intro_summary.txt"), "Generated summary", "utf8");

    const overview = await getInterviewOverview(root, "northstar-solutions-engineer");

    expect(overview?.isLegacy).toBe(true);
    expect(overview?.rounds).toHaveLength(1);
    expect(overview?.rounds[0]).toMatchObject({
      stage: "recruiter_screen",
      status: "prep_ready",
      legacy: true,
      debriefSourcePaths: ["debrief/northstar-labs/intro_summary.txt", "debrief/northstar-labs/intro_transcript.txt"],
    });
    expect(overview?.rounds[0].artifactPaths.questionBank).toBe("jobs/northstar-solutions-engineer/interviews/question_bank.md");
    expect(await readFile(interviewPath, "utf8")).toBe(original);
  });

  it("reads normalized round folders and interviewer-reported next steps", async () => {
    const root = await workspace();
    const job = await createJob(root, "example-fde", "Example");
    await writeFile(join(job, "interviews", "interview.json"), JSON.stringify({
      schemaVersion: 2,
      jobId: "example-fde",
      company: "Example",
      role: "Forward Deployed Engineer",
      currentRoundId: "02-hiring-manager",
      rounds: [{
        id: "01-recruiter-screen",
        sequence: 1,
        stage: "recruiter_screen",
        label: "Recruiter screen",
        status: "debriefed",
        artifactPaths: {
          research: "jobs/example-fde/interviews/01-recruiter-screen/research.md",
          prep: "jobs/example-fde/interviews/01-recruiter-screen/prep.md",
          questionBank: "jobs/example-fde/interviews/01-recruiter-screen/question_bank.md",
          debriefAnalysis: "jobs/example-fde/interviews/01-recruiter-screen/debrief_analysis.md",
        },
        debriefSourcePaths: ["debrief/example/intro_transcript.txt"],
      }, {
        id: "02-hiring-manager",
        sequence: 2,
        stage: "hiring_manager",
        label: "Head of Engineering",
        interviewer: "Pablo",
        status: "planned",
        artifactPaths: {},
        debriefSourcePaths: [],
      }],
      knownProcess: [{
        stage: "take_home",
        label: "Take-home exercise",
        sourceType: "reported_by_interviewer",
      }],
    }), "utf8");

    const overview = await getInterviewOverview(root, "example-fde");
    const rounds = await listInterviewRounds(root, "example-fde");

    expect(overview?.schemaVersion).toBe(2);
    expect(overview?.currentRoundId).toBe("02-hiring-manager");
    expect(overview?.knownProcess[0]).toMatchObject({ stage: "take_home", sourceType: "reported_by_interviewer" });
    expect(rounds.map((round) => round.stage)).toEqual(["recruiter_screen", "hiring_manager"]);
  });

  it("builds an information-rich round brief from existing prep, question bank, and research files", async () => {
    const root = await workspace();
    const job = await createJob(root, "brief-example", "Brief Example");
    const roundRoot = join(job, "interviews", "01-recruiter-hiring-manager");
    await mkdir(roundRoot, { recursive: true });
    await writeFile(join(roundRoot, "prep.md"), `# Prep

## Career introduction

I moved from hands-on software delivery into customer-facing technical enablement while staying close to APIs and troubleshooting.

## Truth and scope cautions

Describe customer enablement accurately and do not imply full account ownership.`, "utf8");
    await writeFile(join(roundRoot, "question_bank.md"), `# Questions

## Primary for this round

### Q1. Tell me about yourself?

#### Direct answer (30-45 seconds)

I started in software engineering and now help customers understand, test, and adopt technical products.

## Questions to ask

- What would success look like in the first ninety days?
- How does the team share customer feedback with product?`, "utf8");
    await writeFile(join(roundRoot, "research.md"), `# Research

## Company facts

- The company builds developer infrastructure for operational teams.
- The role connects customers with engineering.`, "utf8");
    await writeFile(join(job, "interviews", "interview.json"), JSON.stringify({
      schemaVersion: 2,
      currentRoundId: "01-recruiter-hiring-manager",
      rounds: [{
        id: "01-recruiter-hiring-manager",
        sequence: 1,
        stage: "hiring_manager",
        label: "Recruiter / Hiring Manager",
        status: "prep_ready",
        artifactPaths: {
          prep: "interviews/01-recruiter-hiring-manager/prep.md",
          questionBank: "interviews/01-recruiter-hiring-manager/question_bank.md",
          research: "interviews/01-recruiter-hiring-manager/research.md",
        },
      }],
    }), "utf8");

    const brief = (await getInterviewOverview(root, "brief-example"))?.rounds[0].dashboardBrief;

    expect(brief?.quickAnswers[0].title).toBe("Career introduction");
    expect(brief?.priorityQuestions[0]).toMatchObject({ title: "Q1. Tell me about yourself?" });
    expect(brief?.priorityQuestions[0].text).toContain("started in software engineering");
    expect(brief?.questionsToAsk).toHaveLength(2);
    expect(brief?.companyFacts).toHaveLength(2);
    expect(brief?.cautions[0].text).toContain("full account ownership");
    expect(brief?.availableArtifactCount).toBe(3);
    expect(brief?.references.length).toBeGreaterThanOrEqual(6);
    expect(brief?.priorityQuestions[0]).toMatchObject({ anchor: "Q1. Tell me about yourself?", category: "question", priority: "primary" });
  });

  it("reads technical challenge rounds and their safe practice artifacts", async () => {
    const root = await workspace();
    const job = await createJob(root, "example-labs-dse", "Example Labs");
    await writeFile(join(job, "interviews", "interview.json"), JSON.stringify({
      schemaVersion: 2,
      jobId: "example-labs-dse",
      currentRoundId: "02-technical-challenge",
      rounds: [{
        id: "02-technical-challenge",
        sequence: 2,
        stage: "technical_challenge",
        label: "Implementation challenge",
        assessmentMode: "implementation_walkthrough",
        status: "prep_ready",
        artifactPaths: {
          challengeBrief: "jobs/example-labs-dse/interviews/02-technical-challenge/challenge_brief.md",
          practiceLabs: "jobs/example-labs-dse/interviews/02-technical-challenge/practice_labs.json",
        },
      }],
    }), "utf8");

    const overview = await getInterviewOverview(root, "example-labs-dse");

    expect(overview?.rounds[0]).toMatchObject({
      stage: "technical_challenge",
      assessmentMode: "implementation_walkthrough",
      artifactPaths: {
        challengeBrief: "jobs/example-labs-dse/interviews/02-technical-challenge/challenge_brief.md",
        practiceLabs: "jobs/example-labs-dse/interviews/02-technical-challenge/practice_labs.json",
      },
    });
  });

  it("maps legacy artifact path arrays into the normalized live context paths", async () => {
    const root = await workspace();
    const job = await createJob(root, "cascade-solutions-engineer", "Cascade Labs");
    await writeFile(join(job, "interviews", "interview.json"), JSON.stringify({
      schemaVersion: 2,
      currentRoundId: "01-recruiter-screen",
      rounds: [{
        id: "01-recruiter-screen",
        sequence: 1,
        stage: "recruiter_screen",
        label: "Recruiter Screen",
        status: "prep_ready",
        artifactPaths: ["interviews/01-recruiter-screen/research.md", "interviews/01-recruiter-screen/prep.md", "interviews/01-recruiter-screen/question_bank.md"],
      }],
    }), "utf8");
    const overview = await getInterviewOverview(root, "cascade-solutions-engineer");
    expect(overview?.rounds[0].artifactPaths).toMatchObject({
      prep: "jobs/cascade-solutions-engineer/interviews/01-recruiter-screen/prep.md",
      questionBank: "jobs/cascade-solutions-engineer/interviews/01-recruiter-screen/question_bank.md",
    });
  });

  it("returns null without interview metadata and rejects unsafe job identifiers", async () => {
    const root = await workspace();
    await createJob(root, "no-interview", "No Interview");
    await mkdir(join(root, "jobs", "no-metadata"), { recursive: true });
    await expect(getInterviewOverview(root, "no-interview")).resolves.toBeNull();
    await expect(getInterviewOverview(root, "no-metadata")).resolves.toBeNull();
    await expect(getInterviewOverview(root, "../outside")).rejects.toThrow("Job identifier is invalid");
  });

  it("keeps root-level job metadata compatible with legacy interview workspaces", async () => {
    const root = await workspace();
    const job = join(root, "jobs", "legacy-job");
    await mkdir(join(job, "interviews"), { recursive: true });
    await writeFile(join(job, "job.json"), JSON.stringify({ company: "Legacy Co", title: "Legacy Role" }), "utf8");
    await writeFile(join(job, "interviews", "interview.json"), JSON.stringify({ round: "Recruiter screen" }), "utf8");

    await expect(getInterviewOverview(root, "legacy-job")).resolves.toMatchObject({
      company: "Legacy Co",
      role: "Legacy Role",
      isLegacy: true,
    });
  });

  it("drops artifact and debrief paths that escape their approved roots", async () => {
    const root = await workspace();
    const job = await createJob(root, "unsafe-paths", "Unsafe");
    await writeFile(join(job, "interviews", "interview.json"), JSON.stringify({
      schemaVersion: 2,
      currentRoundId: "01-recruiter-screen",
      rounds: [{
        id: "01-recruiter-screen",
        sequence: 1,
        stage: "recruiter_screen",
        label: "Recruiter screen",
        status: "prep_ready",
        artifactPaths: { prep: "jobs/unsafe-paths/interviews/../../other-job/private.md" },
        debriefSourcePaths: ["debrief/unsafe/../../context/private.md"],
      }],
    }), "utf8");

    const overview = await getInterviewOverview(root, "unsafe-paths");

    expect(overview?.rounds[0].artifactPaths.prep).toBeNull();
    expect(overview?.rounds[0].debriefSourcePaths).toEqual([]);
  });
});
