import { z } from "zod";

/**
 * Job Search: the user's search settings, the boards Agy may search or must skip, and the inbox of found
 * postings. Agy only finds links; the app opens each one, saves the posting, and gives it a quick fit.
 */

export const JOB_SEARCH_SCHEMA_VERSION = 1;
export const WORK_SETUPS = ["remote", "hybrid", "onsite"] as const;
export const SEARCH_LEVELS = ["intern", "junior", "mid", "senior", "staff", "lead", "manager", "director"] as const;

export type BoardInfo = { id: string; name: string; domain: string; reason?: string };

/** Boards Agy searches by default: public job pages the app can open and read. */
export const SEARCH_BOARDS: BoardInfo[] = [
  { id: "greenhouse", name: "Greenhouse", domain: "greenhouse.io" },
  { id: "lever", name: "Lever", domain: "lever.co" },
  { id: "ashby", name: "Ashby", domain: "ashbyhq.com" },
  { id: "workable", name: "Workable", domain: "workable.com" },
  { id: "smartrecruiters", name: "SmartRecruiters", domain: "smartrecruiters.com" },
  { id: "yc", name: "Y Combinator (Work at a Startup)", domain: "ycombinator.com" },
  { id: "builtin", name: "Built In", domain: "builtin.com" },
  { id: "wellfound", name: "Wellfound", domain: "wellfound.com" },
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
  postedWithinDays: z.number().int().min(1).max(90).default(14),
  includeKeywords: z.array(z.string().min(1)).default([]),
  excludeKeywords: z.array(z.string().min(1)).default([]),
  /** Built-in boards the user turned off (by id). */
  boardsOff: z.array(z.string()).default([]),
  /** Extra boards or careers pages to search (domains or URLs). */
  extraSites: z.array(z.string().min(1)).default([]),
  /** Extra boards or domains never to use. */
  skipSites: z.array(z.string().min(1)).default([]),
  /** Companies whose public boards (Ashby, Greenhouse, Lever) are checked on every run, free and without Agy. */
  watched: z.array(z.object({ board: z.enum(["ashby", "greenhouse", "lever"]), slug: z.string().min(1), name: z.string().default("") })).default([]),
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
    /** "daily": once a day, the first time the computer is on (awake, woken, or started) after `after`. "times": at set times. */
    mode: z.enum(["daily", "times"]).default("daily"),
    after: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).default("08:00"),
    days: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
    times: z.array(z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)).min(1).max(4).default(["08:00"]),
    /** Windows only: wake a sleeping PC for the search (Task Scheduler WakeToRun, no admin rights). */
    wake: z.boolean().default(false),
  }).default({ enabled: false, mode: "daily", after: "08:00", days: [1, 2, 3, 4, 5], times: ["08:00"], wake: false }),
  /** How many postings one search asks Agy for. */
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
  /** Matches Agy gave a light rating in this run. */
  rated: z.number().int().default(0),
  /** "search" = Agy + watched companies; "watched" = watched companies only (no Agy). */
  source: z.enum(["search", "watched"]).default("search"),
  /** True when the OS schedule started it (app closed or in the background). */
  scheduled: z.boolean().default(false),
  /** A failure message; on a finished run, Agy's failure while watched companies still ran. */
  error: z.string().nullable(),
});
export type SearchRun = z.infer<typeof searchRunSchema>;

export type SearchProgress = { phase: "watched" | "agy" | "checking" | "rating"; checked: number; total: number };
export type SearchStatus = { running: boolean; source: "search" | "watched" | "rating" | null; progress: SearchProgress | null; startedAt: string | null; scheduled?: boolean };
export type ScheduleInfo = { supported: boolean; installed: boolean; label: string; detail: string; platform: string };
export type WatchedSuggestion = { board: "ashby" | "greenhouse" | "lever"; slug: string; name: string; jobs: number; interviewed: boolean };

const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const minutesOf = (time: string) => { const [hour, minute] = time.split(":").map(Number); return hour * 60 + minute; };

/**
 * Daily mode: whether the scheduled search should run now. It runs once per day (local time), on a chosen day, at or
 * after the chosen time; a finished search today (scheduled, or a full search started in the app after that time)
 * counts, so waking the computer again or a 1 a.m. session never adds a second run.
 */
export function dailyRunDue(runs: SearchRun[], schedule: Pick<JobSearchSettings["schedule"], "after" | "days">, now = new Date()): { due: boolean; reason: string } {
  if (schedule.days.length && !schedule.days.includes(now.getDay())) return { due: false, reason: "not a search day" };
  if (now.getHours() * 60 + now.getMinutes() < minutesOf(schedule.after)) return { due: false, reason: `before ${schedule.after}` };
  const today = localDate(now);
  const done = runs.some((run) => run.status === "done" && run.source === "search" && localDate(new Date(run.startedAt)) === today
    && (run.scheduled || new Date(run.startedAt).getHours() * 60 + new Date(run.startedAt).getMinutes() >= minutesOf(schedule.after)));
  return done ? { due: false, reason: "already searched today" } : { due: true, reason: "first time on today" };
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
  return company && title ? `${norm(company)}|${norm(title)}` : null;
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

/** Inbox order: by fit (Agy's light rating, else quick fit; highest first), then newest. */
export function rankInbox(items: InboxItem[], sort: "fit" | "newest" | "company" = "fit"): InboxItem[] {
  const time = (item: InboxItem) => Date.parse(item.postedAt ?? item.foundAt) || 0;
  return [...items].sort((a, b) => sort === "company" ? (a.company ?? "").localeCompare(b.company ?? "") || effectiveFit(b) - effectiveFit(a)
    : sort === "newest" ? time(b) - time(a) || effectiveFit(b) - effectiveFit(a)
      : effectiveFit(b) - effectiveFit(a) || time(b) - time(a));
}

/** Which new items to queue for drafts by themselves: at or above the user's rating, within today's cap. */
export function autoDraftPicks(state: JobSearchState, settings: JobSearchSettings, now = new Date()): InboxItem[] {
  if (settings.autoDraftAt === null) return [];
  const today = now.toISOString().slice(0, 10);
  const queuedToday = state.items.filter((item) => item.autoQueued && item.queuedAt?.slice(0, 10) === today).length;
  const room = Math.max(0, settings.autoDraftDailyCap - queuedToday);
  return rankInbox(state.items.filter((item) => item.status === "new" && item.fit.blockers.length === 0 && effectiveFit(item) >= settings.autoDraftAt!)).slice(0, room);
}
