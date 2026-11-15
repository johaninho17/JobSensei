// Keyboard shortcut rules that are easy to get wrong (#23): which page each "g" chord opens, which job [ and ] move to,
// and how a status key that closes a job (Rejected, Withdrawn) needs a second press.

export type GoPage = "today-home" | "jobs-home" | "search-home" | "interviews-home" | "context-home" | "agy-home" | "docs-home";

/** "g" then a letter opens a page; letters for pages the edition leaves out do nothing. */
export function goTarget(key: string, features: { today: boolean; jobSearch: boolean; interviews: boolean; agyPage?: boolean }): GoPage | null {
  const pages: Record<string, GoPage | null> = {
    t: features.today ? "today-home" : null,
    j: "jobs-home",
    s: features.jobSearch ? "search-home" : null,
    i: features.interviews ? "interviews-home" : null,
    c: "context-home",
    a: features.agyPage ? "agy-home" : null,
    d: "docs-home",
  };
  return pages[key] ?? null;
}

/** The job [ or ] opens: next in the list the user came from (Jobs with its tab, filters, search, and sort), else all jobs. */
export function neighborJob(currentId: string, direction: -1 | 1, cameFrom: string[], allIds: string[]): string | null {
  const order = cameFrom.includes(currentId) ? cameFrom : allIds;
  const index = order.indexOf(currentId);
  return index < 0 ? null : order[index + direction] ?? null;
}

/** Status keys 1–6 in TRACKER_STATUSES order; 5 (Rejected) and 6 (Withdrawn) close a job and need the same key twice. */
export const CLOSING_KEYS = new Set(["5", "6"]);
export const SECOND_PRESS_MS = 2000;

export function statusKeyAction(key: string, armed: { key: string; at: number } | null, now: number): "set" | "arm" {
  if (!CLOSING_KEYS.has(key)) return "set";
  return armed && armed.key === key && now - armed.at <= SECOND_PRESS_MS ? "set" : "arm";
}
