// The job record: everything the app knows about one job, in one place (`jobs/<id>/.sensei/job_record.json`).
// The app builds it from the posting record, the evaluation, the validation report, the drafts, and the tracker
// (electron/job-record.ts); the job list, Overview, and data health read it instead of parsing those files.
// The user's own facts (status, interviews, outcome) stay in tracker.json; this record only copies them.
import { z } from "zod";

export const JOB_RECORD_SCHEMA_VERSION = 1;

/** How complete one area of a job is. "older" = from an earlier format that a fresh run would replace. */
export const HEALTH_STATES = ["complete", "partial", "older", "missing", "not_needed"] as const;
export const healthStateSchema = z.enum(HEALTH_STATES);
export type HealthState = z.infer<typeof healthStateSchema>;

export const jobHealthSchema = z.object({
  posting: healthStateSchema,
  evaluation: healthStateSchema,
  documents: healthStateSchema,
  tracking: healthStateSchema,
  /** One short line per area that is not complete, saying what is missing and how to fill it. */
  notes: z.array(z.string()),
});
export type JobHealth = z.infer<typeof jobHealthSchema>;

export const jobRecordSchema = z.object({
  schemaVersion: z.literal(JOB_RECORD_SCHEMA_VERSION),
  jobId: z.string(),
  builtAt: z.string(),
  fit: z.object({
    score: z.number().min(0).max(5).nullable(),
    decision: z.string().nullable(),
    confidence: z.string().nullable(),
    /** True when the evaluation rates the posting's own requirements by ID (`req:N`, current format). */
    byRequirement: z.boolean(),
    /** False when the rated rows no longer match the posting's requirements as the app reads them now. */
    matchesPosting: z.boolean(),
  }),
  requirements: z.array(z.object({
    id: z.string().nullable(),
    text: z.string(),
    category: z.string(),
    classification: z.string(),
    evidence: z.string(),
  })),
  mustHaves: z.array(z.object({ requirement: z.string(), status: z.enum(["met", "learnable", "blocker"]) })),
  /** Requirements rated gap or unclear, in the posting's words. */
  gaps: z.array(z.string()),
  /** Tools from the posting that sit in gap or learnable rows, for cross-job learnings ("Kotlin", "SQL"). */
  gapTerms: z.array(z.string()),
  documents: z.object({
    evaluation: z.boolean(),
    resume: z.boolean(),
    coverLetter: z.boolean(),
    answers: z.boolean(),
    pdfs: z.number().int().nonnegative(),
  }),
  posting: z.object({
    payMin: z.number().nullable(),
    payMax: z.number().nullable(),
    payPeriod: z.enum(["year", "month", "hour"]).nullable(),
    workMode: z.enum(["remote", "hybrid", "onsite"]).nullable(),
    seniority: z.string().nullable(),
    experience: z.string().nullable(),
    requiredCount: z.number().int().nonnegative(),
    tools: z.array(z.string()),
    missing: z.array(z.string()),
  }).nullable(),
  interviews: z.object({
    preparedRounds: z.number().int().nonnegative(),
    /** Real interviews the user recorded in the tracker. */
    recorded: z.number().int().nonnegative(),
    furthestRound: z.string().nullable(),
  }),
  outcome: z.object({ stageReached: z.string().nullable(), result: z.string().nullable(), reason: z.string() }).nullable(),
  health: jobHealthSchema,
});
export type JobRecord = z.infer<typeof jobRecordSchema>;
