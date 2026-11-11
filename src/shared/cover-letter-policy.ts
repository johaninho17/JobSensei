// Whether a cover letter is written for a candidate, and why not (recruiter plan R7). The one owner: Setup shows its
// reason, the snapshot leaves the letter brief out when it says no, and the finalizer, validator, and job page follow.
// The solo edition always writes letters unless the user turns them off; editions with `coverLetterOptIn` write one
// only when it's turned on and there is enough real material for a letter about the person, never a thin generic one.

export type CoverLetterPlan = {
  write: boolean;
  /** Why no letter is written (null when one is). */
  reason: string | null;
  /** What to add before letters can be written (empty when turned off or ready). */
  missing: string[];
  /** Turned off on purpose: no letter, and nothing to warn about. */
  off: boolean;
};

export type CoverLetterInputs = {
  /** `preferences.coverLetter.enabled`: null = the edition's default. */
  enabled: boolean | null;
  optIn: boolean;
  name: string;
  transitionSummary: string;
  pillars: string[];
  hasVoice: boolean;
  /** Checked career files besides the base resume (structured, notes, other resumes, LinkedIn). */
  careerFiles: number;
};

export const MIN_STORY_PILLARS = 2;
export const MIN_CAREER_FILES = 2;

export function coverLetterPlan(input: CoverLetterInputs): CoverLetterPlan {
  const on = input.enabled ?? !input.optIn;
  if (!on) return { write: false, reason: `Cover letters are turned off for ${input.name}.`, missing: [], off: true };
  if (!input.optIn) return { write: true, reason: null, missing: [], off: false };
  const missing = [
    !input.transitionSummary.trim() || input.pillars.filter((pillar) => pillar.trim()).length < MIN_STORY_PILLARS ? "the career story (direction plus two of the three questions)" : null,
    input.hasVoice ? null : "a writing voice",
    input.careerFiles >= MIN_CAREER_FILES ? null : `${MIN_CAREER_FILES - input.careerFiles} more checked career file${MIN_CAREER_FILES - input.careerFiles === 1 ? "" : "s"} (notes, another resume, or work records)`,
  ].filter((value): value is string => Boolean(value));
  if (!missing.length) return { write: true, reason: null, missing: [], off: false };
  return { write: false, reason: `Add ${joinList(missing)} to write letters for ${input.name}.`, missing, off: false };
}

function joinList(items: string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** The plan from a candidate profile; both callers (Setup, the snapshot) count voice and career files the same way. */
export function coverLetterPlanFor(profile: {
  identity: { fullName: string };
  career: { transitionSummary: string; narrativePillars: Record<string, string> };
  preferences: { coverLetter: { enabled?: boolean | null; narrativePillars: Record<string, string> } };
} | null, facts: { hasVoice: boolean; careerFiles: number; optIn: boolean }): CoverLetterPlan {
  const own = profile?.preferences.coverLetter.narrativePillars ?? {};
  const old = profile?.career.narrativePillars ?? {};
  const pillars = ["turningPoints", "workingStyle", "personalValues"].map((key) => own[key] || old[key] || "");
  return coverLetterPlan({
    enabled: profile?.preferences.coverLetter.enabled ?? null,
    optIn: facts.optIn,
    name: profile?.identity.fullName || "this candidate",
    transitionSummary: profile?.career.transitionSummary ?? "",
    pillars,
    hasVoice: facts.hasVoice,
    careerFiles: facts.careerFiles,
  });
}

/** Checked career files besides the base resume: selected context files (not README), other resumes, LinkedIn. */
export function countCareerFiles(selectedCareerPaths: string[], secondaryResumes: number, hasLinkedin: boolean): number {
  return selectedCareerPaths.filter((path) => path.startsWith("context/") && !/README\.md$/i.test(path)).length + secondaryResumes + Number(hasLinkedin);
}
