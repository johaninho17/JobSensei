// Setup readiness: what JobSensei needs before it can run (required) and what makes its drafts better (recommended).
// electron/setup-readiness.ts computes it; Get Started, the Setup page, the job queue, and the snapshot all read it,
// so the app (not Agy) is the first to say what is missing, always in the same words.
import { z } from "zod";

export const READINESS_ACTIONS = ["profile", "resume", "agy", "context", "story", "logistics", "private-names", "voice", "other-resumes", "targets", "cover-letter", "folder", "none"] as const;

export const readinessItemSchema = z.object({
  id: z.string(),
  level: z.enum(["required", "recommended"]),
  /** "later" = filled by the app on its own (the story bank is made on the first interview prep). */
  state: z.enum(["done", "missing", "problem", "later"]),
  title: z.string(),
  /** What is set up now, or what is wrong, in one line. */
  detail: z.string(),
  /** What this improves, in one line. */
  improves: z.string(),
  /** Extra lines to show under the detail (the base resume: what the app read from it). */
  lines: z.array(z.string()).default([]),
  action: z.enum(READINESS_ACTIONS),
  /** The workspace path this item lives at, for "Show in Finder/Explorer". */
  path: z.string().nullable(),
});
export type ReadinessItem = z.infer<typeof readinessItemSchema>;

export const readinessSchema = z.object({
  items: z.array(readinessItemSchema),
  /** True when every required item is done: the app may send jobs to Agy. */
  ready: z.boolean(),
  /** One sentence naming the first required step that is missing, for the Add jobs box and the snapshot. */
  blocker: z.string().nullable(),
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type Readiness = z.infer<typeof readinessSchema>;

/** The words used everywhere a base resume can't be read (Get Started, Setup, the snapshot that Agy sees). */
export const RESUME_FORMAT_HELP = "JobSensei reads your base resume's structure from a Word (.docx) or Markdown (.md) file. A PDF works only when the .docx or .md version is in the same folder.";
export const RESUME_PDF_ONLY = `Your base resume is a PDF with no Word or Markdown version beside it. ${RESUME_FORMAT_HELP} Choose the .docx or .md version in Setup.`;
