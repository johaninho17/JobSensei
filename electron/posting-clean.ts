// One cleanup for every posting the app saves (pastes and fetched links), so Agy, the requirement parser, the
// question answerer, and the posting page all read the same text: the application form is split off (its questions
// are kept apart for the Questions tab), invisible characters and button text are removed, and a plain paste gets a
// header (title, company, location, source) and real headings.

/** A job's application form text, split off its posting (`jobs/<id>/.sensei/application_form.md`). */
export const APPLICATION_FORM_FILE = ".sensei/application_form.md";

/** Where a posting turns into the board's application form (Greenhouse, Lever, Ashby, Workday). */
export const APPLICATION_FORM = /^\s*#{0,6}\s*\**\s*(?:apply for this job|apply for this position|submit (?:your )?application|application form|voluntary self-identification|\*?\s*indicates a required field)\b/im;
/** Zero-width and other invisible characters that break heading matches ("Key R͏esponsibilities"). */
const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁤⁪-⁯﻿]/g;
/** Lines that are page buttons or navigation, not posting text. */
const BUTTON_LINE = /^\s*(?:apply(?: now| here| today)?|back to (?:jobs|all jobs|search)|save(?: job)?|share(?: this job)?|print|view all jobs|see all jobs)\s*$/i;
/** Labels whose value sits on the next line in copied career pages ("Job Category" / "Software Engineering"). */
const LABELS = ["job identification", "job id", "requisition id", "req id", "job category", "category", "business unit", "department", "team", "posting date", "date posted", "posted", "location", "locations", "apply before", "closing date", "job schedule", "schedule", "employment type", "job type", "base pay/salary", "base pay", "salary", "pay range", "compensation", "work arrangement", "workplace type", "experience level", "seniority level"];

/** The posting and, when the text ends in an application form, that form's text. */
export function splitApplicationForm(text: string): { posting: string; form: string | null } {
  const match = APPLICATION_FORM.exec(text);
  if (!match) return { posting: text, form: null };
  return { posting: text.slice(0, match.index).trimEnd(), form: text.slice(match.index).trim() };
}

export function stripInvisible(text: string): string {
  return text.replace(INVISIBLE, "");
}

const isAllCaps = (line: string) => line.length <= 60 && /[A-Z]{3}/.test(line) && !/[a-z]/.test(line) && !/^\s*[-*•]/.test(line);
const sentenceCase = (line: string) => line.charAt(0).toUpperCase() + line.slice(1).toLowerCase();

/**
 * Plain pasted text → readable Markdown: ALL-CAPS lines and short "Label:" lines become headings, a known label with
 * its value on the next line becomes one "**Label:** value" line. Text that already has Markdown headings is kept.
 */
export function formatPlainPosting(text: string): string {
  if (/^#{1,3}\s/m.test(text)) return text;
  const lines = text.split("\n");
  const out: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    const label = line.replace(/:$/, "");
    const next = lines.slice(index + 1).find((candidate) => candidate.trim())?.trim();
    if (LABELS.includes(label.toLowerCase()) && next && next.length <= 100 && !LABELS.includes(next.replace(/:$/, "").toLowerCase()) && !isAllCaps(next)) {
      out.push(`**${label}:** ${next}  `);
      index = lines.indexOf(lines.slice(index + 1).find((candidate) => candidate.trim())!, index + 1);
      continue;
    }
    if (isAllCaps(line)) { out.push("", `## ${sentenceCase(line.replace(/:$/, ""))}`, ""); continue; }
    if (/^[A-Z][^.!?]{2,58}:$/.test(line) && !/^\s*[-*•]/.test(line)) { out.push("", `### ${line.replace(/:$/, "")}`, ""); continue; }
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export type CleanPosting = { markdown: string; form: string | null };

/**
 * The saved posting: form split off, invisible characters and button lines removed, and (for plain pastes) a header
 * and headings. `header` is added only when the text has no top-level heading of its own.
 */
export function cleanPosting(text: string, header: { title: string | null; company: string | null; location: string | null; source: string }): CleanPosting {
  const normalized = stripInvisible(text.replace(/\r\n?/g, "\n"));
  const { posting, form } = splitApplicationForm(normalized);
  const kept = posting.split("\n").filter((line) => !BUTTON_LINE.test(line)).join("\n").trim();
  if (/^#\s/m.test(kept)) return { markdown: `${kept}\n`, form };
  const body = formatPlainPosting(header.title ? kept.replace(new RegExp(`^\\s*${escape(header.title)}\\s*\\n`), "") : kept);
  const lines = [
    `# ${header.title ?? "Job Description"}`,
    "",
    ...(header.company ? [`**Company:** ${header.company}  `] : []),
    ...(header.location ? [`**Location:** ${header.location}  `] : []),
    `**Source:** ${header.source}`,
    "",
  ];
  return { markdown: `${lines.join("\n")}\n${body}\n`, form };
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A link to a board's apply page → the posting itself (Lever `/apply`, Ashby `/application`, Greenhouse `#app`),
 * so the description is fetched instead of the form.
 */
export function postingUrl(url: string): string {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return url; }
  if (/^jobs\.(?:eu\.)?lever\.co$/i.test(parsed.hostname)) parsed.pathname = parsed.pathname.replace(/\/apply\/?$/, "");
  if (/^jobs\.ashbyhq\.com$/i.test(parsed.hostname)) parsed.pathname = parsed.pathname.replace(/\/application\/?$/, "");
  if (/greenhouse\.io$/i.test(parsed.hostname) && parsed.hash === "#app") parsed.hash = "";
  return parsed.toString();
}

/**
 * Board page titles that wrap the role ("Job Application for Data Analyst at Northstar", "Northstar - Data Analyst")
 * → the role and company.
 */
export function splitPageTitle(title: string): { title: string; company: string | null } {
  const application = /^job application for (.+?) at (.+)$/i.exec(title.trim());
  if (application) return { title: application[1]!.trim(), company: application[2]!.trim() };
  return { title: title.trim(), company: null };
}

/** Questions written in a form's text (lines asking something), with required-field markers removed. */
export function formQuestionLines(form: string): string[] {
  return form.split("\n")
    .map((line) => line.replace(/^\s*(?:#{1,6}\s*|[-*•]\s*|\d+[.)]\s*)/, "").replace(/\s*[✱*]+\s*$/, "").replace(/\*\*/g, "").trim())
    .filter((line) => line.length >= 12 && (/\?/.test(line) || /^(?:tell|describe|explain|share|walk|give|please (?:describe|tell|share|explain))\b/i.test(line)));
}
