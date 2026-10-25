import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { RunStatus } from "../src/shared/schemas";
import { assertInsideWorkspace } from "./workspace";

type Candidate = { at: number; load: () => Promise<RunStatus | null> };
const RUNNING_WINDOW_MS = 15 * 60_000;

async function json<T>(path: string): Promise<T | null> {
  return readFile(path, "utf8").then((raw) => JSON.parse(raw) as T).catch(() => null);
}
async function mtime(path: string): Promise<number> {
  return (await stat(path).catch(() => null))?.mtimeMs ?? 0;
}
function issueState(status: string | undefined, issues: Array<{ severity?: string }>): RunStatus["state"] {
  if (status === "failed" || status === "not_ready") return "failed";
  return issues.some((issue) => issue.severity === "warning") || status === "passed_with_warnings" ? "warnings" : "passed";
}
function topIssues(issues: Array<{ severity?: string; code?: string; message?: string }>): RunStatus["issues"] {
  return [...issues].sort((a, b) => Number(b.severity === "error") - Number(a.severity === "error")).slice(0, 3)
    .map((issue) => ({ severity: issue.severity === "error" ? "error" : "warning", code: issue.code ?? "", message: issue.message ?? "" }));
}

/** The most recent pipeline run in the workspace (JD fetch, application, or interview round), read from the files the commands already write. */
export async function latestRun(workspacePath: string, now = Date.now()): Promise<RunStatus | null> {
  const jobsRoot = assertInsideWorkspace(workspacePath, join(workspacePath, "jobs"));
  const candidates: Candidate[] = [];
  const fetchedPath = join(workspacePath, ".sensei", "fetched_jd.json");
  const fetchedAt = await mtime(fetchedPath);
  if (fetchedAt) candidates.push({ at: fetchedAt, load: async () => {
    const meta = await json<{ fetchedAt?: string; company?: string | null; title?: string | null; suggestedJobId?: string | null }>(fetchedPath);
    return { kind: "fetch", jobId: meta?.suggestedJobId ?? null, roundId: null, label: [meta?.company, meta?.title].filter(Boolean).join(", ") || "Job posting", at: new Date(fetchedAt).toISOString(), durationSeconds: null, state: now - fetchedAt < RUNNING_WINDOW_MS ? "running" : "passed", fitScore: null, gate: null, issues: [] };
  } });
  for (const entry of await readdir(jobsRoot, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const jobId = entry.name;
    const state = join(jobsRoot, jobId, ".sensei");
    const timingAt = await mtime(join(state, "run_timing.json"));
    if (timingAt) candidates.push({ at: timingAt, load: async () => {
      const [timing, report, job] = await Promise.all([
        json<{ startedAt?: string; finalizedAt?: string; durationSeconds?: number }>(join(state, "run_timing.json")),
        json<{ status?: string; fitScore?: number | null; gateStatus?: string | null; issues?: Array<{ severity?: string; code?: string; message?: string }> }>(join(state, "validation_report.json")),
        json<{ company?: string; title?: string }>(join(state, "job.json")),
      ]);
      const running = !timing?.finalizedAt && Boolean(timing?.startedAt) && now - Date.parse(timing!.startedAt!) < RUNNING_WINDOW_MS;
      const issues = report?.issues ?? [];
      return { kind: "application", jobId, roundId: null, label: [job?.company, job?.title].filter(Boolean).join(", ") || jobId, at: timing?.finalizedAt ?? timing?.startedAt ?? new Date(timingAt).toISOString(), durationSeconds: timing?.durationSeconds ?? null, state: running ? "running" : issueState(report?.status, issues), fitScore: report?.fitScore ?? null, gate: report?.gateStatus ?? null, issues: running ? [] : topIssues(issues) };
    } });
    const interviewState = join(jobsRoot, jobId, "interviews", ".sensei");
    for (const file of await readdir(interviewState).catch(() => [] as string[])) {
      const match = /^(check|run_timing)_(.+)\.json$/.exec(file);
      if (!match) continue;
      const at = await mtime(join(interviewState, file));
      candidates.push({ at, load: async () => {
        const roundId = match[2]!;
        const [check, timing, job] = await Promise.all([
          json<{ status?: string; issues?: Array<{ severity?: string; code?: string; message?: string }>; durationSeconds?: number | null }>(join(interviewState, `check_${roundId}.json`)),
          json<{ startedAt?: string; checkedAt?: string }>(join(interviewState, `run_timing_${roundId}.json`)),
          json<{ company?: string; title?: string }>(join(state, "job.json")),
        ]);
        const running = match[1] === "run_timing" && !timing?.checkedAt && Boolean(timing?.startedAt) && now - Date.parse(timing!.startedAt!) < RUNNING_WINDOW_MS;
        const issues = check?.issues ?? [];
        return { kind: "interview", jobId, roundId, label: [job?.company, job?.title].filter(Boolean).join(", ") || jobId, at: new Date(at).toISOString(), durationSeconds: check?.durationSeconds ?? null, state: running ? "running" : issueState(check?.status, issues), fitScore: null, gate: null, issues: running ? [] : topIssues(issues) };
      } });
    }
  }
  const newest = candidates.sort((a, b) => b.at - a.at)[0];
  return newest ? newest.load() : null;
}
