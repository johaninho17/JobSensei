import type { JobQueue, JobQueueItem, RunStatus } from "./schemas";

/** Minutes a sent link may run without a finished application before it needs attention. */
export const QUEUE_TIMEOUT_MINUTES = 12;

/** The one line Agy gets after the app stages a pasted JD (`jd:fetch -- --staged` prints it). */
export function pastedJdPrompt(note = ""): string {
  return `Evaluate the job description I pasted and draft the application${note ? ` (${note.replace(/[\r\n]+/g, " ").slice(0, 200)})` : ""}`;
}

export function queuePrompt(url: string): string {
  return `Evaluate this job and draft the application: ${url}`;
}

/**
 * One step of the queue: finish or time out the running item, then decide whether to send the next one.
 * Pure, so the rules are tested without Agy. `send` is the item to send now, if any.
 */
export function advanceQueue(queue: JobQueue, latest: RunStatus | null, now: number, agyReady = true): { queue: JobQueue; send: JobQueueItem | null } {
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
  // Links wait (and keep queueing) until Agy is running, signed in, and idle.
  const next = queue.autoRun && agyReady && !busy && !blocked ? items.find((item) => item.status === "queued") ?? null : null;
  if (next) Object.assign(next, { status: "running", sentAt: new Date(now).toISOString() });
  return { queue: { ...queue, items }, send: next };
}

/** Screens where Agy is waiting for the user (sign-in, folder trust), not for a prompt. */
const BLOCKING = /select login method|waiting for authentication|authorization code|authentication (?:failed|timed out)|do you trust the contents|use a google cloud project/gi;
/** Agy's status line (model and effort), drawn once it is signed in and at its prompt. */
const READY_LINE = /\b(?:gemini|claude|gpt)[^\n·]{0,40}·\s*(?:low|medium|high|xhigh|max)\b/gi;
/** Agy redraws while it works, so this long without output means it is idle. */
const IDLE_MS = 5000;

function lastIndex(pattern: RegExp, text: string): number {
  let index = -1;
  for (const match of text.matchAll(pattern)) index = match.index ?? index;
  return index;
}

/** Plain text of terminal output: escape sequences and control characters removed. */
export function plainTerminalText(output: string): string {
  return output.replace(/\x1b\[[0-9;?<>=$]*[A-Za-z~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Z0-9]|[\x00-\x08\x0e-\x1f]/g, "");
}

/**
 * Whether Agy can take a queued prompt: running, its status line drawn after any sign-in or trust screen,
 * and idle for a few seconds.
 */
export function agyReadiness(state: { running: boolean; agy: boolean; startedAt: number | null; lastOutputAt?: number | null; recentOutput: string }, now: number): boolean {
  if (!state.running || !state.agy || state.startedAt === null) return false;
  if (now - state.startedAt < 4000) return false;
  if (state.lastOutputAt && now - state.lastOutputAt < IDLE_MS) return false;
  const text = plainTerminalText(state.recentOutput);
  const ready = lastIndex(READY_LINE, text);
  // The trust question is drawn above the status line, so it blocks whenever it is on the latest screen.
  if (/do you trust the contents/i.test(text.slice(-700))) return false;
  return ready >= 0 && ready > lastIndex(BLOCKING, text);
}
