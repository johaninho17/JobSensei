import { randomBytes } from "node:crypto";
import { fencePosting, POSTING_DATA_RULE } from "../src/shared/prompt-fence";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import type { CandidateProfile, JobFolderSummary } from "../src/shared/schemas";
import type { PostingRecord } from "../src/shared/posting";
import {
  DEFAULT_JOB_SEARCH_SETTINGS, EMPTY_JOB_SEARCH_STATE, LEFT_OUT_EXAMPLES, SEARCH_BOARDS, SKIPPED_BOARDS,
  canonicalUrl, jobKey, jobSearchSettingsSchema, lightRatingPicks, locationFits, titleExcluded, jobSearchStateSchema, skippedSite,
  type InboxItem, type LeftOutItem, type JobSearchSettings, type JobSearchState, type QuickFit, type SearchProgress, type SearchRun, type WatchedSuggestion,
} from "../src/shared/job-search";
import { readActiveContextManifest } from "./context";
import { loadCanonicalResumeBaseline } from "./canonical-resume";
import { fetchAndClean, postingFromBoard, stageCleanedPosting, suggestJobId } from "./jd-fetch";
import { bestMatch, boardPostingHtml, fitsSearchTitles, listBoardJobs, titleSimilarity, type BoardJob } from "./job-boards";
import { computeLearnings, furthestRecordedStage } from "../src/shared/learnings";
import { boardKey, boardOf, boardRef, boardUrl, postingRef, singlePosting, type BoardRef } from "../src/shared/boards";

export { boardOf, singlePosting };
import { assertInsideWorkspace } from "./files";
import { readJson, writeJsonAtomic, writeTextAtomic } from "./persistence";
import { buildPostingRecord } from "./posting-record";
import type { AgyRunner } from "./question-agent";
import { appFetch } from "./app-fetch";

/**
 * Job Search (phase 1). One headless Agy run finds posting links from the user's search settings only (no resume,
 * no career files). The app then opens every link itself: dead, stale, duplicate, unreadable, and skipped-board
 * links are left out; each live posting is saved, read into a posting record, and given a quick fit from the
 * candidate's own files (no Agy). This file owns the search instructions Agy gets.
 */

export const JOB_SEARCH_DIR = ".sensei/job-search";
const SETTINGS_FILE = `${JOB_SEARCH_DIR}/settings.json`;
const STATE_FILE = `${JOB_SEARCH_DIR}/state.json`;
const POSTINGS_DIR = `${JOB_SEARCH_DIR}/postings`;
const MIN_POSTING_CHARS = 400;

export const SEARCH_SCHEMA = JSON.stringify({
  type: "object",
  required: ["companies"],
  properties: {
    companies: {
      type: "array",
      items: {
        type: "object",
        // The link is required: without it Agy returned names only (2026-11-11 run: 12 of 12).
        required: ["name", "jobsUrl"],
        properties: { name: { type: "string" }, jobsUrl: { type: "string" } },
      },
    },
    jobs: {
      type: "array",
      items: {
        type: "object",
        required: ["url"],
        properties: {
          url: { type: "string" },
          title: { type: "string" },
          company: { type: "string" },
          location: { type: "string" },
          postedDate: { type: "string" },
        },
      },
    },
  },
});

const path = (workspace: string, relative: string) => assertInsideWorkspace(workspace, join(resolve(workspace), relative));

// ---------- Settings and state ----------

/** Search settings; a first read is seeded from the profile (role families, location, work arrangement). */
export async function readSearchSettings(workspace: string, profile: CandidateProfile | null): Promise<JobSearchSettings> {
  const stored = jobSearchSettingsSchema.safeParse(await readJson<unknown>(path(workspace, SETTINGS_FILE)));
  if (stored.success) return stored.data;
  const arrangement = profile?.preferences.interview.workArrangement.toLowerCase() ?? "";
  const setups = (["remote", "hybrid", "onsite"] as const).filter((mode) => arrangement.includes(mode === "onsite" ? "on-site" : mode) || (mode === "onsite" && arrangement.includes("onsite")));
  return {
    ...DEFAULT_JOB_SEARCH_SETTINGS,
    titles: profile?.career.preferredRoleFamilies.filter(Boolean).slice(0, 8) ?? [],
    locations: profile?.preferences.interview.location ? [profile.preferences.interview.location] : profile?.identity.location ? [profile.identity.location] : [],
    workSetups: setups.length ? [...setups] : DEFAULT_JOB_SEARCH_SETTINGS.workSetups,
  };
}

export async function saveSearchSettings(workspace: string, input: unknown): Promise<JobSearchSettings> {
  const settings = jobSearchSettingsSchema.parse(input);
  await writeJsonAtomic(path(workspace, SETTINGS_FILE), settings);
  return settings;
}

export async function readSearchState(workspace: string): Promise<JobSearchState> {
  const parsed = jobSearchStateSchema.safeParse(await readJson<unknown>(path(workspace, STATE_FILE)));
  return parsed.success ? parsed.data : structuredClone(EMPTY_JOB_SEARCH_STATE);
}

export async function saveSearchState(workspace: string, state: JobSearchState): Promise<JobSearchState> {
  // Nothing is ever dropped: every found job, every run, and every seen link stays (seen links keep dismissed jobs away).
  const next = jobSearchStateSchema.parse({ ...state, seen: [...new Set(state.seen)] });
  await writeJsonAtomic(path(workspace, STATE_FILE), next);
  return next;
}

// ---------- The search prompt (owner of what Agy is told) ----------

/** Agy's own time limit for one web search run (a minute's grace on the wall clock is added in headlessAgy). */
export const SEARCH_TIMEOUT_SECONDS = 330;

/** Agy's web search budget per run: each search adds about 15 seconds and the run has a few minutes. */
export const MAX_WEB_SEARCHES = 5;
/** Every watched company fits (names only); above this the prompt grows without helping. */
export const KNOWN_COMPANIES_MAX = 250;

export function buildSearchPrompt(settings: JobSearchSettings, recent: string[], today: Date = new Date(), knownCompanies: string[] = []): string {
  const boards = SEARCH_BOARDS.filter((board) => !settings.boardsOff.includes(board.id));
  const list = (items: string[], empty: string) => items.length ? items.join("; ") : empty;
  return [
    `Find up to ${settings.resultsPerRun} companies in the United States that are hiring now for the roles below, quickly (a few searches, no more than a few minutes). Use web search only: do not read or write any files, and run no commands.`,
    "",
    "Roles:",
    `- Titles or role families: ${list(settings.titles, "use the include keywords")}`,
    `- Where: ${list(settings.locations, "anywhere in the United States")}; work setup: ${settings.workSetups.join(", ") || "any"}`,
    `- Level: ${list(settings.levels, "any")}${settings.payFloor ? `; base pay at least $${settings.payFloor.toLocaleString("en-US")} a year when stated` : ""}`,
    settings.needsSponsorship ? "- The candidate needs visa sponsorship: skip companies that say they don't sponsor." : "",
    `- Hiring within the last ${settings.postedWithinDays} days (today is ${today.toISOString().slice(0, 10)}).`,
    settings.includeKeywords.length ? `- Should involve: ${settings.includeKeywords.join(", ")}` : "",
    settings.excludeKeywords.length ? `- Leave out roles about: ${settings.excludeKeywords.join(", ")}` : "",
    settings.excludeTitleWords.length ? `- Leave out roles whose title includes: ${settings.excludeTitleWords.join(", ")}` : "",
    settings.skipCompanies.length ? `- Never these companies: ${settings.skipCompanies.join(", ")}` : "",
    knownCompanies.length ? `- Already known (the app checks these itself), find others: ${knownCompanies.slice(0, KNOWN_COMPANIES_MAX).join(", ")}` : "",
    "",
    "Where to look:",
    `- Search these sources (site: searches work well): ${boards.map((board) => `${board.name} (${board.domain})`).join(", ")}${settings.extraSites.length ? `; also: ${settings.extraSites.join(", ")}` : ""}.`,
    `- Never use: ${[...SKIPPED_BOARDS.map((board) => board.domain), ...settings.skipSites].join(", ")}.`,
    "",
    "Return:",
    "- companies: each company's name and the link to its jobs page as you saw it, ideally its applicant system (jobs.ashbyhq.com/<company>, job-boards.greenhouse.io/<company>, jobs.lever.co/<company>) or its careers page. The app reads every company's open jobs itself, so return companies, not single postings.",
    "- jobs (optional): a single posting you saw on a site that isn't an applicant system, with its title, company, location, and posted date (YYYY-MM-DD) if shown.",
    `- Run at most ${MAX_WEB_SEARCHES} web searches in total: combine titles in one query and search the applicant-system sites broadly, never one query per title.`,
    "- Every company needs a link. Prefer its applicant-system or careers address when a result shows it; otherwise return the search result's link exactly as given, even a redirect (the app follows redirects).",
    "- Copy links exactly as they appear in results. Never type, shorten, or assemble a link; a made-up link is worse than none. Don't rate or describe anything.",
    recent.length ? `- Postings already seen: ${recent.slice(-30).join("; ")}` : "",
  ].filter((line) => line !== "").join("\n");
}

export type FoundLink = { url: string; title?: string; company?: string; location?: string; postedDate?: string };
export type FoundCompany = { name: string; jobsUrl?: string };

export function parseSearchReply(response: string): FoundLink[] {
  return parseSearchResult(response).jobs;
}

export function parseSearchResult(response: string): { jobs: FoundLink[]; companies: FoundCompany[] } {
  const text = response.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  let value: unknown;
  try { value = JSON.parse(text); } catch {
    const match = text.match(/\{[\s\S]*\}/);
    try { value = match ? JSON.parse(match[0]) : null; } catch { value = null; }
  }
  const record = (value ?? {}) as { jobs?: unknown; companies?: unknown };
  const str = (input: unknown) => typeof input === "string" && input.trim() ? input.trim() : undefined;
  const jobs = (Array.isArray(record.jobs) ? record.jobs : []).flatMap((job) => {
    const item = job as Record<string, unknown>;
    const url = str(item?.url);
    if (!url || !/^https?:\/\//i.test(url)) return [];
    return [{ url, title: str(item.title), company: str(item.company), location: str(item.location), postedDate: str(item.postedDate) }];
  });
  const companies = (Array.isArray(record.companies) ? record.companies : []).flatMap((company) => {
    const item = company as Record<string, unknown>;
    const name = str(item?.name);
    if (!name) return [];
    const jobsUrl = str(item.jobsUrl);
    // A single posting given as the jobs page: the company is read from its board, and the posting is checked too.
    const posting = jobsUrl ? postingRef(jobsUrl) : null;
    if (posting && jobsUrl && !jobs.some((job) => job.url === jobsUrl)) jobs.push({ url: jobsUrl, title: undefined, company: name, location: undefined, postedDate: undefined });
    return [{ name, jobsUrl: posting ? boardUrl(posting) : jobsUrl }];
  });
  return { jobs, companies };
}

// ---------- Dead and stale postings ----------

const CLOSED = /\b(?:no longer (?:accepting applications|available|open|active)|(?:this )?(?:job|position|posting|role) (?:has been|was|is) (?:filled|closed|removed)|(?:job|posting|position) (?:has )?expired|no longer accepting|this job is closed|position is closed|page (?:you(?:'re| are) looking for )?(?:can(?:no|')t be found|not found|does not exist))\b/i;

export function closedPosting(text: string): boolean {
  return CLOSED.test(text.slice(0, 4000));
}

/** Days since the posted date, or null when unknown or unreadable. */
export function postingAgeDays(postedDate: string | undefined | null, now: Date): number | null {
  if (!postedDate) return null;
  const time = Date.parse(postedDate);
  if (Number.isNaN(time)) return null;
  return Math.max(0, Math.floor((now.getTime() - time) / 86_400_000));
}

// ---------- Quick fit (no Agy) ----------

const STOP = new Set(("ability able about across also and any are around based being both build building can collaborate communication complex "
  + "cross customer customers deep demonstrated desire drive environment etc excellent experience experienced familiarity fast for from "
  + "functional good great have help high including into its join knowledge least like more must new not other our paced plus preferred "
  + "proven related required requirements role skills strong team teams than that the their them this through using well what will with "
  + "work working years you your").split(" "));

function contentWords(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[^a-z0-9+#.]+/).map((word) => word.replace(/\.+$/, "")).filter((word) => word.length >= 4 && !STOP.has(word) && !/^\d+$/.test(word)))];
}

export type Vocabulary = { words: Set<string>; text: string };

export function vocabularyFrom(texts: string[]): Vocabulary {
  const text = texts.join("\n").toLowerCase();
  return { words: new Set(contentWords(text)), text };
}

const hasTerm = (vocab: Vocabulary, term: string) => {
  const needle = term.toLowerCase().trim();
  if (!needle) return true;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`).test(vocab.text);
};

/** The candidate's own words: base resume lines and the checked work records (text files only). */
export async function loadVocabulary(workspace: string, profile: CandidateProfile | null): Promise<Vocabulary> {
  const texts: string[] = [];
  const resume = profile?.sources.baseResumePath;
  if (resume) {
    const baseline = await loadCanonicalResumeBaseline(workspace, resume).catch(() => null);
    if (baseline) texts.push(...baseline.employers.flatMap((employer) => [employer.title ?? "", ...employer.originalBullets]), ...baseline.originalSkillsLines);
  }
  const manifest = await readActiveContextManifest(workspace);
  for (const relative of manifest?.selectedStructuredPaths ?? []) {
    if (![".md", ".txt", ".json", ".csv"].includes(extname(relative).toLowerCase())) continue;
    const file = path(workspace, relative);
    const info = await stat(file).catch(() => null);
    if (!info?.isFile() || info.size > 2_000_000) continue;
    texts.push(await readFile(file, "utf8").catch(() => ""));
  }
  return vocabularyFrom(texts);
}

const NO_SPONSOR = /\b(?:no|not|unable to|cannot|can't|won't|will not|does not|do not)\b[^.]{0,40}\bsponsor/i;
const CLEARANCE = /\b(?:security clearance|clearance (?:is )?required|ts\/sci|secret clearance)\b/i;
const CITIZEN = /\bu\.?s\.? citizen(?:ship)?\b[^.]{0,30}\brequired\b|\bmust be a u\.?s\.? citizen\b/i;

export function quickFit(record: PostingRecord, vocab: Vocabulary, settings: JobSearchSettings): QuickFit {
  const required = record.requirements.filter((row) => row.kind === "required");
  const rows = required.length ? required : record.requirements;
  const toolsByRow = new Map<string, string[]>();
  for (const tool of record.tools) for (const id of tool.requirementIds) toolsByRow.set(id, [...(toolsByRow.get(id) ?? []), tool.name]);
  // The company's own name and the role's own title words (and their acronym, e.g. TAM) are not skills to learn.
  const own = `${record.company ?? ""} ${record.title ?? ""}`.toLowerCase();
  const acronym = (record.title ?? "").split(/\s+/).filter((word) => /^[A-Z]/.test(word)).map((word) => word[0]).join("").toLowerCase();
  const isOwn = (name: string) => own.includes(name.toLowerCase()) || (name.length >= 2 && acronym.includes(name.toLowerCase()));
  const gaps = [...new Set(record.tools.filter((tool) => !isOwn(tool.name) && !hasTerm(vocab, tool.name)).map((tool) => tool.name))];
  const coveredRows = rows.filter((row) => {
    const tools = toolsByRow.get(row.id) ?? [];
    if (tools.some((tool) => !hasTerm(vocab, tool))) return false;
    const words = contentWords(row.text);
    if (!words.length) return true;
    return words.filter((word) => vocab.words.has(word)).length / words.length >= 0.4;
  });
  const coverage = rows.length ? coveredRows.length / rows.length : 0.5;

  const blockers: string[] = [];
  const flags: string[] = [];
  const auth = `${record.workAuthorization ?? ""} ${record.requiredItems.join(" ")}`;
  if (settings.needsSponsorship && NO_SPONSOR.test(auth)) blockers.push("No visa sponsorship");
  if (CLEARANCE.test(auth)) blockers.push("Security clearance required");
  if (CITIZEN.test(auth)) blockers.push("US citizenship required");

  let score = 1 + 4 * coverage;
  const level = record.seniority;
  if (settings.levels.length && level && !settings.levels.includes(level as JobSearchSettings["levels"][number])) { score -= 0.5; flags.push(`Level: ${level}`); }
  const yearlyMax = record.pay?.period === "year" ? record.pay.max ?? record.pay.min : null;
  if (settings.payFloor && yearlyMax !== null && yearlyMax !== undefined && yearlyMax < settings.payFloor) { score -= 0.5; flags.push(`Pay below your floor (${record.pay!.text})`); }
  const mode = record.workSetup?.mode;
  if (mode && settings.workSetups.length && !settings.workSetups.includes(mode)) { score -= 0.5; flags.push(`Work setup: ${mode}`); }
  if ((record.workSetup?.daysInOffice ?? 0) >= 5) flags.push("5 days in the office");
  if (record.travel && /\b(?:[5-9]\d)\s?%/.test(record.travel)) flags.push(`Travel: ${record.travel}`);
  if (/\b(?:contract|temporary|temp-to-hire|fixed[- ]term)\b/i.test(`${record.title ?? ""} ${record.summary.slice(0, 2).join(" ")}`)) flags.push("Contract or temporary");
  if (!rows.length) flags.push("The posting lists no requirements");
  if (blockers.length) score = Math.min(score, 1.5);
  score = Math.round(Math.max(1, Math.min(5, score)) * 10) / 10;

  const why = [
    rows.length ? `Your files cover ${coveredRows.length} of ${rows.length} ${required.length ? "requirements" : "main duties"}` : "No requirement list to compare",
    gaps.length ? `missing ${gaps.slice(0, 3).join(", ")}` : "",
    blockers[0] ?? "",
  ].filter(Boolean).join("; ");
  return { score, why: `${why}.`, covered: coveredRows.length, total: rows.length, gaps: gaps.slice(0, 8), blockers, flags };
}

// ---------- The run ----------

const REDIRECT_HOSTS = /(?:^|\.)(?:vertexaisearch\.cloud\.google\.com|google\.com|bing\.com|duckduckgo\.com)$/i;

/** Search-result redirect links (Agy's web search returns Google grounding redirects) resolved to the posting's own address. */
export async function resolveLink(url: string, fetcher: typeof fetch): Promise<string> {
  let host = "";
  try { host = new URL(url).hostname; } catch { return url; }
  if (!REDIRECT_HOSTS.test(host)) return url;
  let current = url;
  for (let hop = 0; hop < 5; hop += 1) {
    const response = await fetcher(current, { redirect: "manual", signal: AbortSignal.timeout(15_000) }).catch(() => null);
    const location = response?.headers.get("location");
    if (!response || response.status < 300 || response.status >= 400 || !location) break;
    current = new URL(location, current).toString();
    try { if (!REDIRECT_HOSTS.test(new URL(current).hostname)) return current; } catch { break; }
  }
  return current;
}


/** Title and company: what Agy saw on the page first, then the page; "Company - Title" page titles (Lever) are split. */
export function nameJob(link: FoundLink, pageCompany: string | null, pageTitle: string | null): { company: string | null; title: string | null } {
  let company = link.company ?? pageCompany;
  let title = link.title ?? pageTitle;
  const split = !link.title && pageTitle ? /^(.{2,60}?)\s+[-–|]\s+(.{3,})$/.exec(pageTitle) : null;
  if (split && (!company || split[1].toLowerCase() === company.toLowerCase())) { company = company ?? split[1].trim(); title = split[2].trim(); }
  return { company, title };
}

export type SearchDeps = {
  workspace: string;
  profile: CandidateProfile | null;
  /** Null checks watched companies only (no Agy). */
  runner: AgyRunner | null;
  /** Agy runner for the light rating (with the rating schema); null skips it. */
  rater?: AgyRunner | null;
  fetcher?: typeof fetch;
  now?: () => Date;
  /** Keys of jobs already in Jobs (canonical URLs and company|title keys). */
  existingKeys: Set<string>;
  /** Companies of the user's jobs on Ashby/Greenhouse/Lever, watched automatically when `autoWatch` is on. */
  jobCompanies?: WatchedSuggestion[];
  /** What the user's recorded interviews teach the search (see `searchLearning`). */
  learned?: SearchLearning;
  onUpdate?: (state: JobSearchState) => void;
  onProgress?: (progress: SearchProgress) => void;
  /** Set by the scheduled runner. */
  scheduled?: boolean;
  /** A scheduled retry of only Agy's search: watched companies were checked earlier in the window. */
  agyOnly?: boolean;
};

const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;

const agyError = (message: string) => /print_timeout|DEADLINE_EXCEEDED/.test(message) ? "Agy took too long to search. Try fewer companies per search or fewer titles."
  : /quota|RESOURCE_EXHAUSTED/i.test(message) ? "Agy's quota is used up for now. Try again later." : message.slice(0, 200);

/** Board slugs a company's name may use ("Together AI" → togetherai, together-ai). Never a single word of a longer name. */
export function slugGuesses(name: string): string[] {
  const words = name.toLowerCase().replace(/&/g, " and ").replace(/\b(?:inc|llc|ltd|corp|co)\b\.?/g, " ").split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length) return [];
  return [...new Set([words.join(""), words.join("-")])];
}

/** The company's board when Agy gave no usable link: the first board with open jobs under a slug from its name. */
export async function findBoardByName(name: string, read: (ref: BoardRef) => Promise<BoardJob[] | null>): Promise<BoardRef | null> {
  for (const slug of slugGuesses(name)) {
    for (const board of ["ashby", "greenhouse", "lever"] as const) {
      const jobs = await read({ board, slug });
      if (jobs?.length) return { board, slug };
    }
  }
  return null;
}

/** Watched boards read at once: fast, and gentle on each board's public API. */
const BOARD_READS_AT_ONCE = 8;

/** Maps with at most `limit` calls running at once, keeping the input order. */
export async function mapLimit<T, R>(items: T[], limit: number, map: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; out[index] = await map(items[index]!); }
  }));
  return out;
}

/** A link to check, with the board job behind it when it came from a company's live list. */
type Candidate = { link: FoundLink; source: "watched" | "search"; board: { ref: BoardRef; job: BoardJob } | null };

export async function runSearch(deps: SearchDeps): Promise<{ state: JobSearchState; run: SearchRun }> {
  const now = deps.now ?? (() => new Date());
  const fetcher = deps.fetcher ?? appFetch;
  let settings = await readSearchSettings(deps.workspace, deps.profile);
  let state = await readSearchState(deps.workspace);
  const run: SearchRun = { id: newId("run"), startedAt: now().toISOString(), finishedAt: null, status: "running", found: 0, added: 0, leftOut: {}, leftOutItems: {}, autoQueued: 0, replaced: 0, rated: 0, companies: 0, error: null, source: deps.runner ? "search" : "watched", scheduled: deps.scheduled === true, agyFailed: false, agyOnly: deps.agyOnly === true };
  state = await saveSearchState(deps.workspace, { ...state, runs: [...state.runs, run] });
  deps.onUpdate?.(state);
  const finish = async (patch: Partial<SearchRun>) => {
    const done = { ...run, ...patch, finishedAt: now().toISOString() };
    state = await saveSearchState(deps.workspace, { ...state, runs: state.runs.map((candidate) => candidate.id === run.id ? done : candidate) });
    deps.onUpdate?.(state);
    return { state, run: done };
  };
  const leftOut: Record<string, number> = {};
  const leftOutItems: Record<string, LeftOutItem[]> = {};
  // The posting being checked, so a reason left out keeps an example to show (#121).
  let current: LeftOutItem | null = null;
  const skip = (reason: string, item: LeftOutItem | null = current) => {
    leftOut[reason] = (leftOut[reason] ?? 0) + 1;
    const list = (leftOutItems[reason] ??= []);
    if (item && list.length < LEFT_OUT_EXAMPLES) list.push(item);
  };

  // Board lists, read once per run: live postings with their places, setup, dates, and text.
  const boards = new Map<string, Promise<BoardJob[] | null>>();
  const boardJobs = (ref: BoardRef) => {
    const key = boardKey(ref);
    if (!boards.has(key)) boards.set(key, listBoardJobs(ref, fetcher).catch(() => null));
    return boards.get(key)!;
  };
  const watchedKeys = () => new Set(settings.watched.map((company) => boardKey(company)));
  const addWatched = async (companies: JobSearchSettings["watched"]) => {
    const known = watchedKeys();
    const fresh = companies.filter((company) => !known.has(boardKey(company)));
    if (!fresh.length) return 0;
    settings = await saveSearchSettings(deps.workspace, { ...settings, watched: [...settings.watched, ...fresh] });
    return fresh.length;
  };
  // Companies of the user's own jobs join the watched list (the setting is on by default and editable).
  if (settings.autoWatch && deps.jobCompanies?.length) await addWatched(deps.jobCompanies.map((company) => ({ board: company.board, slug: company.slug, name: company.name, source: "jobs" as const })));

  const candidates: Candidate[] = [];
  const fromBoard = (ref: BoardRef, job: BoardJob, name: string | undefined, source: Candidate["source"]) => {
    if (!fitsSearchTitles(job.title, settings.titles)) return;
    const example: LeftOutItem = { title: job.title, company: name || job.company || null, url: job.url };
    if (titleExcluded(job.title, settings.excludeTitleWords)) { skip("title has a word you left out", example); return; }
    // Old postings are left out here, before they become candidates (never marked seen, so a wider age setting brings them back).
    const age = postingAgeDays(job.postedAt, now());
    if (age !== null && age > settings.postedWithinDays) { skip("too old", example); return; }
    candidates.push({ link: { url: job.url, title: job.title, company: name || job.company || undefined, location: job.location ?? undefined, postedDate: job.postedAt ?? undefined }, source, board: { ref, job } });
  };

  // 1. Watched companies (free): their live postings whose titles fit the search (already done on an Agy-only retry).
  // Boards are read a few at a time (each is one small public request); results are used in watched-list order.
  const watched = deps.agyOnly ? [] : settings.watched;
  let read = 0;
  const lists = await mapLimit(watched, BOARD_READS_AT_ONCE, async (company) => {
    const jobs = await boardJobs(company);
    deps.onProgress?.({ phase: "watched", checked: (read += 1) - 1, total: watched.length });
    return jobs;
  });
  for (const [index, company] of watched.entries()) {
    const jobs = lists[index];
    if (!jobs) { skip("watched board unreadable", { title: null, company: company.name || company.slug, url: null }); continue; }
    for (const job of jobs) fromBoard(company, job, company.name, "watched");
  }

  // 2. Agy's search (one run): companies hiring for the titles, read from their own boards; plus postings seen elsewhere.
  let agyFailure: string | null = null;
  let searchFailed = false;
  let companiesFound = 0;
  if (deps.runner) {
    deps.onProgress?.({ phase: "agy", checked: 0, total: 0 });
    const recent = state.items.slice(-30).map((item) => [item.company, item.title].filter(Boolean).join(" — ")).filter(Boolean);
    try {
      const reply = parseSearchResult((await deps.runner(buildSearchPrompt(settings, recent, now(), settings.watched.map((company) => company.name || company.slug)), { conversationId: null })).response);
      const found: JobSearchSettings["watched"] = [];
      for (const company of reply.companies) {
        // Agy's link (search redirects resolved), else the company's board found by its name on Ashby, Greenhouse, Lever.
        const ref = (company.jobsUrl ? boardRef(await resolveLink(company.jobsUrl, fetcher)) : null) ?? await findBoardByName(company.name, boardJobs);
        const companyExample: LeftOutItem = { title: null, company: company.name, url: company.jobsUrl ?? null };
        if (!ref) { skip("company not on a readable board", companyExample); continue; }
        // Watched companies were read in step 1; reading them again only repeats their postings.
        if (watchedKeys().has(boardKey(ref))) { skip("already watched", companyExample); continue; }
        const jobs = await boardJobs(ref);
        if (!jobs) { skip("company board not found", companyExample); continue; }
        companiesFound += 1;
        if (!watchedKeys().has(boardKey(ref))) found.push({ ...ref, name: company.name, source: "search" });
        for (const job of jobs) fromBoard(ref, job, company.name, "search");
      }
      // Companies Agy found are kept, so later searches (and free checks) read them without Agy.
      if (settings.watchFoundCompanies) await addWatched(found);
      for (const link of reply.jobs) candidates.push({ link, source: "search", board: null });
    } catch (error) {
      agyFailure = agyError(error instanceof Error ? error.message : String(error));
      searchFailed = true;
      if (!candidates.length) return finish({ status: "failed", error: agyFailure, leftOut, leftOutItems, agyFailed: true });
    }
  }

  // 3. The app checks every candidate: newest first, cheap checks (seen, place, age) before any posting is loaded.
  // `seen` is kept between runs and only grows with jobs that were added or found closed, so a posting left out for
  // its age, its place, or a filter comes back once the user changes that setting. `checked` stops repeats within a run.
  candidates.sort((a, b) => (Date.parse(b.link.postedDate ?? "") || 0) - (Date.parse(a.link.postedDate ?? "") || 0));
  const seen = new Set([...state.seen, ...deps.existingKeys]);
  const checked = new Set<string>();
  const sameUrl = (a: string, b: string) => canonicalUrl(a).toLowerCase() === b.toLowerCase();
  const vocab = await loadVocabulary(deps.workspace, deps.profile);
  const skipCompanies = settings.skipCompanies.map((name) => name.toLowerCase());
  let added = 0;
  let replaced = 0;
  for (const [index, candidate] of candidates.entries()) {
    deps.onProgress?.({ phase: "checking", checked: index, total: candidates.length });
    const link = candidate.link;
    current = { title: link.title ?? null, company: link.company ?? null, url: link.url };
    let board = candidate.board;
    let url = canonicalUrl(board ? link.url : await resolveLink(link.url, fetcher));
    if (seen.has(url) || checked.has(url)) { skip("already seen"); continue; }
    checked.add(url);
    if (!board) {
      if (skippedSite(url, settings)) { skip("skipped board"); continue; }
      if (!singlePosting(url)) { skip("not a single posting"); continue; }
      // On Ashby, Greenhouse, and Lever the company's live list decides: a link not on it is swapped for the live
      // posting with the same title, or left out as closed.
      const ref = boardRef(url);
      const jobs = ref ? await boardJobs(ref) : null;
      if (ref && jobs) {
        const live = jobs.find((job) => sameUrl(job.url, url));
        const swap = live ? null : link.title ? bestMatch(jobs, link.title) : null;
        if (!live && !swap) { seen.add(url); skip("posting closed"); continue; }
        if (swap) {
          url = canonicalUrl(swap.url);
          if (seen.has(url) || checked.has(url)) { skip("already seen"); continue; }
          checked.add(url);
          replaced += 1;
        }
        board = { ref, job: (live ?? swap)! };
      }
    }
    let postedDate = board?.job.postedAt ?? link.postedDate;
    let age = postingAgeDays(postedDate, now());
    if (age !== null && age > settings.postedWithinDays) { skip("too old"); continue; }
    if (board) {
      const place = locationFits(board.job, settings);
      if (!place.fits) { skip(`not in your places or setups`); continue; }
    }
    if (company(link, board) && skipCompanies.includes(company(link, board)!.toLowerCase())) { skip("skipped company"); continue; }
    if (added >= settings.maxNewPerRun) { skip("over this run's limit"); continue; }
    let markdown: string;
    let meta: { title: string | null; company: string | null; location: string | null };
    try {
      const html = board ? await boardPostingHtml(board.ref, board.job, fetcher) : null;
      const { extracted } = html && board
        ? postingFromBoard({ url, title: board.job.title, company: company(link, board), location: board.job.locations.join("; ") || board.job.location, html, pay: board.job.pay ?? null, posted: board.job.postedAt ?? null })
        : await fetchAndClean(url, fetcher, { render: false });
      markdown = extracted.markdown;
      meta = extracted;
    } catch (error) {
      const gone = /HTTP 4(?:04|10)/.test(String(error));
      if (gone) seen.add(url);
      skip(gone ? "posting closed" : "couldn't open");
      continue;
    }
    if (closedPosting(markdown)) { seen.add(url); skip("posting closed"); continue; }
    if (markdown.replace(/^[\s\S]*?\*\*Source:\*\*[^\n]*\n/, "").trim().length < MIN_POSTING_CHARS) { skip("couldn't read"); continue; }
    const record = buildPostingRecord(markdown);
    // The posting's own date (structured data or Ashby's embedded data, #116) when the board and the link gave none.
    if (!postedDate && record.postedAt) {
      postedDate = record.postedAt;
      age = postingAgeDays(postedDate, now());
      if (age !== null && age > settings.postedWithinDays) { skip("too old"); continue; }
    }
    // The posting's own words decide when they state the setup ("On-site in New York City"): boards' labels can be
    // wrong (a recruiting marketplace marks client jobs "Remote"). Board places are kept alongside the posting's.
    if (!board || record.workSetup?.mode) {
      const places = [...(record.workSetup?.mode ? [record.workSetup.text] : []), record.location ?? link.location ?? "", ...(board?.job.locations ?? [])].filter(Boolean);
      const place = locationFits({ locations: places, workplace: record.workSetup?.mode ?? board?.job.workplace ?? null }, settings);
      if (!place.fits) { skip("not in your places or setups"); continue; }
    }
    const { company: companyName, title } = nameJob(link, meta.company ?? record.company ?? null, meta.title ?? record.title ?? null);
    const key = jobKey(companyName, title);
    if (key && (seen.has(key) || checked.has(key))) { skip("already seen"); continue; }
    if (key) checked.add(key);
    if (title && titleExcluded(title, settings.excludeTitleWords)) { skip("title has a word you left out"); continue; }
    if (companyName && skipCompanies.includes(companyName.toLowerCase())) { skip("skipped company"); continue; }
    const text = `${title ?? ""} ${record.summary.join(" ")}`.toLowerCase();
    if (settings.excludeKeywords.some((word) => text.includes(word.toLowerCase()))) { skip("excluded keyword"); continue; }
    const item: InboxItem = {
      id: newId("find"),
      url,
      title,
      company: companyName,
      location: board?.job.locations.join("; ") || meta.location || record.location || link.location || null,
      board: boardOf(url),
      postedAt: age !== null && postedDate ? new Date(Date.parse(postedDate)).toISOString().slice(0, 10) : null,
      foundAt: now().toISOString(),
      runId: run.id,
      status: "new",
      pay: record.pay?.text ?? null,
      workSetup: record.workSetup?.text ?? board?.job.workplace ?? record.workSetup?.mode ?? null,
      level: record.seniority,
      fit: learnedFit(quickFit(record, vocab, settings), deps.learned),
      jobId: null,
      queuedAt: null,
      autoQueued: false,
      watched: candidate.source === "watched",
      agyFit: null,
      likeInterviewed: title ? likeInterviewed(title, deps.learned) : null,
    };
    await writeTextAtomic(path(deps.workspace, `${POSTINGS_DIR}/${item.id}.md`), markdown);
    seen.add(url);
    if (key) seen.add(key);
    added += 1;
    state = await saveSearchState(deps.workspace, { ...state, items: [...state.items, item], seen: [...seen] });
    deps.onUpdate?.(state);
  }
  deps.onProgress?.({ phase: "checking", checked: candidates.length, total: candidates.length });
  state = await saveSearchState(deps.workspace, { ...state, seen: [...seen] });
  // 4. Agy's light rating for this run's best new matches (one call), when the search used Agy.
  let rated = 0;
  if (deps.runner && deps.rater && settings.lightRating && !agyFailure) {
    const picks = lightRatingPicks(state.items.filter((item) => item.runId === run.id), settings);
    if (picks.length) {
      deps.onProgress?.({ phase: "rating", checked: 0, total: picks.length });
      try {
        rated = await rateItems({ workspace: deps.workspace, profile: deps.profile, rater: deps.rater, ids: picks.map((item) => item.id), now, onUpdate: deps.onUpdate });
        state = await readSearchState(deps.workspace);
      } catch (error) {
        agyFailure = `The light rating didn't finish (${agyError(error instanceof Error ? error.message : String(error))}); quick fit is shown instead.`;
      }
    }
  }
  return finish({ status: "done", found: candidates.length, added, replaced, rated, companies: companiesFound, leftOut, leftOutItems, error: agyFailure, agyFailed: searchFailed });
}

const company = (link: FoundLink, board: Candidate["board"]) => link.company ?? board?.job.company ?? null;

/**
 * What the search needs from the user's Jobs: keys of jobs already there (never shown again) and the companies whose
 * postings are on Ashby/Greenhouse/Lever (watched automatically when `autoWatch` is on), with how many jobs each has
 * and whether one reached an interview. Used by Run now, the scheduled runner, and the watched-list suggestions.
 */
export async function jobsForSearch(workspace: string, jobs: Array<{ id: string; company: string | null; title: string | null; reachedInterview: boolean }>): Promise<{ existingKeys: Set<string>; companies: WatchedSuggestion[] }> {
  const existingKeys = new Set(jobs.map((job) => jobKey(job.company, job.title)).filter((key): key is string => Boolean(key)));
  const found = new Map<string, WatchedSuggestion>();
  for (const job of jobs) {
    const posting = await readJson<{ url?: string | null }>(path(workspace, `jobs/${job.id}/.sensei/posting.json`));
    const ref = posting?.url ? boardRef(posting.url) : null;
    if (!ref) continue;
    const key = boardKey(ref);
    const current = found.get(key) ?? { board: ref.board, slug: ref.slug, name: job.company ?? ref.slug, jobs: 0, interviewed: false };
    current.jobs += 1;
    current.interviewed ||= job.reachedInterview;
    found.set(key, current);
  }
  const companies = [...found.values()].sort((a, b) => Number(b.interviewed) - Number(a.interviewed) || b.jobs - a.jobs || a.name.localeCompare(b.name));
  return { existingKeys, companies };
}

/**
 * What recorded interviews teach the search: titles of jobs that got a real interview (matches like them rank a little
 * higher) and gap terms that recur in applications with no interview (flagged on new matches). From Learnings (U31).
 */
export type SearchLearning = { interviewed: Array<{ title: string; company: string | null }>; rejectionGaps: string[] };

export function searchLearning(jobs: JobFolderSummary[]): SearchLearning {
  return {
    interviewed: jobs.filter((job) => furthestRecordedStage(job) !== null && job.title).map((job) => ({ title: job.title!, company: job.company })),
    rejectionGaps: computeLearnings(jobs).gapTerms.filter((term) => term.noInterview >= 2 && term.noInterview > term.interviewed).map((term) => term.term),
  };
}

export function likeInterviewed(title: string, learned: SearchLearning | undefined): string | null {
  const match = learned?.interviewed.find((job) => titleSimilarity(job.title, title) >= 0.6);
  return match ? `Like ${match.company ? `your ${match.company} interview` : "a job that got you an interview"}` : null;
}

function learnedFit(fit: QuickFit, learned: SearchLearning | undefined): QuickFit {
  const recurring = fit.gaps.filter((gap) => learned?.rejectionGaps.some((term) => term.toLowerCase() === gap.toLowerCase()));
  return recurring.length ? { ...fit, flags: [...fit.flags, `Came up in applications without interviews: ${recurring.join(", ")}`] } : fit;
}

// ---------- One search at a time (the app and the scheduled runner share this lock) ----------

const LOCK_FILE = `${JOB_SEARCH_DIR}/run.lock`;
/** Longer than the slowest run (search 6 min + rating 4 min + link checks), so a lock left by a stalled process clears soon. */
const LOCK_STALE_MS = 20 * 60_000;

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; } };

/** Who holds the search lock, or null when free (a lock older than 30 minutes or from a dead process is free). */
export async function searchLockHolder(workspace: string, now = Date.now()): Promise<{ pid: number; startedAt: string; by: "app" | "schedule" } | null> {
  const lock = await readJson<{ pid?: number; startedAt?: string; by?: "app" | "schedule" }>(path(workspace, LOCK_FILE));
  if (!lock?.pid || !lock.startedAt) return null;
  if (now - Date.parse(lock.startedAt) > LOCK_STALE_MS || !alive(lock.pid)) return null;
  return { pid: lock.pid, startedAt: lock.startedAt, by: lock.by === "schedule" ? "schedule" : "app" };
}

/** Takes the lock, or returns who holds it. */
export async function takeSearchLock(workspace: string, by: "app" | "schedule"): Promise<{ ok: true } | { ok: false; by: "app" | "schedule" }> {
  const holder = await searchLockHolder(workspace);
  if (holder && holder.pid !== process.pid) return { ok: false, by: holder.by };
  await writeJsonAtomic(path(workspace, LOCK_FILE), { pid: process.pid, startedAt: new Date().toISOString(), by });
  return { ok: true };
}

export async function releaseSearchLock(workspace: string): Promise<void> {
  const holder = await searchLockHolder(workspace);
  if (!holder || holder.pid === process.pid) await rm(path(workspace, LOCK_FILE), { force: true });
}

/** Removes queued-draft ids the app has handled. */
export async function clearPendingDrafts(workspace: string, ids: string[]): Promise<JobSearchState> {
  const state = await readSearchState(workspace);
  const done = new Set(ids);
  return saveSearchState(workspace, { ...state, pendingDrafts: state.pendingDrafts.filter((id) => !done.has(id)) });
}

// ---------- Agy light rating (one call for up to 10 jobs) ----------

export const RATING_SCHEMA = JSON.stringify({
  type: "object",
  required: ["ratings"],
  properties: {
    ratings: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "score", "why"],
        properties: { id: { type: "string" }, score: { type: "number" }, why: { type: "string" }, gaps: { type: "array", items: { type: "string" } } },
      },
    },
  },
});

const clip = (text: string, max: number) => text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
const plain = (text: string) => text.replace(/[*_`#]/g, "").replace(/\s+/g, " ").trim();

/** A short card of the candidate for the light rating: role titles and dates, skills lines, story, target roles. No employer names. */
export async function profileCard(workspace: string, profile: CandidateProfile | null): Promise<string> {
  const baseline = profile?.sources.baseResumePath ? await loadCanonicalResumeBaseline(workspace, profile.sources.baseResumePath).catch(() => null) : null;
  const roles = profile?.career.employers.length
    ? profile.career.employers.map((role) => `${role.title} (${role.startDate} – ${role.endDate ?? "present"})`)
    : (baseline?.employers ?? []).map((role) => `${plain(role.title ?? "Role")} (${role.dateRange ?? "dates not stated"})`);
  const lines = [
    roles.length ? `Roles: ${roles.slice(0, 6).join("; ")}` : "",
    baseline?.originalSkillsLines.length ? `Skills: ${clip(baseline.originalSkillsLines.map(plain).join(" | "), 700)}` : "",
    profile?.career.transitionSummary ? `Story: ${clip(plain(profile.career.transitionSummary), 500)}` : "",
    profile?.career.preferredRoleFamilies.length ? `Wants: ${profile.career.preferredRoleFamilies.join(", ")}` : "",
  ].filter(Boolean);
  return lines.join("\n") || "No profile details yet.";
}

export function buildRatingPrompt(card: string, jobs: Array<{ id: string; title: string | null; company: string | null; level: string | null; requirements: string[] }>): string {
  return [
    "Rate how well this candidate fits each job below, from 1 (poor) to 5 (excellent). Use only the candidate card and each job's requirements: do not search, read files, or run commands.",
    "Score the work itself: transferable experience counts, tools that can be learned quickly are a small gap, and missing core experience is a big one. Be honest, not generous.",
    "For each job return its id, a score (one decimal), why in one plain sentence under 25 words (say \"you\", not \"the candidate\"), and up to 3 gaps of a few words each.",
    POSTING_DATA_RULE,
    "",
    "Candidate:",
    card,
    "",
    ...jobs.flatMap((job) => [
      `Job ${job.id}:`,
      // Title, company, and requirements all come from the posting, so all of them sit inside the fence.
      fencePosting([
        `${job.title ?? "Untitled"} at ${job.company ?? "an unnamed company"}${job.level ? ` (${job.level})` : ""}`,
        ...(job.requirements.length ? job.requirements.map((text) => `- ${clip(plain(text), 180)}`) : ["- (the posting lists no requirements)"]),
      ].join("\n")),
      "",
    ]),
  ].join("\n");
}

export function parseRatingReply(response: string, ids: string[]): Map<string, { score: number; why: string; gaps: string[] }> {
  const wanted = new Set(ids);
  const text = response.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  let value: unknown;
  try { value = JSON.parse(text); } catch { const match = text.match(/\{[\s\S]*\}/); try { value = match ? JSON.parse(match[0]) : null; } catch { value = null; } }
  const ratings = Array.isArray((value as { ratings?: unknown })?.ratings) ? (value as { ratings: Array<Record<string, unknown>> }).ratings : [];
  const out = new Map<string, { score: number; why: string; gaps: string[] }>();
  for (const rating of ratings) {
    const id = typeof rating.id === "string" ? rating.id.trim() : "";
    const score = typeof rating.score === "number" ? rating.score : Number(rating.score);
    if (!wanted.has(id) || !Number.isFinite(score)) continue;
    out.set(id, {
      score: Math.round(Math.min(5, Math.max(1, score)) * 10) / 10,
      why: typeof rating.why === "string" ? clip(plain(rating.why), 220) : "",
      gaps: Array.isArray(rating.gaps) ? rating.gaps.filter((gap): gap is string => typeof gap === "string").map((gap) => clip(plain(gap), 80)).slice(0, 3) : [],
    });
  }
  return out;
}

/** Rates the given matches (at most 10) in one Agy call and saves the ratings. Returns how many were rated. */
export async function rateItems(deps: { workspace: string; profile: CandidateProfile | null; rater: AgyRunner; ids: string[]; now?: () => Date; onUpdate?: (state: JobSearchState) => void }): Promise<number> {
  const now = deps.now ?? (() => new Date());
  const state = await readSearchState(deps.workspace);
  const items = deps.ids.map((id) => state.items.find((item) => item.id === id)).filter((item): item is InboxItem => Boolean(item)).slice(0, 10);
  if (!items.length) return 0;
  const jobs = await Promise.all(items.map(async (item) => {
    const record = buildPostingRecord(await postingFor(deps.workspace, item.id).catch(() => ""));
    const required = record.requirements.filter((row) => row.kind === "required");
    return { id: item.id, title: item.title, company: item.company, level: item.level, requirements: (required.length ? required : record.requirements).slice(0, 12).map((row) => row.text) };
  }));
  const reply = await deps.rater(buildRatingPrompt(await profileCard(deps.workspace, deps.profile), jobs), { conversationId: null });
  const ratings = parseRatingReply(reply.response, items.map((item) => item.id));
  const latest = await readSearchState(deps.workspace);
  const ratedAt = now().toISOString();
  const next = await saveSearchState(deps.workspace, { ...latest, items: latest.items.map((item) => ratings.has(item.id) ? { ...item, agyFit: { ...ratings.get(item.id)!, ratedAt } } : item) });
  deps.onUpdate?.(next);
  return ratings.size;
}

// ---------- Inbox actions ----------

export async function postingFor(workspace: string, itemId: string): Promise<string> {
  if (!/^find-[a-z0-9-]{4,40}$/.test(itemId)) throw new Error("That isn't a found job.");
  return readFile(path(workspace, `${POSTINGS_DIR}/${itemId}.md`), "utf8");
}

export async function setItemStatus(workspace: string, ids: string[], status: InboxItem["status"], patch: Partial<InboxItem> = {}): Promise<JobSearchState> {
  const state = await readSearchState(workspace);
  const wanted = new Set(ids);
  return saveSearchState(workspace, { ...state, items: state.items.map((item) => wanted.has(item.id) ? { ...item, ...patch, status } : item) });
}

/**
 * Removes dismissed matches for good (#210). Only dismissed ones; their link and company+title stay in `seen`, so a
 * later search never brings them back.
 */
export async function removeDismissed(workspace: string, ids: string[]): Promise<JobSearchState> {
  const state = await readSearchState(workspace);
  const wanted = new Set(ids);
  const gone = state.items.filter((item) => wanted.has(item.id) && item.status === "dismissed");
  const keys = gone.flatMap((item) => [canonicalUrl(item.url), jobKey(item.company, item.title)].filter((key): key is string => Boolean(key)));
  return saveSearchState(workspace, { ...state, items: state.items.filter((item) => !gone.includes(item)), seen: [...state.seen, ...keys] });
}

/** A saved match whose job was sent for drafts from Jobs or the Saved tab moves to "Sent for drafts". */
export async function markSavedJobQueued(workspace: string, jobId: string, now = new Date()): Promise<void> {
  const ids = (await readSearchState(workspace)).items.filter((item) => item.jobId === jobId && item.status === "saved").map((item) => item.id);
  if (ids.length) await setItemStatus(workspace, ids, "queued", { queuedAt: now.toISOString(), autoQueued: false });
}

/** Saves a found job into Jobs (status Saved) with its posting, without running Agy. */
export async function saveFoundJob(workspace: string, itemId: string): Promise<string> {
  const state = await readSearchState(workspace);
  const item = state.items.find((candidate) => candidate.id === itemId);
  if (!item) throw new Error("That found job is gone.");
  if (item.jobId) return item.jobId;
  const posting = await postingFor(workspace, itemId);
  const base = suggestJobId(item.company, item.title) ?? item.id.replace(/^find-/, "job-");
  let jobId = base;
  for (let n = 2; await stat(path(workspace, `jobs/${jobId}`)).catch(() => null); n += 1) jobId = `${base}-${n}`;
  const folder = path(workspace, `jobs/${jobId}`);
  await mkdir(join(folder, ".sensei"), { recursive: true });
  await writeFile(join(folder, "original_jd.md"), posting, { flag: "wx" });
  await setItemStatus(workspace, [itemId], "saved", { jobId });
  return jobId;
}

/** Copies a found posting into the queue's saved postings under a paste ID; returns the queue label. */
export async function stageFoundJob(workspace: string, itemId: string, pasteId: string, auto = false, now = new Date()): Promise<string> {
  const state = await readSearchState(workspace);
  const item = state.items.find((candidate) => candidate.id === itemId);
  if (!item) throw new Error("That found job is gone.");
  const posting = await postingFor(workspace, itemId);
  await stageCleanedPosting(workspace, pasteId, posting, {
    url: item.url, fetchedAt: item.foundAt, title: item.title, company: item.company, location: item.location, suggestedJobId: suggestJobId(item.company, item.title),
  });
  await setItemStatus(workspace, [itemId], "queued", { queuedAt: now.toISOString(), autoQueued: auto });
  return [item.company, item.title].filter(Boolean).join(", ") || item.url;
}
