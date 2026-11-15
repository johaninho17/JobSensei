// Builds the job record (src/shared/job-record.ts): one structured view of a job from its posting record,
// evaluation, drafts, and tracker, with a health check per area. job-folders.ts builds it when it reads a job
// and saves it as `.sensei/job_record.json` only when something changed.
import { readFile } from "node:fs/promises";
import { featuresFor } from "../src/shared/edition";
import { currentEdition } from "./edition";
import { join } from "node:path";
import { FIT_GATE } from "../src/shared/fit-credit";
import { JOB_RECORD_SCHEMA_VERSION, jobRecordSchema, type HealthState, type JobRecord } from "../src/shared/job-record";
import type { PostingRecord } from "../src/shared/posting";
import { INTERVIEW_ROUNDS, type JobTracker, type TrackerStatus } from "../src/shared/schemas";
import { parseFitRequirements, parseMustHaves } from "./fit-scoring";
import { writeJsonAtomic } from "./persistence";

export const JOB_RECORD_FILE = ".sensei/job_record.json";

export type JobRecordInput = {
  jobId: string;
  posting: PostingRecord | null;
  evaluation: string;
  rating: number | null;
  decision: string | null;
  confidence: string | null;
  documents: JobRecord["documents"];
  preparedRounds: number;
  tracker: JobTracker | null;
  /** The status shown in the app (the user's, or derived). */
  status: TrackerStatus;
  /** The last run wrote no cover letter on purpose (src/shared/cover-letter-policy.ts), so a resume alone is complete. */
  letterSkipped?: boolean;
  /** The fit gate the job was rated under (its stamped settings); today's gate when absent. */
  gate?: number;
};

const WEAK = new Set(["gap", "unclear", "adjacent_transferable"]);

export function buildJobRecord(input: JobRecordInput, now = new Date()): JobRecord {
  const rows = parseFitRequirements(input.evaluation) ?? [];
  const requirements = rows.map((row) => ({
    id: /^(req:\d+)\b/i.exec(row.requirement)?.[1]?.toLowerCase() ?? null,
    text: row.requirement.replace(/^req:\d+\s*/i, ""),
    category: row.category,
    classification: row.classification,
    evidence: row.evidence,
  }));
  const mustHaves = parseMustHaves(input.evaluation).map((row) => ({ requirement: row.requirement.replace(/^must:\d+\s*/i, ""), status: row.status }));
  const gaps = requirements.filter((row) => row.classification === "gap" || row.classification === "unclear").map((row) => row.text);
  const byRequirement = requirements.some((row) => row.id);
  // The rated rows should be the posting's requirements as the app reads them today; if not, the rating is stale.
  const key = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 40);
  const postingKeys = new Set((input.posting?.requirements ?? []).map((row) => key(row.text)));
  const ratedKeys = requirements.filter((row) => row.id).map((row) => key(row.text));
  const matchesPosting = !postingKeys.size || ratedKeys.filter((text) => postingKeys.has(text)).length * 2 >= ratedKeys.length;
  // Posting tools that sit in a weak or learnable row: the skills this job wanted that the evidence didn't show.
  const weakIds = new Set(requirements.filter((row) => row.id && WEAK.has(row.classification)).map((row) => row.id!));
  const weakTexts = [...gaps, ...mustHaves.filter((row) => row.status !== "met").map((row) => row.requirement)].join(" \n ").toLowerCase();
  const gapTerms = (input.posting?.tools ?? [])
    .filter((tool) => tool.requirementIds.some((id) => weakIds.has(id)) || weakTexts.includes(tool.name.toLowerCase()))
    .map((tool) => tool.name);
  const recorded = input.tracker?.interviews ?? [];
  const furthest = recorded.map((event) => event.round).filter((round) => round !== "other")
    .sort((a, b) => INTERVIEW_ROUNDS.indexOf(b) - INTERVIEW_ROUNDS.indexOf(a))[0] ?? (recorded.length ? "other" : null);
  const outcome = input.tracker?.outcome ?? null;
  const record: JobRecord = {
    schemaVersion: JOB_RECORD_SCHEMA_VERSION,
    jobId: input.jobId,
    builtAt: now.toISOString(),
    fit: { score: input.rating, decision: input.decision, confidence: input.confidence, byRequirement, matchesPosting },
    requirements,
    mustHaves,
    gaps,
    gapTerms: [...new Set(gapTerms)],
    documents: input.documents,
    posting: input.posting ? {
      payMin: input.posting.pay?.min ?? null,
      payMax: input.posting.pay?.max ?? null,
      payPeriod: input.posting.pay?.period ?? null,
      workMode: input.posting.workSetup?.mode ?? null,
      seniority: input.posting.seniority,
      experience: input.posting.experience,
      requiredCount: input.posting.requiredItems.length,
      tools: input.posting.tools.map((tool) => tool.name),
      missing: input.posting.missing,
    } : null,
    interviews: { preparedRounds: input.preparedRounds, recorded: recorded.length, furthestRound: furthest },
    outcome: outcome ? { stageReached: outcome.stageReached, result: outcome.result, reason: outcome.reason } : null,
    health: { posting: "complete", evaluation: "complete", documents: "complete", tracking: "complete", notes: [] },
  };
  record.health = health(input, record);
  return jobRecordSchema.parse(record);
}

function health(input: JobRecordInput, record: JobRecord): JobRecord["health"] {
  const notes: string[] = [];
  const posting: HealthState = !input.posting ? "missing" : input.posting.requirements.length ? "complete" : "partial";
  if (posting === "missing") notes.push("No saved posting. Add the job description.");
  if (posting === "partial") notes.push("The posting has no requirement sections, so the rating uses general rows.");

  const evaluation: HealthState = !record.documents.evaluation ? "missing"
    : record.fit.score === null ? "partial"
    : (!record.fit.byRequirement || !record.fit.matchesPosting) && (input.posting?.requirements.length ?? 0) > 0 ? "older" : "complete";
  if (evaluation === "missing") notes.push("Not rated yet. Send the job to Agy.");
  if (evaluation === "partial") notes.push("The evaluation has no score. Run the job again.");
  if (evaluation === "older") notes.push(record.fit.byRequirement ? "The posting was re-read since this rating. A fresh run rates its current requirements." : "Rated in an older format. A fresh run rates the posting's own requirements.");

  // Drafts are expected once a job is rated at or above the gate.
  const belowGate = record.fit.score !== null && record.fit.score < (input.gate ?? FIT_GATE);
  const drafts = Number(record.documents.resume) + Number(record.documents.coverLetter);
  const expected = input.letterSkipped ? 1 : 2;
  const documents: HealthState = !record.documents.evaluation || belowGate ? (drafts ? "complete" : "not_needed") : drafts >= expected && (record.documents.resume || !input.letterSkipped) ? "complete" : drafts ? "partial" : "missing";
  if (documents === "missing") notes.push("Rated above the gate, but no resume or cover letter yet.");
  if (documents === "partial") notes.push(record.documents.resume ? "No cover letter yet." : "No tailored resume yet.");

  // Interview history matters for learning: closed jobs and jobs in interviews should say what happened.
  const closed = input.status === "rejected" || input.status === "withdrawn";
  // The recruiter edition records no interviews (src/shared/edition.ts), so it has no tracking gaps.
  const interviewed = featuresFor(currentEdition()).interviews && (record.interviews.recorded > 0 || record.interviews.preparedRounds > 0 || input.status === "interviewing" || input.status === "offer");
  let tracking: HealthState = "not_needed";
  if (interviewed && closed) {
    tracking = record.interviews.recorded && record.outcome?.reason ? "complete" : record.interviews.recorded || record.outcome?.reason ? "partial" : "missing";
    if (tracking !== "complete") notes.push(!record.interviews.recorded ? "Record which interviews happened." : "Add why it ended.");
  } else if (interviewed) {
    tracking = record.interviews.recorded ? "complete" : "missing";
    if (tracking === "missing") notes.push("Record the interviews you've had (prep alone doesn't count).");
  } else if (closed) tracking = "complete";
  return { posting, evaluation, documents, tracking, notes };
}

/** Saves the record unless the saved one matches (ignoring the build time), so a refresh never rewrites it. */
export async function saveJobRecord(jobPath: string, record: JobRecord): Promise<void> {
  const path = join(jobPath, JOB_RECORD_FILE);
  const saved = await readFile(path, "utf8").then((raw) => JSON.parse(raw) as JobRecord).catch(() => null);
  if (saved && JSON.stringify({ ...saved, builtAt: "" }) === JSON.stringify({ ...record, builtAt: "" })) return;
  await writeJsonAtomic(path, record);
}
