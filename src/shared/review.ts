// What the review screen shows for a drafted job (Recruiter Edition, plan R8 P2); built by electron/application-review.ts.
export type ReviewEvidence = { id: string; text: string; source: string };
export type ReviewLine = { text: string; changed: boolean; evidence: ReviewEvidence[] };
export type ReviewSection = { title: string; lines: ReviewLine[] };
export type ApplicationReview = { resumeName: string; sections: ReviewSection[]; changed: number; total: number; letter: boolean } | null;
