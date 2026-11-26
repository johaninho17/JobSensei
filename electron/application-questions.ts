// Reads an application form's questions from the posting link (Greenhouse, Ashby, Lever). Code only, no AI, and only
// the mechanical part: it drops fields that are never questions (uploads, contact details) and marks logistics and
// choice questions ("how did you hear about us", salary, a Yes/No dropdown), which are answered from the profile
// (src/shared/profile-answers.ts) and never reach Agy. Everything else goes to the background answerer
// (question-agent.ts), where Agy decides per question whether to answer, skip, or give notes.
// Any other job board returns null and nothing happens.
import { postingRef } from "../src/shared/boards";
import type { ApplicationQuestion } from "../src/shared/schemas";
import { decodeEntities, embeddedPostingUrl, fetchText } from "./jd-fetch";
import { postingUrl } from "./posting-clean";
import { appFetch } from "./app-fetch";

export type { ApplicationQuestion };

export type FormField = { label: string; type: "long" | "short" | "choice" | "file" | "other"; required: boolean; description: string; options?: string[] };

/** Contact and profile fields: never a question to answer. Matched against the whole (short) label. */
const CONTACT_FIELD = /^\W*(?:(?:(?:preferred|legal|full|first|last|middle|given|family)\s+)*name|e-?mail(?: address)?|phone(?: number)?|mobile|(?:current )?(?:address|city|state|country|zip|postal code|location)|linkedin(?: profile| url)?|website|portfolio|github(?: url)?|twitter|x handle|personal (?:site|website)|pronouns?|gender|race|ethnicity|veteran status|disability(?: status)?|current (?:company|employer|title)|resume\/?cv|cover letter)\b[^?]{0,30}\??\W*$/i;
/**
 * Logistics: facts only the candidate knows or one-line form answers. Never sent to Agy; shown as skipped
 * ("Answer anyway" still works).
 */
const LOGISTICS = /\b(?:hear about|heard about|find (?:this|the|our) (?:job|role|posting|position|opening)|found (?:this|the|our) (?:job|role|posting|position)|learn(?:ed)? about (?:this|the) (?:job|role|position)|referr\w*|who referred|salary|compensation|pay (?:range|expectations?)|desired pay|ote\b|visa|sponsor\w*|authori[sz]ed to work|eligib\w* to work|work authori[sz]ation|relocat\w*|where (?:do you|are you|will you) (?:plan|live|located|based|work)|where are you (?:located|based)|time ?zone|onsite|on-site|in-office|in office|hybrid|commute|start date|notice period|when can you start|earliest (?:start|available)|availability to start|pronouns?|years of (?:professional )?experience\?|how many years|security clearance|background check|non-compete|previously (?:worked|applied)|worked (?:here|for us) before|former employee|secret|decode|encoded|captcha|not a bot)\b/i;
const WRITE_YOURSELF = /\bwrite (?:this|it) (?:one )?yourself\b|\bin your own words\b|\bwithout (?:the use of |using )?(?:ai|chatgpt|generative ai)\b|\b(?:do not|don't|please don't) use (?:ai|chatgpt|generative ai)\b|\bno ai\b/i;
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
/** Words per sentence used to turn a sentence limit into a word limit. */
export const WORDS_PER_SENTENCE = 25;

/** Word limit stated in the question or its description (a sentence limit becomes about 25 words per sentence). */
export function wordLimit(text: string): number | null {
  const words = /\b(\d{2,4})\s*words?\b(?:\s*(?:max(?:imum)?|or (?:less|fewer)|limit))?|\b(?:max(?:imum)?|up to|no more than|under)\s*(\d{2,4})\s*words?\b/i.exec(text);
  if (words) return Number(words[1] ?? words[2]);
  const chars = /\b(\d{3,5})\s*char(?:acter)?s?\b/i.exec(text);
  if (chars) return Math.max(30, Math.round(Number(chars[1]) / 6));
  const sentences = sentenceLimit(text);
  return sentences ? sentences * WORDS_PER_SENTENCE : null;
}

/** Sentence limit: "(in 2-3 sentences)" → 3, "one sentence" → 1, "a few sentences" → 3. */
export function sentenceLimit(text: string): number | null {
  const match = /\b(?:(\d|one|two|three|four|five|six)\s*(?:-|–|to|or)\s*)?(\d|one|two|three|four|five|six|a few|a couple of)\s+sentences?\b/i.exec(text);
  if (!match) return null;
  const top = match[2]!.toLowerCase();
  return /\d/.test(top) ? Number(top) : NUMBER_WORDS[top] ?? 3;
}

function question(label: string, description: string, required: boolean, index: number, options: string[] = []): ApplicationQuestion {
  const full = `${label} ${description}`;
  if (options.length) return { id: `q:${index + 1}`, label: label.trim(), wordLimit: null, sentenceLimit: null, writeYourself: false, required, logistics: true, options };
  return { id: `q:${index + 1}`, label: label.trim(), wordLimit: wordLimit(full), sentenceLimit: sentenceLimit(full), writeYourself: WRITE_YOURSELF.test(full), required, logistics: isLogistics(label) };
}

/** A choice field's option labels, trimmed and de-duplicated (at most 40). */
function optionLabels(values: unknown[]): string[] {
  return [...new Set(values.map((value) => plain(String(value ?? ""))).filter(Boolean))].slice(0, 40);
}

/** A question that is plainly logistics or a one-line form answer (never sent to Agy unless the user asks). */
export function isLogistics(text: string): boolean {
  return LOGISTICS.test(text);
}

/**
 * The form's questions: text fields and choice fields (with their options) that aren't contact details. Logistics and
 * choice questions are marked (`logistics: true`) and answered from the profile; Agy sees only the rest.
 */
export function writtenQuestions(fields: FormField[]): ApplicationQuestion[] {
  return fields
    .filter((field) => (field.type === "long" || field.type === "short" || (field.type === "choice" && (field.options?.length ?? 0) > 0)) && !CONTACT_FIELD.test(field.label))
    .map((field, index) => question(field.label, field.description, field.required, index, field.type === "choice" ? field.options : []));
}

/** Questions pasted in the Questions subtab: one per line, or one per blank-line-separated block. */
export function parsePastedQuestions(text: string): ApplicationQuestion[] {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];
  const blocks = /\n\s*\n/.test(normalized) ? normalized.split(/\n\s*\n/) : normalized.split("\n");
  return blocks
    .map((block) => block.replace(/\s*\n\s*/g, " ").replace(/^\s*(?:[-*•]|\d+[.)]|q\d+[:.)]?)\s*/i, "").replace(/[\s,;]+$/, "").trim())
    .filter((block) => block.length >= 5)
    .map((block, index) => question(block, "", true, index));
}

const plain = (value: string) => decodeEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** Greenhouse Job Board API questions → fields. */
export function greenhouseFields(payload: unknown): FormField[] {
  const questions = (payload as { questions?: Array<{ label?: string; description?: string | null; required?: boolean; fields?: Array<{ type?: string; values?: Array<{ label?: string }> }> }> })?.questions ?? [];
  return questions.map((entry) => {
    const kind = entry.fields?.[0]?.type ?? "";
    const type: FormField["type"] = kind === "textarea" ? "long" : kind === "input_text" ? "short" : /select|checkbox|radio/.test(kind) ? "choice" : kind === "input_file" ? "file" : "other";
    const options = type === "choice" ? optionLabels((entry.fields?.[0]?.values ?? []).map((value) => value.label)) : [];
    return { label: plain(entry.label ?? ""), type, required: Boolean(entry.required), description: plain(entry.description ?? ""), ...(options.length ? { options } : {}) };
  }).filter((field) => field.label);
}

/** Ashby `ApiJobPosting` application form → fields. */
export function ashbyFields(payload: unknown): FormField[] {
  const sections = (payload as { data?: { jobPosting?: { applicationForm?: { sections?: Array<{ fieldEntries?: Array<{ field?: { type?: string; title?: string; description?: string | null; selectableValues?: Array<{ label?: string }> }; isRequired?: boolean }> }> } } | null } })?.data?.jobPosting?.applicationForm?.sections ?? [];
  return sections.flatMap((section) => section.fieldEntries ?? []).map((entry) => {
    const kind = entry.field?.type ?? "";
    const type: FormField["type"] = kind === "LongText" ? "long" : kind === "String" || kind === "Email" || kind === "Phone" ? "short" : /Select|Boolean|Location/.test(kind) ? "choice" : kind === "File" ? "file" : "other";
    const options = kind === "Boolean" ? ["Yes", "No"] : type === "choice" ? optionLabels((entry.field?.selectableValues ?? []).map((value) => value.label)) : [];
    return { label: plain(entry.field?.title ?? ""), type, required: Boolean(entry.isRequired), description: plain(entry.field?.description ?? ""), ...(options.length ? { options } : {}) };
  }).filter((field) => field.label);
}

/** Lever `/apply` page: each custom question card is embedded as JSON in a hidden input. */
export function leverFields(html: string): FormField[] {
  const fields: FormField[] = [];
  for (const match of html.matchAll(/<input[^>]*type="hidden"[^>]*value="(\{[^"]*?&quot;fields&quot;[^"]*?)"/g)) {
    try {
      const card = JSON.parse(decodeEntities(match[1]!)) as { fields?: Array<{ type?: string; text?: string; description?: string; required?: boolean; options?: Array<{ text?: string }> }> };
      for (const field of card.fields ?? []) {
        const kind = field.type ?? "";
        const type: FormField["type"] = kind === "textarea" ? "long" : kind === "text" ? "short" : /select|dropdown|multiple|checkbox/.test(kind) ? "choice" : kind === "file-upload" ? "file" : "other";
        const options = type === "choice" ? optionLabels((field.options ?? []).map((option) => option.text)) : [];
        if (field.text) fields.push({ label: plain(field.text), type, required: Boolean(field.required), description: plain(field.description ?? ""), ...(options.length ? { options } : {}) });
      }
    } catch {
      // A card that isn't JSON is not a question card.
    }
  }
  return fields;
}

const ASHBY_QUERY = "query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) { jobPosting(organizationHostedJobsPageName: $organizationHostedJobsPageName, jobPostingId: $jobPostingId) { title applicationForm { sections { fieldEntries { field isRequired } } } } }";

/** Which supported board a posting link is on; null for any other host. */
export function formSource(url: string): { board: "greenhouse" | "ashby" | "lever"; parts: string[] } | null {
  const ref = postingRef(url);
  if (!ref) return null;
  return { board: ref.board, parts: ref.board === "lever" ? [ref.origin, ref.slug, ref.id] : [ref.slug, ref.id] };
}

/** Systems whose forms sit behind sign-in or bot checks: no page read (form filling in a browser will cover them). */
const NO_PUBLIC_FORM = /(?:^|\.)(?:myworkdayjobs\.com|oraclecloud\.com|smartrecruiters\.com|icims\.com|taleo\.net|successfactors\.(?:com|eu)|linkedin\.com|indeed\.com)$/i;

/**
 * A company careers page that embeds a board's posting (Greenhouse `gh_jid` links, Ashby or Lever frames) has that
 * board's form (issue #175). One page read; null when the page embeds no supported board or can't be read.
 */
export async function embeddedFormSource(url: string, fetcher: typeof fetch = appFetch): Promise<ReturnType<typeof formSource>> {
  try {
    const { protocol, hostname } = new URL(url);
    if (!/^https?:$/.test(protocol) || NO_PUBLIC_FORM.test(hostname)) return null;
  } catch { return null; }
  const html = await fetchText(url, fetcher).catch(() => null);
  const embedded = html ? embeddedPostingUrl(html, url) : null;
  if (embedded && embedded !== url) return formSource(postingUrl(embedded));
  // A `gh_jid` page that names no board (it renders the posting itself): Greenhouse boards are usually named after
  // the site, so that board is used only when Greenhouse has this exact job on it.
  const jid = new URL(url).searchParams.get("gh_jid");
  const slug = siteBoardName(url);
  if (!jid || !/^\d+$/.test(jid) || !slug) return null;
  const found = await fetcher(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${jid}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
  return found?.ok ? { board: "greenhouse", parts: [slug, jid] } : null;
}

/** The site's own name as a board name: "careers.northwind.com" → "northwind" (country domains like .co.uk handled). */
export function siteBoardName(url: string): string | null {
  let labels: string[];
  try { labels = new URL(url).hostname.toLowerCase().split("."); } catch { return null; }
  const index = labels.length >= 3 && /^(?:co|com|org|net|ac)$/.test(labels.at(-2)!) && labels.at(-1)!.length === 2 ? labels.length - 3 : labels.length - 2;
  const name = labels[index];
  return name && /^[a-z0-9-]{2,}$/.test(name) ? name : null;
}

/** The form's fields from a posting link, or null when the board isn't supported. */
export async function fetchApplicationForm(url: string, fetcher: typeof fetch = appFetch): Promise<FormField[] | null> {
  const source = formSource(url) ?? await embeddedFormSource(url, fetcher);
  if (!source) return null;
  if (source.board === "greenhouse") {
    const [board, id] = source.parts;
    return greenhouseFields(JSON.parse(await fetchText(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${id}?questions=true`, fetcher)));
  }
  if (source.board === "ashby") {
    const [organization, posting] = source.parts;
    const body = JSON.stringify({ operationName: "ApiJobPosting", variables: { organizationHostedJobsPageName: organization, jobPostingId: posting }, query: ASHBY_QUERY });
    return ashbyFields(JSON.parse(await fetchText("https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting", fetcher, { method: "POST", body, headers: { "Content-Type": "application/json" } })));
  }
  const [origin, company, posting] = source.parts;
  return leverFields(await fetchText(`${origin}/${company}/${posting}/apply`, fetcher));
}
