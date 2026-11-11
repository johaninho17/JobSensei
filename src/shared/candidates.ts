// Recruiter Edition data contract (recruiter plan R1): the recruiter's own settings and the candidate roster.
// Each candidate's folder is a normal single-candidate workspace; only these two files sit above them.
import { z } from "zod";
import { DEFAULT_PDF_TEXT_SIZE, pdfTextSizeSchema, type PdfTextSize } from "./schemas";

export const RECRUITER_DIR = "recruiter";
export const CANDIDATES_DIR = "candidates";
export const RECRUITER_SETTINGS_PATH = `${RECRUITER_DIR}/settings.json`;
export const ROSTER_PATH = `${RECRUITER_DIR}/candidates.json`;

/** Name slug plus a short random suffix, so two candidates with the same name never share a folder. */
export const CANDIDATE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*-[a-z0-9]{4}$/;

export const CANDIDATE_STATUSES = ["active", "paused", "placed", "archived"] as const;
export const candidateStatusSchema = z.enum(CANDIDATE_STATUSES);
export type CandidateStatus = z.infer<typeof candidateStatusSchema>;

export const candidateEntrySchema = z.object({
  id: z.string().regex(CANDIDATE_ID),
  displayName: z.string().trim().min(1).max(120),
  status: candidateStatusSchema.default("active"),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable().default(null),
});
export type CandidateEntry = z.infer<typeof candidateEntrySchema>;

export const rosterSchema = z.object({
  schemaVersion: z.literal(1),
  candidates: z.array(candidateEntrySchema).default([]),
  updatedAt: z.string(),
});
export type Roster = z.infer<typeof rosterSchema>;

/**
 * What every candidate gets unless their own Settings say otherwise (recruiter plan Q2). `effectiveSetting` is the one
 * rule for which value wins: the candidate's own, then the recruiter's default, then the app's.
 */
export const recruiterDefaultsSchema = z.object({
  coverLetters: z.boolean().default(false),
  tailorSummary: z.boolean().default(false),
  pdfTextSize: pdfTextSizeSchema.default(DEFAULT_PDF_TEXT_SIZE),
});
export type RecruiterDefaults = z.infer<typeof recruiterDefaultsSchema>;
export const APP_RECRUITER_DEFAULTS: RecruiterDefaults = { coverLetters: false, tailorSummary: false, pdfTextSize: DEFAULT_PDF_TEXT_SIZE };

export function effectiveSetting<T>(own: T | null | undefined, recruiter: T | null | undefined, app: T): T {
  return own ?? recruiter ?? app;
}
export type { PdfTextSize };

export const recruiterSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  recruiterName: z.string().trim().max(120).nullable().default(null),
  /** Shown in reports and client updates. */
  agency: z.string().trim().max(120).nullable().default(null),
  defaults: recruiterDefaultsSchema.default(APP_RECRUITER_DEFAULTS),
  activeCandidateId: z.string().regex(CANDIDATE_ID).nullable().default(null),
  updatedAt: z.string(),
});
export type RecruiterSettings = z.infer<typeof recruiterSettingsSchema>;

/** Folder of a candidate, relative to the recruiter root. The id is checked, so it can never point elsewhere. */
export function candidateFolder(id: string): string {
  if (!CANDIDATE_ID.test(id)) throw new Error("That isn't a valid candidate.");
  return `${CANDIDATES_DIR}/${id}`;
}

/** `alex-morgan-7k2f`: letters and digits of the name (accents dropped), then a 4-character suffix. */
export function candidateIdFor(displayName: string, suffix: string): string {
  if (!/^[a-z0-9]{4}$/.test(suffix)) throw new Error("The suffix must be 4 lowercase letters or digits.");
  const slug = displayName.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  return `${slug || "candidate"}-${suffix}`;
}

/** What the renderer gets: the roster and who is active. */
/** `waiting`: jobs queued for each candidate (recruiter plan R5), so work waiting for others is visible. */
/** One line per candidate on the Candidates page (recruiter plan R8). */
export type CandidateOverview = { resume: boolean; jobs: number; applied: number; ready: number; toApprove?: number; weeklyTarget?: number | null; insight?: import("./recruiter-insight").CandidateInsight };
export type CandidatesState = { candidates: CandidateEntry[]; activeId: string | null; waiting?: Record<string, number>; overview?: Record<string, CandidateOverview> };

/** File prefix for a new candidate's documents: `Alex_Morgan` (accents dropped; "Candidate" when nothing is left). */
export function artifactPrefixFor(displayName: string): string {
  const prefix = displayName.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40).replace(/_+$/, "");
  return prefix || "Candidate";
}
