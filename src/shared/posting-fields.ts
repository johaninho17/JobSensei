// One normal form for the facts every posting has (issue #53): company, title, location, employment type, posted date.
// Used by the posting record (electron/posting-record.ts) for every source, by Job Search (jobKey), and by the
// recruiter's candidate matching (sameCompany), so the same job found two ways reads the same. Pay has its own owner
// (src/shared/pay.ts, parsePay in posting-record.ts); its text as written is kept beside the numbers.

const LEGAL_SUFFIX = /[,\s]+(?:inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|gmbh|ag|plc|s\.?a|s\.?a\.?s|b\.?v|n\.?v|pty|s\.? de r\.?l\.?(?: de c\.?v)?|sas|srl|oy|ab)\.?$/i;
const SITE_WORDS = /\s*(?:[-–|:]\s*)?(?:candidate experience(?: page)?|careers?(?: site| page)?|jobs?(?: site| page| board)?|job openings|hiring|recruiting)\s*$/i;

/** The company as people say it: legal suffixes, career-site words, and entity codes removed ("Acme, Inc." → "Acme"). */
export function normalCompany(value: string | null | undefined): string | null {
  let name = (value ?? "").replace(/\s+/g, " ").trim();
  if (!name) return null;
  name = name.replace(/^\d{2,}\s+/, "");
  for (let pass = 0; pass < 3; pass += 1) {
    const next = name.replace(SITE_WORDS, "").replace(LEGAL_SUFFIX, "").replace(/[,\s]+$/, "").trim();
    if (next === name) break;
    name = next;
  }
  return name.length >= 2 ? name : null;
}

/** A key that matches the same company however it is written. */
export function companyKey(value: string | null | undefined): string {
  return (normalCompany(value) ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** The job title without the site or company glued on ("Support Engineer | Acme Careers" → "Support Engineer"). */
export function normalTitle(value: string | null | undefined, company?: string | null): string | null {
  let title = (value ?? "").replace(/\s+/g, " ").trim();
  if (!title) return null;
  title = title.replace(/^(?:job application for|apply for|job:)\s+/i, "");
  const key = companyKey(company);
  const parts = title.split(/\s+(?:\||–|—|-|@| at )\s+/);
  if (parts.length > 1) {
    const kept = parts.filter((part, index) => index === 0 || !(SITE_WORDS.test(` ${part}`) || /careers?|jobs?$/i.test(part) || (key && companyKey(part) === key)));
    title = kept.join(" - ");
  }
  return title.trim() || null;
}

const COUNTRY = /^(?:united states(?: of america)?|usa|us|u\.s\.a?\.?)$/i;

/**
 * The location as "City, Region" (US) or "City, Country": "Philadelphia, PA, United States" → "Philadelphia, PA",
 * "Mexico - Mexico City" → "Mexico City, Mexico", "Remote - US" → "Remote (US)".
 */
export function normalLocation(value: string | null | undefined): string | null {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const remote = text.match(/^remote\b[\s,:\-–()]*(.*?)\)?$/i);
  if (remote) {
    const where = remote[1]!.trim().replace(/^(?:in|-)\s*/i, "");
    return where ? `Remote (${COUNTRY.test(where) ? "US" : where})` : "Remote";
  }
  // "Country - City" (Workday) becomes "City, Country".
  const dashed = text.match(/^([A-Za-z .]+?)\s+-\s+([A-Za-z .]+)$/);
  if (dashed && !/,/.test(text)) return `${dashed[2]!.trim()}, ${dashed[1]!.trim()}`;
  const parts = text.split(/\s*,\s*/).filter(Boolean);
  if (parts.length >= 2 && COUNTRY.test(parts.at(-1)!)) parts.pop();
  return parts.join(", ");
}

export const EMPLOYMENT_TYPES = ["Full-time", "Part-time", "Contract", "Temporary", "Internship"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

/** Full time / FULL_TIME / FT → "Full-time"; null when the text names none. */
export function normalEmploymentType(value: string | null | undefined): EmploymentType | null {
  const text = (value ?? "").toLowerCase().replace(/[_-]+/g, " ");
  if (/\bintern(?:ship)?\b/.test(text)) return "Internship";
  if (/\b(?:contract(?:or)?|freelance|1099)\b/.test(text)) return "Contract";
  if (/\b(?:temp(?:orary)?|seasonal)\b/.test(text)) return "Temporary";
  if (/\bpart time\b|\bpt\b/.test(text)) return "Part-time";
  if (/\bfull time\b|\bft\b|\bpermanent\b|\bregular\b/.test(text)) return "Full-time";
  return null;
}

/** A posted date as YYYY-MM-DD from an ISO date or a written one ("Nov 13, 2026"); null for relative words. */
export function normalPostedDate(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  const iso = text.match(/\b(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1]!;
  const parsed = /\b\d{4}\b/.test(text) ? new Date(text.replace(/^posted(?: on)?:?\s*/i, "")) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}` : null;
}
