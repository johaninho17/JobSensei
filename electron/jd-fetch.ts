import { mkdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { writeJsonAtomic, writeTextAtomic } from "./persistence";
import { parseJobDescriptionMetadata } from "./job-description";

/** Fetched postings are staged here until the job is accepted and a job folder exists. */
export const FETCHED_JD_PATH = ".sensei/fetched_jd.md";
export const FETCHED_JD_META_PATH = ".sensei/fetched_jd.json";
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

function decodeEntities(text: string): string {
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
  const pageTitle = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "") || null;
  const title = posting?.title?.trim() || pageTitle;
  const company = (typeof posting?.hiringOrganization === "string" ? posting.hiringOrganization : posting?.hiringOrganization?.name)?.trim() || null;
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

export async function fetchJobDescription(workspacePath: string, url: string, fetcher: typeof fetch = fetch): Promise<FetchedJobDescription> {
  if (!/^https?:\/\//i.test(url)) throw new Error("Provide a full http(s) job posting URL.");
  const response = await fetcher(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15", Accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`The posting returned HTTP ${response.status}.`);
  const extracted = extractJobDescription(await response.text(), url);
  const bodyChars = extracted.markdown.replace(/^[\s\S]*?\*\*Source:\*\*[^\n]*\n/, "").trim().length;
  if (bodyChars < MIN_DESCRIPTION_CHARS) {
    throw new Error("Could not read a job description from this page (it may need JavaScript or block bots). Ask the user to paste the JD.");
  }
  const fetched: FetchedJobDescription = { ...extracted, fetchedAt: new Date().toISOString() };
  const workspace = resolve(workspacePath);
  await mkdir(join(workspace, ".sensei"), { recursive: true });
  await writeTextAtomic(join(workspace, FETCHED_JD_PATH), fetched.markdown);
  const { markdown: _markdown, ...meta } = fetched;
  await writeJsonAtomic(join(workspace, FETCHED_JD_META_PATH), meta);
  return fetched;
}

const MAX_PASTED_CHARS = 200_000;

/**
 * Stages a JD the user pasted in the app, in the same slot `jd:fetch` uses for a link, so Agy gets one
 * short prompt instead of the whole text typed into its input, and the pipeline runs unchanged.
 */
export async function stagePastedJobDescription(workspacePath: string, input: unknown, now = new Date()): Promise<Omit<FetchedJobDescription, "markdown">> {
  if (typeof input !== "string") throw new Error("The pasted job description must be text.");
  const text = input.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (text.length < MIN_DESCRIPTION_CHARS) throw new Error("That paste is too short to be a job description.");
  if (text.length > MAX_PASTED_CHARS) throw new Error("That paste is too long for a job description.");
  const metadata = parseJobDescriptionMetadata(text);
  const staged: FetchedJobDescription = {
    url: metadata.url ?? "pasted",
    fetchedAt: now.toISOString(),
    title: metadata.title,
    company: metadata.company,
    location: metadata.location,
    suggestedJobId: suggestJobId(metadata.company, metadata.title),
    markdown: `${text}\n`,
  };
  const workspace = resolve(workspacePath);
  await mkdir(join(workspace, ".sensei"), { recursive: true });
  await writeTextAtomic(join(workspace, FETCHED_JD_PATH), staged.markdown);
  const { markdown: _markdown, ...meta } = staged;
  await writeJsonAtomic(join(workspace, FETCHED_JD_META_PATH), meta);
  return meta;
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
    // A JD the user pasted in the app: print what the app staged, exactly like a fetch.
    const workspace = defaultWorkspace();
    Promise.all([readFile(join(workspace, FETCHED_JD_PATH), "utf8"), readFile(join(workspace, FETCHED_JD_META_PATH), "utf8").then((raw) => JSON.parse(raw) as Partial<FetchedJobDescription>)])
      .then(([markdown, meta]) => printStaged(markdown, meta))
      .catch(() => {
        process.stderr.write("No pasted job description is staged. Ask the user to paste the JD again.\n");
        process.exitCode = 2;
      });
  } else if (!url) {
    process.stderr.write("Usage: npm run jd:fetch -- <job-posting-url> | --staged\n");
    process.exitCode = 1;
  } else {
    fetchJobDescription(defaultWorkspace(), url)
      .then((fetched) => printStaged(fetched.markdown, fetched))
      .catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 2;
      });
  }
}
