import type { CandidateProfile, InterviewLogistics } from "./schemas";
import { EMPTY_INTERVIEW_LOGISTICS } from "./schemas";

/**
 * Profile fields edited in two places (Settings and the Setup page): one reading and one way of saving, so the two
 * screens can't drift apart. Story pillars have one owner, `preferences.coverLetter.narrativePillars` (W13); the old
 * `career.narrativePillars` is only read as a fallback when the owner's field is empty.
 */
export type StoryFields = { transitionSummary: string; turningPoints: string; workingStyle: string; personalValues: string };

export function readStoryFields(profile: CandidateProfile | null): StoryFields {
  const owner = profile?.preferences.coverLetter?.narrativePillars;
  const old = profile?.career?.narrativePillars;
  return {
    transitionSummary: profile?.career?.transitionSummary ?? "",
    turningPoints: owner?.turningPoints || old?.turningPoints || "",
    workingStyle: owner?.workingStyle || old?.workingStyle || "",
    personalValues: owner?.personalValues || old?.personalValues || "",
  };
}

/** What saving the story writes: the summary to the career details, the pillars to their owner. Trimmed. */
export function storyUpdate(fields: StoryFields): { transitionSummary: string; narrativePillars: Omit<StoryFields, "transitionSummary"> } {
  return {
    transitionSummary: fields.transitionSummary.trim(),
    narrativePillars: { turningPoints: fields.turningPoints.trim(), workingStyle: fields.workingStyle.trim(), personalValues: fields.personalValues.trim() },
  };
}

/** Names typed one per line or separated by commas: trimmed, blanks dropped, each name once. */
export function parseNames(text: string): string[] {
  return [...new Set(text.split(/[\n,]/).map((name) => name.trim()).filter(Boolean))];
}

export function readLogistics(profile: CandidateProfile | null): InterviewLogistics {
  return { ...EMPTY_INTERVIEW_LOGISTICS, ...(profile?.preferences.interview ?? {}) };
}

/** Logistics are used word for word (I11), so only surrounding spaces are removed; blanks stay blank. */
export function logisticsUpdate(values: InterviewLogistics): InterviewLogistics {
  return Object.fromEntries(Object.entries({ ...EMPTY_INTERVIEW_LOGISTICS, ...values }).map(([key, value]) => [key, String(value ?? "").trim()])) as InterviewLogistics;
}
