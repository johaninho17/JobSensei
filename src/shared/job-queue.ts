import type { JobQueue, JobQueueItem, RunStatus } from "./schemas";

/** Minutes a sent link may run without a finished application before it needs attention. */
export const QUEUE_TIMEOUT_MINUTES = 12;

/** The one line Agy gets for a pasted JD; Agy loads it with `sensei jd:fetch --staged <paste-id>`. */
export function pastedJdPrompt(pasteId: string, label: string | null = null, note: string | null = null): string {
  const oneLine = (value: string, max: number) => value.replace(/[\r\n]+/g, " ").slice(0, max);
  const what = label ? `: ${oneLine(label, 120)}` : "";
  return `Evaluate the job description I pasted (paste ID ${pasteId}${what}) and draft the application${note ? `. Note: ${oneLine(note, 200)}` : ""}`;
}

export function queuePrompt(url: string): string {
  return `Evaluate this job and draft the application: ${url}`;
}

/** What Agy is sent for a queue item. */
export function promptForItem(item: JobQueueItem): string {
  return item.kind === "paste" ? pastedJdPrompt(item.id, item.label, item.note) : queuePrompt(item.url ?? "");
}

/** A new queue item; paste IDs start with "paste-" so `jd:fetch --staged` accepts them. */
export function newQueueItem(input: { kind: "link"; url: string } | { kind: "paste"; label: string | null; note?: string | null }, now: Date, manual = false, random = Math.random): JobQueueItem {
  const suffix = `${now.getTime().toString(36)}-${random().toString(36).slice(2, 6)}`;
  return {
    id: input.kind === "paste" ? `paste-${suffix}` : `job-${suffix}`,
    kind: input.kind,
    url: input.kind === "link" ? input.url : null,
    label: input.kind === "paste" ? input.label : null,
    note: input.kind === "paste" ? input.note?.trim().slice(0, 200) || null : null,
    manual,
    addedAt: now.toISOString(),
    status: "queued",
    sentAt: null,
    finishedAt: null,
    jobId: null,
  };
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
  // Items wait (and keep queueing) until Agy is running, signed in, and idle; one runs at a time.
  // Items sent from the chat run even while automatic running is paused.
  const next = agyReady && !busy && !blocked ? items.find((item) => item.status === "queued" && (queue.autoRun || item.manual)) ?? null : null;
  if (next) Object.assign(next, { status: "running", sentAt: new Date(now).toISOString() });
  return { queue: { ...queue, items }, send: next };
}

/** Screens where Agy cannot take a prompt: sign-in, folder trust, or a used-up quota. */
// Agy's first-run setup (theme picker, Terms of Service and data-use consent) waits for the user too: a job sent
// there is lost, and only the user may accept the terms.
const BLOCKING = /select login method|waiting for authentication|authorization code|authentication (?:failed|timed out)|do you trust the contents|use a google cloud project|quota reached|upgrade your subscription|safe to run outside of the sandbox|do you want to proceed\?|allow access to this file\?|terms of service & data use|i agree to help improve|navigate · enter confirm/gi;
/** Agy's status line (model and effort), drawn once it is signed in and at its prompt. */
const READY_LINE = /(?:gemini|claude|gpt)[^\n·]{0,40}·\s*(?:low|medium|high|xhigh|max)\b/gi;
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
 * What the latest Agy screen shows, from a rolling tail of plain output: its status line after any
 * sign-in or trust screen ("ready"), a sign-in or trust screen ("blocked"), or neither ("unknown").
 */
export function classifyAgyScreen(plainTail: string): "ready" | "blocked" | "unknown" {
  // These screens keep the status line drawn below them, so a recent one wins over it.
  if (/do you trust the contents|safe to run outside of the sandbox|do you want to proceed\?|allow access to this file\?/i.test(plainTail.slice(-700))) return "blocked";
  // A picker that is still open (Agy's first-run colour scheme, a model menu) ends with its key hint and then the
  // status line, drawn in the same redraw: the hint wins, so the queue never types a job into the picker.
  if (/navigate · enter confirm\s*(?:(?:gemini|claude|gpt)[^\n·]{0,40}·\s*(?:low|medium|high|xhigh|max))?\s*$/i.test(plainTail)) return "blocked";
  const ready = lastIndex(READY_LINE, plainTail);
  const blocked = lastIndex(BLOCKING, plainTail);
  if (ready < 0 && blocked < 0) return "unknown";
  return ready > blocked ? "ready" : "blocked";
}

/**
 * Whether Agy can take a queued prompt: running, its latest screen classified "ready" (status line after
 * any sign-in or trust screen), and idle for a few seconds. The main process keeps `screen` up to date as
 * output arrives, so the status line is never lost from a short buffer.
 */
export function agyReadiness(state: { running: boolean; agy: boolean; startedAt: number | null; lastOutputAt?: number | null; recentOutput: string; screen?: "ready" | "blocked" | "unknown" }, now: number): boolean {
  if (!state.running || !state.agy || state.startedAt === null) return false;
  if (now - state.startedAt < 4000) return false;
  if (state.lastOutputAt && now - state.lastOutputAt < IDLE_MS) return false;
  return (state.screen ?? classifyAgyScreen(plainTerminalText(state.recentOutput))) === "ready";
}
