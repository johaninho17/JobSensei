// Whether practice (mock) interviews count as career evidence: the candidate's own choice (Settings → Truth and privacy,
// `truth.practiceInterviewsAsEvidence`, on by default). When off, the snapshot leaves out rows whose source is a practice
// interview, Agy is told so, and the content update proposes no story rows from practice interviews. A mock
// interviewer's feedback is never evidence either way (.agents/workflows/jobsensei-interview-review.md step 6).

/** A row recorded from a practice interview: its source locator names a mock, practice, or simulated interview. */
export function fromPracticeInterview(row: { sourceLocator: string }): boolean {
  return /\b(?:mock|practice|simulat(?:ed|ion))\b/i.test(row.sourceLocator);
}

export function practiceCountsAsEvidence(profile: { truth?: { practiceInterviewsAsEvidence?: boolean } } | null | undefined): boolean {
  return profile?.truth?.practiceInterviewsAsEvidence !== false;
}

/** The line Agy reads (snapshot instructions, What Agy sees) when practice interviews are not evidence. */
export const PRACTICE_NOT_EVIDENCE_LINE = "Practice (mock) interviews are not evidence for this candidate: rows from them are left out, and nothing said in a practice interview may be used as a fact.";
