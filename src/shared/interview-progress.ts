import type { InterviewRoundKind, InterviewStage } from "./schemas";

/**
 * Where a job's interviews stand and what comes next, one owner for the job actions, the round stepper, and the
 * Interviews list. A round counts as done when its own status says so or when the user recorded that interview in the
 * tracker. The next step always comes after the furthest round done; rounds before it that were skipped (a process that
 * started at the hiring manager) are never suggested.
 */

/** Interview stages in the order they usually happen. */
export const STAGE_RANK: Record<InterviewStage, number> = {
  recruiter_screen: 1,
  hiring_manager: 2,
  technical: 3,
  practical_evaluation: 3,
  technical_challenge: 3,
  take_home: 3,
  onsite: 4,
  final_panel: 4,
  executive: 5,
  unknown: 0,
};

/** The tracker's recorded round, as the stages it covers. */
const RECORDED_RANK: Record<InterviewRoundKind, number> = { recruiter: 1, hiring_manager: 2, practical: 3, final: 4, other: 0 };

/** The stage to prepare after a given rank when the posting names no process. */
const DEFAULT_NEXT: Array<{ rank: number; stage: InterviewStage }> = [
  { rank: 1, stage: "recruiter_screen" },
  { rank: 2, stage: "hiring_manager" },
  { rank: 3, stage: "practical_evaluation" },
  { rank: 4, stage: "final_panel" },
];

type Round = { id: string; stage: InterviewStage; status: string };
type Step = { stage: InterviewStage; roundId?: string | null };

const DONE_STATUSES = new Set(["completed", "debriefed"]);

export function roundDone(round: Round, recorded: Array<{ round: InterviewRoundKind }>): boolean {
  if (DONE_STATUSES.has(round.status)) return true;
  const rank = STAGE_RANK[round.stage] ?? 0;
  return rank > 0 && recorded.some((event) => RECORDED_RANK[event.round] === rank);
}

export type NextInterviewStep =
  | { kind: "practice"; roundId: string; stage: InterviewStage }
  | { kind: "prepare"; stage: InterviewStage }
  | { kind: "none" };

export function nextInterviewStep(input: { rounds: Round[]; knownProcess: Step[]; recorded: Array<{ round: InterviewRoundKind }> }): NextInterviewStep {
  const { rounds, knownProcess, recorded } = input;
  const furthest = Math.max(0, ...rounds.filter((round) => roundDone(round, recorded)).map((round) => STAGE_RANK[round.stage] ?? 0), ...recorded.map((event) => RECORDED_RANK[event.round] ?? 0));
  // A prepared round after the furthest one done: practice it.
  const upcoming = rounds.filter((round) => !roundDone(round, recorded) && (STAGE_RANK[round.stage] ?? 0) > furthest)
    .sort((a, b) => (STAGE_RANK[a.stage] ?? 0) - (STAGE_RANK[b.stage] ?? 0))[0];
  if (upcoming) return { kind: "practice", roundId: upcoming.id, stage: upcoming.stage };
  const prepared = new Set(rounds.map((round) => round.stage));
  // The posting's own process first, then the usual order; only stages after the furthest one done.
  const fromProcess = knownProcess.find((step) => (STAGE_RANK[step.stage] ?? 0) > furthest && !prepared.has(step.stage) && !rounds.some((round) => step.roundId && round.id === step.roundId));
  if (fromProcess) return { kind: "prepare", stage: fromProcess.stage };
  if (knownProcess.length && furthest >= Math.max(...knownProcess.map((step) => STAGE_RANK[step.stage] ?? 0))) return { kind: "none" };
  const fallback = DEFAULT_NEXT.find((step) => step.rank > furthest && !rounds.some((round) => (STAGE_RANK[round.stage] ?? 0) === step.rank));
  return fallback ? { kind: "prepare", stage: fallback.stage } : { kind: "none" };
}
