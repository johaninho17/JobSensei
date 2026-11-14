// The posting record: one structured reading of a job posting, built by the app (electron/posting-record.ts)
// and saved as `jobs/<id>/.sensei/posting.json`. Every screen and check reads these fields instead of
// parsing original_jd.md itself. A field the posting doesn't state is null and listed in `missing`.
import { z } from "zod";

export const POSTING_SCHEMA_VERSION = 1;

export const WORK_MODES = ["remote", "hybrid", "onsite"] as const;
export const SENIORITY_LEVELS = ["intern", "junior", "mid", "senior", "staff", "lead", "manager", "director", "executive"] as const;
export const POSTING_BOARDS = ["greenhouse", "lever", "ashby", "workday", "linkedin", "smartrecruiters", "oracle", "other"] as const;

export const postingPaySchema = z.object({
  /** Compact range as written ("$83,000–$116,000/year"). */
  text: z.string(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  currency: z.string().nullable(),
  period: z.enum(["year", "month", "hour"]).nullable(),
  /** The whole sentence the pay came from (it may add OTE, equity, or location bands). */
  line: z.string(),
});

export const postingWorkSetupSchema = z.object({
  mode: z.enum(WORK_MODES).nullable(),
  daysInOffice: z.number().int().min(0).max(7).nullable(),
  /** The posting's own words ("Hybrid, 3 days a week in San Francisco"). */
  text: z.string(),
});

export const postingRequirementSchema = z.object({
  id: z.string().regex(/^req:\d+$/),
  text: z.string(),
  kind: z.enum(["required", "responsibility"]),
});

export const postingRecordSchema = z.object({
  schemaVersion: z.literal(POSTING_SCHEMA_VERSION),
  /** Bumped when the parser changes, so every record is rebuilt with the fix. */
  parserVersion: z.number().int().positive(),
  /** sha256 of the posting text the record was built from. */
  sourceHash: z.string(),
  title: z.string().nullable(),
  company: z.string().nullable(),
  location: z.string().nullable(),
  url: z.string().nullable(),
  board: z.enum(POSTING_BOARDS).nullable(),
  /** What the role is, from the posting's own overview paragraphs. */
  summary: z.array(z.string()),
  /** One sentence about the company, from the posting. */
  companyLine: z.string().nullable(),
  /** What the evaluation rates: required items, then main responsibilities, with stable IDs. */
  requirements: z.array(postingRequirementSchema),
  requiredItems: z.array(z.string()),
  responsibilities: z.array(z.string()),
  preferred: z.array(z.string()),
  benefits: z.array(z.string()),
  pay: postingPaySchema.nullable(),
  workSetup: postingWorkSetupSchema.nullable(),
  travel: z.string().nullable(),
  experience: z.string().nullable(),
  seniority: z.enum(SENIORITY_LEVELS).nullable(),
  /** Full-time, Part-time, Contract, Temporary, or Internship (src/shared/posting-fields.ts). */
  employmentType: z.enum(["Full-time", "Part-time", "Contract", "Temporary", "Internship"]).nullable().default(null),
  /** When the posting went up (YYYY-MM-DD), when it says. */
  postedAt: z.string().nullable().default(null),
  /** The employer's own job or requisition ID. */
  jobId: z.string().nullable().default(null),
  /** The posting's line about sponsorship, work authorization, citizenship, or clearance. */
  workAuthorization: z.string().nullable(),
  /** Tools and named skills in the requirements, each with the requirement IDs that name it. */
  tools: z.array(z.object({ name: z.string(), requirementIds: z.array(z.string()) })),
  /** Fields the posting doesn't state, so screens say "Not in the posting" instead of showing nothing. */
  missing: z.array(z.string()),
});

export type PostingRecord = z.infer<typeof postingRecordSchema>;
export type PostingPay = z.infer<typeof postingPaySchema>;
export type PostingWorkSetup = z.infer<typeof postingWorkSetupSchema>;
export type PostingRequirement = z.infer<typeof postingRequirementSchema>;

/** Fields reported in `missing` when the posting doesn't state them. */
export const POSTING_EXPECTED_FIELDS = ["title", "company", "location", "summary", "requirements", "responsibilities", "pay", "workSetup", "experience"] as const;
