import { z } from "zod";

/**
 * Job Search: the user's search settings, the boards Agy may search or must skip, and the inbox of found
 * postings. Agy only finds links; the app opens each one, saves the posting, and gives it a quick fit.
 */

export const JOB_SEARCH_SCHEMA_VERSION = 1;
export const WORK_SETUPS = ["remote", "hybrid", "onsite"] as const;
export const SEARCH_LEVELS = ["intern", "junior", "mid", "senior", "staff", "lead", "manager", "director"] as const;

/** `direct`: the app reads companies' open jobs from this board itself, free. Otherwise Agy searches it. */
export type BoardInfo = { id: string; name: string; domain: string; reason?: string; direct?: boolean };

/** Boards Agy searches by default: public job pages the app can open and read. */
export const SEARCH_BOARDS: BoardInfo[] = [
  { id: "greenhouse", name: "Greenhouse", domain: "greenhouse.io", direct: true },
  { id: "lever", name: "Lever", domain: "lever.co", direct: true },
  { id: "ashby", name: "Ashby", domain: "ashbyhq.com", direct: true },
  { id: "workable", name: "Workable", domain: "workable.com" },
  { id: "smartrecruiters", name: "SmartRecruiters", domain: "smartrecruiters.com" },
  { id: "yc", name: "Y Combinator (Work at a Startup)", domain: "ycombinator.com" },
  { id: "builtin", name: "Built In", domain: "builtin.com" },
  // Wellfound and Otta can't be read directly (sign-in, bot blocking; checked 2026-11-10): Agy searches them, and the
  // app reads the companies it finds from their own Ashby/Greenhouse/Lever boards.
  { id: "wellfound", name: "Wellfound", domain: "wellfound.com" },
  { id: "otta", name: "Welcome to the Jungle (Otta)", domain: "welcometothejungle.com" },
];

/** Boards never searched: they require sign-in, block automated reading, or only link elsewhere. */
export const SKIPPED_BOARDS: BoardInfo[] = [
  { id: "linkedin", name: "LinkedIn", domain: "linkedin.com", reason: "needs sign-in and doesn't allow automated reading" },
  { id: "indeed", name: "Indeed", domain: "indeed.com", reason: "blocks automated reading" },
  { id: "glassdoor", name: "Glassdoor", domain: "glassdoor.com", reason: "needs sign-in" },
  { id: "ziprecruiter", name: "ZipRecruiter", domain: "ziprecruiter.com", reason: "blocks automated reading" },
];

export const jobSearchSettingsSchema = z.object({
  /** Job titles or role families to look for. */
  titles: z.array(z.string().min(1)).default([]),
  /** Cities, states, or "United States"; empty means anywhere. */
  locations: z.array(z.string().min(1)).default([]),
  workSetups: z.array(z.enum(WORK_SETUPS)).default(["remote", "hybrid"]),
  levels: z.array(z.enum(SEARCH_LEVELS)).default([]),
  /** Lowest yearly base pay worth seeing (USD); null means no floor. */
  payFloor: z.number().int().min(0).nullable().default(null),
  needsSponsorship: z.boolean().default(false),
  /** Postings older than this are treated as stale. */
  postedWithinDays: z.number().int().min(1).max(90).default(30),
  includeKeywords: z.array(z.string().min(1)).default([]),
  /** Words that rule a job out when they appear in its title (e.g. Senior, Principal, Lead), as whole words. */
  excludeTitleWords: z.array(z.string().min(1)).default([]),
  excludeKeywords: z.array(z.string().min(1)).default([]),
  /** Built-in boards the user turned off (by id). */
  boardsOff: z.array(z.string()).default([]),
  /** Extra boards or careers pages to search (domains or URLs). */
  extraSites: z.array(z.string().min(1)).default([]),
  /** Extra boards or domains never to use. */
  skipSites: z.array(z.string().min(1)).default([]),
  /** Companies whose public boards (Ashby, Greenhouse, Lever) are checked on every run, free and without Agy. */
  watched: z.array(z.object({
    board: z.enum(["ashby", "greenhouse", "lever"]),
    slug: z.string().min(1),
    name: z.string().default(""),
    /** How it was added: by the user, from the user's jobs, or found by a search. */
    source: z.enum(["user", "jobs", "search"]).default("user"),
  })).default([]),
  /** Companies of jobs the user adds are watched automatically. */
  autoWatch: z.boolean().default(true),
  /** Companies Agy finds hiring for the titles are added to the watched list. */
  watchFoundCompanies: z.boolean().default(true),
  /** New matches added per run at most (the newest first); the rest wait for the next run. */
  maxNewPerRun: z.number().int().min(5).max(300).default(60),
  /** Companies the user never wants to see. */
  skipCompanies: z.array(z.string().min(1)).default([]),
  /** Lowest quick fit shown above the fold; lower ones are folded into "Below your bar". */
  minFit: z.number().min(1).max(5).default(3),
  /** Quick fit at or above which a found job is queued for drafts by itself; null = never (default). */
  autoDraftAt: z.number().min(1).max(5).nullable().default(null),
  autoDraftDailyCap: z.number().int().min(1).max(10).default(3),
  /** After a search, Agy rates up to 10 new matches near or above the bar in one call (a little quota). */
  lightRating: z.boolean().default(true),
  /** Searches while the app is closed (launchd on macOS, Task Scheduler on Windows). Days: 0 = Sunday. */
  schedule: z.object({
    enabled: z.boolean().default(false),
    /** "daily": one search per window from `after` to `after` the next day, the first time the computer is on in it. "times": at set times. */
    mode: z.enum(["daily", "times"]).default("daily"),
    after: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).default("08:00"),
    days: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
    times: z.array(z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)).min(1).max(4).default(["08:00"]),
    /** Windows only: wake a sleeping PC for the search (Task Scheduler WakeToRun, no admin rights). */
    wake: z.boolean().default(false),
    /**
     * What a scheduled search does: "every" = watched companies and one Agy web search (a few minutes, uses quota);
     * "never" = watched companies only (free, seconds); "days" = watched every time, Agy only on `agyDays`.
     */
    agy: z.enum(["every", "never", "days"]).default("every"),
    agyDays: z.array(z.number().int().min(0).max(6)).default([1]),
  }).default({ enabled: false, mode: "daily", after: "08:00", days: [1, 2, 3, 4, 5], times: ["08:00"], wake: false, agy: "every", agyDays: [1] }),
  /** How many postings one search asks Agy for. */
  /** How many companies one Agy search asks for. */
  resultsPerRun: z.number().int().min(5).max(40).default(20),
});
export type JobSearchSettings = z.infer<typeof jobSearchSettingsSchema>;
export const DEFAULT_JOB_SEARCH_SETTINGS: JobSearchSettings = jobSearchSettingsSchema.parse({});

export const quickFitSchema = z.object({
  /** 1–5, from the app's own checks (no Agy). */
  score: z.number(),
  /** One line on why. */
  why: z.string(),
  /** Requirements the candidate's files show / total. */
  covered: z.number().int(),
  total: z.number().int(),
  /** Tools and named skills the posting asks for that the candidate's files don't show. */
  gaps: z.array(z.string()),
  blockers: z.array(z.string()),
  flags: z.array(z.string()),
});
export type QuickFit = z.infer<typeof quickFitSchema>;

/** Agy's light rating: the job's requirements against the candidate's short profile card, one call for up to 10 jobs. */
export const agyFitSchema = z.object({
  score: z.number().min(1).max(5),
  why: z.string(),
  gaps: z.array(z.string()),
  ratedAt: z.string(),
});
export type AgyFit = z.infer<typeof agyFitSchema>;

export const INBOX_STATUSES = ["new", "dismissed", "saved", "queued"] as const;

export const inboxItemSchema = z.object({
  id: z.string().regex(/^find-[a-z0-9-]{4,40}$/),
  url: z.string(),
  title: z.string().nullable(),
  company: z.string().nullable(),
  location: z.string().nullable(),
  board: z.string().nullable(),
  postedAt: z.string().nullable(),
  foundAt: z.string(),
  runId: z.string(),
  status: z.enum(INBOX_STATUSES),
  pay: z.string().nullable(),
  workSetup: z.string().nullable(),
  level: z.string().nullable(),
  fit: quickFitSchema,
  /** Job folder created by Save for later. */
  jobId: z.string().nullable().default(null),
  /** When it was sent to the queue (manually or by auto-draft). */
  queuedAt: z.string().nullable().default(null),
  /** Set when auto-draft queued it. */
  autoQueued: z.boolean().default(false),
  /** Found on a watched company's board. */
  watched: z.boolean().default(false),
  agyFit: agyFitSchema.nullable().default(null),
  /** A job like one that got the user a real interview (title), shown and ranked a little higher. */
  likeInterviewed: z.string().nullable().default(null),
});
export type InboxItem = z.infer<typeof inboxItemSchema>;

export const searchRunSchema = z.object({
  id: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  status: z.enum(["running", "done", "failed"]),
  found: z.number().int(),
  added: z.number().int(),
  /** Why links were left out, counted: dead, stale, duplicate, unreadable, skipped board or company. */
  leftOut: z.record(z.string(), z.number().int()),
  autoQueued: z.number().int().default(0),
  /** Dead links swapped for the company's live posting with the same title. */
  replaced: z.number().int().default(0),
  /** Companies Agy named whose boards the app could read. */
  companies: z.number().int().default(0),
  /** Matches Agy gave a light rating in this run. */
  rated: z.number().int().default(0),
  /** "search" = Agy + watched companies; "watched" = watched companies only (no Agy). */
  source: z.enum(["search", "watched"]).default("search"),
  /** True when the OS schedule started it (app closed or in the background). */
  scheduled: z.boolean().default(false),
  /** Agy's web search failed (timed out, quota) while watched companies finished. */
  agyFailed: z.boolean().default(false),
  /** A scheduled retry of only Agy's part, after `agyFailed` earlier in the same window. */
  agyOnly: z.boolean().default(false),
  /** A failure message; on a finished run, Agy's failure while watched companies still ran. */
  error: z.string().nullable(),
});
export type SearchRun = z.infer<typeof searchRunSchema>;

export type SearchProgress = { phase: "watched" | "agy" | "checking" | "rating"; checked: number; total: number };
export type SearchStatus = { running: boolean; source: "search" | "watched" | "rating" | null; progress: SearchProgress | null; startedAt: string | null; scheduled?: boolean };
export type ScheduleInfo = { supported: boolean; installed: boolean; label: string; detail: string; platform: string };
export type WatchedSuggestion = { board: "ashby" | "greenhouse" | "lever"; slug: string; name: string; jobs: number; interviewed: boolean };

/** The start of the current daily window: the most recent occurrence of the set time (today's, or yesterday's if it hasn't come yet). */
export function windowStart(after: string, now = new Date()): Date {
  const [hour, minute] = after.split(":").map(Number);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
  if (start.getTime() > now.getTime()) start.setDate(start.getDate() - 1);
  return start;
}

/**
 * Daily mode: one search per window, from the set time to the same time the next day (8:00 Monday → 8:00 Tuesday).
 * The first time the computer is on in a window, it searches; later wakes in the same window (a 1 a.m. session after
 * a Monday 8:30 search) don't. Only a finished scheduled search counts: searches the user runs add jobs but never use
 * up the window; failed and watched-only runs don't count either. `days` are the days a window may start on.
 */
export function dailyRunDue(runs: SearchRun[], schedule: Pick<JobSearchSettings["schedule"], "after" | "days">, now = new Date()): { due: boolean; reason: string; agyOnly: boolean } {
  const start = windowStart(schedule.after, now);
  if (schedule.days.length && !schedule.days.includes(start.getDay())) return { due: false, reason: "not a search day", agyOnly: false };
  const inWindow = runs.filter((run) => run.scheduled && Date.parse(run.startedAt) >= start.getTime());
  const done = inWindow.filter((run) => run.status === "done" && !run.agyOnly);
  if (!done.length) return { due: true, reason: "first time on in this window", agyOnly: false };
  // Agy timed out while watched companies finished: one more try of only Agy's part, on a later wake in the window.
  if (done.some((run) => run.agyFailed) && !inWindow.some((run) => run.agyOnly)) return { due: true, reason: "retrying Agy's search once", agyOnly: true };
  return { due: false, reason: "already searched in this window", agyOnly: false };
}

/** Whether a scheduled search today includes Agy's web search (the user's setting; the day is the window's start). */
export function scheduledAgyToday(schedule: Pick<JobSearchSettings["schedule"], "after" | "agy" | "agyDays">, now = new Date()): boolean {
  if (schedule.agy === "never") return false;
  if (schedule.agy === "every") return true;
  return schedule.agyDays.includes(windowStart(schedule.after, now).getDay());
}

/** One line for the progress of a run, shown on any page. */
export function searchProgressText(status: SearchStatus): string {
  const progress = status.progress;
  if (!status.running) return "";
  if (status.scheduled) return "A scheduled search is running in the background…";
  if (!progress) return "Starting the search…";
  if (progress.phase === "watched") return `Checking watched companies (${progress.checked + 1} of ${progress.total})…`;
  if (progress.phase === "agy") return "Agy is searching the job boards (usually 1–3 minutes)…";
  if (progress.phase === "rating") return `Agy is rating ${progress.total} match${progress.total === 1 ? "" : "es"} (about a minute)…`;
  return `Checking postings: ${progress.checked} of ${progress.total}…`;
}

export const jobSearchStateSchema = z.object({
  schemaVersion: z.literal(JOB_SEARCH_SCHEMA_VERSION),
  items: z.array(inboxItemSchema),
  runs: z.array(searchRunSchema),
  /** URLs and company+title keys already seen (kept after dismissal so they never come back). */
  seen: z.array(z.string()),
  /** Matches a scheduled search chose for auto-draft; the app queues them when it next runs (it owns the queue). */
  pendingDrafts: z.array(z.string()).default([]),
});
export type JobSearchState = z.infer<typeof jobSearchStateSchema>;
export const EMPTY_JOB_SEARCH_STATE: JobSearchState = { schemaVersion: JOB_SEARCH_SCHEMA_VERSION, items: [], runs: [], seen: [], pendingDrafts: [] };

/** A posting link with its tracking query removed, so the same job found twice is one job. */
export function canonicalUrl(url: string): string {
  try {
    const parsed = new URL(url.trim());
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) if (/^(utm_|gh_src|source|ref|lever-|src)/i.test(key)) parsed.searchParams.delete(key);
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url.trim();
  }
}

export function jobKey(company: string | null, title: string | null): string | null {
  const norm = (value: string | null) => (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  // The same role posted once per city ("Engineer (Atlanta)", "Engineer (New York)") is one job.
  const role = (title ?? "").replace(/\([^)]*\)/g, " ").replace(/\s[-–|]\s*(?:remote|hybrid|[A-Z][\w .]+,\s*[A-Z]{2})\s*$/i, " ");
  return company && title ? `${norm(company)}|${norm(role)}` : null;
}

/** Whether a link belongs to a board or site the search must not use. */
export function skippedSite(url: string, settings: Pick<JobSearchSettings, "skipSites" | "boardsOff">): string | null {
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch { return "not a link"; }
  const matches = (domain: string) => { const clean = domain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""); return Boolean(clean) && (host === clean || host.endsWith(`.${clean}`)); };
  const skipped = SKIPPED_BOARDS.find((board) => matches(board.domain));
  if (skipped) return skipped.name;
  const off = SEARCH_BOARDS.find((board) => settings.boardsOff.includes(board.id) && matches(board.domain));
  if (off) return off.name;
  return settings.skipSites.find(matches) ?? null;
}

/** The score that ranks and auto-drafts a match: Agy's light rating when it has one, else the quick fit. */
export const effectiveFit = (item: Pick<InboxItem, "fit" | "agyFit">) => item.agyFit?.score ?? item.fit.score;

/** Matches worth Agy's light rating: new, unrated, no blocker, quick fit within half a point of the bar. */
export function lightRatingPicks(items: InboxItem[], settings: Pick<JobSearchSettings, "minFit">, limit = 10): InboxItem[] {
  return items.filter((item) => item.status === "new" && !item.agyFit && !item.fit.blockers.length && item.fit.score >= settings.minFit - 0.5)
    .sort((a, b) => b.fit.score - a.fit.score).slice(0, limit);
}

// ---------- Where a job is, against where the user wants to work ----------

/** Metro areas a user may type, with the places inside them. Matching is by plain text, so any place the user types still works. */
export const METRO_AREAS: Record<string, string[]> = {
  "bay area": ["san francisco", "south san francisco", "oakland", "berkeley", "emeryville", "san jose", "palo alto", "mountain view", "sunnyvale", "santa clara", "cupertino", "redwood city", "menlo park", "san mateo", "foster city", "burlingame", "san bruno", "fremont", "san leandro", "hayward", "pleasanton", "walnut creek", "milpitas", "los gatos", "campbell"],
  "new york": ["new york", "nyc", "brooklyn", "manhattan", "queens", "jersey city", "hoboken"],
  "seattle": ["seattle", "bellevue", "redmond", "kirkland"],
  "boston": ["boston", "cambridge", "somerville", "waltham"],
  "los angeles": ["los angeles", "santa monica", "culver city", "pasadena", "irvine", "el segundo"],
  "austin": ["austin"],
  "chicago": ["chicago"],
  "washington dc": ["washington, dc", "washington dc", "arlington", "reston", "mclean", "bethesda"],
  "denver": ["denver", "boulder"],
};

const US_HINT = /\b(?:us|usa|united states|u\.s\.?)\b/i;
const US_STATES = ["alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine", "maryland", "massachusetts", "michigan", "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada", "new hampshire", "new jersey", "new mexico", "new york", "north carolina", "north dakota", "ohio", "oklahoma", "oregon", "pennsylvania", "rhode island", "south carolina", "south dakota", "tennessee", "texas", "utah", "vermont", "virginia", "washington", "west virginia", "wisconsin", "wyoming"];
const STATE_CODE = /,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/;
/** Words that say how a job is worked, not where: what's left after removing them names a place. */
const NOT_A_PLACE = /\b(?:remote|anywhere|hybrid|on-?site|in[- ]office|fully|work from home|wfh|distributed|flexible|global(?:ly)?|first|or|and|optional)\b|[-–|,;:/()]/gi;

/** Whether a place string is in the US: a US hint, a state, a state code, or a known US town. */
export function inUS(where: string): boolean {
  const text = where.toLowerCase();
  return US_HINT.test(where) || STATE_CODE.test(where) || US_STATES.some((state) => text.includes(state))
    || Object.values(METRO_AREAS).some((towns) => towns.some((town) => text.includes(town)));
}

const namesAPlace = (where: string) => where.replace(NOT_A_PLACE, " ").trim().length > 0;

/** The places a user's entry covers: the entry itself plus a metro area's towns ("SF Bay Area" → San Francisco, Oakland…). */
export function placesFor(entry: string): string[] {
  const text = entry.toLowerCase().replace(/\bsf\b/g, "san francisco").trim();
  const metro = Object.entries(METRO_AREAS).find(([name, towns]) => text.includes(name) || towns.some((town) => text === town));
  return [...new Set([text.replace(/,.*$/, "").trim(), ...(metro ? metro[1] : [])].filter(Boolean))];
}

/**
 * Whether a job's place and work setup fit the user's settings. Remote jobs fit when the user accepts remote and the job
 * is in the US or names no place (a remote job limited to another country doesn't); on-site and hybrid jobs fit when that
 * setup is accepted and the place is one the user listed (or, with no places listed, is in the US). Jobs with no place
 * are kept: the user decides.
 */
export function locationFits(job: { locations: string[]; workplace: "remote" | "hybrid" | "onsite" | null }, settings: Pick<JobSearchSettings, "locations" | "workSetups">): { fits: boolean; reason: string } {
  const where = job.locations.join(" | ");
  const remote = job.workplace === "remote" || (!job.workplace && /\bremote\b/i.test(where) && !/\bhybrid\b/i.test(where));
  const accepts = (mode: "remote" | "hybrid" | "onsite") => !settings.workSetups.length || settings.workSetups.includes(mode);
  const wanted = settings.locations.flatMap(placesFor);
  const inWanted = wanted.length > 0 && wanted.some((place) => where.toLowerCase().includes(place));
  if (remote) {
    if (accepts("remote") && (inUS(where) || !namesAPlace(where) || inWanted)) return { fits: true, reason: "remote" };
    if (inWanted && (accepts("hybrid") || accepts("onsite"))) return { fits: true, reason: "in your area" };
    return { fits: false, reason: accepts("remote") ? "remote outside the US" : "remote (not in your work setups)" };
  }
  const mode = job.workplace ?? (/\bhybrid\b/i.test(where) ? "hybrid" : null);
  if (mode && !accepts(mode)) return { fits: false, reason: `${mode} (not in your work setups)` };
  if (!namesAPlace(where)) return { fits: true, reason: "place not stated" };
  if (!wanted.length) return inUS(where) ? { fits: true, reason: "any US place" } : { fits: false, reason: "outside the US" };
  return inWanted ? { fits: true, reason: "in your area" } : { fits: false, reason: "outside your places" };
}

/** Whether a job title has one of the user's left-out words, as a whole word ("Lead" never matches "Leading"). */
export function titleExcluded(title: string, words: string[]): string | null {
  // Common short forms count as the same word ("Senior" also leaves out "Sr." titles).
  const SHORT: Record<string, string[]> = { senior: ["sr"], junior: ["jr"], principal: ["princ"], manager: ["mgr"], director: ["dir"] };
  for (const word of words) {
    const forms = [word.trim(), ...(SHORT[word.trim().toLowerCase()] ?? [])];
    for (const form of forms) {
      const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (escaped && new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(title)) return word.trim();
    }
  }
  return null;
}

/** Inbox order: by fit (Agy's light rating, else quick fit; highest first), then newest. */
export function rankInbox(items: InboxItem[], sort: "fit" | "newest" | "company" = "fit"): InboxItem[] {
  const time = (item: InboxItem) => Date.parse(item.postedAt ?? item.foundAt) || 0;
  // Jobs like ones that got interviews rank a quarter point higher (the shown score doesn't change).
  const rank = (item: InboxItem) => effectiveFit(item) + (item.likeInterviewed ? 0.25 : 0);
  return [...items].sort((a, b) => sort === "company" ? (a.company ?? "").localeCompare(b.company ?? "") || rank(b) - rank(a)
    : sort === "newest" ? time(b) - time(a) || rank(b) - rank(a)
      : rank(b) - rank(a) || time(b) - time(a));
}

/** Which new items to queue for drafts by themselves: at or above the user's rating, within today's cap. */
export function autoDraftPicks(state: JobSearchState, settings: JobSearchSettings, now = new Date()): InboxItem[] {
  if (settings.autoDraftAt === null) return [];
  const today = now.toISOString().slice(0, 10);
  const queuedToday = state.items.filter((item) => item.autoQueued && item.queuedAt?.slice(0, 10) === today).length;
  const room = Math.max(0, settings.autoDraftDailyCap - queuedToday);
  return rankInbox(state.items.filter((item) => item.status === "new" && item.fit.blockers.length === 0 && effectiveFit(item) >= settings.autoDraftAt!)).slice(0, room);
}
