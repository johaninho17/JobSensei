// The Agy page's Activity tab (#33): one list of everything Agy did, in the panel and in the background, newest first,
// read from the files each run already writes (nothing new is recorded):
//   panel: application runs (run_timing.json + validation_report.json), interview prep (interviews/.sensei),
//          content updates (content-sources.json import dates, content-update.json while one runs);
//   background: job searches (job-search/state.json), written answers (application_questions.json),
//               Today answers filed into career records (today-answers.json).
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { AgyActivity } from "../src/shared/schemas";
import { assertInsideWorkspace, workspaceFile } from "./workspace";

async function json<T>(path: string): Promise<T | null> {
  return readFile(path, "utf8").then((raw) => JSON.parse(raw) as T).catch(() => null);
}
const seconds = (start?: string | null, end?: string | null) => start && end && Date.parse(end) >= Date.parse(start) ? Math.round((Date.parse(end) - Date.parse(start)) / 1000) : null;
const RUNNING_MS = 15 * 60_000;

export async function agyActivity(workspacePath: string, options: { now?: number; limit?: number } = {}): Promise<AgyActivity[]> {
  const now = options.now ?? Date.now();
  const root = assertInsideWorkspace(workspacePath, workspacePath);
  const out: AgyActivity[] = [];
  const jobsRoot = join(root, "jobs");
  for (const entry of await readdir(jobsRoot, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const jobId = entry.name;
    const state = join(jobsRoot, jobId, ".sensei");
    const job = await json<{ company?: string; title?: string }>(join(state, "job.json"));
    const name = [job?.company, job?.title].filter(Boolean).join(", ") || jobId;
    const timing = await json<{ startedAt?: string; finalizedAt?: string; durationSeconds?: number }>(join(state, "run_timing.json"));
    if (timing?.startedAt) {
      const report = await json<{ status?: string; issues?: Array<{ severity?: string }> }>(join(state, "validation_report.json"));
      const running = !timing.finalizedAt && now - Date.parse(timing.startedAt) < RUNNING_MS;
      const issues = report?.issues ?? [];
      const result: AgyActivity["result"] = running ? "running" : !timing.finalizedAt ? "failed" : report?.status === "failed" ? "failed" : issues.some((issue) => issue.severity === "warning" || issue.severity === "error") ? "warnings" : "passed";
      out.push({ id: `application:${jobId}`, kind: "application", where: "panel", label: `Application: ${name}`, at: timing.finalizedAt ?? timing.startedAt, durationSeconds: timing.durationSeconds ?? seconds(timing.startedAt, timing.finalizedAt), result, detail: issues.length ? `${issues.length} thing${issues.length === 1 ? "" : "s"} to check` : null, open: { jobId, tab: "application" } });
    }
    const interviews = join(jobsRoot, jobId, "interviews", ".sensei");
    for (const file of await readdir(interviews).catch(() => [] as string[])) {
      const roundId = /^run_timing_(.+)\.json$/.exec(file)?.[1];
      if (!roundId) continue;
      const [round, check] = await Promise.all([
        json<{ startedAt?: string; checkedAt?: string }>(join(interviews, file)),
        json<{ status?: string; durationSeconds?: number | null; issues?: unknown[] }>(join(interviews, `check_${roundId}.json`)),
      ]);
      if (!round?.startedAt) continue;
      const running = !round.checkedAt && now - Date.parse(round.startedAt) < RUNNING_MS;
      out.push({ id: `interview:${jobId}:${roundId}`, kind: "interview", where: "panel", label: `Interview prep: ${name} (${roundId.replace(/[-_]/g, " ")})`, at: round.checkedAt ?? round.startedAt, durationSeconds: check?.durationSeconds ?? seconds(round.startedAt, round.checkedAt), result: running ? "running" : check?.status === "failed" ? "failed" : (check?.issues?.length ?? 0) > 0 ? "warnings" : round.checkedAt ? "passed" : "failed", detail: null, open: { jobId, tab: "interview", roundId } });
    }
    const questions = await json<{ status?: string; startedAt?: string; finishedAt?: string | null; durationSeconds?: number | null; answers?: unknown[]; message?: string | null }>(join(state, "application_questions.json"));
    if (questions?.startedAt) {
      const done = questions.status === "done";
      out.push({ id: `answers:${jobId}`, kind: "answers", where: "background", label: `Written answers: ${name}`, at: questions.finishedAt ?? questions.startedAt, durationSeconds: questions.durationSeconds ?? null, result: questions.status === "failed" ? "failed" : done ? "passed" : "running", detail: done ? `${questions.answers?.length ?? 0} answered` : questions.message ?? null, open: { jobId, tab: "application" } });
    }
  }
  const search = await json<{ runs?: Array<{ id: string; startedAt: string; finishedAt: string | null; status: string; added?: number; source?: string; scheduled?: boolean }> }>(workspaceFile(root, ".sensei/job-search/state.json"));
  for (const run of search?.runs ?? []) {
    out.push({ id: `search:${run.id}`, kind: "search", where: "background", label: `${run.source === "watched" ? "Watched companies check" : "Job search"}${run.scheduled ? " (scheduled)" : ""}`, at: run.finishedAt ?? run.startedAt, durationSeconds: seconds(run.startedAt, run.finishedAt), result: run.status === "running" ? "running" : run.status === "failed" ? "failed" : "passed", detail: typeof run.added === "number" ? `${run.added} new` : null, open: { page: "search-home" } });
  }
  const filed = await json<Array<{ id: string; subject: string; status: string; answeredAt: string; filedAt?: string | null; filedTo?: string | null }> | { answers?: Array<{ id: string; subject: string; status: string; answeredAt: string; filedAt?: string | null; filedTo?: string | null }> }>(workspaceFile(root, ".sensei/today-answers.json"));
  for (const answer of Array.isArray(filed) ? filed : filed?.answers ?? []) {
    out.push({ id: `filing:${answer.id}`, kind: "filing", where: "background", label: `Today answer filed: ${answer.subject}`, at: answer.filedAt ?? answer.answeredAt, durationSeconds: null, result: answer.status === "pending" ? "running" : answer.status === "filed" ? "passed" : "warnings", detail: answer.filedTo ? `into ${answer.filedTo.split("/").pop()}` : answer.status === "skipped" ? "not added" : null, open: { page: "today-home" } });
  }
  const ledger = await json<{ files?: Record<string, { status: string; importedAt?: string | null }> }>(workspaceFile(root, ".sensei/content-sources.json"));
  const updates = new Map<string, number>();
  for (const file of Object.values(ledger?.files ?? {})) if (file.status === "imported" && file.importedAt) updates.set(file.importedAt, (updates.get(file.importedAt) ?? 0) + 1);
  for (const [at, count] of updates) out.push({ id: `content:${at}`, kind: "content", where: "panel", label: "Interview content update", at, durationSeconds: null, result: "passed", detail: `${count} recording${count === 1 ? "" : "s"}`, open: { page: "interviews-home" } });
  const pending = await json<{ startedAt?: string; recordings?: unknown[] }>(workspaceFile(root, ".sensei/content-update.json"));
  if (pending?.startedAt) out.push({ id: `content:pending`, kind: "content", where: "panel", label: "Interview content update", at: pending.startedAt, durationSeconds: null, result: "running", detail: `${pending.recordings?.length ?? 0} recordings`, open: { page: "interviews-home" } });
  return out.filter((entry) => !Number.isNaN(Date.parse(entry.at))).sort((a, b) => b.at.localeCompare(a.at)).slice(0, options.limit ?? 60);
}
