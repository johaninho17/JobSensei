// One-time backfill of real interviews and outcomes into job trackers, from a plan file the user confirmed.
// Usage: node dist-electron/electron/interview-backfill.js <plan.json> [--apply]
// Without --apply it only prints what would change. It adds interviews and fills empty outcome fields; it never
// removes an interview, never replaces a reason the user wrote, and never changes a status the user set.
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { INTERVIEW_ROUNDS, interviewEventSchema, jobOutcomeSchema, jobTrackerSchema, OUTCOME_RESULTS, type InterviewEvent, type JobOutcome, type JobTracker, type TrackerStatus } from "../src/shared/schemas";
import { readJobTracker } from "./tracker";
import { writeJsonAtomic } from "./persistence";
import { assertInsideWorkspace } from "./workspace";

const JOB_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export const backfillEntrySchema = z.object({
  jobId: z.string().regex(JOB_ID),
  interviews: z.array(interviewEventSchema).default([]),
  outcome: z.object({ result: z.enum(OUTCOME_RESULTS).nullable().default(null), reason: z.string().max(500).default(""), date: z.string().nullable().default(null) }).nullable().default(null),
  /** For an interview with no job folder yet: the folder is created with this posting text (marked as reconstructed). */
  createJob: z.object({ company: z.string().min(1), title: z.string().min(1), posting: z.string().min(1), addedAt: z.string().optional() }).optional(),
});
export const backfillPlanSchema = z.array(backfillEntrySchema);
export type BackfillEntry = z.infer<typeof backfillEntrySchema>;

const sameEvent = (a: InterviewEvent, b: InterviewEvent) => a.round === b.round && (a.date ?? "") === (b.date ?? "");

export function furthestStage(events: InterviewEvent[]): JobOutcome["stageReached"] {
  const rounds = events.map((event) => event.round).filter((round) => round !== "other");
  return rounds.sort((a, b) => INTERVIEW_ROUNDS.indexOf(b) - INTERVIEW_ROUNDS.indexOf(a))[0] ?? (events.length ? "other" : "applied");
}

const statusForResult = (result: JobOutcome["result"]): TrackerStatus => result === "withdrew" || result === "declined" ? "withdrawn" : result === "offer" || result === "accepted" ? "offer" : result ? "rejected" : "interviewing";

/** The tracker after the backfill, plus a list of the changes in plain words. Pure. */
export function mergeBackfill(current: JobTracker | null, entry: BackfillEntry, now = new Date()): { tracker: JobTracker; changes: string[] } {
  const changes: string[] = [];
  // Nothing to record yet (the user hasn't confirmed any interview or outcome): leave the job as it is.
  if (!current && !entry.interviews.length && !entry.outcome) return { tracker: jobTrackerSchema.parse({}), changes };
  const base = current ?? jobTrackerSchema.parse({ status: statusForResult(entry.outcome?.result ?? null), history: [{ at: now.toISOString(), status: statusForResult(entry.outcome?.result ?? null) }] });
  if (!current) changes.push(`create tracker with status ${base.status}`);
  const interviews = [...base.interviews];
  for (const event of entry.interviews) {
    if (interviews.some((existing) => sameEvent(existing, event))) continue;
    interviews.push(event);
    changes.push(`add ${event.round} interview${event.date ? ` on ${event.date}` : ""} (${event.source})`);
  }
  let outcome = base.outcome;
  if (entry.outcome) {
    const next = jobOutcomeSchema.parse({
      stageReached: furthestStage(interviews),
      result: base.outcome?.result ?? entry.outcome.result,
      reason: base.outcome?.reason || entry.outcome.reason,
      date: base.outcome?.date ?? entry.outcome.date,
    });
    if (JSON.stringify(next) !== JSON.stringify(base.outcome)) {
      changes.push(`outcome: reached ${next.stageReached}, ${next.result ?? "result not set"}${next.reason ? `, "${next.reason}"` : ""}`);
      outcome = next;
    }
  } else if (outcome && outcome.stageReached !== furthestStage(interviews)) {
    outcome = { ...outcome, stageReached: furthestStage(interviews) };
    changes.push(`outcome stage → ${outcome.stageReached}`);
  }
  const tracker = jobTrackerSchema.parse({ ...base, interviews, outcome, updatedAt: changes.length ? now.toISOString() : base.updatedAt });
  return { tracker, changes };
}

export async function runBackfill(workspacePath: string, plan: BackfillEntry[], apply: boolean): Promise<string[]> {
  const lines: string[] = [];
  for (const entry of plan) {
    const jobPath = assertInsideWorkspace(workspacePath, join(workspacePath, "jobs", entry.jobId));
    const exists = (await stat(jobPath).catch(() => null))?.isDirectory() ?? false;
    if (!exists && !entry.createJob) { lines.push(`${entry.jobId}: no job folder (skipped; add createJob to make one)`); continue; }
    const jobChanges: string[] = [];
    if (!exists && entry.createJob) {
      jobChanges.push(`create job folder for ${entry.createJob.company}, ${entry.createJob.title}`);
      if (apply) {
        await mkdir(join(jobPath, ".sensei"), { recursive: true });
        const header = `# ${entry.createJob.title}\n\n**Company:** ${entry.createJob.company}\n\n_Reconstructed from an interview recording; the original posting was not saved._\n\n`;
        await writeFile(join(jobPath, "original_jd.md"), `${header}${entry.createJob.posting.trim()}\n`, "utf8");
        await writeJsonAtomic(join(jobPath, ".sensei", "job.json"), { company: entry.createJob.company, title: entry.createJob.title, createdAt: entry.createJob.addedAt ?? new Date().toISOString(), reconstructed: true });
      }
    }
    const { tracker, changes } = mergeBackfill(exists ? await readJobTracker(jobPath) : null, entry);
    jobChanges.push(...changes);
    if (apply && changes.length) await writeJsonAtomic(join(jobPath, ".sensei", "tracker.json"), tracker);
    lines.push(`${entry.jobId}: ${jobChanges.length ? jobChanges.join("; ") : "no change"}`);
  }
  return lines;
}

if (require.main === module) {
  const [planPath] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  const apply = process.argv.includes("--apply");
  if (!planPath) {
    process.stderr.write("Usage: node dist-electron/electron/interview-backfill.js <plan.json> [--apply]\n");
    process.exitCode = 1;
  } else {
    const workspace = resolve(process.env.SENSEI_WORKSPACE ?? "data");
    readFile(planPath, "utf8")
      .then((raw) => runBackfill(workspace, backfillPlanSchema.parse(JSON.parse(raw)), apply))
      .then((lines) => process.stdout.write(`${apply ? "Applied" : "Dry run (add --apply to write)"} in ${workspace}\n${lines.map((line) => `- ${line}`).join("\n")}\n`))
      .catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
  }
}
