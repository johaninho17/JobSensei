// The user's corrections to a job's details (#114): company, title, location, work setup, and pay, kept in
// `jobs/<id>/.sensei/job-overrides.json`. Only the user writes it (the job page's Edit details). It is laid over what
// the app read from the posting wherever a job is shown or named, and a re-read of the posting never touches it.
import { z } from "zod";
import { formatPay } from "./pay";
import type { JobFolderSummary } from "./schemas";

export const JOB_OVERRIDES_FILE = ".sensei/job-overrides.json";

const field = z.string().trim().max(160).transform((value) => value || null).nullable().default(null);
const amount = z.number().nonnegative().finite().nullable().default(null);

export const jobOverridesSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  company: field,
  title: field,
  location: field,
  workMode: z.enum(["remote", "hybrid", "onsite"]).nullable().default(null),
  pay: z.object({
    min: amount,
    max: amount,
    currency: z.string().trim().min(1).max(8).default("USD"),
    period: z.enum(["year", "month", "hour"]).default("year"),
  }).nullable().default(null).transform((pay) => pay && (pay.min !== null || pay.max !== null) ? pay : null),
  updatedAt: z.string().nullable().default(null),
});
export type JobOverrides = z.infer<typeof jobOverridesSchema>;
export type JobOverridesInput = z.input<typeof jobOverridesSchema>;

export const NO_OVERRIDES: JobOverrides = jobOverridesSchema.parse({});

const LABELS = { company: "Company", title: "Title", location: "Location", workMode: "Work setup", pay: "Pay" } as const;
export type OverriddenField = keyof typeof LABELS;

/** Which details the user corrected, in display order. */
export function overriddenFields(overrides: JobOverrides): OverriddenField[] {
  return (Object.keys(LABELS) as OverriddenField[]).filter((key) => overrides[key] !== null);
}

export const overrideLabel = (field: OverriddenField) => LABELS[field];

/** Pay as one line, through the one pay formatter (src/shared/pay.ts, #209). */
export function payLine(pay: NonNullable<JobOverrides["pay"]>): string {
  return formatPay(pay.min, pay.max, pay.currency, pay.period) ?? "";
}

const WORK = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" } as const;

/** The job as shown everywhere: the user's corrections laid over what the app read. */
export function applyJobOverrides(summary: JobFolderSummary, overrides: JobOverrides): JobFolderSummary {
  const edited = overriddenFields(overrides);
  if (!edited.length) return summary;
  const role = summary.role && (overrides.workMode || overrides.pay) ? {
    ...summary.role,
    ...(overrides.workMode ? { workMode: overrides.workMode, workArrangement: WORK[overrides.workMode] } : {}),
    ...(overrides.pay ? { pay: payLine(overrides.pay), payRange: { min: overrides.pay.min, max: overrides.pay.max, currency: overrides.pay.currency, period: overrides.pay.period } } : {}),
    missing: summary.role.missing.filter((item) => !(item === "pay" && overrides.pay)),
  } : summary.role;
  return {
    ...summary,
    company: overrides.company ?? summary.company,
    title: overrides.title ?? summary.title,
    location: overrides.location ?? summary.location,
    role,
    editedFields: edited,
  };
}
