// Editions: one codebase, chosen at build time (ledger U15). This file is the single owner of what each edition
// contains. Code checks `features.*`, never the edition name, so every left-out area has exactly one switch.

export const EDITIONS = ["solo", "recruiter"] as const;
export type Edition = (typeof EDITIONS)[number];

export type Features = {
  /** Interview prep: rounds, coach, technical challenge, live window, "What happened?", recorded interviews. */
  interviews: boolean;
  /** Application questions answered by the background Agy. */
  applicationQuestions: boolean;
  /** Interview content refresh from new recordings (debrief folder). */
  contentRefresh: boolean;
  /** Interviews → Learnings. */
  learnings: boolean;
  /** Story bank and interview voice. */
  interviewProfile: boolean;
  /** Follow-up dates, stale-application nudges, "N new career files". */
  nudges: boolean;
  /** Job Search: finding postings on boards, watched companies, and scheduled searches. */
  jobSearch: boolean;
  /** Several candidates in one folder (recruiter plan R1). */
  candidates: boolean;
  /** Every checked candidate file is eligible evidence on its own, including files without evidence tables (recruiter plan R4). */
  candidateFilesEligible: boolean;
  /** Cover letters are off until turned on per candidate, and need enough material (recruiter plan R7). */
  coverLetterOptIn: boolean;
  /** Today page: morning matches, what's due, insights, questions, closed-posting checks (builds on Job Search and interviews). */
  today: boolean;
  /** Drafts mark a job applied (solo: sent through Sensei); off where a recruiter sends and marks it (recruiter plan R8). */
  draftsMarkApplied: boolean;
};

const FEATURES: Record<Edition, Features> = {
  solo: { interviews: true, applicationQuestions: true, contentRefresh: true, learnings: true, interviewProfile: true, nudges: true, jobSearch: true, candidates: false, candidateFilesEligible: false, coverLetterOptIn: false, today: true, draftsMarkApplied: true },
  recruiter: { interviews: false, applicationQuestions: false, contentRefresh: false, learnings: false, interviewProfile: false, nudges: false, jobSearch: false, candidates: true, candidateFilesEligible: true, coverLetterOptIn: true, today: false, draftsMarkApplied: false },
};

export type EditionInfo = {
  edition: Edition;
  /** Window title and installer name. */
  productName: string;
  appId: string;
  /** Small print under "JobSensei" (null in solo). */
  subtitle: string | null;
  /** Short mark where space is short (null in solo). */
  badge: string | null;
  /** Port of the dev server (`npm run dev`), different per edition so both can run side by side. */
  devPort: number;
  /** Default folder under Documents in an installed app. */
  defaultFolder: string;
  /** Prefix of installer file names. */
  artifactName: string;
};

export const EDITION_INFO: Record<Edition, EditionInfo> = {
  solo: { edition: "solo", productName: "JobSensei", appId: "com.jobsensei.desktop", subtitle: null, badge: null, devPort: 5173, defaultFolder: "JobSensei", artifactName: "JobSensei" },
  recruiter: { edition: "recruiter", productName: "JobSensei Recruiter Edition", appId: "com.jobsensei.recruiter", subtitle: "Recruiter Edition", badge: "RE", devPort: 5174, defaultFolder: "JobSensei Recruiter", artifactName: "JobSensei-Recruiter-Edition" },
};

export function featuresFor(edition: Edition): Features {
  return FEATURES[edition];
}

export function parseEdition(value: unknown): Edition {
  return value === "recruiter" ? "recruiter" : "solo";
}

/**
 * Agy runtime files that belong to a feature. The workspace sync seeds an entry only when its feature is on, and
 * removes it otherwise; the recruiter build leaves them out of its resources too (scripts/edition-build.mjs).
 */
export const FEATURE_AGENT_ENTRIES: Record<string, keyof Features> = {
  "skills/jobsensei-interview-pipeline": "interviews",
  "skills/jobsensei-interview-coach": "interviews",
  "skills/jobsensei-technical-challenge": "interviews",
  "workflows/jobsensei-challenge.md": "interviews",
  "workflows/jobsensei-interview-review.md": "contentRefresh",
  "workflows/jobsensei-story-bank.md": "interviewProfile",
  "workflows/jobsensei-file-answers.md": "today",
};

/** `sensei` pipeline commands that belong to a feature (all others are in every edition). */
export const FEATURE_COMMANDS: Record<string, keyof Features> = {
  "interview:context": "interviews",
  "interview:check": "interviews",
};

/** Compiled main-process modules that only a feature uses; the recruiter build leaves them out. */
export const FEATURE_MODULES: Record<string, keyof Features> = {
  "interview-ipc": "interviews",
  "interviews": "interviews",
  "interview-context": "interviews",
  "interview-check": "interviews",
  "interview-backfill": "interviews",
  "question-ipc": "applicationQuestions",
  "question-agent": "applicationQuestions",
  "application-questions": "applicationQuestions",
  "content-ipc": "contentRefresh",
  "content-refresh": "contentRefresh",
  "today-ipc": "today",
  "today": "today",
  "answer-filing": "today",
  "search-ipc": "jobSearch",
  "job-search": "jobSearch",
  "job-search-runner": "jobSearch",
  "job-boards": "jobSearch",
  "search-schedule": "jobSearch",
  "scheduled-search": "jobSearch",
  "candidate-ipc": "candidates",
  "posting-library": "candidates",
  pipeline: "candidates",
  "zip-folder": "candidates",
  "candidate-intake": "candidates",
  "application-review": "candidates",
  "candidate-facts": "candidates",
  submission: "candidates",
  proposals: "candidates",
};

export function includedAgentEntry(features: Features, entry: string): boolean {
  const feature = FEATURE_AGENT_ENTRIES[entry];
  return !feature || features[feature];
}

export function includedCommand(features: Features, name: string): boolean {
  const feature = FEATURE_COMMANDS[name];
  return !feature || features[feature];
}

/**
 * AGENTS.md, PRIVACY.md, and TERMS.md mark feature-only text with `<!-- feature:<name> -->` … `<!-- /feature -->`
 * (whole sections or a few words). Text whose feature is off is removed; the markers stay out of every copy.
 */
export function featureText(features: Features, text: string): string {
  return text
    .replace(/<!-- feature:(\w+) -->\n?([\s\S]*?)<!-- \/feature -->\n?/g, (_match, name: string, body: string) => (features[name as keyof Features] === false ? "" : body))
    .replace(/\n{3,}/g, "\n\n");
}
export const agentsMdFor = featureText;

/** Marker written into a workspace so each edition can tell its own folders apart (`.sensei/edition.json`). */
export const EDITION_MARKER = ".sensei/edition.json";

export function folderMismatchMessage(current: Edition, folder: Edition): string | null {
  if (current === folder) return null;
  return `This folder belongs to ${EDITION_INFO[folder].productName}. Open it there, or choose another folder.`;
}
