import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { writeJsonAtomic, writeTextAtomic } from "./persistence";
import { parseJobDescriptionMetadata } from "./job-description";
import { cleanPosting, postingUrl, splitPageTitle } from "./posting-clean";

/** Fetched postings are staged here until the job is accepted and a job folder exists. */
export const FETCHED_JD_PATH = ".sensei/fetched_jd.md";
export const FETCHED_JD_META_PATH = ".sensei/fetched_jd.json";
/** The application form split off the staged posting (its questions feed the Questions tab, never the evaluation). */
export const FETCHED_FORM_PATH = ".sensei/fetched_form.md";
const MIN_DESCRIPTION_CHARS = 400;

export interface FetchedJobDescription {
  url: string;
  fetchedAt: string;
  title: string | null;
  company: string | null;
  location: string | null;
  suggestedJobId: string | null;
  markdown: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…", bull: "•" };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) return String.fromCodePoint(parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(parseInt(entity.slice(1), 10));
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** Converts posting HTML into readable Markdown-ish text. */
export function htmlToText(html: string): string {
  return decodeEntities(html
    .replace(/<(script|style|noscript|svg|head|template|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<h[1-3][^>]*>/gi, "\n\n## ")
    .replace(/<h[4-6][^>]*>/gi, "\n\n### ")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|ul|ol|li|tr)>/gi, "\n")
    .replace(/<(strong|b)>\s*/gi, "**").replace(/\s*<\/(strong|b)>/gi, "**")
    .replace(/<[^>]+>/g, " "))
    // Some boards (Lever) put escaped line breaks in the text itself; they showed up as "\n" in the JD.
    .replace(/(?:\\r)?\\n/g, "\n")
    .replace(/\*\*\s*\*\*/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n\n- /g, "\n- ")
    .trim();
}

interface JobPostingLd {
  title?: string;
  description?: string;
  hiringOrganization?: { name?: string } | string;
  jobLocation?: unknown;
}

function findJobPosting(value: unknown): JobPostingLd | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJobPosting(item);
      if (found) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  const type = record["@type"];
  if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) return record as JobPostingLd;
  return findJobPosting(record["@graph"]);
}

function locationText(value: unknown): string | null {
  const entries = Array.isArray(value) ? value : value ? [value] : [];
  const parts = entries.map((entry) => {
    const address = (entry as { address?: Record<string, unknown> })?.address;
    if (!address || typeof address !== "object") return null;
    return [address.addressLocality, address.addressRegion, address.addressCountry]
      .map((part) => (typeof part === "object" && part ? (part as { name?: string }).name : part))
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .join(", ");
  }).filter((part): part is string => Boolean(part));
  return parts.length ? [...new Set(parts)].join(" / ") : null;
}

function slug(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function suggestJobId(company: string | null, title: string | null): string | null {
  const companyName = company?.replace(/[,\s]+(inc|llc|ltd|limited|corp|corporation|gmbh|plc|co)\.?$/i, "") ?? null;
  const id = slug([companyName, title].filter(Boolean).join(" ")).slice(0, 80).replace(/-+$/, "");
  return id || null;
}

/** Extracts a readable job description from a posting page. Prefers embedded JobPosting data. */
export function extractJobDescription(html: string, url: string): Omit<FetchedJobDescription, "fetchedAt"> {
  let posting: JobPostingLd | null = null;
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      posting = findJobPosting(JSON.parse(match[1]!.trim()));
    } catch {
      posting = null;
    }
    if (posting) break;
  }
  const rawPageTitle = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "") || null;
  const pageTitle = rawPageTitle ? splitPageTitle(rawPageTitle) : null;
  const title = posting?.title?.trim() || pageTitle?.title || null;
  const company = (typeof posting?.hiringOrganization === "string" ? posting.hiringOrganization : posting?.hiringOrganization?.name)?.trim() || pageTitle?.company || null;
  const location = locationText(posting?.jobLocation);
  const body = posting?.description ? htmlToText(decodeEntities(posting.description)) : htmlToText(html);
  const header = [
    `# ${title ?? "Job Description"}`,
    "",
    ...(company ? [`**Company:** ${company}  `] : []),
    ...(location ? [`**Location:** ${location}  `] : []),
    `**Source:** ${url}`,
    "",
  ];
  return { url, title, company, location, suggestedJobId: suggestJobId(company, title), markdown: `${header.join("\n")}\n${body}\n` };
}

type Extracted = Omit<FetchedJobDescription, "fetchedAt">;

/** A fetched page through the shared cleanup: the form is split off, invisible characters and buttons removed. */
function cleanExtracted(extracted: Extracted): { extracted: Extracted; form: string | null } {
  const { markdown, form } = cleanPosting(extracted.markdown, { title: extracted.title, company: extracted.company, location: extracted.location, source: extracted.url });
  return { extracted: { ...extracted, markdown }, form };
}

/** Fetches a posting link (apply-page links are turned into the posting first) and cleans it. */
export async function fetchAndClean(url: string, fetcher: typeof fetch): Promise<{ extracted: Extracted; form: string | null }> {
  const target = postingUrl(url);
  return cleanExtracted(await fetchOracleCloudPosting(target, fetcher) ?? extractJobDescription(await fetchPage(target, fetcher), target));
}

const ORACLE_CX = /^https:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)*\.oraclecloud\.com)\/hcmUI\/CandidateExperience\/[a-z-]+\/sites\/([A-Za-z0-9_]+)\/(?:job|requisitions\/preview)\/(\d+)/i;

/**
 * Oracle Cloud career sites render with JavaScript, so their pages have no readable text. The
 * same posting is public as JSON from the site's own job API.
 */
async function fetchOracleCloudPosting(url: string, fetcher: typeof fetch): Promise<Omit<FetchedJobDescription, "fetchedAt"> | null> {
  const match = ORACLE_CX.exec(url);
  if (!match) return null;
  const [, host, site, id] = match;
  const api = new URL(`https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails`);
  api.searchParams.set("expand", "all");
  api.searchParams.set("onlyData", "true");
  api.searchParams.set("finder", `ById;Id="${id}",siteNumber=${site}`);
  const response = await fetcher(api.toString(), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`The posting returned HTTP ${response.status}.`);
  const item = ((await response.json()) as { items?: Array<Record<string, unknown>> }).items?.[0];
  if (!item) return null;
  const text = (key: string) => typeof item[key] === "string" ? item[key] as string : "";
  const title = text("Title").trim() || null;
  const location = text("PrimaryLocation").trim() || null;
  const body = ["ExternalDescriptionStr", "ExternalResponsibilitiesStr", "ExternalQualificationsStr"]
    .map((key) => htmlToText(decodeEntities(text(key))).trim())
    .filter(Boolean)
    .join("\n\n");
  const header = [`# ${title ?? "Job Description"}`, "", ...(location ? [`**Location:** ${location}  `] : []), `**Source:** ${url}`, ""];
  return { url, title, company: null, location, suggestedJobId: suggestJobId(null, title), markdown: `${header.join("\n")}\n${body}\n` };
}

export async function fetchJobDescription(workspacePath: string, url: string, fetcher: typeof fetch = fetch): Promise<FetchedJobDescription> {
  if (!/^https?:\/\//i.test(url)) throw new Error("Provide a full http(s) job posting URL.");
  const { extracted, form } = await fetchAndClean(url, fetcher);
  return stageFetched(workspacePath, extracted, form);
}

/** One page or API response as text, with the same browser headers and timeout as posting fetches. */
export async function fetchText(url: string, fetcher: typeof fetch = fetch, init: RequestInit = {}): Promise<string> {
  const response = await fetcher(url, {
    ...init,
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15", Accept: "text/html,application/xhtml+xml,application/json", ...(init.headers as Record<string, string> | undefined) },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`The page returned HTTP ${response.status}.`);
  return response.text();
}

async function fetchPage(url: string, fetcher: typeof fetch): Promise<string> {
  const response = await fetcher(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15", Accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`The posting returned HTTP ${response.status}.`);
  return response.text();
}

async function stageFetched(workspacePath: string, extracted: Omit<FetchedJobDescription, "fetchedAt">, form: string | null = null): Promise<FetchedJobDescription> {
  const bodyChars = extracted.markdown.replace(/^[\s\S]*?\*\*Source:\*\*[^\n]*\n/, "").trim().length;
  if (bodyChars < MIN_DESCRIPTION_CHARS) {
    throw new Error("Could not read a job description from this page (it may need JavaScript or block bots).\nStop here: ask the user to paste the job description in the app. Do not look for the posting another way.");
  }
  const fetched: FetchedJobDescription = { ...extracted, fetchedAt: new Date().toISOString() };
  const workspace = resolve(workspacePath);
  await mkdir(join(workspace, ".sensei"), { recursive: true });
  await writeTextAtomic(join(workspace, FETCHED_JD_PATH), fetched.markdown);
  const { markdown: _markdown, ...meta } = fetched;
  await writeJsonAtomic(join(workspace, FETCHED_JD_META_PATH), meta);
  await writeForm(join(workspace, FETCHED_FORM_PATH), form);
  return fetched;
}

/** Writes the split-off form next to its posting, or removes a stale one. */
async function writeForm(path: string, form: string | null): Promise<void> {
  if (form) await writeTextAtomic(path, `${form}\n`);
  else await rm(path, { force: true });
}

const MAX_PASTED_CHARS = 200_000;

export const STAGED_JDS_DIR = ".sensei/staged-jds";
const STAGED_ID = /^paste-[a-z0-9-]{4,40}$/;

function stagedPaths(workspacePath: string, id: string): { markdown: string; meta: string; form: string } {
  if (!STAGED_ID.test(id)) throw new Error("That is not a valid paste ID.");
  const dir = join(resolve(workspacePath), STAGED_JDS_DIR);
  return { markdown: join(dir, `${id}.md`), meta: join(dir, `${id}.json`), form: join(dir, `${id}.form.md`) };
}

/**
 * Saves a JD the user pasted in the app under its own paste ID (one file per paste), so a later
 * paste can never replace one that is waiting or running. Agy loads it with `jd:fetch --staged <id>`.
 */
export async function stagePastedJobDescription(workspacePath: string, input: unknown, id: string, now = new Date()): Promise<Omit<FetchedJobDescription, "markdown">> {
  if (typeof input !== "string") throw new Error("The pasted job description must be text.");
  const text = input.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (text.length < MIN_DESCRIPTION_CHARS) throw new Error("That paste is too short to be a job description.");
  if (text.length > MAX_PASTED_CHARS) throw new Error("That paste is too long for a job description.");
  const metadata = parseJobDescriptionMetadata(text);
  const meta = {
    url: metadata.url ?? "pasted",
    fetchedAt: now.toISOString(),
    title: metadata.title,
    company: metadata.company,
    location: metadata.location,
    suggestedJobId: suggestJobId(metadata.company, metadata.title),
  };
  const { markdown, form } = cleanPosting(text, { title: meta.title, company: meta.company, location: meta.location, source: meta.url });
  if (markdown.replace(/^[\s\S]*?\*\*Source:\*\*[^\n]*\n/, "").trim().length < MIN_DESCRIPTION_CHARS / 2) throw new Error("That paste looks like an application form, not a job description. Paste the job description too.");
  const paths = stagedPaths(workspacePath, id);
  await mkdir(join(paths.markdown, ".."), { recursive: true });
  await writeTextAtomic(paths.markdown, markdown);
  await writeJsonAtomic(paths.meta, meta);
  await writeForm(paths.form, form);
  return meta;
}

/** The company the user named for a paste that names none: saved in its header, metadata, and suggested job ID. */
export async function setStagedCompany(workspacePath: string, id: string, company: string): Promise<Omit<FetchedJobDescription, "markdown">> {
  const name = company.replace(/\s+/g, " ").trim().slice(0, 120);
  if (!name) throw new Error("Enter the company name.");
  const paths = stagedPaths(workspacePath, id);
  const [markdown, meta] = await Promise.all([readFile(paths.markdown, "utf8"), readFile(paths.meta, "utf8").then((raw) => JSON.parse(raw) as Omit<FetchedJobDescription, "markdown">)]);
  const line = `**Company:** ${name}  `;
  const updated = /^\*\*Company:\*\*.*$/m.test(markdown) ? markdown.replace(/^\*\*Company:\*\*.*$/m, line) : markdown.replace(/^(#\s[^\n]*\n\n?)/, `$1${line}\n`);
  const next = { ...meta, company: name, suggestedJobId: suggestJobId(name, meta.title) };
  await writeTextAtomic(paths.markdown, updated);
  await writeJsonAtomic(paths.meta, next);
  return next;
}

/**
 * Fetches a posting in the app (which has network; Agy's sandbox does not) and saves it under a paste ID, so the
 * queue hands Agy a saved posting it loads with `jd:fetch --staged <id>`, the same as a paste. Throws a plain
 * message when the page can't be read, so the user is asked for a paste right away.
 */
export async function stageLinkJobDescription(workspacePath: string, url: string, id: string, fetcher: typeof fetch = fetch, now = new Date()): Promise<Omit<FetchedJobDescription, "markdown">> {
  if (!/^https?:\/\//i.test(url)) throw new Error("Provide a full http(s) job posting URL.");
  let extracted: Omit<FetchedJobDescription, "fetchedAt">;
  let form: string | null;
  try {
    ({ extracted, form } = await fetchAndClean(url, fetcher));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Couldn't open this posting (${message.replace(/\n[\s\S]*/, "")}). Paste the job description instead.`);
  }
  const bodyChars = extracted.markdown.replace(/^[\s\S]*?\*\*Source:\*\*[^\n]*\n/, "").trim().length;
  if (bodyChars < MIN_DESCRIPTION_CHARS) throw new Error("Couldn't read a job description from this page (it may need JavaScript or block bots). Paste the job description instead.");
  const { markdown, ...rest } = extracted;
  const meta = { ...rest, fetchedAt: now.toISOString() };
  const paths = stagedPaths(workspacePath, id);
  await mkdir(join(paths.markdown, ".."), { recursive: true });
  await writeTextAtomic(paths.markdown, markdown);
  await writeJsonAtomic(paths.meta, meta);
  await writeForm(paths.form, form);
  return meta;
}

/** Saves an already fetched and cleaned posting under a paste ID, so the queue loads it like any other. */
export async function stageCleanedPosting(workspacePath: string, id: string, markdown: string, meta: Omit<FetchedJobDescription, "markdown">): Promise<void> {
  const paths = stagedPaths(workspacePath, id);
  await mkdir(join(paths.markdown, ".."), { recursive: true });
  await writeTextAtomic(paths.markdown, markdown);
  await writeJsonAtomic(paths.meta, meta);
}

/** Network errors (no route out of a sandbox, DNS, reset), as opposed to a page that couldn't be read. */
export function isNetworkError(message: string): boolean {
  return /\bfetch failed\b|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPERM|UND_ERR|network/i.test(message);
}

/** Copies one paste into the slot the snapshot reads (`--from-fetched`), at the moment Agy starts it. */
export async function loadStagedJobDescription(workspacePath: string, id: string): Promise<{ markdown: string; meta: Partial<FetchedJobDescription> }> {
  const paths = stagedPaths(workspacePath, id);
  const [markdown, meta] = await Promise.all([
    readFile(paths.markdown, "utf8"),
    readFile(paths.meta, "utf8").then((raw) => JSON.parse(raw) as Partial<FetchedJobDescription>),
  ]).catch(() => { throw new Error(`No pasted job description is saved as ${id}. Ask the user to paste the JD again.`); });
  const workspace = resolve(workspacePath);
  await writeTextAtomic(join(workspace, FETCHED_JD_PATH), markdown);
  await writeJsonAtomic(join(workspace, FETCHED_JD_META_PATH), meta);
  await writeForm(join(workspace, FETCHED_FORM_PATH), await readFile(paths.form, "utf8").catch(() => null));
  return { markdown, meta };
}

/**
 * Removes saved pastes no queue item refers to. Pastes younger than `minAgeMs` stay: the app saves a
 * paste just before it adds its queue item, and a queue save in between must not delete it.
 */
export async function pruneStagedJobDescriptions(workspacePath: string, keepIds: string[], minAgeMs = 60 * 60_000, now = Date.now()): Promise<void> {
  const dir = join(resolve(workspacePath), STAGED_JDS_DIR);
  const keep = new Set(keepIds);
  const names = await readdir(dir).catch(() => [] as string[]);
  await Promise.all(names
    .filter((name) => !keep.has(name.replace(/\.(?:form\.md|md|json)$/, "")))
    .map(async (name) => {
      const path = join(dir, name);
      const modified = await stat(path).then((info) => info.mtimeMs, () => now);
      if (now - modified >= minAgeMs) await rm(path, { force: true });
    }));
}

function printStaged(markdown: string, meta: Partial<FetchedJobDescription>): void {
  process.stdout.write(`${markdown}\n---\n${JSON.stringify({ company: meta.company ?? null, title: meta.title ?? null, location: meta.location ?? null, suggestedJobId: meta.suggestedJobId ?? null, stagedAt: FETCHED_JD_PATH }, null, 2)}\n`);
}

export async function readFetchedJobDescription(workspacePath: string): Promise<{ markdown: string; fetchedAt: string | null } | null> {
  const workspace = resolve(workspacePath);
  const markdown = await readFile(join(workspace, FETCHED_JD_PATH), "utf8").catch(() => null);
  if (!markdown) return null;
  const meta = await readFile(join(workspace, FETCHED_JD_META_PATH), "utf8").then((value) => JSON.parse(value) as { fetchedAt?: string }).catch(() => null);
  return { markdown, fetchedAt: meta?.fetchedAt ?? null };
}

function defaultWorkspace(): string {
  const configured = process.env.SENSEI_WORKSPACE;
  if (configured) return resolve(configured);
  return basename(process.cwd()) === "data" ? process.cwd() : resolve(process.cwd(), "data");
}

if (require.main === module) {
  const url = process.argv[2];
  if (url === "--staged") {
    // A JD the user pasted in the app: load that paste into the snapshot slot and print it like a fetch.
    loadStagedJobDescription(defaultWorkspace(), process.argv[3] ?? "")
      .then(({ markdown, meta }) => printStaged(markdown, meta))
      .catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\nStop here: ask the user to paste the job description again.\n`);
        process.exitCode = 2;
      });
  } else if (!url) {
    process.stderr.write("Usage: npm run jd:fetch -- <job-posting-url> | --staged <paste-id>\n");
    process.exitCode = 1;
  } else {
    fetchJobDescription(defaultWorkspace(), url)
      .then((fetched) => printStaged(fetched.markdown, fetched))
      .catch((error: unknown) => {
        // No network (Agy's sandbox has none): the same command works outside the sandbox. A page that can't be
        // read (blocked, HTTP error, JavaScript-only) ends the run with a request for a paste.
        const message = error instanceof Error ? error.message : String(error);
        if (isNetworkError(message) && !message.includes("Stop here")) {
          process.stderr.write(`${message}\nNo network here: run this exact command again with BypassSandbox set to true. Do not look for the posting another way.\n`);
        } else {
          process.stderr.write(`${message}${message.includes("Stop here") ? "" : "\nStop here: ask the user to paste the job description in the app. Do not look for the posting another way."}\n`);
        }
        process.exitCode = 2;
      });
  }
}
