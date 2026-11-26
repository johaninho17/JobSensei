import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { MIN_PASTED_POSTING_CHARS } from "../src/shared/paste-limits";
import { normalCompany } from "../src/shared/posting-fields";
import { postingTemplate } from "./posting-template";
import { formatPay } from "../src/shared/pay";
import { basename, join, resolve } from "node:path";
import { writeJsonAtomic, writeTextAtomic } from "./persistence";
import { parseJobDescriptionMetadata } from "./job-description";
import { cleanPosting, postingUrl, splitPageTitle } from "./posting-clean";
import { appFetch } from "./app-fetch";

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

/**
 * The page without its site chrome: menus, header, footer, side panels, and cookie banners removed, and the page's
 * `<main>` or `<article>` when it holds most of the text.
 */
export function mainContent(html: string): string {
  const stripped = html
    .replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(div|section)\b[^>]*(?:id|class)=["'][^"']*\b(?:cookie|consent|onetrust|gdpr)[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi, " ");
  const textLength = (value: string) => htmlToText(value).length;
  const total = textLength(stripped);
  for (const tag of ["main", "article"]) {
    const inner = stripped.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*)<\\/${tag}>`, "i"))?.[1];
    if (inner && textLength(inner) >= total * 0.6) return inner;
  }
  return stripped;
}

interface JobPostingLd {
  title?: string;
  description?: string;
  hiringOrganization?: { name?: string } | string;
  jobLocation?: unknown;
  datePosted?: string;
  baseSalary?: { currency?: string; value?: { minValue?: number; maxValue?: number; value?: number; unitText?: string } | number };
}

/** Pay from the posting's structured data, else Ashby's embedded compensation summary (shown beside the text, not in it). */
export function pagePay(posting: JobPostingLd | null, html: string): string | null {
  const salary = posting?.baseSalary;
  if (salary) {
    const value = typeof salary.value === "number" ? { value: salary.value } : salary.value ?? {};
    const min = typeof value.minValue === "number" ? value.minValue : typeof value.value === "number" ? value.value : null;
    const max = typeof value.maxValue === "number" && value.maxValue !== min ? value.maxValue : null;
    const text = formatPay(min, max, salary.currency ?? "USD", value.unitText ?? null);
    if (text) return text;
  }
  const embedded = html.match(/"(?:scrapeableCompensationSalarySummary|compensationTierSummary)"\s*:\s*"([^"]*\d[^"]*)"/);
  return embedded ? embedded[1]!.replace(/\\u([0-9a-f]{4})/gi, (_match, code: string) => String.fromCharCode(parseInt(code, 16))).trim() : null;
}

/** When the posting went up (YYYY-MM-DD): the structured data's datePosted, else Ashby's embedded app data, which carries
 * the date when the board API and the page text leave it out (#116). */
export function pagePosted(posting: JobPostingLd | null, html: string): string | null {
  const day = (value: string | undefined | null) => value?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
  return day(posting?.datePosted) ?? day(html.match(/"(?:publishedDate|publishedAt|datePublished)"\s*:\s*"(\d{4}-\d{2}-\d{2}[^"]*)"/)?.[1]);
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
  let pageTitle = rawPageTitle ? splitPageTitle(rawPageTitle) : null;
  // "Role - Company" / "Role | Company Careers": the last part is the company when the page text names it too.
  if (pageTitle && !pageTitle.company) {
    const parts = pageTitle.title.split(/\s+(?:\||–|—|-|@| at )\s+/);
    const last = normalCompany(parts.at(-1));
    const text = htmlToText(html).toLowerCase();
    if (parts.length > 1 && last && last.split(/\s+/).length <= 4 && text.split(last.toLowerCase()).length > 1) {
      pageTitle = { title: parts.slice(0, -1).join(" - "), company: last };
    }
  }
  const title = (posting?.title ? decodeEntities(posting.title).trim() : "") || pageTitle?.title || null;
  const organization = typeof posting?.hiringOrganization === "string" ? posting.hiringOrganization : posting?.hiringOrganization?.name;
  const company = (organization ? decodeEntities(organization).trim() : "") || pageTitle?.company || null;
  const location = locationText(posting?.jobLocation);
  const pay = pagePay(posting, html);
  const posted = pagePosted(posting, html);
  const body = posting?.description ? htmlToText(decodeEntities(posting.description)) : htmlToText(mainContent(html));
  const header = [
    `# ${title ?? "Job Description"}`,
    "",
    ...(company ? [`**Company:** ${company}  `] : []),
    ...(location ? [`**Location:** ${location}  `] : []),
    ...(pay ? [`**Compensation:** ${pay}  `] : []),
    ...(posted ? [`**Posted:** ${posted}  `] : []),
    `**Source:** ${url}`,
    "",
  ];
  return { url, title, company, location, suggestedJobId: suggestJobId(company, title), markdown: `${header.join("\n")}\n${body}\n` };
}

type Extracted = Omit<FetchedJobDescription, "fetchedAt">;

/**
 * A posting built from a job board's own data (Ashby/Lever lists, Greenhouse's per-job API) instead of loading its
 * page: the same header, text conversion, and cleanup as a fetched page, so everything downstream reads it the same.
 */
export function postingFromBoard(input: { url: string; title: string; company: string | null; location: string | null; html: string; pay?: string | null; posted?: string | null }): { extracted: Extracted; form: string | null } {
  const header = [
    `# ${input.title}`,
    "",
    ...(input.company ? [`**Company:** ${input.company}  `] : []),
    ...(input.location ? [`**Location:** ${input.location}  `] : []),
    ...(input.pay ? [`**Compensation:** ${input.pay}  `] : []),
    ...(input.posted?.match(/^\d{4}-\d{2}-\d{2}/) ? [`**Posted:** ${input.posted.slice(0, 10)}  `] : []),
    `**Source:** ${input.url}`,
    "",
  ];
  const body = htmlToText(decodeEntities(input.html));
  return cleanExtracted({ url: input.url, title: input.title, company: input.company, location: input.location, suggestedJobId: suggestJobId(input.company, input.title), markdown: `${header.join("\n")}\n${body}\n` });
}

/** A fetched page through the shared cleanup: the form is split off, invisible characters and buttons removed. */
function cleanExtracted(extracted: Extracted): { extracted: Extracted; form: string | null } {
  const { markdown, form } = cleanPosting(extracted.markdown, { title: extracted.title, company: extracted.company, location: extracted.location, source: extracted.url });
  return { extracted: { ...extracted, markdown: postingTemplate(markdown, { url: extracted.url }) }, form };
}

/**
 * Loads a page in a real browser and returns its HTML after scripts ran (Workday, SmartRecruiters, iCIMS, and company
 * career sites that build the posting with JavaScript). Set by the app at start (electron/page-render.ts); command-line
 * runs and tests have none and read the plain page only.
 */
type PageRenderer = (url: string) => Promise<string | null>;
let pageRenderer: PageRenderer | null = null;
export function setPageRenderer(renderer: PageRenderer | null): void { pageRenderer = renderer; }

const bodyLength = (extracted: Extracted) => extracted.markdown.replace(/^[\s\S]*?\*\*Source:\*\*[^\n]*\n/, "").trim().length;

/**
 * A company career page that embeds a job board's posting (Greenhouse `gh_jid` pages, Lever or Ashby frames): the
 * board's own posting link, which reads cleanly.
 */
export function embeddedPostingUrl(html: string, pageUrl: string): string | null {
  const embed = html.match(/(?:boards|job-boards)\.greenhouse\.io\/embed\/job_(?:app|board)[^"'\s>]*/i)?.[0].replaceAll("&amp;", "&") ?? "";
  const ghFor = embed.match(/[?&]for=([A-Za-z0-9_-]+)/)?.[1];
  const token = embed.match(/[?&]token=(\d+)/)?.[1] ?? new URL(pageUrl).searchParams.get("gh_jid");
  if (ghFor && token) return `https://job-boards.greenhouse.io/${ghFor}/jobs/${token}`;
  // Ashby's embed: `?ashby_jid=<posting id>` on the company page and the board's embed script names the slug.
  const ashbyJid = new URL(pageUrl).searchParams.get("ashby_jid");
  const ashbySlug = html.match(/jobs\.ashbyhq\.com\/([A-Za-z0-9_.%-]+)\/embed/i)?.[1];
  if (ashbyJid && ashbySlug && /^[0-9a-f-]{36}$/i.test(ashbyJid)) return `https://jobs.ashbyhq.com/${ashbySlug}/${ashbyJid}`;
  // A plain board link for the same job id (`gh_jid` pages that link `boards.greenhouse.io/<slug>`).
  const ghSlug = token ? html.match(/(?:boards|job-boards)\.greenhouse\.io\/(?!embed\b)([A-Za-z0-9_-]+)/i)?.[1] : null;
  if (token && ghSlug) return `https://job-boards.greenhouse.io/${ghSlug}/jobs/${token}`;
  const oracle = new Set(html.match(/https:\/\/[a-z0-9.-]+\.oraclecloud\.com\/hcmUI\/CandidateExperience\/[a-z-]+\/sites\/[A-Za-z0-9_]+\/(?:job|requisitions\/preview)\/\d+/gi) ?? []);
  if (oracle.size === 1) return [...oracle][0]!;
  const direct = html.match(/https:\/\/(?:jobs\.lever\.co\/[A-Za-z0-9_.-]+\/[0-9a-f-]{36}|jobs\.ashbyhq\.com\/[A-Za-z0-9_.%-]+\/[0-9a-f-]{36}|(?:boards|job-boards)\.greenhouse\.io\/[A-Za-z0-9_-]+\/jobs\/\d+)/i)?.[0];
  return direct && singlePostingOnPage(html, direct) ? direct : null;
}

/** A page that links one posting many times (its apply button or frame), not a list of many postings. */
function singlePostingOnPage(html: string, link: string): boolean {
  const all = new Set(html.match(/https:\/\/(?:jobs\.lever\.co|jobs\.ashbyhq\.com|(?:boards|job-boards)\.greenhouse\.io)\/[^"'\s<>?#]+/gi) ?? []);
  return all.size === 1 || [...all].every((other) => other.startsWith(link));
}

/** The page's posting, from the plain page or (when that has too little text) the rendered one. */
async function readPage(target: string, fetcher: typeof fetch, render: boolean, depth = 0): Promise<Extracted> {
  const renderer = render ? pageRenderer : null;
  let html: string | null = null;
  let failure: unknown = null;
  try { html = await fetchPage(target, fetcher); } catch (error) { failure = error; }
  const tryEmbedded = async (page: string): Promise<Extracted | null> => {
    const embedded = depth === 0 ? embeddedPostingUrl(page, target) : null;
    if (!embedded || embedded === target) return null;
    const fromApi = await postingFromApi(postingUrl(embedded), fetcher, target).catch(() => null);
    if (fromApi && bodyLength(fromApi) >= MIN_DESCRIPTION_CHARS) return fromApi;
    const inner = await readPage(postingUrl(embedded), fetcher, render, depth + 1).catch(() => null);
    return inner && bodyLength(inner) >= MIN_DESCRIPTION_CHARS ? { ...inner, url: target } : null;
  };
  if (html) {
    const fromEmbed = await tryEmbedded(html);
    if (fromEmbed) return fromEmbed;
    const extracted = extractJobDescription(html, target);
    if (bodyLength(extracted) >= MIN_DESCRIPTION_CHARS || !renderer) return extracted;
  }
  const rendered = renderer ? await renderer(target).catch(() => null) : null;
  if (rendered) {
    const fromEmbed = await tryEmbedded(rendered);
    if (fromEmbed) return fromEmbed;
    return extractJobDescription(rendered, target);
  }
  if (html) return extractJobDescription(html, target);
  throw failure instanceof Error ? failure : new Error(String(failure));
}

/**
 * Fetches a posting link (apply-page links are turned into the posting first) and cleans it. `render: false` skips
 * the browser fallback (Job Search checks many links and only keeps board postings, which read without it).
 */
export async function fetchAndClean(url: string, fetcher: typeof fetch, options: { render?: boolean } = {}): Promise<{ extracted: Extracted; form: string | null }> {
  const target = postingUrl(url);
  const fromApi = await postingFromApi(target, fetcher);
  return fromApi ? cleanExtracted(fromApi) : cleanExtracted(await readPage(target, fetcher, options.render ?? true));
}

/** Postings a job board serves as JSON (Greenhouse, Workday, Oracle Cloud), shown with `source` as their link. */
async function postingFromApi(url: string, fetcher: typeof fetch, source = url): Promise<Omit<FetchedJobDescription, "fetchedAt"> | null> {
  return await fetchGreenhouseJob(url, fetcher, source) ?? await fetchWorkdayPosting(url, fetcher) ?? await fetchOracleCloudPosting(url, fetcher)
    ?? await fetchSmartRecruitersPosting(url, fetcher) ?? await fetchWorkablePosting(url, fetcher) ?? await fetchRecruiteePosting(url, fetcher);
}

async function getJson<T>(url: string, fetcher: typeof fetch): Promise<T | null> {
  const response = await fetcher(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!response?.ok) return null;
  return await response.json().catch(() => null) as T | null;
}

/** "SANTA CLARA, CALIFORNIA" → "Santa Clara, California"; mixed-case text stays as written. */
const tidyCase = (value: string) => value.replace(/\b[A-Z]{3,}\b/g, (word) => word[0] + word.slice(1).toLowerCase());
const factLines = (facts: Array<[string, string | null | undefined]>) => facts.filter(([, value]) => value).map(([label, value]) => `<p>${label}: ${value}</p>`).join("");
const setupOf = (remote?: boolean | null, hybrid?: boolean | null) => remote ? "Remote" : hybrid ? "Hybrid" : null;

const SMARTRECRUITERS = /^https:\/\/(?:jobs|careers)\.smartrecruiters\.com\/([A-Za-z0-9_-]+)\/(\d{6,})/i;

/** SmartRecruiters postings from its public posting API (sections, location, type, posted date, reference). */
async function fetchSmartRecruitersPosting(url: string, fetcher: typeof fetch): Promise<Omit<FetchedJobDescription, "fetchedAt"> | null> {
  const match = SMARTRECRUITERS.exec(url);
  if (!match) return null;
  type Data = { name?: string; refNumber?: string; releasedDate?: string; company?: { name?: string }; typeOfEmployment?: { label?: string };
    location?: { fullLocation?: string; city?: string; region?: string; remote?: boolean; hybrid?: boolean }; jobAd?: { sections?: Record<string, { title?: string; text?: string }> } };
  const data = await getJson<Data>(`https://api.smartrecruiters.com/v1/companies/${match[1]}/postings/${match[2]}`, fetcher);
  const sections = Object.values(data?.jobAd?.sections ?? {}).filter((section) => section.text?.trim());
  if (!data?.name || !sections.length) return null;
  const location = data.location?.fullLocation ? tidyCase(data.location.fullLocation) : null;
  const html = factLines([["Work setup", setupOf(data.location?.remote, data.location?.hybrid)], ["Employment type", data.typeOfEmployment?.label], ["Posted", data.releasedDate?.slice(0, 10)], ["Job ID", data.refNumber]])
    + sections.map((section) => `<h2>${section.title ?? ""}</h2>${section.text}`).join("");
  return postingFromBoard({ url, title: data.name, company: data.company?.name?.trim() || null, location, html }).extracted;
}

const WORKABLE = /^https:\/\/apply\.workable\.com\/([A-Za-z0-9_-]+)\/j\/([A-Za-z0-9]+)/i;

/** Workable postings from its public job API; the company name from the account. */
async function fetchWorkablePosting(url: string, fetcher: typeof fetch): Promise<Omit<FetchedJobDescription, "fetchedAt"> | null> {
  const match = WORKABLE.exec(url);
  if (!match) return null;
  type Data = { title?: string; description?: string; requirements?: string; benefits?: string; published?: string; type?: string; workplace?: string; remote?: boolean;
    location?: { city?: string; region?: string | null; country?: string } };
  const data = await getJson<Data>(`https://apply.workable.com/api/v2/accounts/${match[1]}/jobs/${match[2]}`, fetcher);
  if (!data?.title || !data.description) return null;
  const account = await getJson<{ name?: string }>(`https://apply.workable.com/api/v1/accounts/${match[1]}`, fetcher);
  const place = [data.location?.city, data.location?.region, data.location?.country].filter((part) => part && part.trim()).join(", ") || null;
  const html = factLines([["Work setup", data.workplace === "hybrid" ? "Hybrid" : data.workplace === "on_site" ? "On-site" : setupOf(data.remote ?? data.workplace === "remote", false)], ["Employment type", data.type], ["Posted", data.published?.slice(0, 10)]])
    + data.description + (data.requirements ? `<h2>Requirements</h2>${data.requirements}` : "") + (data.benefits ? `<h2>Benefits</h2>${data.benefits}` : "");
  return postingFromBoard({ url, title: data.title, company: account?.name?.trim() || workdayCompany(match[1]!, null), location: place, html }).extracted;
}

const RECRUITEE = /^https:\/\/([a-z0-9-]+)\.recruitee\.com\/o\/([A-Za-z0-9_-]+)/i;

/** Recruitee postings from the company's public offers API. */
async function fetchRecruiteePosting(url: string, fetcher: typeof fetch): Promise<Omit<FetchedJobDescription, "fetchedAt"> | null> {
  const match = RECRUITEE.exec(url);
  if (!match) return null;
  type Offer = { title?: string; description?: string; requirements?: string; company_name?: string; location?: string; published_at?: string; employment_type_code?: string; remote?: boolean; hybrid?: boolean };
  const offer = (await getJson<{ offer?: Offer }>(`https://${match[1]}.recruitee.com/api/offers/${match[2]}`, fetcher))?.offer;
  if (!offer?.title || !offer.description) return null;
  const html = factLines([["Work setup", setupOf(offer.remote, offer.hybrid)], ["Employment type", offer.employment_type_code?.replace(/_/g, " ")], ["Posted", offer.published_at?.slice(0, 10)]])
    + offer.description + (offer.requirements ? `<h2>Requirements</h2>${offer.requirements}` : "");
  return postingFromBoard({ url, title: offer.title, company: offer.company_name?.trim() || null, location: offer.location?.trim() || null, html }).extracted;
}

const GREENHOUSE_JOB = /^https:\/\/(?:boards|job-boards)\.greenhouse\.io\/([A-Za-z0-9_-]+)\/jobs\/(\d+)/i;

/** A Greenhouse posting from the board's job API: title, company, location, and the description only. */
async function fetchGreenhouseJob(url: string, fetcher: typeof fetch, source: string): Promise<Omit<FetchedJobDescription, "fetchedAt"> | null> {
  const match = GREENHOUSE_JOB.exec(url);
  if (!match) return null;
  const response = await fetcher(`https://boards-api.greenhouse.io/v1/boards/${match[1]}/jobs/${match[2]}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!response?.ok) return null;
  const data = await response.json().catch(() => null) as { title?: string; content?: string; company_name?: string; location?: { name?: string } } | null;
  if (!data?.title || !data.content) return null;
  return postingFromBoard({ url: source, title: decodeEntities(data.title), company: data.company_name?.trim() || null, location: data.location?.name?.trim() || null, html: data.content }).extracted;
}

const WORKDAY = /^https:\/\/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/?#]+)\/job\/([^?#]+?)(?:\/apply(?:\/[^?#]*)?)?\/?(?:[?#].*)?$/i;

/** The company a Workday site belongs to: its legal entity when that names the tenant, else the tenant's name. */
export function workdayCompany(tenant: string, organization: string | null | undefined): string {
  const name = (organization ?? "").trim();
  if (name && !/^\d/.test(name) && name.toLowerCase().replace(/[^a-z0-9]/g, "").includes(tenant.toLowerCase().replace(/[^a-z0-9]/g, ""))) return name;
  return tenant.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * Workday career sites draw postings with JavaScript; the same posting is public as JSON from the site's CXS API
 * (`/wday/cxs/<tenant>/<site>/job/<path>`). Apply links (`…/apply`) read the posting itself.
 */
async function fetchWorkdayPosting(url: string, fetcher: typeof fetch): Promise<Omit<FetchedJobDescription, "fetchedAt"> | null> {
  const match = WORKDAY.exec(url);
  if (!match) return null;
  const [, tenant, instance, site, path] = match;
  const api = `https://${tenant}.${instance}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/job/${path}`;
  const response = await fetcher(api, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) return null;
  const data = (await response.json().catch(() => null)) as { jobPostingInfo?: Record<string, unknown>; hiringOrganization?: { name?: string } } | null;
  const info = data?.jobPostingInfo;
  const text = (key: string) => typeof info?.[key] === "string" ? (info[key] as string).trim() : "";
  if (!info || !text("jobDescription")) return null;
  const facts = [
    text("remoteType") && `Work setup: ${text("remoteType")}`,
    text("timeType") && `Employment type: ${text("timeType")}`,
    text("startDate") && `Posted: ${text("startDate")}`,
    text("jobReqId") && `Job ID: ${text("jobReqId")}`,
  ].filter(Boolean).map((line) => `<p>${line}</p>`).join("");
  const posting = postingFromBoard({
    url: text("externalUrl") || url,
    title: text("title") || "Job Description",
    company: workdayCompany(tenant!, data?.hiringOrganization?.name),
    location: text("location") || null,
    html: facts + text("jobDescription"),
  });
  return { ...posting.extracted, url };
}

/** The company an Oracle Cloud career site belongs to, from its site name ("JPMC Candidate Experience page" → "JPMC"). */
export function oracleCompanyFromSiteName(siteName: string | null | undefined): string | null {
  const name = (siteName ?? "")
    .replace(/\b(?:candidate\s+experience|career(?:s)?(?:\s+site)?|job(?:s)?(?:\s+site)?|external|internal|recruiting)\b/gi, " ")
    .replace(/\b(?:page|site|portal|copy)\b/gi, " ")
    .replace(/[()_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[-–—:|,]+$/, "")
    .trim();
  return name.length >= 2 ? name : null;
}

async function oracleSiteCompany(host: string, site: string, fetcher: typeof fetch): Promise<string | null> {
  const api = `https://${host}/hcmRestApi/resources/latest/recruitingCESites?onlyData=true&q=SiteNumber=${encodeURIComponent(site)}`;
  const response = await fetcher(api, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!response?.ok) return null;
  const item = ((await response.json().catch(() => null)) as { items?: Array<{ SiteName?: string }> } | null)?.items?.[0];
  return oracleCompanyFromSiteName(item?.SiteName);
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
  const company = await oracleSiteCompany(host!, site!, fetcher);
  const header = [`# ${title ?? "Job Description"}`, "", ...(company ? [`**Company:** ${company}  `] : []), ...(location ? [`**Location:** ${location}  `] : []), `**Source:** ${url}`, ""];
  return { url, title, company, location, suggestedJobId: suggestJobId(company, title), markdown: `${header.join("\n")}\n${body}\n` };
}

export async function fetchJobDescription(workspacePath: string, url: string, fetcher: typeof fetch = appFetch): Promise<FetchedJobDescription> {
  if (!/^https?:\/\//i.test(url)) throw new Error("Provide a full http(s) job posting URL.");
  const { extracted, form } = await fetchAndClean(url, fetcher);
  return stageFetched(workspacePath, extracted, form);
}

/** One page or API response as text, with the same browser headers and timeout as posting fetches. */
export async function fetchText(url: string, fetcher: typeof fetch = appFetch, init: RequestInit = {}): Promise<string> {
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
  if (text.length < MIN_PASTED_POSTING_CHARS) throw new Error("That paste is too short to be a job description.");
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
  const cleaned = cleanPosting(text, { title: meta.title, company: meta.company, location: meta.location, source: meta.url });
  const { form } = cleaned;
  const markdown = postingTemplate(cleaned.markdown, { url: meta.url });
  if (markdown.replace(/^[\s\S]*?\*\*Source:\*\*[^\n]*\n/, "").trim().length < MIN_PASTED_POSTING_CHARS / 2) throw new Error("That paste looks like an application form, not a job description. Paste the job description too.");
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
export async function stageLinkJobDescription(workspacePath: string, url: string, id: string, fetcher: typeof fetch = appFetch, now = new Date()): Promise<Omit<FetchedJobDescription, "markdown">> {
  if (!/^https?:\/\//i.test(url)) throw new Error("Provide a full http(s) job posting URL.");
  let extracted: Omit<FetchedJobDescription, "fetchedAt">;
  let form: string | null;
  try {
    ({ extracted, form } = await fetchAndClean(url, fetcher));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Couldn't open this posting (${message.replace(/\n[\s\S]*/, "")}). Paste the job description instead.`);
  }
  if (bodyLength(extracted) < MIN_DESCRIPTION_CHARS) throw new Error(signInWall(extracted.markdown)
    ? "This site only shows the posting after signing in (LinkedIn, Indeed, and similar). Open the job on the company's own careers page and paste that link, or paste the job description."
    : "Couldn't read a job description from this page. Paste the job description instead.");
  const { markdown, ...rest } = extracted;
  const meta = { ...rest, fetchedAt: now.toISOString() };
  const paths = stagedPaths(workspacePath, id);
  await mkdir(join(paths.markdown, ".."), { recursive: true });
  await writeTextAtomic(paths.markdown, markdown);
  await writeJsonAtomic(paths.meta, meta);
  await writeForm(paths.form, form);
  return meta;
}

function signInWall(markdown: string): boolean {
  return /\b(?:sign in|log in|join now|create (?:an )?account)\b/i.test(markdown) && /linkedin|indeed|glassdoor|ziprecruiter|wellfound|otta/i.test(markdown);
}

/** Saves an already fetched and cleaned posting under a paste ID, so the queue loads it like any other. */
export async function stageCleanedPosting(workspacePath: string, id: string, markdown: string, meta: Omit<FetchedJobDescription, "markdown">): Promise<void> {
  const paths = stagedPaths(workspacePath, id);
  await mkdir(join(paths.markdown, ".."), { recursive: true });
  await writeTextAtomic(paths.markdown, markdown);
  await writeJsonAtomic(paths.meta, meta);
}

/**
 * Sends a job that already has a folder and a posting (saved for later, no drafts yet) to the queue: its own posting
 * is staged under a paste ID with the job's ID as the suggested ID, so the drafts land in that folder, not a new one.
 */
export async function stageSavedJob(workspacePath: string, jobId: unknown, id: string, now = new Date()): Promise<Omit<FetchedJobDescription, "markdown">> {
  if (typeof jobId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(jobId) || jobId.includes("..")) throw new Error("That isn't a job.");
  const markdown = await readFile(join(workspacePath, "jobs", jobId, "original_jd.md"), "utf8").catch(() => null);
  if (!markdown?.trim()) throw new Error("This job has no saved posting to draft from.");
  const metadata = parseJobDescriptionMetadata(markdown);
  const meta = { url: metadata.url ?? "saved", fetchedAt: now.toISOString(), title: metadata.title, company: metadata.company, location: metadata.location, suggestedJobId: jobId };
  await stageCleanedPosting(workspacePath, id, markdown, meta);
  return meta;
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
      // File times carry fractions of a millisecond, so a file saved this millisecond can look newer than `now`.
      if (minAgeMs <= 0 || now - Math.floor(modified) >= minAgeMs) await rm(path, { force: true });
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
