import { describe, expect, it } from "vitest";
import { nextInterviewStep, roundDone } from "../src/shared/interview-progress";
import { DRAFT_ACTION_ID, buildJobActions } from "../src/renderer/job-actions";

const round = (id: string, stage: string, status = "prep_ready") => ({ id, stage, status }) as never;

describe("what comes next in interviews", () => {
  it("moves on once the user recorded the recruiter interview, even though its prep is still 'ready'", () => {
    const rounds = [round("01", "recruiter_screen")];
    expect(nextInterviewStep({ rounds, knownProcess: [], recorded: [] })).toEqual({ kind: "practice", roundId: "01", stage: "recruiter_screen" });
    expect(nextInterviewStep({ rounds, knownProcess: [], recorded: [{ round: "recruiter" }] })).toEqual({ kind: "prepare", stage: "hiring_manager" });
    expect(roundDone(rounds[0], [{ round: "recruiter" }])).toBe(true);
    const both = [round("01", "recruiter_screen"), round("02", "hiring_manager")];
    expect(nextInterviewStep({ rounds: both, knownProcess: [], recorded: [{ round: "recruiter" }] })).toEqual({ kind: "practice", roundId: "02", stage: "hiring_manager" });
  });

  it("never suggests a round that was skipped before the one the user started at", () => {
    const rounds = [round("01", "hiring_manager", "completed")];
    expect(nextInterviewStep({ rounds, knownProcess: [], recorded: [] })).toEqual({ kind: "prepare", stage: "practical_evaluation" });
    const withProcess = { rounds, knownProcess: [{ stage: "recruiter_screen" }, { stage: "hiring_manager" }, { stage: "technical_challenge" }] as never, recorded: [] };
    expect(nextInterviewStep(withProcess)).toEqual({ kind: "prepare", stage: "technical_challenge" });
    expect(nextInterviewStep({ rounds: [], knownProcess: [], recorded: [{ round: "hiring_manager" }] })).toEqual({ kind: "prepare", stage: "practical_evaluation" });
  });

  it("starts at the recruiter round with nothing yet, and stops after the last step of the posting's process", () => {
    expect(nextInterviewStep({ rounds: [], knownProcess: [], recorded: [] })).toEqual({ kind: "prepare", stage: "recruiter_screen" });
    expect(nextInterviewStep({ rounds: [round("01", "final_panel", "debriefed")], knownProcess: [{ stage: "recruiter_screen" }, { stage: "final_panel" }] as never, recorded: [] })).toEqual({ kind: "none" });
  });

  it("puts the next step on the job's main action", () => {
    const job = { id: "northstar-se", company: "Northstar Labs", title: "Solutions Engineer", name: "northstar-se", tracker: { interviews: [{ round: "recruiter", date: "2026-11-04", note: "", source: "user" }] } } as never;
    const interview = { currentRoundId: "01", knownProcess: [], rounds: [{ id: "01", stage: "recruiter_screen", status: "prep_ready", debriefSourcePaths: [], artifactPaths: {} }] } as never;
    const main = buildJobActions(job, interview, null).find((action) => action.recommended)!;
    expect(main.label).toBe("Prepare hiring manager interview");
  });

  it("makes drafting the next step for a saved job that has no drafts and no interview rounds", () => {
    const saved = { id: "northstar-se", company: "Northstar Labs", title: "Solutions Engineer", name: "northstar-se", tracker: null, hasApplicationMaterials: false } as never;
    const [first] = buildJobActions(saved, null, null);
    expect(first).toMatchObject({ id: DRAFT_ACTION_ID, label: "Draft application", recommended: true, jobId: "northstar-se" });
    expect(buildJobActions({ ...(saved as object), hasApplicationMaterials: true } as never, null, null).some((action) => action.id === DRAFT_ACTION_ID)).toBe(false);
  });
});

describe("Interviews count (#7)", () => {
  it("the sidebar number counts the Active list only: prepared jobs not rejected or withdrawn", async () => {
    const { activeInterviews } = await import("../src/shared/interview-progress");
    const job = (id: string, status: string | null, round: string | null) => ({ id, name: id, interviewRoundLabel: round, tracker: status ? { status, history: [], interviews: [] } : null, createdAt: "2026-11-01T00:00:00.000Z", modifiedAt: "2026-11-01T00:00:00.000Z" }) as unknown as import("../src/shared/schemas").JobFolderSummary;
    const jobs = [job("a", "interviewing", "Recruiter"), job("b", "rejected", "Hiring manager"), job("c", "withdrawn", "Recruiter"), job("d", "applied", "Recruiter"), job("e", "interviewing", null)];
    expect(activeInterviews(jobs).map((entry) => entry.id)).toEqual(["a", "d"]);
  });
});
