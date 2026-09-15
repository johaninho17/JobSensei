import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { challengePracticeSchema } from "../src/shared/schemas";
import { filterChallengeExercises, parseChallengePractice } from "../src/renderer/challenge-practice";

const root = process.cwd();

const fixture = {
  schemaVersion: 1,
  jobId: "example-labs",
  company: "Example Labs",
  role: "Developer Success Engineer",
  roundId: "02-technical-challenge",
  title: "Example Labs implementation challenge practice",
  assessmentMode: "implementation_walkthrough",
  sourceBasis: "reported_process",
  realPromptSupplied: false,
  approximationNotice: "Practice based on the interviewer-reported format.",
  exercises: [{
    id: "normalize-payroll-payload",
    type: "coding",
    title: "Normalize a payroll payload",
    difficulty: "practical",
    timeboxMinutes: 25,
    jobRelevance: "Tests integration judgment.",
    prompt: "Normalize provider records into one employee shape.",
    starterContext: "{\"employees\": []}",
    requirements: ["Preserve source identifiers."],
    expectedOutput: "One normalized employee list.",
    acceptanceTests: ["Missing optional fields do not crash."],
    hints: ["Separate provider parsing from normalization."],
    solution: "Create a provider adapter and a canonical mapper.",
    explanation: "The boundary isolates provider-specific behavior.",
    commonMistakes: ["Conflating missing and empty values."],
    followUpProbes: ["How would you add another provider?"],
    evaluationCriteria: ["Correctness", "Communication"],
    scoringRubric: [{ criterion: "Correctness", points: 5, strongPerformance: "Handles required edge cases." }],
  }, {
    id: "explain-rollout",
    type: "verbal",
    title: "Explain the production rollout",
    difficulty: "practical",
    timeboxMinutes: 8,
    jobRelevance: "Tests developer-facing communication.",
    prompt: "Give a two-minute rollout explanation.",
    starterContext: null,
    requirements: ["Explain rollout order and risk controls."],
    expectedOutput: "A sequenced explanation with risks.",
    acceptanceTests: [],
    hints: ["Start with the customer's desired outcome."],
    solution: "Clarify the goal, validate in sandbox, monitor, then expand.",
    explanation: "The answer connects technical work to customer risk.",
    commonMistakes: ["Leading with implementation detail before the customer outcome."],
    followUpProbes: ["What would block production access?"],
    evaluationCriteria: ["Clarity"],
    scoringRubric: [{ criterion: "Clarity", points: 5, strongPerformance: "Uses an audience-appropriate sequence." }],
  }],
} as const;

describe("technical challenge practice", () => {
  it("parses valid labs and filters coding from verbal scenarios", () => {
    const parsed = parseChallengePractice(JSON.stringify(fixture));

    expect(parsed?.assessmentMode).toBe("implementation_walkthrough");
    expect(filterChallengeExercises(parsed!, "coding").map((exercise) => exercise.id)).toEqual(["normalize-payroll-payload"]);
    expect(filterChallengeExercises(parsed!, "verbal").map((exercise) => exercise.id)).toEqual(["explain-rollout"]);
  });

  it("rejects malformed or incomplete practice files safely", () => {
    expect(parseChallengePractice("not json")).toBeNull();
    expect(parseChallengePractice(JSON.stringify({ ...fixture, exercises: [{ title: "Incomplete" }] }))).toBeNull();
  });

  it("requires hidden-solution content and a scoring rubric for every exercise", () => {
    const missingSolution = structuredClone(fixture) as Record<string, any>;
    missingSolution.exercises[0].solution = "";
    expect(challengePracticeSchema.safeParse(missingSolution).success).toBe(false);

    const missingRubric = structuredClone(fixture) as Record<string, any>;
    missingRubric.exercises[0].scoringRubric = [];
    expect(challengePracticeSchema.safeParse(missingRubric).success).toBe(false);
  });

  it("keeps the new skill isolated from ordinary interview and application prompts", async () => {
    const skill = await readFile(join(root, ".agents/skills/jobsensei-technical-challenge/SKILL.md"), "utf8");
    const interviewSkill = await readFile(join(root, ".agents/skills/jobsensei-interview-pipeline/SKILL.md"), "utf8");
    const applicationSkill = await readFile(join(root, ".agents/skills/jobsensei-application-pipeline/SKILL.md"), "utf8");

    expect(skill).toContain("Do not activate for a pasted JD");
    expect(skill).toContain("Do not activate for");
    expect(skill).toContain("technical interview");
    expect(skill).toContain("Create only:");
    expect(interviewSkill).not.toContain("practice_labs.json");
    expect(applicationSkill).not.toContain("practice_labs.json");
  });

  it("keeps hints and solutions collapsed until the user reveals them", async () => {
    const app = await readFile(join(root, "src/renderer/App.tsx"), "utf8");

    expect(app).toContain('const [revealedHints, setRevealedHints] = useState<string[]>([])');
    expect(app).toContain("const [solutionOpen, setSolutionOpen] = useState(false)");
    expect(app).toContain('solutionOpen ? "Hide solution" : "Show solution"');
    expect(app).toContain('aria-label="Jump to challenge exercise"');
  });
});
