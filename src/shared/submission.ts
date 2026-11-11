// What was sent for a job (Recruiter Edition, plan R8 P4): `jobs/<id>/.sensei/submission.json`, written by
// electron/submission.ts when the recruiter marks the job applied.
import { z } from "zod";

export const submissionSchema = z.object({
  submittedAt: z.string(),
  /** Local calendar day the application was sent. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Where it went: the posting's board (Greenhouse, Workday…) or the link's site. */
  platform: z.string().nullable().default(null),
  url: z.string().nullable().default(null),
  /** Frozen copies of the PDFs sent, workspace-relative. */
  files: z.array(z.string()).default([]),
  /** Short fingerprint of the tailored resume text that was sent. */
  resumeVersion: z.string(),
  screenshot: z.string().nullable().default(null),
});
export type Submission = z.infer<typeof submissionSchema>;
