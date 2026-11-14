// What a found job (a Job Search match) can do, wherever it is shown: Job Search and Today use these, so Draft and
// Save behave and read the same on both pages.

type FoundApi = { saveJob: (id: string) => Promise<unknown> };

const count = (n: number) => `${n} job${n === 1 ? "" : "s"}`;

/** Saves found jobs to Jobs as Saved (no Agy). Returns the toast text. */
export async function saveFound(ids: string[], api: FoundApi = window.sensei.jobSearch): Promise<string> {
  for (const id of ids) await api.saveJob(id);
  return `Saved ${count(ids.length)} to Jobs.`;
}

/** Sends found jobs to the application queue. `queue` returns how many jobs are ahead. Returns the toast text. */
export async function draftFound(ids: string[], queue: (id: string) => Promise<number>): Promise<string> {
  let ahead = 0;
  for (const id of ids) ahead = await queue(id);
  return `Sent ${count(ids.length)} for drafts${ahead ? ` (${ahead} ahead in the queue)` : ""}.`;
}

/** A queue or IPC error as the user should read it. */
export function foundError(reason: unknown): string {
  return reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(reason);
}

/** The DOM id of a match row, so another page can open Job Search on it. */
export const foundRowId = (id: string) => `found-${id}`;
