import { challengePracticeSchema, type ChallengePractice, type ChallengePracticeType } from "../shared/schemas";

export type ChallengeFilter = "all" | ChallengePracticeType;

export function parseChallengePractice(content: string | null): ChallengePractice | null {
  if (!content) return null;
  try {
    const result = challengePracticeSchema.safeParse(JSON.parse(content));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function filterChallengeExercises(practice: ChallengePractice, filter: ChallengeFilter) {
  return filter === "all" ? practice.exercises : practice.exercises.filter((exercise) => exercise.type === filter);
}
