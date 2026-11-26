/**
 * Public job boards (Ashby, Greenhouse, Lever) publish every company's live postings as JSON, free and without
 * sign-in. Job Search uses them to swap a dead link for the company's live posting with the same title, to read
 * posted dates, and to check watched companies without Agy.
 */

import { boardKey, boardRef, type BoardId, type BoardRef } from "../src/shared/boards";
import { leverPay } from "../src/shared/pay";
export { leverPay };
import { appFetch } from "./app-fetch";

export { boardKey, boardRef, type BoardId, type BoardRef };
export type BoardJob = {
  title: string;
  url: string;
  location: string | null;
  /** Every place the board lists (main + secondary). */
  locations: string[];
  /** How the job is worked, when the board says (Ashby, Lever). */
  workplace: "remote" | "hybrid" | "onsite" | null;
  postedAt: string | null;
  company: string | null;
  /** The posting's text, when the list includes it (Ashby, Lever); Greenhouse is read per job (`postingId`). */
  descriptionHtml: string | null;
  /** Pay as the board states it outside the description (Ashby's compensation panel, Lever's salary range). */
  pay?: string | null;
  postingId: string | null;
};

const workplaceOf = (value: unknown): BoardJob["workplace"] => {
  const text = typeof value === "string" ? value.toLowerCase() : "";
  return text.includes("remote") ? "remote" : text.includes("hybrid") ? "hybrid" : /on-?site|in.?office/.test(text) ? "onsite" : null;
};
const texts = (...values: unknown[]) => [...new Set(values.flat().filter((value): value is string => typeof value === "string" && value.trim() !== "").map((value) => value.trim()))];

const iso = (value: unknown): string | null => {
  const time = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : null;
};

/** Ashby's compensation panel ("$145K – $175K • Offers Equity"): the salary summary, else the tier summary. */
export function ashbyPay(value: unknown): string | null {
  const record = (value ?? {}) as { scrapeableCompensationSalarySummary?: unknown; compensationTierSummary?: unknown };
  const text = [record.scrapeableCompensationSalarySummary, record.compensationTierSummary].find((entry): entry is string => typeof entry === "string" && /\d/.test(entry));
  return text ? text.replace(/\s+/g, " ").trim() : null;
}

/** Every live posting on one company's board. Throws when the board can't be read. */
export async function listBoardJobs(ref: BoardRef, fetcher: typeof fetch = appFetch): Promise<BoardJob[]> {
  const get = async (url: string) => {
    const response = await fetcher(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`The ${ref.board} board for ${ref.slug} returned HTTP ${response.status}.`);
    return response.json() as Promise<unknown>;
  };
  const slug = encodeURIComponent(ref.slug);
  if (ref.board === "ashby") {
    const data = await get(`https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`) as { jobs?: Array<Record<string, unknown>> };
    return (data.jobs ?? []).filter((job) => job.isListed !== false && typeof job.title === "string" && typeof job.jobUrl === "string").map((job) => ({
      title: String(job.title).trim(), url: String(job.jobUrl), location: typeof job.location === "string" ? job.location : null,
      locations: texts(job.location, ((job.secondaryLocations as Array<{ location?: string }> | undefined) ?? []).map((place) => place.location)),
      workplace: workplaceOf(job.workplaceType) ?? (job.isRemote === true ? "remote" : null),
      postedAt: iso(job.publishedAt), company: null,
      descriptionHtml: typeof job.descriptionHtml === "string" ? job.descriptionHtml : typeof job.descriptionPlain === "string" ? String(job.descriptionPlain).replace(/\n/g, "<br>") : null,
      postingId: null,
      pay: ashbyPay(job.compensation),
    }));
  }
  if (ref.board === "greenhouse") {
    const data = await get(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`) as { jobs?: Array<Record<string, unknown>> };
    return (data.jobs ?? []).filter((job) => typeof job.title === "string" && typeof job.absolute_url === "string").map((job) => {
      const location = (job.location as { name?: string } | null)?.name ?? null;
      return {
        title: String(job.title).trim(), url: String(job.absolute_url), location, locations: texts(location), workplace: workplaceOf(location),
        postedAt: iso(job.first_published ?? job.updated_at), company: typeof job.company_name === "string" ? job.company_name : null,
        descriptionHtml: null, postingId: job.id === undefined ? null : String(job.id),
      };
    });
  }
  const data = await get(`https://api.lever.co/v0/postings/${slug}?mode=json`) as Array<Record<string, unknown>>;
  return (Array.isArray(data) ? data : []).filter((job) => typeof job.text === "string" && typeof job.hostedUrl === "string").map((job) => {
    const categories = (job.categories as { location?: string; allLocations?: string[] } | undefined) ?? {};
    const lists = ((job.lists as Array<{ text?: string; content?: string }> | undefined) ?? []).map((list) => `<h2>${list.text ?? ""}</h2><ul>${list.content ?? ""}</ul>`).join("");
    const pay = job.salaryDescription ?? "";
    return {
      title: String(job.text).trim(), url: String(job.hostedUrl), location: categories.location ?? null, locations: texts(categories.location, categories.allLocations ?? []),
      workplace: workplaceOf(job.workplaceType), postedAt: iso(job.createdAt), company: null,
      descriptionHtml: `${job.description ?? ""}${lists}${job.additional ?? ""}${pay}` || null, postingId: null, pay: leverPay(job.salaryRange),
    };
  });
}

/** A board job's posting HTML: from the list (Ashby, Lever) or Greenhouse's per-job API. Null when it can't be read. */
export async function boardPostingHtml(ref: BoardRef, job: BoardJob, fetcher: typeof fetch = appFetch): Promise<string | null> {
  if (job.descriptionHtml) return job.descriptionHtml;
  if (ref.board !== "greenhouse" || !job.postingId) return null;
  const response = await fetcher(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(ref.slug)}/jobs/${encodeURIComponent(job.postingId)}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!response?.ok) return null;
  const data = await response.json().catch(() => null) as { content?: string } | null;
  return typeof data?.content === "string" ? data.content : null;
}

const TITLE_NOISE = new Set(["the", "and", "of", "for", "a", "an", "i", "ii", "iii", "iv", "us", "usa", "remote", "hybrid", "onsite", "east", "west", "central", "sr", "jr"]);
const titleWords = (title: string) => title.toLowerCase().replace(/\([^)]*\)/g, " ").split(/[^a-z0-9+#]+/).filter((word) => word.length > 1 && !TITLE_NOISE.has(word));

/** How alike two job titles are (0..1), ignoring levels, locations, and parentheses. */
export function titleSimilarity(a: string, b: string): number {
  const left = new Set(titleWords(a));
  const right = new Set(titleWords(b));
  if (!left.size || !right.size) return 0;
  const shared = [...left].filter((word) => right.has(word)).length;
  return (2 * shared) / (left.size + right.size);
}

/** The live posting on the board that best matches a title, or null below the bar. */
export function bestMatch(jobs: BoardJob[], title: string, minimum = 0.6): BoardJob | null {
  let best: BoardJob | null = null;
  let score = minimum;
  for (const job of jobs) {
    const similarity = titleSimilarity(job.title, title);
    if (similarity >= score) { best = job; score = similarity; }
  }
  return best;
}

/** Whether a board title fits one of the user's search titles (most of the search title's words appear). */
/**
 * Whether a board title fits one of the user's search titles: most of the search title's words appear in one part of
 * the title ("Sr. Software Engineer - Investor Solutions" is two parts, so it doesn't fit "solutions engineering").
 */
export function fitsSearchTitles(title: string, searchTitles: string[]): boolean {
  const stem = (word: string) => word.replace(/ing$/, "").replace(/s$/, "");
  const parts = title.split(/\s[-–|]\s|[,(/):]/).map((part) => new Set(titleWords(part).map(stem))).filter((part) => part.size);
  return searchTitles.some((search) => {
    const wanted = titleWords(search).map(stem);
    if (!wanted.length) return false;
    return parts.some((part) => wanted.filter((word) => part.has(word)).length / wanted.length >= 0.75);
  });
}
