// Evidence rows that come from the candidate's own files rather than from evidence tables (ledger T8, recruiter plan R4).
// - The base resume's lines are rows in both editions (`base:` IDs), so a reworded base line can cite the line it rewords.
//   They earn no fit credit (ledger T5; fit-scoring.ts reads isBaseResumeRow).
// - With features.candidateFilesEligible (Recruiter Edition), checked files without evidence tables (other resumes,
//   LinkedIn, notes, recruiter notes) become line rows (`file:` IDs) that may back a claim alone.
import type { CanonicalResumeBaseline, EvidenceSnapshotRow } from "../src/shared/schemas";

export const BASE_ROW_PREFIX = "base:";
export const FILE_ROW_PREFIX = "file:";
export const BASE_RESUME_FAMILY = "base-resume";

export const isBaseResumeRow = (evidenceId: string) => evidenceId.startsWith(BASE_ROW_PREFIX);

function recency(value: string): Pick<EvidenceSnapshotRow, "startYear" | "endYear" | "isOngoing" | "recencyBand"> {
  const years = [...value.matchAll(/\b(?:19|20)\d{2}\b/g)].map((match) => Number(match[0]));
  const isOngoing = /\bpresent\b|\bcurrent\b|\bongoing\b|\bnow\b/i.test(value);
  const currentYear = new Date().getFullYear();
  const startYear = years[0] ?? null;
  const endYear = isOngoing ? currentYear : years.at(-1) ?? null;
  const recencyBand = isOngoing ? "current" : endYear !== null && endYear >= currentYear - 1 ? "recent" : endYear !== null ? "foundation" : "unknown";
  return { startYear, endYear, isOngoing, recencyBand };
}

const plain = (value: string) => value.replace(/\\([\\().,+-])/g, "$1").replace(/\[([^\]]+)]\([^)]*\)/g, "$1").replace(/[*_`#]/g, "").replace(/\s+/g, " ").trim();

/** One row per base-resume bullet (assigned to its role's employer) and per skills line (no employer). */
export function baseResumeRows(resume: CanonicalResumeBaseline | null | undefined, baseResumePath: string | null | undefined): EvidenceSnapshotRow[] {
  if (!resume || !baseResumePath) return [];
  const common = { sourcePath: baseResumePath, sourceFamily: BASE_RESUME_FAMILY, confidence: "high", classification: "verified", eligibility: "eligible" } as const;
  const roles = resume.employers.flatMap((employer, roleIndex) => employer.originalBullets.map((bullet, bulletIndex) => ({
    ...common,
    evidenceId: `${BASE_ROW_PREFIX}r${roleIndex + 1}:b${bulletIndex + 1}`,
    year: employer.dateRange ?? "",
    ...recency(employer.dateRange ?? ""),
    project: [employer.name, employer.title].filter(Boolean).join(", "),
    employer: employer.name,
    claim: plain(bullet),
    scope: "The base resume's own line: the candidate's approved claim, at the confidence the base states it.",
    sourceLocator: `${employer.name}, bullet ${bulletIndex + 1}`,
  })));
  const skills = (resume.originalSkillsLines ?? []).map((line, index) => ({
    ...common,
    evidenceId: `${BASE_ROW_PREFIX}skills:${index + 1}`,
    year: "",
    ...recency(""),
    project: "Skills",
    employer: null,
    claim: plain(line),
    scope: "A skills line from the base resume; names what the candidate lists, not where they used it.",
    sourceLocator: `Skills, line ${index + 1}`,
  }));
  return [...roles, ...skills].filter((row) => row.claim);
}

const slug = (path: string) => path.replace(/^context\//, "").replace(/\.[a-z0-9]+$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const MAX_FILE_ROWS = 80;

/**
 * Line rows from a checked candidate file that has no evidence table: each bullet or sentence-length line becomes a
 * row. The employer is the base-resume employer the line (or the heading above it) names; otherwise none, so the row
 * can back skills, letters, and career-wide claims but never a bullet under a specific role. A line with no dates of its
 * own takes its role's dates from the base resume.
 */
export function candidateFileRows(text: string, sourcePath: string, sourceFamily: string | null, roles: Array<{ name: string; dateRange?: string | null }>): EvidenceSnapshotRow[] {
  const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const named = (line: string) => roles.find((role) => key(role.name).length >= 3 && key(line).includes(key(role.name)))?.name ?? null;
  const roleDates = (employer: string | null) => roles.find((role) => role.name === employer)?.dateRange ?? "";
  const rows: EvidenceSnapshotRow[] = [];
  let sectionEmployer: string | null = null;
  let sectionYears = "";
  for (const raw of text.replaceAll("\r\n", "\n").split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed || /^\|/.test(trimmed) || /^[-*]\s*(?:source_role|source_locator|confidence|employer|factual_authority|public_use):/i.test(trimmed) || /^-{3,}$/.test(trimmed)) continue;
    const isBullet = /^[-*+•]\s+/.test(trimmed) || /^\d+[.)]\s+/.test(trimmed);
    const line = plain(trimmed.replace(/^[-*+•]\s+|^\d+[.)]\s+/, ""));
    const words = line.split(/\s+/).length;
    if (!isBullet && (words < 6 || /^#/.test(trimmed))) {
      // A heading or short line starts a section; it may name an employer and dates for the lines below it.
      sectionEmployer = named(line) ?? (words <= 12 ? null : sectionEmployer);
      sectionYears = /\b(?:19|20)\d{2}\b|present/i.test(line) ? line : "";
      continue;
    }
    if (words < 4) continue;
    const employer = named(line) ?? sectionEmployer;
    const years = /\b(?:19|20)\d{2}\b/.test(line) ? line : sectionYears || roleDates(employer);
    rows.push({
      evidenceId: `${FILE_ROW_PREFIX}${slug(sourcePath)}:${rows.length + 1}`,
      year: years.match(/\b(?:19|20)\d{2}\b(?:\s*[-–]\s*(?:\b(?:19|20)\d{2}\b|present))?/i)?.[0] ?? "",
      ...recency(years),
      project: employer ?? "",
      employer,
      claim: line,
      scope: "From a file the candidate or their recruiter supplied; usable as written, without adding to it.",
      sourcePath,
      sourceFamily,
      sourceLocator: `Line ${rows.length + 1}`,
      confidence: "candidate-supplied",
      classification: "verified",
      eligibility: "eligible",
    });
    if (rows.length >= MAX_FILE_ROWS) break;
  }
  return rows;
}
