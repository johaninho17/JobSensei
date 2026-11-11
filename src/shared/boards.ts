/**
 * Job boards, one owner: which board a link belongs to, the company slug and posting ID in it, whether it is a single
 * posting, and the board's display name. Used by Job Search, posting records, application forms, and the renderer.
 * (Reading a board's jobs over the network lives in electron/job-boards.ts.)
 */

/** Boards whose public job lists the app reads directly, free. */
export type BoardId = "ashby" | "greenhouse" | "lever";
export type BoardRef = { board: BoardId; slug: string };

const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

const parse = (url: string): URL | null => { try { return new URL(url.trim().includes("://") ? url.trim() : `https://${url.trim()}`); } catch { return null; } };
const LEVER_HOST = /^jobs\.(?:eu\.)?lever\.co$/;
/** Ashby boards live on jobs.ashbyhq.com; links copied from search results often use app.ashbyhq.com (same slug and ID). */
const ASHBY_HOST = /^(?:jobs|app)\.ashbyhq\.com$/;

/** The readable board and company slug in a posting or jobs-page link, or null for other sites. */
export function boardRef(url: string): BoardRef | null {
  const parsed = parse(url);
  if (!parsed) return null;
  const host = parsed.hostname.toLowerCase();
  const [first] = parsed.pathname.split("/").filter(Boolean);
  if (ASHBY_HOST.test(host) && first && SLUG.test(first)) return { board: "ashby", slug: first };
  if (LEVER_HOST.test(host) && first && SLUG.test(first)) return { board: "lever", slug: first };
  if (/(?:^|\.)greenhouse\.io$/.test(host)) {
    const slug = host.startsWith("boards-api.") && first === "v1" ? parsed.pathname.split("/")[3] : first === "embed" ? parsed.searchParams.get("for") : first;
    if (slug && SLUG.test(slug)) return { board: "greenhouse", slug };
  }
  return null;
}

export const boardKey = (ref: BoardRef) => `${ref.board}:${ref.slug.toLowerCase()}`;

/** One posting on a readable board: its slug and ID (and the Lever origin, which differs for EU boards). */
export function postingRef(url: string): { board: BoardId; slug: string; id: string; origin: string } | null {
  const parsed = parse(url);
  if (!parsed) return null;
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.split("/").filter(Boolean);
  if (/(?:^|\.)greenhouse\.io$/.test(host)) {
    const jobIndex = path.indexOf("jobs");
    const slug = jobIndex > 0 ? path[jobIndex - 1] : parsed.searchParams.get("for");
    const id = jobIndex >= 0 ? path[jobIndex + 1] : parsed.searchParams.get("gh_jid");
    return slug && id ? { board: "greenhouse", slug, id, origin: parsed.origin } : null;
  }
  if (ASHBY_HOST.test(host) && path.length >= 2 && !["apply", "application"].includes(path[1]!)) return { board: "ashby", slug: path[0]!, id: path[1]!, origin: "https://jobs.ashbyhq.com" };
  if (LEVER_HOST.test(host) && path.length >= 2 && path[1] !== "apply") return { board: "lever", slug: path[0]!, id: path[1]!, origin: parsed.origin };
  return null;
}

/** The public jobs page of a company on a readable board. */
export function boardUrl(ref: BoardRef): string {
  return ref.board === "ashby" ? `https://jobs.ashbyhq.com/${ref.slug}` : ref.board === "lever" ? `https://jobs.lever.co/${ref.slug}` : `https://job-boards.greenhouse.io/${ref.slug}`;
}

/** False for a known board's list or company page (not one posting); unknown sites get the benefit of the doubt. */
export function singlePosting(url: string): boolean {
  const parsed = parse(url);
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase();
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (LEVER_HOST.test(host) || ASHBY_HOST.test(host)) return parts.length >= 2 && !["apply", "application"].includes(parts[1]!);
  if (/greenhouse\.io$/.test(host)) return (parts.includes("jobs") && /^\d+$/.test(parts[parts.indexOf("jobs") + 1] ?? "")) || parsed.searchParams.has("gh_jid");
  if (/workable\.com$/.test(host)) return parts.includes("j") || parts.includes("view");
  if (/smartrecruiters\.com$/.test(host)) return parts.length >= 2;
  return parsed.pathname.length > 1;
}

/** Every board or site a job link can come from, by host. */
const BOARDS: Array<{ id: string; name: string; host: RegExp }> = [
  { id: "greenhouse", name: "Greenhouse", host: /greenhouse\.io$/ },
  { id: "lever", name: "Lever", host: /lever\.co$/ },
  { id: "ashby", name: "Ashby", host: /ashbyhq\.com$/ },
  { id: "workday", name: "Workday", host: /myworkdayjobs\.com$|workday\.com$/ },
  { id: "linkedin", name: "LinkedIn", host: /linkedin\.com$/ },
  { id: "smartrecruiters", name: "SmartRecruiters", host: /smartrecruiters\.com$/ },
  { id: "oracle", name: "Oracle", host: /oraclecloud\.com$|oracle\.com$/ },
  { id: "workable", name: "Workable", host: /workable\.com$/ },
  { id: "yc", name: "Y Combinator", host: /ycombinator\.com$/ },
  { id: "builtin", name: "Built In", host: /builtin\.com$/ },
  { id: "wellfound", name: "Wellfound", host: /wellfound\.com$/ },
  { id: "otta", name: "Welcome to the Jungle", host: /welcometothejungle\.com$|otta\.com$/ },
];

/** The board a link comes from (its ID), or the site's host for anything else; null for no link. */
export function boardOf(url: string | null): string | null {
  const parsed = url ? parse(url) : null;
  if (!parsed) return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  return BOARDS.find((board) => board.host.test(host))?.id ?? host;
}

/** A board's display name ("ashby" → "Ashby"); other sites show their host. */
export const boardName = (id: string | null): string | null => id ? BOARDS.find((board) => board.id === id)?.name ?? id : null;
