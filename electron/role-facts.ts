// What a job is, for the Overview's Role section: read from the saved posting and, when interview prep exists,
// the company research. Pure, so it is tested without files; job-folders.ts calls it when it reads a job.
import { postingRecordFor } from "./posting-record";

export interface RoleFacts {
  /** What the role is: research "The role decoded" when prep exists, else the posting's own overview. */
  summary: string[];
  /** The posting's top responsibilities. */
  responsibilities: string[];
  /** How many required items the posting lists (they are rated under Fit). */
  requiredCount: number;
  /** Years of experience the posting asks for ("3+ years"), when it says. */
  experience: string | null;
  /** Remote, hybrid, or on-site, with the posting's own detail. */
  workArrangement: string | null;
  workMode: "remote" | "hybrid" | "onsite" | null;
  /** Pay from the research or the posting. */
  pay: string | null;
  /** Pay as numbers, from the posting (for sorting and learnings). */
  payRange: { min: number | null; max: number | null; currency: string | null; period: "year" | "month" | "hour" | null } | null;
  travel: string | null;
  seniority: string | null;
  workAuthorization: string | null;
  /** Tools the requirements name. */
  tools: string[];
  /** What the company does, in one sentence. */
  company: string | null;
  /** The interview process, when research found it. */
  process: string[];
  /** The posting's URL. */
  source: string | null;
  /** Facts the posting doesn't state ("pay", "workSetup", "experience", …). */
  missing: string[];
}

const MAX_SUMMARY = 3;
const MAX_RESPONSIBILITIES = 5;
const MAX_LINE = 280;

function section(markdown: string, heading: RegExp): string {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const start = lines.findIndex((line) => /^##\s/.test(line) && heading.test(line));
  if (start < 0) return "";
  const end = lines.findIndex((line, index) => index > start && /^##\s/.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}

/** Plain text of a Markdown line: no list marker, emphasis, IDs, or trailing source note. */
function clean(line: string): string {
  return line
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "")
    .replace(/\s*\((?:source:[^)]*|https?:[^)]*)\)\s*\.?$/i, "")
    .replace(/\s*\((?:S\d{1,2}|[a-z][a-z0-9-]*(?::[a-z0-9][a-z0-9.+-]*){2,})(?:\s*,\s*[^)]*)?\)/gi, "")
    .replace(/[*_`]/g, "")
    .replace(/([a-z])\.([A-Z])/g, "$1. $2")
    .trim();
}

const short = (line: string) => line.length > MAX_LINE ? `${line.slice(0, MAX_LINE).replace(/\s+\S*$/, "")}…` : line;
const bullets = (text: string) => text.split("\n").filter((line) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(line)).map(clean).filter(Boolean);
const firstSentence = (text: string) => short((/^(.+?[.!?])(?:\s|$)/.exec(text)?.[1] ?? text).trim());

/** The Role section: the posting record (one reading of the posting) plus interview research when it exists. */
export function roleFacts(posting: string, research = ""): RoleFacts {
  const record = postingRecordFor(posting);
  const decoded = bullets(section(research, /role decoded/i));
  const payResearch = bullets(section(research, /^##\s*pay/i)).concat(section(research, /^##\s*pay/i).split("\n").map(clean)).find((line) => /\$\s?\d/.test(line)) ?? null;
  const companyResearch = section(research, /what they sell/i).split("\n").map(clean).find((line) => line.length > 30) ?? null;
  const work = record.workSetup;
  const workArrangement = work ? work.text && work.mode && !new RegExp(work.mode === "onsite" ? "on[- ]?site|in[- ]office|in[- ]person" : work.mode, "i").test(work.text) ? `${work.mode === "onsite" ? "On-site" : work.mode[0]!.toUpperCase() + work.mode.slice(1)}: ${work.text}` : work.text : null;
  const pay = payResearch ? short(payResearch) : record.pay ? (/^[^:$]{2,30}:\s*[$£€]/.test(record.pay.line) && record.pay.line.length <= 160 ? record.pay.line.replace(/^[^:]{2,30}:\s*/, "") : record.pay.text) : null;
  return {
    summary: (decoded.length ? decoded : record.summary).slice(0, MAX_SUMMARY).map(short),
    responsibilities: record.responsibilities.slice(0, MAX_RESPONSIBILITIES).map((item) => short(clean(item))),
    requiredCount: record.requiredItems.length,
    experience: record.experience,
    workArrangement,
    workMode: work?.mode ?? null,
    pay,
    payRange: record.pay ? { min: record.pay.min, max: record.pay.max, currency: record.pay.currency, period: record.pay.period } : null,
    travel: record.travel ? short(record.travel) : null,
    seniority: record.seniority,
    workAuthorization: record.workAuthorization ? short(record.workAuthorization) : null,
    tools: record.tools.map((tool) => tool.name),
    company: companyResearch ? firstSentence(companyResearch) : record.companyLine,
    process: bullets(section(research, /interview process/i)).slice(0, 3).map(short),
    source: record.url,
    missing: record.missing.filter((field) => !(field === "summary" && decoded.length) && !(field === "pay" && payResearch)),
  };
}
