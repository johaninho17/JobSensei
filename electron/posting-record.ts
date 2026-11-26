// Builds the posting record (src/shared/posting.ts) from a saved posting. This is the one place the app reads a
// posting's structure: requirements, pay, work setup, and the rest. Screens and checks call `postingRecordFor`
// (memoized by content) or `readPostingRecord` (also saves `.sensei/posting.json`), never their own regexes.
import { boardOf } from "../src/shared/boards";
import { normalCompany, normalEmploymentType, normalLocation, normalPostedDate, normalTitle } from "../src/shared/posting-fields";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { extractRequiredItems, extractResponsibilityItems, isHeadingLike, isProse, isRequiredHeading, jobRequirements, NOT_REQUIRED_HEADING, postingBody, RESPONSIBILITY_HEADING, sectionHeadingText } from "./fit-scoring";
import { parseJobDescriptionMetadata } from "./job-description";
import { POSTING_BOARDS, POSTING_EXPECTED_FIELDS, POSTING_SCHEMA_VERSION, postingRecordSchema, type PostingPay, type PostingRecord, type PostingWorkSetup } from "../src/shared/posting";

/** Bump when any parsing rule changes: saved records with an older version are rebuilt. */
export const POSTING_PARSER_VERSION = 8;
export const POSTING_RECORD_FILE = ".sensei/posting.json";

type SectionKind = "requirements" | "responsibilities" | "preferred" | "benefits" | "pay" | "company" | "role" | "legal" | "other";
type Section = { heading: string; kind: SectionKind; items: string[]; prose: string[] };

const BULLET = /^\s*(?:[-*•▪◦]|\d+[.)])\s+(.*)$/;
const LEGAL = /\b(?:equal (?:employment )?opportunity|eeo|accommodations?|privacy|notice|disclaimer|recruitment process|recruiting process|fraud|e-verify|automated employment|pay transparency|applicant)\b/i;
const PREFERRED = /\b(?:preferred|nice[- ]to[- ]haves?|bonus|pluses|desired|desirable|extra credit)\b/i;
const BENEFITS = /\b(?:benefits|perks|what we offer|we offer|you can expect|why (?:join|work)|what(?:'|’)?s in it for you|the role offers)\b/i;
const PAY_HEADING = /\b(?:compensation|salary|pay(?: range)?|total rewards)\b/i;
const COMPANY = /^(?:about (?!the (?:role|job|position)|this (?:role|job|position)|you\b)|who we are|our (?:mission|company|story|team)|company (?:overview|description))/i;
const ROLE = /\b(?:about the (?:role|job|position|team)|about this (?:role|job|position)|the opportunity|role overview|position (?:overview|summary)|job (?:summary|description|overview)|overview|summary|the role)\b/i;

function kindOf(heading: string): SectionKind {
  if (LEGAL.test(heading)) return "legal";
  if (PREFERRED.test(heading)) return "preferred";
  if (BENEFITS.test(heading)) return "benefits";
  if (PAY_HEADING.test(heading) && !/\bbenefits?\b/i.test(heading)) return "pay";
  if (COMPANY.test(heading)) return "company";
  if (isRequiredHeading(heading)) return "requirements";
  if (RESPONSIBILITY_HEADING.test(heading) && !ROLE.test(heading)) return "responsibilities";
  if (ROLE.test(heading)) return "role";
  if (NOT_REQUIRED_HEADING.test(heading)) return "other";
  return "other";
}

/** Header lines the fetch or paste adds ("Source URL: …", "- Location: …"): facts, never overview or company prose. */
const META_LINE = /^(?:[-*•]\s*)?(?:\*\*)?(?:source(?: url)?|url|job url|company|employer|location|job id|requisition id|posted(?: on)?|date posted|department|team|employment type|job type)(?:\*\*)?\s*:|https?:\/\//i;
/** Header facts with a value ("**Pay:** $90,000–$120,000/year"): facts, never section headings (issue #173). */
const FACT_LINE = /^(?:[-*•]\s*)?(?:\*\*)?(?:work setup|workplace type|remote type|pay|compensation|salary|time type)(?:\*\*)?\s*:(?:\*\*)?\s*\S/i;
const clean = (line: string) => line.replace(/[*_`]/g, "").replace(/([a-z])\.([A-Z])/g, "$1. $2").replace(/\s+/g, " ").trim();
const isTag = (line: string) => /^#[A-Za-z][\w-]*$/.test(line.trim());

/** The posting split at its headings. Lines before the first heading form an untitled "role" section. */
function sections(body: string): Section[] {
  const out: Section[] = [{ heading: "", kind: "role", items: [], prose: [] }];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line || isTag(line) || META_LINE.test(line) || FACT_LINE.test(line)) continue;
    const item = BULLET.exec(raw)?.[1];
    if (item) { out.at(-1)!.items.push(clean(item)); continue; }
    if (isHeadingLike(raw) && !/^#\s/.test(line)) {
      const heading = sectionHeadingText(raw);
      out.push({ heading, kind: kindOf(heading), items: [], prose: [] });
      continue;
    }
    if (/^#\s/.test(line)) continue;
    out.at(-1)!.prose.push(clean(line));
  }
  // A requirements heading over paragraphs ("What we're looking for" + prose) describes the role.
  for (const section of out) if (section.kind === "requirements" && !section.items.length && isProse(section.prose)) section.kind = "role";
  return out;
}

const MAX_LINE = 280;
const short = (line: string) => line.length > MAX_LINE ? `${line.slice(0, MAX_LINE).replace(/\s+\S*$/, "")}…` : line;
const firstSentence = (text: string) => short((/^(.+?[.!?])(?:\s|$)/.exec(text)?.[1] ?? text).trim());

// ---- Pay -------------------------------------------------------------------------------------------------
const AMOUNT = String.raw`[$£€]\s?\d[\d,]*(?:\.\d+)?\s*[kK]?`;
const RANGE = new RegExp(String.raw`(?:between\s+)?(${AMOUNT})\s*(?:USD|GBP|EUR)?\s*(?:[-–—]|to|and)\s*(${AMOUNT.replace("[$£€]\\s?", "[$£€]?\\s?")})(\s*(?:USD|GBP|EUR))?(\s*(?:\/|per|a|an)\s*(?:year|yr|annum|annually|hour|hr|month|mo)\b|\s*annually)?`, "i");
const amount = (value: string) => {
  const number = Number(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(number) && number > 0 ? (/k\s*$/i.test(value) ? number * 1000 : number) : null;
};

const PAY_LABEL = /^(?:salary|pay|compensation|base salary|pay range|salary range)\b[^:]{0,20}:/i;
const PAY_WORDS = /\b(?:salary|base|compensation|pay|wage|ote|on[- ]target|earnings|per (?:year|hour|annum)|annual(?:ly)?|hourly|\/\s?(?:yr|year|hr|hour))\b/i;
/** Money that isn't pay: the company's revenue, funding, valuation, customers' numbers, perks. */
const NOT_PAY = /\b(?:arr|mrr|revenue|raised|raise|funding|funded|series [a-e]|seed|valuation|valued|investors?|backed|customers?|users?|gmv|aum|saved|savings|401\(?k\)?|stipend|reimburse\w*|allowance|bonus of|referral|budget)\b/i;
const MILLIONS = /^\s*(?:m|mm|b|bn|million|billion)\b/i;

/**
 * How likely a line is to state the job's pay: labeled pay lines and pay words count for it; company money (ARR,
 * funding, revenue), perks, millions, and a $0 start count against it. Below 1 it isn't treated as pay.
 */
/** "165,000 USD" / "USD 165,000" written with the currency's sign, so one amount pattern reads every form (#172). */
function withSigns(line: string): string {
  const sign: Record<string, string> = { USD: "$", GBP: "£", EUR: "€" };
  return line
    .replace(/\b(USD|GBP|EUR)\s?(\d[\d,]*(?:\.\d+)?\s*[kK]?)/g, (_, code: string, value: string) => `${sign[code]}${value}`)
    .replace(/(^|[^$£€\d,.])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{4,7}(?:\.\d+)?)\s?(USD|GBP|EUR)\b/g, (_, before: string, value: string, code: string) => `${before}${sign[code]}${value} ${code}`);
}

function payScore(line: string): number {
  if (!/[$£€]\s?\d/.test(line)) return -Infinity;
  const match = RANGE.exec(line) ?? new RegExp(AMOUNT).exec(line);
  if (!match) return -Infinity;
  const after = line.slice((match.index ?? 0) + match[0].length);
  const first = amount(match[1] ?? match[0]);
  let score = 0;
  if (PAY_LABEL.test(line)) score += 5;
  if (PAY_WORDS.test(line)) score += 3;
  // Company-money words count only next to the amount ("$0 to $30M in ARR"), not elsewhere in a long pay sentence.
  const start = match.index ?? 0;
  if (NOT_PAY.test(line.slice(Math.max(0, start - 40), start + match[0].length + 40))) score -= 6;
  if (MILLIONS.test(after) || /[$£€]\s?\d[\d,.]*\s*(?:m|b|bn|million|billion)\b/i.test(line)) score -= 8;
  if (first === null) score -= 4;
  else if (first >= 15_000 && first <= 2_000_000) score += 2;
  else if (first >= 10 && first <= 500 && /\b(?:hour|hr|hourly)\b/i.test(line)) score += 2;
  if (RANGE.test(line)) score += 1;
  return score;
}

export function parsePay(posting: string): PostingPay | null {
  const originals = posting.split("\n").map((value) => clean(value.replace(BULLET, "$1"))).filter(Boolean);
  // The line most likely to state pay, never the first money in the posting ("scaled sales from $0 to $30M in ARR").
  // Read with currency codes as signs; the posting's own wording is what `line` keeps.
  let line: string | null = null;
  let original = "";
  let best = 0;
  for (const value of originals) {
    const signed = withSigns(value);
    const score = payScore(signed);
    if (score > best) { best = score; line = signed; original = value; }
  }
  if (!line || best < 1) return null;
  const match = RANGE.exec(line);
  if (!match) {
    const single = new RegExp(AMOUNT).exec(line)?.[0];
    const at = new RegExp(AMOUNT).exec(line);
    return single && at ? { text: single.trim().replace(/[,.]+$/, ""), min: amount(single), max: amount(single), currency: currencyOf(single), period: periodOf(sentenceAt(line, at.index, at[0].length), amount(single)), line: short(original) } : null;
  }
  const min = amount(match[1]!);
  const max = amount(match[2]!.match(/^[$£€]/) ? match[2]! : `${match[1]!.trim()[0]}${match[2]}`);
  const period = periodOf(match[4] ?? sentenceAt(line, match.index, match[0].length), min);
  const written = (value: string) => value.trim().replace(/[,.]+$/, "");
  const text = `${written(match[1]!)}–${written(match[2]!).replace(/^(?![$£€])/, match[1]!.trim()[0]!)}${period ? `/${period}` : ""}`;
  return { text, min, max, currency: currencyOf(match[1]!) ?? (match[3]?.trim().toUpperCase() || null), period, line: short(original) };
}
/**
 * The sentence holding the amount (issue #172): a pay paragraph often goes on to benefits, and their period words
 * ("six month paid parental leave", "monthly meal allowance") are not the pay's period.
 */
function sentenceAt(line: string, start: number, length: number): string {
  const before = line.slice(0, start);
  const from = Math.max(before.lastIndexOf(". "), before.lastIndexOf("; "), before.lastIndexOf("! "), before.lastIndexOf("? ")) + 1;
  const stop = line.slice(start + length).search(/[.;!?](?:\s|$)/);
  return line.slice(from, stop < 0 ? line.length : start + length + stop);
}
const currencyOf = (value: string) => value.includes("$") ? "USD" : value.includes("£") ? "GBP" : value.includes("€") ? "EUR" : null;
function periodOf(text: string, min: number | null): PostingPay["period"] {
  if (/\b(?:hour|hr|hourly)\b/i.test(text)) return "hour";
  if (/\b(?:month|mo)\b/i.test(text)) return "month";
  if (/\b(?:year|yr|annum|annual(?:ly)?)\b/i.test(text)) return "year";
  return min === null ? null : min >= 10000 ? "year" : min < 200 ? "hour" : null;
}

// ---- Work setup ------------------------------------------------------------------------------------------
const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
export function parseWorkSetup(text: string): PostingWorkSetup | null {
  const tag = /#LI-(Remote|Hybrid|Onsite|On-?site|Office)\b/i.exec(text)?.[1]?.toLowerCase();
  // A stated work setup ("Work setup: Hybrid", from the board's own field or the posting's facts) is the employer's
  // setting, like the tag; sentences are only read when the posting states none (issue #172).
  const stated = /^\s*(?:[-*•]\s*)?\*{0,2}(?:work setup|workplace(?: type)?|remote type|work arrangement)\*{0,2}\s*:\*{0,2}\s*(.+)$/im.exec(text)?.[1]?.toLowerCase() ?? "";
  const statedMode: PostingWorkSetup["mode"] = /\bhybrid\b/.test(stated) ? "hybrid" : /\bremote\b/.test(stated) ? "remote" : /\b(?:on[- ]?site|in[- ]office|in[- ]person)\b/.test(stated) ? "onsite" : null;
  const tagMode: PostingWorkSetup["mode"] = tag === "remote" ? "remote" : tag === "hybrid" ? "hybrid" : tag ? "onsite" : null;
  // Plain sentences, plus bullets that label the location or work type ("- Location: Remote (US)") or are a short
  // location line ("- Remote in U.S."); perks bullets ("in-office lunches") are left out.
  const candidates = text.split("\n").flatMap((value) => {
    const item = BULLET.exec(value)?.[1];
    if (item === undefined) return clean(value).split(/(?<=[.!?])\s+/);
    const plain = clean(item);
    return /^(?:location|work(?:place)?(?: type| arrangement| model)?|employment type|remote policy|office)\s*:/i.test(plain) || (plain.split(/\s+/).length <= 6 && /^(?:fully |100% )?(?:remote|hybrid|on[- ]?site|in[- ]office|in[- ]person)\b/i.test(plain)) ? [plain] : [];
  });
  const line = candidates.find((value) => !isTag(value) && value.length <= 200 && /\b(remote|hybrid|on[- ]site|onsite|in[- ]office|in[- ]person|days? (?:in|a week|per week))\b/i.test(value) && !/\b(?:benefit|stipend|reimburse)/i.test(value)) ?? null;
  const days = /\b(\d|one|two|three|four|five)\+?\s+days?\s*(?:a|per|each|\/)\s*week\b/i.exec(line ?? "") ?? /\b(\d|one|two|three|four|five)\s+days?\s+(?:in|at)\s+(?:the|our)\s+office\b/i.exec(line ?? "");
  // Some in-person time plus working from home is hybrid ("some in person meetings, but flexibility to work from home").
  const mixed = !!line && /\b(?:work(?:ing)? from home|wfh|work remotely)\b/i.test(line) && /\b(?:in[- ]person|in[- ]office|on[- ]?site)\b/i.test(line) && !/\b(?:fully|100%) remote\b/i.test(line);
  const lineMode: PostingWorkSetup["mode"] = !line ? null : /\bhybrid\b/i.test(line) || mixed || (days && /\bremote\b/i.test(line)) ? "hybrid" : /\b(?:fully |100% )?remote\b/i.test(line) && !/\bnot remote\b/i.test(line) ? "remote" : /\b(?:on[- ]?site|in[- ]office|in[- ]person)\b/i.test(line) ? days && Number(WORDS[days[1]!.toLowerCase()] ?? days[1]) < 5 ? "hybrid" : "onsite" : null;
  // The board's own tag (#LI-Hybrid) is the employer's setting; a line that disagrees is about something else.
  const mode = tagMode ?? statedMode ?? lineMode;
  if (!mode && !line) return null;
  const daysInOffice = days ? Number(WORDS[days[1]!.toLowerCase()] ?? days[1]) : null;
  const label = mode ? mode === "onsite" ? "On-site" : mode[0]!.toUpperCase() + mode.slice(1) : "";
  const setting = tagMode ?? statedMode;
  const detail = line && (!setting || lineMode === setting) ? line.replace(/^(?:location|work setup|work(?:place)?(?: type| arrangement| model)?|remote (?:policy|type))\s*:\s*/i, "") : "";
  return { mode, daysInOffice: daysInOffice !== null && daysInOffice <= 7 ? daysInOffice : null, text: short(detail || label) };
}

// ---- Smaller facts ---------------------------------------------------------------------------------------
const YEARS = /\b(\d+\s*(?:\+|[-–]\s*\d+)?\s*(?:\+\s*)?years?)\b/i;
function experienceOf(required: string[], body: string): string | null {
  const found = required.map((item) => YEARS.exec(item)?.[1]).find(Boolean)
    ?? /\b(\d+\s*(?:\+|[-–]\s*\d+)?\s*years?)\s+(?:of\s+)?(?:professional\s+|relevant\s+)?experience/i.exec(body)?.[1];
  return found?.replace(/\s+/g, " ") ?? null;
}

export function seniorityOf(title: string | null, experience: string | null): PostingRecord["seniority"] {
  const value = (title ?? "").toLowerCase();
  if (/\bintern(ship)?\b/.test(value)) return "intern";
  if (/\b(?:vp|vice president|chief|head of)\b/.test(value)) return "executive";
  if (/\bdirector\b/.test(value)) return "director";
  if (/\bmanager\b/.test(value) && !/\b(?:account|success|product|program|project)\s+manager\b/.test(value)) return "manager";
  if (/\b(?:staff|principal)\b/.test(value)) return "staff";
  if (/\blead\b/.test(value)) return "lead";
  if (/\b(?:senior|sr\.?)\b/.test(value) || /\b(?:iii|iv)\b/.test(value)) return "senior";
  if (/\b(?:junior|jr\.?|entry|graduate|new grad)\b/.test(value) || /\bi\b$/.test(value)) return "junior";
  const years = Number(/\d+/.exec(experience ?? "")?.[0]);
  if (!Number.isFinite(years) || !experience) return null;
  return years >= 7 ? "senior" : years >= 2 ? "mid" : "junior";
}

const AUTHORIZATION = /\b(?:sponsor(?:ship)?|visa|work authori[sz]ation|authori[sz]ed to work|citizen(?:ship)?|security clearance|clearance|green card|permanent resident)\b/i;
const TRAVEL = /\btravel\b/i;
const NOT_TOOLS = new Set(["US", "USA", "UK", "EU", "EEO", "OTE", "PTO", "HR", "CEO", "CTO", "CFO", "COO", "VP", "II", "III", "IV", "LLC", "INC", "NYC", "SF", "LA", "AM", "PM", "ID", "OK", "TBD", "FAQ", "MS", "BS", "BA", "MBA", "PHD", "GPA", "ADA", "B2B", "B2C", "KPI", "KPIs", "ROI", "AE", "SME", "SOP", "POC"]);

const TWO_LETTER_SKILLS = new Set(["AI", "ML", "UI", "UX", "QA", "CI", "CD", "BI", "AR", "VR", "R"]);
/** Tool-shaped names (acronyms, CamelCase, letters with digits) in the rated requirements, with the IDs that name them. */
function toolsOf(requirements: PostingRecord["requirements"], company: string | null): PostingRecord["tools"] {
  const tools = new Map<string, Set<string>>();
  const companyWords = new Set((company ?? "").toLowerCase().split(/\s+/));
  for (const requirement of requirements) {
    // Sentence starts are capitalized anyway, so a plain capitalized word counts only mid-sentence.
    const words = requirement.text.split(/[\s,;()/]+/);
    words.forEach((raw, index) => {
      const word = raw.replace(/^[^A-Za-z0-9.#]+|[^A-Za-z0-9+#]+$/g, "");
      // Two capital letters are mostly states, titles, or abbreviations (CA, AE, PR); keep the known skill ones.
      if (word.length < 2 || NOT_TOOLS.has(word) || (/^[A-Z]{2}$/.test(word) && !TWO_LETTER_SKILLS.has(word))) return;
      const shaped = /^(?=[A-Z0-9]*[A-Z])[A-Z0-9]{2,}s?$/.test(word) || /[a-z][A-Z]/.test(word) || (/\d/.test(word) && /[A-Za-z]/.test(word) && !/^\d+\+?(?:years?|yrs?)$/i.test(word));
      const sentenceStart = index === 0 || /[.!?:]$/.test(words[index - 1] ?? "");
      const named = !sentenceStart && /^[A-Z][a-z]+(?:\.js)?$/.test(word) && !COMMON_CAPITALIZED.has(word.toLowerCase()) && !/(?:tion|sion|ship|ment|ness|ity|ing|ist|ance|ence)$/.test(word) && !companyWords.has(word.toLowerCase());
      if (!shaped && !named) return;
      const name = /^[A-Z0-9]{2,}s$/.test(word) ? word.slice(0, -1) : word;
      if (NOT_TOOLS.has(name)) return;
      if (!tools.has(name)) tools.set(name, new Set());
      tools.get(name)!.add(requirement.id);
    });
  }
  return [...tools].map(([name, ids]) => ({ name, requirementIds: [...ids] }));
}

/** Capitalized words in requirements that are job vocabulary, places, or degrees, not tools or skills. */
const COMMON_CAPITALIZED = new Set(("customer customers success sales product engineering engineer engineers support solutions solution technical account accounts manager management marketing operations team teams "
  + "bachelor bachelors master masters degree degrees computer science english spanish french german business information systems enterprise mid market commercial government public sector federal "
  + "americas america north south east west united states us usa europe european canada california york francisco san city remote hybrid onsite office "
  + "senior junior lead staff principal director partner partners services service cloud data security platform platforms the a an and or of in with for to our your you we "
  + "monday friday january december experience ability strong excellent proven required preferred plus including such "
  + "software development developer developers code implementation analytics architect architects architecture executive executives design designs workspace collaboration agent agents "
  + "optimization managers delivery finance financial professional professionals onboarding health healthcare forward deployed documentation integration integrations testing field "
  + "consultant consultants engagement associate associates consulting fluency skills communication communications client clients execution strategy strategic program project projects "
  + "process processes problem problems framework frameworks library libraries analyst analysts frontend backend fullstack specialist "
  + "generative technology technologies tools tooling systems system modern new series agentic risk legal email "
  + "growth revenue leadership knowledge expertise certification certifications certified fundamentals advanced intermediate basic level tier").split(/\s+/));

/** The board a posting link comes from (src/shared/boards.ts owns detection); other sites are "other". */
function postingBoard(url: string | null): PostingRecord["board"] {
  const id = boardOf(url);
  if (id === null) return null;
  return (POSTING_BOARDS as readonly string[]).includes(id) ? id as PostingRecord["board"] : "other";
}

export const postingHash = (text: string) => createHash("sha256").update(text.replaceAll("\r\n", "\n")).digest("hex");

/** Reads a posting into the record. Pure: the same text always gives the same record. */
/** A labeled fact line ("Employment type: Full time", "**Job ID:** R123"), the value only. */
function labeled(body: string, label: RegExp): string | null {
  for (const raw of body.split("\n")) {
    const line = raw.replace(/\*\*/g, "").replace(/^\s*[-*•]\s*/, "").trim();
    const match = line.match(new RegExp(`^(?:${label.source})\\s*:\\s*(.+)$`, "i"));
    if (match) return match[1]!.trim();
  }
  return null;
}

/** A line describing the company itself ("Northwind is the platform for…", "The same principles … our team"), not the role. */
function aboutCompany(line: string, company: string | null): boolean {
  // "Northwind is looking to hire…" is about the role.
  if (/\b(?:is|are) (?:looking|hiring|seeking)\b/i.test(line.slice(0, 80))) return false;
  if (company && line.toLowerCase().startsWith(`${company.toLowerCase()} `) && /^\S+(?:\s+\S+){0,3}?\s+(?:is|was|enables|helps|builds|makes|provides|powers)\b/i.test(line)) return true;
  return /^(?:the same principles|our (?:mission|values|culture)|we(?:'|’)re (?:proud|a (?:global|remote))|founded in)\b/i.test(line);
}

export function buildPostingRecord(posting: string): PostingRecord {
  const body = postingBody(posting);
  const metadata = parseJobDescriptionMetadata(posting);
  const all = sections(body);
  const required = extractRequiredItems(posting);
  const responsibilities = extractResponsibilityItems(posting).map(clean);
  const requirements = jobRequirements(posting).map((item) => ({ ...item, text: clean(item.text) }));
  // One normal form per field (src/shared/posting-fields.ts), whatever the source.
  const companyName = normalCompany(metadata.company);
  const companySection = all.find((section) => section.kind === "company")?.prose.find((line) => line.length > 40) ?? null;
  const companyPara = companySection ?? body.split("\n").filter((line) => !META_LINE.test(line.trim()) && !BULLET.test(line)).map(clean).find((line) => line.length > 60 && !/\b(?:opportunity|role|position|candidate)\b/i.test(line.slice(0, 80)) && !/^(?:as an? |you\b|in this role)|\b(?:is|are) (?:seeking|looking|hiring)\b/i.test(line)
    && !/\b(?:committed to|equal opportunity|inclusive|accommodations?|diversity|recruitment process|apply)\b/i.test(line)
    && ((companyName && line.toLowerCase().includes(companyName.toLowerCase())) || /^(?:we|our)\b|\b(?:we are|we're|we build|we help)\b/i.test(line))) ?? null;
  // The role overview: prose under role headings (or before any heading), without the company paragraph.
  const rolePara = all.filter((section) => section.kind === "role").flatMap((section) => section.prose)
    .filter((line) => line.length > 60 && line !== companyPara && !LEGAL.test(line.slice(0, 120)) && !(companyName && line.toLowerCase().startsWith(`at ${companyName.toLowerCase()}`)) && !aboutCompany(line, companyName));
  const lines = body.split("\n").map((line) => clean(line.replace(BULLET, "$1"))).filter(Boolean);
  const experience = experienceOf(required, body);
  const record: PostingRecord = {
    schemaVersion: POSTING_SCHEMA_VERSION,
    parserVersion: POSTING_PARSER_VERSION,
    sourceHash: postingHash(posting),
    title: normalTitle(metadata.title, companyName),
    company: companyName,
    location: normalLocation(metadata.location),
    url: metadata.url,
    board: postingBoard(metadata.url),
    summary: rolePara.slice(0, 3).map(short),
    companyLine: companyPara ? firstSentence(companyPara) : null,
    requirements,
    requiredItems: required.map(clean),
    responsibilities,
    preferred: all.filter((section) => section.kind === "preferred").flatMap((section) => section.items.length ? section.items : section.prose).map(short),
    benefits: all.filter((section) => section.kind === "benefits").flatMap((section) => section.items).map(short),
    pay: parsePay(body),
    workSetup: parseWorkSetup(body),
    travel: lines.find((line) => TRAVEL.test(line) && line.length <= 200 && !/\b(?:stipend|reimburse|benefit)/i.test(line)) ?? null,
    experience,
    seniority: seniorityOf(metadata.title, experience),
    employmentType: normalEmploymentType(labeled(posting, /employment type|job type|time type|type/) ?? lines.find((line) => line.length <= 120 && /\b(?:full[- ]time|part[- ]time|internship|contract role|contract position)\b/i.test(line)) ?? metadata.title),
    postedAt: normalPostedDate(labeled(posting, /posted(?: on)?|date posted|posting date/)),
    jobId: labeled(posting, /job id|requisition id|req(?:uisition)? ?(?:id|#|number)|job number/)?.slice(0, 40) ?? null,
    workAuthorization: lines.find((line) => AUTHORIZATION.test(line) && line.length <= 300 && !LEGAL.test(line.slice(0, 60))) ?? null,
    tools: toolsOf(requirements, companyName),
    missing: [],
  };
  record.missing = POSTING_EXPECTED_FIELDS.filter((field) => {
    const value = record[field];
    return value === null || (Array.isArray(value) && value.length === 0);
  });
  return postingRecordSchema.parse(record);
}

const memo = new Map<string, PostingRecord>();
const MEMO_LIMIT = 400;
/** The record for a posting text, built once per distinct text. */
export function postingRecordFor(posting: string): PostingRecord {
  const key = postingHash(posting);
  const cached = memo.get(key);
  if (cached) return cached;
  const record = buildPostingRecord(posting);
  if (memo.size >= MEMO_LIMIT) memo.delete(memo.keys().next().value!);
  memo.set(key, record);
  return record;
}

/**
 * The job's posting record: `.sensei/posting.json` when it matches the posting and the current parser, otherwise
 * rebuilt and saved. Null when the job has no posting.
 */
export async function readPostingRecord(jobPath: string): Promise<PostingRecord | null> {
  const posting = await readFile(join(jobPath, "original_jd.md"), "utf8").catch(() => readFile(join(jobPath, "original_jd.txt"), "utf8")).catch(() => "");
  if (!posting.trim()) return null;
  const hash = postingHash(posting);
  const saved = postingRecordSchema.safeParse(JSON.parse(await readFile(join(jobPath, POSTING_RECORD_FILE), "utf8").catch(() => "null")));
  if (saved.success && saved.data.sourceHash === hash && saved.data.parserVersion === POSTING_PARSER_VERSION) return saved.data;
  const record = postingRecordFor(posting);
  await writePostingRecord(jobPath, record).catch(() => undefined);
  return record;
}

export async function writePostingRecord(jobPath: string, record: PostingRecord): Promise<void> {
  await mkdir(join(jobPath, ".sensei"), { recursive: true });
  await writeFile(join(jobPath, POSTING_RECORD_FILE), `${JSON.stringify(record, null, 2)}\n`, "utf8");
}
