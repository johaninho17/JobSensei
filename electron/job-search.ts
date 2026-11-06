import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import type { CandidateProfile } from "../src/shared/schemas";
import type { PostingRecord } from "../src/shared/posting";
import {
  DEFAULT_JOB_SEARCH_SETTINGS, EMPTY_JOB_SEARCH_STATE, SEARCH_BOARDS, SKIPPED_BOARDS,
  canonicalUrl, jobKey, jobSearchSettingsSchema, lightRatingPicks, jobSearchStateSchema, skippedSite,
  type InboxItem, type JobSearchSettings, type JobSearchState, type QuickFit, type SearchProgress, type SearchRun,
} from "../src/shared/job-search";
import { readActiveContextManifest } from "./context";
import { loadCanonicalResumeBaseline } from "./canonical-resume";
import { fetchAndClean, stageCleanedPosting, suggestJobId } from "./jd-fetch";
import { bestMatch, boardKey, boardRef, fitsSearchTitles, listBoardJobs, type BoardJob, type BoardRef } from "./job-boards";
import { assertInsideWorkspace } from "./files";
import { readJson, writeJsonAtomic, writeTextAtomic } from "./persistence";
import { buildPostingRecord } from "./posting-record";
import type { AgyRunner } from "./question-agent";

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
  required: ["jobs"],
  properties: {
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

export function buildSearchPrompt(settings: JobSearchSettings, recent: string[], today: Date = new Date()): string {
  const boards = SEARCH_BOARDS.filter((board) => !settings.boardsOff.includes(board.id));
  const list = (items: string[], empty: string) => items.length ? items.join("; ") : empty;
  return [
    `Find up to ${settings.resultsPerRun} current job postings, quickly (a few searches, no more than a few minutes) in the United States that match the search below. Use web search only: do not read or write any files, and run no commands.`,
    "",
    "Search:",
    `- Titles or role families: ${list(settings.titles, "use the include keywords")}`,
    `- Where: ${list(settings.locations, "anywhere in the United States")}; work setup: ${settings.workSetups.join(", ") || "any"}`,
    `- Level: ${list(settings.levels, "any")}${settings.payFloor ? `; base pay at least $${settings.payFloor.toLocaleString("en-US")} a year when the posting states pay` : ""}`,
    settings.needsSponsorship ? "- The candidate needs visa sponsorship: skip postings that say they don't sponsor." : "",
    `- Posted within the last ${settings.postedWithinDays} days (today is ${today.toISOString().slice(0, 10)}).`,
    settings.includeKeywords.length ? `- Should mention: ${settings.includeKeywords.join(", ")}` : "",
    settings.excludeKeywords.length ? `- Leave out postings about: ${settings.excludeKeywords.join(", ")}` : "",
    settings.skipCompanies.length ? `- Never these companies: ${settings.skipCompanies.join(", ")}` : "",
    "",
    "Where to look:",
    `- Search these boards first (site: searches work well): ${boards.map((board) => `${board.name} (${board.domain})`).join(", ")}${settings.extraSites.length ? `; also these sites: ${settings.extraSites.join(", ")}` : ""}.`,
    `- Never use or link to: ${[...SKIPPED_BOARDS.map((board) => board.domain), ...settings.skipSites].join(", ")}. If a job is only found there, find the same job on the company's own careers page or applicant system, or leave it out.`,
    "- Copy each link exactly as it appears in a search result. Never type, shorten, or assemble a link yourself; a made-up link is worse than none.",
    "- Prefer the company's own applicant-system link (Greenhouse, Lever, Ashby, Workable, SmartRecruiters, or its careers site) over aggregators.",
    recent.length ? `- Already seen, don't return again: ${recent.slice(-30).join("; ")}` : "",
    "",
    "Return only links to single job postings (never search pages, lists, or company home pages), each with its title, company, location, and posted date (YYYY-MM-DD) when the page shows one. Don't guess a field you can't see; leave it out. Don't rate or describe the jobs: the app opens every link and checks it.",
  ].filter((line) => line !== "").join("\n");
}

export type FoundLink = { url: string; title?: string; company?: string; location?: string; postedDate?: string };

export function parseSearchReply(response: string): FoundLink[] {
  const text = response.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  let value: unknown;
  try { value = JSON.parse(text); } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return [];
    try { value = JSON.parse(match[0]); } catch { return []; }
  }
  const jobs = Array.isArray((value as { jobs?: unknown })?.jobs) ? (value as { jobs: unknown[] }).jobs : [];
  const str = (input: unknown) => typeof input === "string" && input.trim() ? input.trim() : undefined;
  return jobs.flatMap((job) => {
    const record = job as Record<string, unknown>;
    const url = str(record?.url);
    if (!url || !/^https?:\/\//i.test(url)) return [];
    return [{ url, title: str(record.title), company: str(record.company), location: str(record.location), postedDate: str(record.postedDate) }];
  });
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

/** False for a known board's list or company page (not one posting); unknown sites are given the benefit of the doubt. */
export function singlePosting(url: string): boolean {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  const host = parsed.hostname.toLowerCase();
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (/lever\.co$/.test(host) || /ashbyhq\.com$/.test(host)) return parts.length >= 2 && !["apply", "application"].includes(parts[1]);
  if (/greenhouse\.io$/.test(host)) return parts.includes("jobs") && /^\d+$/.test(parts[parts.indexOf("jobs") + 1] ?? "") || parsed.searchParams.has("gh_jid");
  if (/workable\.com$/.test(host)) return parts.includes("j") || parts.includes("view");
  if (/smartrecruiters\.com$/.test(host)) return parts.length >= 2;
  return parsed.pathname.length > 1;
}

const BOARD_BY_HOST: Array<[RegExp, string]> = [[/greenhouse\.io$/, "greenhouse"], [/lever\.co$/, "lever"], [/ashbyhq\.com$/, "ashby"], [/workable\.com$/, "workable"], [/smartrecruiters\.com$/, "smartrecruiters"], [/myworkdayjobs\.com$/, "workday"], [/ycombinator\.com$/, "yc"], [/builtin\.com$/, "builtin"], [/wellfound\.com$/, "wellfound"]];
export function boardOf(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return BOARD_BY_HOST.find(([pattern]) => pattern.test(host))?.[1] ?? host;
  } catch { return null; }
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
  onUpdate?: (state: JobSearchState) => void;
  onProgress?: (progress: SearchProgress) => void;
  /** Set by the scheduled runner. */
  scheduled?: boolean;
};

const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;

const agyError = (message: string) => /print_timeout|DEADLINE_EXCEEDED/.test(message) ? "Agy took too long to search. Try fewer links per search or fewer titles."
  : /quota|RESOURCE_EXHAUSTED/i.test(message) ? "Agy's quota is used up for now. Try again later." : message.slice(0, 200);

export async function runSearch(deps: SearchDeps): Promise<{ state: JobSearchState; run: SearchRun }> {
  const now = deps.now ?? (() => new Date());
  const fetcher = deps.fetcher ?? fetch;
  const settings = await readSearchSettings(deps.workspace, deps.profile);
  let state = await readSearchState(deps.workspace);
  const run: SearchRun = { id: newId("run"), startedAt: now().toISOString(), finishedAt: null, status: "running", found: 0, added: 0, leftOut: {}, autoQueued: 0, replaced: 0, rated: 0, error: null, source: deps.runner ? "search" : "watched", scheduled: deps.scheduled === true };
  state = await saveSearchState(deps.workspace, { ...state, runs: [...state.runs, run] });
  deps.onUpdate?.(state);
  const finish = async (patch: Partial<SearchRun>) => {
    const done = { ...run, ...patch, finishedAt: now().toISOString() };
    state = await saveSearchState(deps.workspace, { ...state, runs: state.runs.map((candidate) => candidate.id === run.id ? done : candidate) });
    deps.onUpdate?.(state);
    return { state, run: done };
  };
  const leftOut: Record<string, number> = {};
  const skip = (reason: string) => { leftOut[reason] = (leftOut[reason] ?? 0) + 1; };

  // Board lists, read once per run: live postings with their dates, for watched companies and for checking links.
  const boards = new Map<string, Promise<BoardJob[] | null>>();
  const boardJobs = (ref: BoardRef) => {
    const key = boardKey(ref);
    if (!boards.has(key)) boards.set(key, listBoardJobs(ref, fetcher).catch(() => null));
    return boards.get(key)!;
  };

  // 1. Watched companies (free): their live postings whose titles fit the search.
  const links: Array<FoundLink & { watched?: boolean }> = [];
  for (const [index, company] of settings.watched.entries()) {
    deps.onProgress?.({ phase: "watched", checked: index, total: settings.watched.length });
    const jobs = await boardJobs(company);
    if (!jobs) { skip("watched board unreadable"); continue; }
    for (const job of jobs) {
      if (!fitsSearchTitles(job.title, settings.titles)) continue;
      links.push({ url: job.url, title: job.title, company: company.name || job.company || undefined, location: job.location ?? undefined, postedDate: job.postedAt ?? undefined, watched: true });
    }
  }

  // 2. Agy's search (one run).
  let agyFailure: string | null = null;
  if (deps.runner) {
    deps.onProgress?.({ phase: "agy", checked: 0, total: 0 });
    const recent = state.items.slice(-30).map((item) => [item.company, item.title].filter(Boolean).join(" — ")).filter(Boolean);
    try {
      links.push(...parseSearchReply((await deps.runner(buildSearchPrompt(settings, recent, now()), { conversationId: null })).response));
    } catch (error) {
      agyFailure = agyError(error instanceof Error ? error.message : String(error));
      if (!links.length) return finish({ status: "failed", error: agyFailure, leftOut });
    }
  }

  // 3. The app checks every link.
  // `seen` is kept between runs and only grows with jobs that were added or found closed, so a posting left out for
  // its age, its board, or a filter comes back once the user changes that setting. `checked` stops repeats within a run.
  const seen = new Set([...state.seen, ...deps.existingKeys]);
  const checked = new Set<string>();
  const sameUrl = (a: string, b: string) => canonicalUrl(a).toLowerCase() === b.toLowerCase();
  const vocab = await loadVocabulary(deps.workspace, deps.profile);
  const skipCompanies = settings.skipCompanies.map((name) => name.toLowerCase());
  let added = 0;
  let replaced = 0;
  for (const [index, link] of links.entries()) {
    deps.onProgress?.({ phase: "checking", checked: index, total: links.length });
    let url = canonicalUrl(await resolveLink(link.url, fetcher));
    if (seen.has(url) || checked.has(url)) { skip("already seen"); continue; }
    checked.add(url);
    if (skippedSite(url, settings)) { skip("skipped board"); continue; }
    if (!singlePosting(url)) { skip("not a single posting"); continue; }
    let postedDate = link.postedDate;
    // On Ashby, Greenhouse, and Lever the company's live list decides: a link not on it is swapped for the live
    // posting with the same title, or left out as closed.
    const ref = boardRef(url);
    const jobs = ref ? await boardJobs(ref) : null;
    if (jobs) {
      const live = jobs.find((job) => sameUrl(job.url, url));
      const swap = live ? null : link.title ? bestMatch(jobs, link.title) : null;
      if (!live && !swap) { seen.add(url); skip("posting closed"); continue; }
      if (swap) {
        url = canonicalUrl(swap.url);
        if (seen.has(url) || checked.has(url)) { skip("already seen"); continue; }
        checked.add(url);
        replaced += 1;
      }
      postedDate = (live ?? swap)!.postedAt ?? postedDate;
    }
    const age = postingAgeDays(postedDate, now());
    if (age !== null && age > settings.postedWithinDays) { skip("too old"); continue; }
    let markdown: string;
    let meta: { title: string | null; company: string | null; location: string | null };
    try {
      const { extracted } = await fetchAndClean(url, fetcher);
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
    const { company, title } = nameJob(link, meta.company ?? record.company ?? null, meta.title ?? record.title ?? null);
    const key = jobKey(company, title);
    if (key && (seen.has(key) || checked.has(key))) { skip("already seen"); continue; }
    if (key) checked.add(key);
    if (company && skipCompanies.includes(company.toLowerCase())) { skip("skipped company"); continue; }
    const text = `${title ?? ""} ${record.summary.join(" ")}`.toLowerCase();
    if (settings.excludeKeywords.some((word) => text.includes(word.toLowerCase()))) { skip("excluded keyword"); continue; }
    const item: InboxItem = {
      id: newId("find"),
      url,
      title,
      company,
      location: meta.location ?? record.location ?? link.location ?? null,
      board: boardOf(url),
      postedAt: age !== null && postedDate ? new Date(Date.parse(postedDate)).toISOString().slice(0, 10) : null,
      foundAt: now().toISOString(),
      runId: run.id,
      status: "new",
      pay: record.pay?.text ?? null,
      workSetup: record.workSetup?.text ?? record.workSetup?.mode ?? null,
      level: record.seniority,
      fit: quickFit(record, vocab, settings),
      jobId: null,
      queuedAt: null,
      autoQueued: false,
      watched: link.watched === true,
      agyFit: null,
    };
    await writeTextAtomic(path(deps.workspace, `${POSTINGS_DIR}/${item.id}.md`), markdown);
    seen.add(url);
    if (key) seen.add(key);
    added += 1;
    state = await saveSearchState(deps.workspace, { ...state, items: [...state.items, item], seen: [...seen] });
    deps.onUpdate?.(state);
  }
  deps.onProgress?.({ phase: "checking", checked: links.length, total: links.length });
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
  return finish({ status: "done", found: links.length, added, replaced, rated, leftOut, error: agyFailure });
}

// ---------- One search at a time (the app and the scheduled runner share this lock) ----------

const LOCK_FILE = `${JOB_SEARCH_DIR}/run.lock`;
const LOCK_STALE_MS = 30 * 60_000;

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
    "",
    "Candidate:",
    card,
    "",
    ...jobs.flatMap((job) => [
      `Job ${job.id}: ${job.title ?? "Untitled"} at ${job.company ?? "an unnamed company"}${job.level ? ` (${job.level})` : ""}`,
      ...(job.requirements.length ? job.requirements.map((text) => `- ${clip(plain(text), 180)}`) : ["- (the posting lists no requirements)"]),
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
