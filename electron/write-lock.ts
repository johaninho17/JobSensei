// One write at a time per key (ledger U76, #107). Every app task that reads, changes, and writes a job's files or the
// career files goes through `withWriteLock`, so a Tune apply, an answer filing, and a framing choice never interleave.
// Keys: `job:<id>` for one job's folder, `career` for profile/ and context/ records. Agy writes from its own terminal
// and can't take this lock; Tune instead refuses to start while Agy is running an application or interview.
// Never take the same key again inside its own callback: the inner call would wait for the outer one forever.

const tails = new Map<string, Promise<unknown>>();

export const jobLock = (jobId: string) => `job:${jobId}`;
export const CAREER_LOCK = "career";

/** Runs `task` after every earlier task with the same key has finished (or failed). */
export async function withWriteLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(task);
  const tail = run.catch(() => undefined);
  tails.set(key, tail);
  try {
    return await run;
  } finally {
    // Forget the key once nothing is queued behind this task, so the map doesn't grow with every job ever touched.
    if (tails.get(key) === tail) tails.delete(key);
  }
}

/** True while a task holds or waits for the key (for tests and for "busy" notices). */
export function isWriteLocked(key: string): boolean {
  return tails.has(key);
}
