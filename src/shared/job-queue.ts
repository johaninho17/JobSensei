import type { JobQueue, JobQueueItem, RunStatus } from "./schemas";

/** Minutes a sent link may run without a finished application before it needs attention. */
export const QUEUE_TIMEOUT_MINUTES = 12;

export function queuePrompt(url: string): string {
  return `Evaluate this job and draft the application: ${url}`;
}

/**
 * One step of the queue: finish or time out the running item, then decide whether to send the next one.
 * Pure, so the rules are tested without Agy. `send` is the item to send now, if any.
 */
export function advanceQueue(queue: JobQueue, latest: RunStatus | null, now: number): { queue: JobQueue; send: JobQueueItem | null } {
  const items = queue.items.map((item) => ({ ...item }));
  const running = items.find((item) => item.status === "running");
  if (running?.sentAt) {
    const sentAt = Date.parse(running.sentAt);
    if (latest?.kind === "application" && Date.parse(latest.at) >= sentAt && latest.state !== "running") {
      Object.assign(running, { status: "done", finishedAt: new Date(now).toISOString(), jobId: latest.jobId });
    } else if (now - sentAt > QUEUE_TIMEOUT_MINUTES * 60_000) {
      Object.assign(running, { status: "needs_attention", finishedAt: new Date(now).toISOString() });
    }
  }
  const busy = items.some((item) => item.status === "running") || latest?.state === "running";
  const blocked = items.some((item) => item.status === "needs_attention");
  const next = queue.autoRun && !busy && !blocked ? items.find((item) => item.status === "queued") ?? null : null;
  if (next) Object.assign(next, { status: "running", sentAt: new Date(now).toISOString() });
  return { queue: { ...queue, items }, send: next };
}
