import { z } from "zod";
import { SENIORITY_LEVELS, WORK_MODES } from "./posting";
import { jobHealthSchema } from "./job-record";
import type { Readiness } from "./readiness";
import type { JobSearchSettings, JobSearchState, ScheduleInfo, SearchRun, SearchStatus, WatchedSuggestion } from "./job-search";
import type { TodayData } from "./today";

export const schemaVersion = 1;

export const workspaceStatusSchema = z.enum(["unconfigured", "ready", "error"]);
export const workspaceSummarySchema = z.object({
  path: z.string(),
  repositoryRoot: z.string().default(""),
  status: workspaceStatusSchema,
  contextFileCount: z.number().int().nonnegative(),
  jobCount: z.number().int().nonnegative(),
  hasIndex: z.boolean(),
  hasCandidateProfile: z.boolean().default(false),
  hasBaseResume: z.boolean().default(false),
  agyAvailable: z.boolean().default(false),
  warnings: z.array(z.string()).default([]),
});
export type WorkspaceSummary = z.infer<typeof workspaceSummarySchema>;

export const candidateEmployerSchema = z.object({
  name: z.string().min(1),
  title: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().nullable(),
  location: z.string().nullable().default(null),
  contextPaths: z.array(z.string()).default([]),
});

export const candidateEducationSchema = z.object({
  institution: z.string().min(1),
  degree: z.string().min(1),
  location: z.string().nullable().default(null),
  details: z.array(z.string()).default([]),
});

export const voicePresetSchema = z.object({
  id: z.string(),
  name: z.string(),
  tagline: z.string(),
  description: z.string(),
  toneGuidance: z.string(),
});
export type VoicePreset = z.infer<typeof voicePresetSchema>;

export const voiceSettingsSchema = z.object({
  tonePreset: z.string().default("direct_outcomes"),
  customGuidance: z.string().default(""),
  antiSlopStrictness: z.enum(["standard", "aggressive"]).default("aggressive"),
  interactiveQuestions: z.enum(["always", "on_gaps", "never"]).default("on_gaps"),
  narrativeDepth: z.enum(["journey_first", "balanced", "technical_proof"]).default("journey_first"),
});
export type VoiceSettings = z.infer<typeof voiceSettingsSchema>;

export const COVER_LETTER_FOCUS = ["career-story", "examples"] as const;
export type CoverLetterFocus = (typeof COVER_LETTER_FOCUS)[number];
export const DEFAULT_COVER_LETTER_LENGTH = { min: 200, max: 280 };
/** Extra words allowed past the target before the letter is refused. */
export const COVER_LETTER_HARD_MARGIN = 50;
export const coverLetterLengthSchema = z.object({ min: z.number().int().min(80).max(800), max: z.number().int().min(100).max(900) })
  .refine((value) => value.max >= value.min + 20, { message: "The longest length must be at least 20 words more than the shortest." });

export const candidateNarrativePillarsSchema = z.object({
  turningPoints: z.string().default(""),
  workingStyle: z.string().default(""),
  personalValues: z.string().default(""),
});
export type CandidateNarrativePillars = z.infer<typeof candidateNarrativePillarsSchema>;

/** Interview logistics the candidate states themselves. Prep uses them verbatim and never fills a blank. */
export const interviewLogisticsSchema = z.object({
  location: z.string().default(""),
  workAuthorization: z.string().default(""),
  compensation: z.string().default(""),
  noticePeriod: z.string().default(""),
  workArrangement: z.string().default(""),
});
export type InterviewLogistics = z.infer<typeof interviewLogisticsSchema>;
export const EMPTY_INTERVIEW_LOGISTICS: InterviewLogistics = { location: "", workAuthorization: "", compensation: "", noticePeriod: "", workArrangement: "" };

/**
 * The jobs a candidate is looking for (Recruiter Edition, plan R5): used to suggest who a posting suits. Every field
 * is optional; an empty one is never held against a posting.
 */
export const candidateTargetsSchema = z.object({
  /** Role titles, e.g. "Support Engineer", "Customer Success Manager". */
  roles: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  /** Places they can work from, e.g. "Denver", "Colorado", "United States". Ignored for remote postings. */
  locations: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  workModes: z.array(z.enum(WORK_MODES)).default([]),
  level: z.enum(SENIORITY_LEVELS).nullable().default(null),
  /** Lowest yearly pay they'd take, in US dollars. */
  salaryFloor: z.number().int().nonnegative().max(10_000_000).nullable().default(null),
  needsSponsorship: z.boolean().default(false),
  /** Companies never to apply to (the current employer is added from the resume automatically). */
  skipCompanies: z.array(z.string().trim().min(1).max(120)).max(40).default([]),
  /** Applications the recruiter aims to send per week (the candidate's package); null when there is none. */
  weeklyTarget: z.number().int().min(1).max(500).nullable().default(null),
  /** Jobs wait for the candidate's approval before they are tailored (recruiter plan R8 P5). */
  approval: z.boolean().default(false),
});
export type CandidateTargets = z.infer<typeof candidateTargetsSchema>;
export const EMPTY_CANDIDATE_TARGETS: CandidateTargets = { roles: [], locations: [], workModes: [], level: null, salaryFloor: null, needsSponsorship: false, skipCompanies: [], weeklyTarget: null, approval: false };

/**
 * Answers the employer's form asks for that the profile doesn't already hold (Recruiter Edition, plan R8 P3): the
 * recruiter enters them; they're shown with copy buttons while filling a form and are never sent to Agy.
 */
export const applicationFactsSchema = z.object({
  extra: z.array(z.object({ label: z.string().trim().min(1).max(80), value: z.string().trim().max(500) })).max(30).default([]),
});
export type ApplicationFacts = z.infer<typeof applicationFactsSchema>;

/** Instructions a recruiter writes for Agy (plan Q3): at most 12 lines of 300 characters, so Agy's context stays small. */
export const AGY_INSTRUCTION_LIMITS = { lines: 12, characters: 300 } as const;
export const agyInstructionsSchema = z.array(z.string().trim().min(1).max(AGY_INSTRUCTION_LIMITS.characters)).max(AGY_INSTRUCTION_LIMITS.lines);
/** Splits a text box into instruction lines (one per line, list markers removed, blanks dropped). */
export function instructionLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.replace(/^\s*[-*•]\s*/, "").trim()).filter(Boolean);
}

export const candidateProfileSchema = z.object({
  schemaVersion: z.literal(1),
  identity: z.object({
    fullName: z.string().min(1),
    artifactPrefix: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
    email: z.string().nullable().default(null),
    phone: z.string().nullable().default(null),
    location: z.string().nullable().default(null),
    links: z.array(z.string()).default([]),
  }),
  sources: z.object({
    baseResumePath: z.string().nullable(),
    secondaryResumePaths: z.array(z.string()).default([]),
    linkedinProfilePath: z.string().nullable().default(null),
    structuredContextRoots: z.array(z.string()).default(["context/structured"]),
    broadContextRoots: z.array(z.string()).default(["context/broad"]),
    denylistPath: z.string().nullable().default("context/denylist.md"),
    applicationVoicePath: z.string().nullable().default("context/application_voice_profile.md"),
  }),
  career: z.object({
    employers: z.array(candidateEmployerSchema).default([]),
    education: z.array(candidateEducationSchema).default([]),
    transitionSummary: z.string().default(""),
    preferredRoleFamilies: z.array(z.string()).default([]),
    narrativePillars: candidateNarrativePillarsSchema.default({
      turningPoints: "",
      workingStyle: "",
      personalValues: "",
    }),
  }),
  preferences: z.object({
    resume: z.object({
      // null = not chosen: off in the regular app, the recruiter's default in the Recruiter Edition.
      includeSummary: z.boolean().nullable().default(null),
      totalExperienceBullets: z.object({ min: z.number().int().min(1), max: z.number().int().min(1) }).default({ min: 10, max: 14 }),
      currentEmployerBullets: z.object({ min: z.number().int().min(1), max: z.number().int().min(1) }).default({ min: 6, max: 8 }),
      skillsCategories: z.array(z.string()).default([]),
    }),
    coverLetter: z.object({
      storyGuidance: z.array(z.string()).default([]),
      voiceGuidance: z.array(z.string()).default([]),
      narrativePillars: candidateNarrativePillarsSchema.default({
        turningPoints: "",
        workingStyle: "",
        personalValues: "",
      }),
      /** Target length in words; the hard limit is max + 50. Each candidate sets their own (default 200–280). */
      length: coverLetterLengthSchema.default(DEFAULT_COVER_LETTER_LENGTH),
      /** What carries the letter: the career story (default) or one or two worked examples. */
      focus: z.enum(COVER_LETTER_FOCUS).default("career-story"),
      /** Write cover letters at all; null = the edition's default (on in solo, off in the Recruiter Edition). */
      enabled: z.boolean().nullable().default(null),
    }),
    voice: voiceSettingsSchema.default({
      tonePreset: "direct_outcomes",
      customGuidance: "",
      antiSlopStrictness: "aggressive",
      interactiveQuestions: "on_gaps",
      narrativeDepth: "journey_first",
    }),
    interview: interviewLogisticsSchema.default(EMPTY_INTERVIEW_LOGISTICS),
    targets: candidateTargetsSchema.default(EMPTY_CANDIDATE_TARGETS),
    applicationFacts: applicationFactsSchema.default({ extra: [] }),
    /** Recruiter Edition (plan Q3): the recruiter's instructions to Agy for this candidate; they win over the recruiter's own. */
    agyInstructions: agyInstructionsSchema.default([]),
  }),
  truth: z.object({
    factualAuthority: z.string().default("Selected structured career evidence"),
    boundaries: z.array(z.string()).default([]),
    /** Client, partner, or project names that must never appear in public resumes or cover letters. */
    confidentialNames: z.array(z.string().min(1)).default([]),
  }),
  updatedAt: z.string(),
});
export type CandidateProfile = z.infer<typeof candidateProfileSchema>;

export const candidateProfileCreateSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  artifactPrefix: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
  narrativePillars: candidateNarrativePillarsSchema.optional(),
  transitionSummary: z.string().trim().max(600).optional(),
});
export type CandidateProfileCreate = z.infer<typeof candidateProfileCreateSchema>;

export const settingsSchema = z.object({
  schemaVersion: z.literal(schemaVersion),
  workspacePath: z.string().nullable(),
  baseResumePath: z.string().nullable(),
  secondaryResumePaths: z.array(z.string()).default([]),
  linkedinProfilePath: z.string().nullable().default(null),
  updatedAt: z.string(),
});
export type Settings = z.infer<typeof settingsSchema>;
export type SettingsUpdate = Pick<Settings, "baseResumePath"> & Partial<Pick<Settings, "secondaryResumePaths" | "linkedinProfilePath">>;

export const fileKindSchema = z.enum(["pdf", "docx", "rtf", "text", "json", "image", "unknown"]);
export const fileTreeNodeSchema: z.ZodType<FileTreeNode> = z.object({
  name: z.string(),
  displayName: z.string().optional(),
  subtitle: z.string().optional(),
  rating: z.number().min(0).max(5).nullable().optional(),
  relativePath: z.string(),
  kind: z.enum(["file", "directory"]),
  fileType: fileKindSchema.optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  modifiedAt: z.string().optional(),
  children: z.array(z.lazy(() => fileTreeNodeSchema)).optional(),
});
export interface FileTreeNode {
  name: string;
  displayName?: string;
  subtitle?: string;
  rating?: number | null;
  relativePath: string;
  kind: "file" | "directory";
  fileType?: z.infer<typeof fileKindSchema>;
  sizeBytes?: number;
  modifiedAt?: string;
  children?: FileTreeNode[];
}

export const filePreviewSchema = z.object({
  relativePath: z.string(),
  name: z.string(),
  fileType: fileKindSchema,
  sizeBytes: z.number().int().nonnegative(),
  modifiedAt: z.string(),
  canPreview: z.boolean(),
  content: z.string().nullable(),
  contentType: z.enum(["text", "html", "data-url"]).nullable(),
  dataUrl: z.string().nullable(),
  message: z.string().nullable(),
  jobCompany: z.string().nullable().default(null),
  jobTitle: z.string().nullable().default(null),
});
export type FilePreview = z.infer<typeof filePreviewSchema>;

export const markdownSaveInputSchema = z.object({
  relativePath: z.string().min(1),
  content: z.string().max(2 * 1024 * 1024),
  expectedContent: z.string().max(2 * 1024 * 1024),
  expectedModifiedAt: z.string().min(1),
});
export type MarkdownSaveInput = z.infer<typeof markdownSaveInputSchema>;

export const pdfTextSizeSchema = z.enum(["auto", "large", "largest"]);
export type PdfTextSize = z.infer<typeof pdfTextSizeSchema>;
/** Default PDF text size: 5% larger reads best on one page. Single owner. */
export const DEFAULT_PDF_TEXT_SIZE: PdfTextSize = "large";

export const pdfExportRequestSchema = z.object({
  relativePath: z.string().min(1),
  textSize: pdfTextSizeSchema.default(DEFAULT_PDF_TEXT_SIZE),
});
export type PdfExportRequest = z.infer<typeof pdfExportRequestSchema>;

export const exportedPdfSchema = z.object({
  relativePath: z.string(),
  name: z.string(),
  artifactType: z.enum(["resume", "cover-letter", "submission-checklist"]),
  pageCount: z.number().int().positive(),
  pageFillRatio: z.number().min(0).max(1).nullable().default(null),
  validationStatus: z.enum(["passed", "warning", "failed"]),
});
export type ExportedPdf = z.infer<typeof exportedPdfSchema>;

/** Application tracker, one per job: `jobs/<id>/.sensei/tracker.json`. Written only when the user changes it. */
export const TRACKER_STATUSES = ["saved", "applied", "interviewing", "offer", "rejected", "withdrawn"] as const;
export const trackerStatusSchema = z.enum(TRACKER_STATUSES);
export type TrackerStatus = z.infer<typeof trackerStatusSchema>;
const trackerDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");
export const trackerEventSchema = z.object({ at: z.string(), status: trackerStatusSchema });
/** Interview rounds, in order. "other" covers anything that is not one of the four standard rounds. */
export const INTERVIEW_ROUNDS = ["recruiter", "hiring_manager", "practical", "final", "other"] as const;
export type InterviewRoundKind = (typeof INTERVIEW_ROUNDS)[number];
/** One real interview (prep alone never counts). Entered by the user, or from a recording or debrief. */
export const interviewEventSchema = z.object({
  round: z.enum(INTERVIEW_ROUNDS),
  date: trackerDateSchema.nullable().default(null),
  note: z.string().max(500).default(""),
  source: z.enum(["user", "recording", "debrief"]).default("user"),
});
export type InterviewEvent = z.infer<typeof interviewEventSchema>;
export const OUTCOME_RESULTS = ["rejected", "withdrew", "no_reply", "offer", "accepted", "declined"] as const;
/** How the application ended: the furthest stage, the result, and why (the user's words). */
export const jobOutcomeSchema = z.object({
  stageReached: z.enum(["applied", ...INTERVIEW_ROUNDS, "offer"]).nullable().default(null),
  result: z.enum(OUTCOME_RESULTS).nullable().default(null),
  reason: z.string().max(500).default(""),
  date: trackerDateSchema.nullable().default(null),
});
export type JobOutcome = z.infer<typeof jobOutcomeSchema>;
export const jobTrackerSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  status: trackerStatusSchema.default("saved"),
  appliedAt: trackerDateSchema.nullable().default(null),
  nextFollowUpAt: trackerDateSchema.nullable().default(null),
  notes: z.string().max(5000).default(""),
  /** The user's own labels for the job ("referral", "dream job"); a filter on the Jobs page. */
  tags: z.array(z.string().max(30)).max(12).default([]),
  history: z.array(trackerEventSchema).max(200).default([]),
  interviews: z.array(interviewEventSchema).max(30).default([]),
  outcome: jobOutcomeSchema.nullable().default(null),
  updatedAt: z.string().nullable().default(null),
});
export type JobTracker = z.infer<typeof jobTrackerSchema>;
export const jobTrackerUpdateSchema = z.object({
  status: trackerStatusSchema.optional(),
  appliedAt: trackerDateSchema.nullable().optional(),
  nextFollowUpAt: trackerDateSchema.nullable().optional(),
  notes: z.string().max(5000).optional(),
  tags: z.array(z.string().max(30)).max(12).optional(),
  interviews: z.array(interviewEventSchema).max(30).optional(),
  outcome: jobOutcomeSchema.nullable().optional(),
}).strict();
export type JobTrackerUpdate = z.infer<typeof jobTrackerUpdateSchema>;

/** How far the drafts reach past the evidence (see electron/stretch-score.ts). Shown beside fit, never part of it. */
export const stretchScoreSchema = z.object({
  level: z.enum(["low", "medium", "high"]),
  tailoredPercent: z.number().min(0).max(100),
  average: z.number().min(0).max(3),
  counts: z.object({ asEvidence: z.number().int(), reworded: z.number().int(), framed: z.number().int(), unsupported: z.number().int() }),
  top: z.array(z.object({
    text: z.string(),
    artifact: z.enum(["resume", "cover-letter"]),
    level: z.number().int().min(0).max(3),
    reason: z.string(),
    evidenceIds: z.array(z.string()),
  })),
});
export type StretchScore = z.infer<typeof stretchScoreSchema>;

/** What a job is, for the Overview (electron/role-facts.ts). */
export const roleFactsSchema = z.object({
  summary: z.array(z.string()).default([]),
  responsibilities: z.array(z.string()).default([]),
  requiredCount: z.number().int().nonnegative().default(0),
  experience: z.string().nullable().default(null),
  workArrangement: z.string().nullable().default(null),
  workMode: z.enum(["remote", "hybrid", "onsite"]).nullable().default(null),
  pay: z.string().nullable().default(null),
  payRange: z.object({ min: z.number().nullable(), max: z.number().nullable(), currency: z.string().nullable(), period: z.enum(["year", "month", "hour"]).nullable() }).nullable().default(null),
  travel: z.string().nullable().default(null),
  seniority: z.string().nullable().default(null),
  workAuthorization: z.string().nullable().default(null),
  tools: z.array(z.string()).default([]),
  company: z.string().nullable().default(null),
  process: z.array(z.string()).default([]),
  source: z.string().nullable().default(null),
  missing: z.array(z.string()).default([]),
});
export type RoleFactsSummary = z.infer<typeof roleFactsSchema>;

export const jobFolderSummarySchema = z.object({
  id: z.string(),
  relativePath: z.string(),
  name: z.string(),
  title: z.string().nullable().default(null),
  company: z.string().nullable().default(null),
  createdAt: z.string(),
  modifiedAt: z.string(),
  artifactCount: z.number().int().nonnegative(),
  applicationStage: z.string().nullable().default(null),
  rating: z.number().min(0).max(5).nullable().default(null),
  ratingDecision: z.string().nullable().default(null),
  ratingConfidence: z.string().nullable().default(null),
  ratingHighlights: z.array(z.string()).default([]),
  ratingGaps: z.array(z.string()).default([]),
  /** The posting's required items as rated: met, learnable, or blocker. */
  mustHaves: z.array(z.object({ requirement: z.string(), status: z.enum(["met", "learnable", "blocker"]) })).default([]),
  /** Posting requirements rated as a gap or unclear, in the posting's words. */
  requirementGaps: z.array(z.string()).default([]),
  stretch: stretchScoreSchema.nullable().default(null),
  location: z.string().nullable().default(null),
  interviewRoundLabel: z.string().nullable().default(null),
  /** Interview round folders under interviews/ (prepared rounds, old and new formats). */
  interviewRoundCount: z.number().int().nonnegative().default(0),
  role: roleFactsSchema.nullable().default(null),
  hasApplicationMaterials: z.boolean().default(false),
  /** PDFs exist under the job's `pdfs/` folder, and when the newest was made (drafted vs applied, `src/shared/tracker.ts`). */
  hasPdfs: z.boolean().default(false),
  pdfsAt: z.string().nullable().default(null),
  /** Null until the user sets a status; the UI then shows "Saved". */
  tracker: jobTrackerSchema.nullable().default(null),
  /** How complete each area of the job is (from the job record). */
  health: jobHealthSchema.nullable().default(null),
  /** Posting tools in rows the evidence didn't cover (from the job record). */
  gapTerms: z.array(z.string()).default([]),
});
export type JobFolderSummary = z.infer<typeof jobFolderSummarySchema>;

export const searchResultKindSchema = z.enum(["job", "career", "application", "interview", "action"]);
export type SearchResultKind = z.infer<typeof searchResultKindSchema>;

export const searchQuerySchema = z.object({
  query: z.string().trim().min(1).max(100),
  limit: z.number().int().min(1).max(100).default(50),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const searchResultSchema = z.object({
  id: z.string().min(1),
  kind: searchResultKindSchema,
  title: z.string().min(1),
  subtitle: z.string().nullable().default(null),
  relativePath: z.string().nullable().default(null),
  jobId: z.string().nullable().default(null),
  company: z.string().nullable().default(null),
  excerpt: z.string().nullable().default(null),
  score: z.number().nonnegative(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const searchResponseSchema = z.object({
  query: z.string(),
  results: z.array(searchResultSchema),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;

export const artifactFileSchema = z.object({
  relativePath: z.string(),
  name: z.string(),
  fileType: fileKindSchema,
  sizeBytes: z.number().int().nonnegative(),
  modifiedAt: z.string(),
});
export type ArtifactFile = z.infer<typeof artifactFileSchema>;

export const interviewStageSchema = z.enum(["recruiter_screen", "hiring_manager", "technical", "practical_evaluation", "technical_challenge", "take_home", "onsite", "final_panel", "executive", "unknown"]);
export type InterviewStage = z.infer<typeof interviewStageSchema>;

export const interviewRoundStatusSchema = z.enum(["planned", "prep_ready", "completed", "debriefed"]);
export type InterviewRoundStatus = z.infer<typeof interviewRoundStatusSchema>;

export const challengeAssessmentModeSchema = z.enum(["live_coding", "debugging", "implementation_walkthrough", "system_design", "take_home", "case_study", "mixed", "unknown"]);
export type ChallengeAssessmentMode = z.infer<typeof challengeAssessmentModeSchema>;

export const interviewArtifactPathsSchema = z.object({
  research: z.string().nullable().default(null),
  prep: z.string().nullable().default(null),
  questionBank: z.string().nullable().default(null),
  challengeBrief: z.string().nullable().default(null),
  practiceLabs: z.string().nullable().default(null),
  debriefAnalysis: z.string().nullable().default(null),
});
export type InterviewArtifactPaths = z.infer<typeof interviewArtifactPathsSchema>;

export const interviewDashboardItemSchema = z.object({
  title: z.string().min(1),
  text: z.string().min(1),
  sourcePath: z.string().min(1),
  anchor: z.string().nullable().default(null),
  category: z.enum(["question", "answer", "career_story", "company_fact", "process", "technical", "challenge", "reverse_question", "caution", "debrief_lesson", "source"]).default("source"),
  priority: z.enum(["primary", "secondary", "reference"]).default("reference"),
  sourceType: z.enum(["round_artifact", "official", "reported", "career_evidence", "generated_projection"]).default("round_artifact"),
});
export type InterviewDashboardItem = z.infer<typeof interviewDashboardItemSchema>;

export const interviewDashboardBriefSchema = z.object({
  priorityQuestions: z.array(interviewDashboardItemSchema).default([]),
  quickAnswers: z.array(interviewDashboardItemSchema).default([]),
  companyFacts: z.array(interviewDashboardItemSchema).default([]),
  questionsToAsk: z.array(interviewDashboardItemSchema).default([]),
  cautions: z.array(interviewDashboardItemSchema).default([]),
  technicalTopics: z.array(interviewDashboardItemSchema).default([]),
  references: z.array(interviewDashboardItemSchema).default([]),
  availableArtifactCount: z.number().int().nonnegative().default(0),
  expectedArtifactCount: z.number().int().nonnegative().default(3),
});
export type InterviewDashboardBrief = z.infer<typeof interviewDashboardBriefSchema>;

export const interviewRoundSchema = z.object({
  id: z.string().min(1),
  sequence: z.number().int().positive(),
  stage: interviewStageSchema,
  label: z.string().min(1),
  interviewer: z.string().nullable().default(null),
  format: z.string().nullable().default(null),
  assessmentMode: challengeAssessmentModeSchema.nullable().default(null),
  scheduledDate: z.string().nullable().default(null),
  status: interviewRoundStatusSchema,
  legacy: z.boolean().default(false),
  artifactPaths: interviewArtifactPathsSchema,
  debriefSourcePaths: z.array(z.string()).default([]),
  dashboardBrief: interviewDashboardBriefSchema.nullable().default(null),
});
export type InterviewRound = z.infer<typeof interviewRoundSchema>;

export const knownInterviewStepSchema = z.object({
  stage: interviewStageSchema,
  label: z.string().min(1),
  interviewer: z.string().nullable().default(null),
  format: z.string().nullable().default(null),
  sourceType: z.enum(["official", "reported_by_interviewer", "reported", "inferred"]),
});
export type KnownInterviewStep = z.infer<typeof knownInterviewStepSchema>;

export const interviewOverviewSchema = z.object({
  schemaVersion: z.number().int().positive(),
  jobId: z.string().min(1),
  company: z.string().nullable().default(null),
  role: z.string().nullable().default(null),
  currentRoundId: z.string().nullable().default(null),
  rounds: z.array(interviewRoundSchema),
  knownProcess: z.array(knownInterviewStepSchema).default([]),
  isLegacy: z.boolean().default(false),
});
export type InterviewOverview = z.infer<typeof interviewOverviewSchema>;

export const challengePracticeTypeSchema = z.enum(["coding", "verbal"]);
export type ChallengePracticeType = z.infer<typeof challengePracticeTypeSchema>;

export const challengeDifficultySchema = z.enum(["warmup", "practical", "stretch"]);
export type ChallengeDifficulty = z.infer<typeof challengeDifficultySchema>;

export const challengeScoringCriterionSchema = z.object({
  criterion: z.string().min(1),
  points: z.number().int().positive(),
  strongPerformance: z.string().min(1),
});
export type ChallengeScoringCriterion = z.infer<typeof challengeScoringCriterionSchema>;

export const challengeExerciseSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  type: challengePracticeTypeSchema,
  title: z.string().min(1),
  difficulty: challengeDifficultySchema,
  timeboxMinutes: z.number().int().positive().max(180),
  jobRelevance: z.string().min(1),
  prompt: z.string().min(1),
  starterContext: z.string().nullable().default(null),
  requirements: z.array(z.string().min(1)).min(1),
  expectedOutput: z.string().nullable().default(null),
  acceptanceTests: z.array(z.string().min(1)).default([]),
  hints: z.array(z.string().min(1)).min(1).max(4),
  solution: z.string().min(1),
  explanation: z.string().min(1),
  commonMistakes: z.array(z.string().min(1)).min(1),
  followUpProbes: z.array(z.string().min(1)).min(1),
  evaluationCriteria: z.array(z.string().min(1)).min(1),
  scoringRubric: z.array(challengeScoringCriterionSchema).min(1),
  /** The JD line this exercise tests (required for new practice; checked by interview:check). */
  jdRequirement: z.string().min(1).optional(),
  /** "general craft" or "public docs: <url>": how a strong outside candidate could know this. */
  knowableFrom: z.string().min(1).optional(),
}).superRefine((exercise, context) => {
  if (exercise.type === "coding" && exercise.acceptanceTests.length === 0) {
    context.addIssue({ code: "custom", path: ["acceptanceTests"], message: "Coding labs require at least one acceptance test." });
  }
});
export type ChallengeExercise = z.infer<typeof challengeExerciseSchema>;

export const challengePracticeSchema = z.object({
  schemaVersion: z.literal(1),
  jobId: z.string().min(1),
  company: z.string().min(1),
  role: z.string().min(1),
  roundId: z.string().nullable().default(null),
  title: z.string().min(1),
  assessmentMode: challengeAssessmentModeSchema,
  sourceBasis: z.enum(["actual_prompt", "reported_process", "job_derived", "mixed"]),
  realPromptSupplied: z.boolean(),
  approximationNotice: z.string().nullable().default(null),
  /** URLs behind a reported or official process; required when sourceBasis is reported_process. */
  sources: z.array(z.string().min(1)).default([]),
  exercises: z.array(challengeExerciseSchema).min(1).max(12),
});
export type ChallengePractice = z.infer<typeof challengePracticeSchema>;

export const contextManifestSchema = z.object({
  schemaVersion: z.literal(schemaVersion),
  workspacePath: z.string(),
  baseResumePath: z.string().nullable(),
  secondaryResumePaths: z.array(z.string()).default([]),
  linkedinProfilePath: z.string().nullable().default(null),
  contextRoots: z.array(z.string()),
  fallbackReferenceRoots: z.array(z.string()).default(["fallback-references"]),
  policyPaths: z.array(z.string()).default(["context/denylist.md", "context/application_voice_profile.md"]),
  primaryContextRoots: z.array(z.string()).default(["context/structured"]),
  conditionalContextRoots: z.array(z.string()).default([]),
  selectedJobIds: z.array(z.string()),
  selectedJobPaths: z.array(z.string()),
  selectedCareerPaths: z.array(z.string()).default([]),
  selectedStructuredPaths: z.array(z.string()).default([]),
  selectedBroadPaths: z.array(z.string()).default([]),
  selectedJobFiles: z.array(z.string()).default([]),
  selectionMode: z.enum(["default", "explicit"]),
  scope: z.enum(["career-context", "selected-jobs"]),
  sourceFiles: z.array(z.object({ path: z.string(), modifiedAt: z.string(), sizeBytes: z.number().int().nonnegative(), sourceFamily: z.string().optional() })),
  generatedAt: z.string(),
  instructions: z.string(),
});
export type ContextManifest = z.infer<typeof contextManifestSchema>;

export const evidenceClassificationSchema = z.enum([
  "verified",
  "summary-derived",
  "supported-inference",
  "corroboration-required",
  "contradictory",
]);
export const evidenceEligibilitySchema = z.enum(["eligible", "corroboration-required", "blocked"]);
export const evidenceRecencySchema = z.enum(["current", "recent", "foundation", "unknown"]);
export type EvidenceRecency = z.infer<typeof evidenceRecencySchema>;

export const resumeFootprintSchema = z.object({
  sourcePath: z.string().min(1),
  format: z.enum(["markdown", "pdf", "docx", "unknown"]),
  status: z.enum(["reliable", "partial", "unavailable"]),
  wordCount: z.number().int().nonnegative().nullable(),
  experienceBulletCount: z.number().int().nonnegative().nullable(),
  currentEmployerBulletCount: z.number().int().nonnegative().nullable(),
  targetWordMin: z.number().int().nonnegative().nullable(),
  targetWordMax: z.number().int().nonnegative().nullable(),
  experienceWordCount: z.number().int().nonnegative().nullable().default(null),
  averageExperienceBulletWords: z.number().nonnegative().nullable().default(null),
  targetExperienceWordMin: z.number().int().nonnegative().nullable().default(null),
  targetExperienceWordMax: z.number().int().nonnegative().nullable().default(null),
  warnings: z.array(z.string()).default([]),
});
export type ResumeFootprint = z.infer<typeof resumeFootprintSchema>;

export const canonicalResumeEmployerSchema = z.object({
  name: z.string().min(1),
  protectedLines: z.array(z.string().min(1)).min(1),
  title: z.string().nullable().default(null),
  dateRange: z.string().nullable().default(null),
  location: z.string().nullable().default(null),
  originalBulletCount: z.number().int().nonnegative(),
  originalBullets: z.array(z.string().min(1)).default([]),
});
export type CanonicalResumeEmployer = z.infer<typeof canonicalResumeEmployerSchema>;

export const canonicalResumeBaselineSchema = z.object({
  schemaVersion: z.literal(1),
  baselineId: z.string().min(1),
  sourcePath: z.string().min(1),
  sourceSha256: z.string().min(1),
  structureSource: z.enum(["markdown", "docx"]),
  headerLines: z.array(z.string().min(1)).min(2),
  /** Optional summary section between the header and Skills ("Summary", "Professional Summary", "Profile", "About"). */
  summaryHeadingLine: z.string().min(1).optional(),
  originalSummaryLines: z.array(z.string().min(1)).optional(),
  skillsHeadingLine: z.string().min(1),
  professionalHeadingLine: z.string().min(1),
  employers: z.array(canonicalResumeEmployerSchema).min(1),
  educationHeadingLine: z.string().min(1),
  educationLines: z.array(z.string().min(1)).min(1),
  /** The base resume's own section order ("summary", "skills", "experience", "education", "extra:N"); kept on every draft. */
  sectionOrder: z.array(z.string().regex(/^(?:summary|skills|experience|education|extra:\d+)$/)).optional(),
  /** Other sections (licenses, certifications, projects…), kept word for word. */
  extraSections: z.array(z.object({ headingLine: z.string().min(1), lines: z.array(z.string().min(1)) })).optional(),
  originalSkillsLines: z.array(z.string().min(1)).min(1),
  footprint: resumeFootprintSchema,
  warnings: z.array(z.string()).default([]),
});
export type CanonicalResumeBaseline = z.infer<typeof canonicalResumeBaselineSchema>;

export const applicationDraftSchema = z.object({
  schemaVersion: z.literal(1),
  applicationRunId: z.string().min(1),
  evidenceSnapshotId: z.string().min(1),
  canonicalBaselineId: z.string().min(1),
  resume: z.object({
    /** Tailored summary; used only when the base resume has one and summary tailoring is on. */
    summary: z.string().min(1).optional(),
    skillsLines: z.array(z.string().min(1)).min(1),
    employers: z.array(z.object({
      name: z.string().min(1),
      bullets: z.array(z.string().min(1)).min(1),
    }).strict()).min(1),
  }).strict(),
  coverLetter: z.object({
    date: z.string().min(1),
    recipientLines: z.array(z.string().min(1)).min(1),
    salutation: z.string().min(1),
    bodyParagraphs: z.array(z.string().min(1)).min(1),
    closing: z.string().min(1).default("Sincerely,"),
  }).strict().nullable().default(null),
}).strict();
export type ApplicationDraft = z.infer<typeof applicationDraftSchema>;

export const evidenceSnapshotRowSchema = z.object({
  evidenceId: z.string().min(1),
  year: z.string(),
  startYear: z.number().int().nullable().optional(),
  endYear: z.number().int().nullable().optional(),
  isOngoing: z.boolean().optional(),
  recencyBand: evidenceRecencySchema.optional(),
  project: z.string(),
  employer: z.string().nullable().optional(),
  claim: z.string().min(1),
  scope: z.string(),
  sourcePath: z.string().min(1),
  sourceFamily: z.string().nullable(),
  sourceLocator: z.string(),
  confidence: z.string(),
  classification: evidenceClassificationSchema,
  eligibility: evidenceEligibilitySchema,
});
export type EvidenceSnapshotRow = z.infer<typeof evidenceSnapshotRowSchema>;

export const applicationEvidenceRouteSchema = z.object({
  evidenceId: z.string().min(1),
  relevanceScore: z.number().min(0).max(100),
  employer: z.string().nullable(),
  timeline: z.enum(["current", "recent", "prior", "unknown"]),
  maximumClassification: z.enum(["direct", "strong_transferable", "adjacent_transferable", "unclear", "gap"]),
  sourceAuthority: z.enum(["primary", "corroboration", "history"]).optional(),
  reason: z.string().min(1),
});
export type ApplicationEvidenceRoute = z.infer<typeof applicationEvidenceRouteSchema>;

export const applicationRoutingSchema = z.object({
  schemaVersion: z.literal(1),
  selectedEvidenceIds: z.array(z.string().min(1)),
  routes: z.array(applicationEvidenceRouteSchema),
  excludedEvidenceCount: z.number().int().min(0),
});
export type ApplicationRouting = z.infer<typeof applicationRoutingSchema>;

export const evidenceSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  snapshotId: z.string().min(1),
  jobId: z.string().min(1),
  generatedAt: z.string(),
  manifestGeneratedAt: z.string(),
  manifestHash: z.string().min(1),
  baseResumePath: z.string().min(1),
  baseResumeFootprint: resumeFootprintSchema.optional(),
  /** Whether this run writes a cover letter (src/shared/cover-letter-policy.ts); old snapshots always did. */
  coverLetterPlan: z.object({ write: z.boolean(), reason: z.string().nullable(), missing: z.array(z.string()).default([]), off: z.boolean().default(false) }).optional(),
  canonicalResume: canonicalResumeBaselineSchema.nullable().optional(),
  canonicalResumeWarnings: z.array(z.string()).default([]),
  secondaryResumePaths: z.array(z.string()),
  selectedStructuredPaths: z.array(z.string()),
  selectedBroadPaths: z.array(z.string()),
  selectedJobFiles: z.array(z.string()),
  policyPaths: z.array(z.string()).min(1),
  sourceFiles: z.array(z.object({
    path: z.string(),
    sha256: z.string(),
    sourceFamily: z.string().nullable(),
    sourceRole: z.enum(["structured", "employer-context", "broad", "linkedin", "base-resume", "secondary-resume", "policy", "job-description"]),
    contextText: z.string().optional(),
  })),
  evidenceRows: z.array(evidenceSnapshotRowSchema),
  applicationRouting: applicationRoutingSchema.optional(),
  denylistRules: z.array(z.object({
    ruleId: z.string().min(1),
    blockedClaim: z.string().min(1),
    safeHandling: z.string().min(1),
  })),
});
export type EvidenceSnapshot = z.infer<typeof evidenceSnapshotSchema>;

// What Agy gets about bullets (changed 2026-11-11): per role, how many bullets the base has, how many it may rewrite,
// and the most it may have. The earlier tailored/anchor/word targets contradicted the per-role counts and Agy spent most
// of a run reconciling them (live Recruiter Edition run: ~19,600 thinking tokens on bullet counts).
export const applicationResumePlanSchema = z.object({
  /** Older plans only; the checks now add up employerTargets[].maxBullets. */
  targetTotalBullets: z.number().int().min(1).max(30).optional(),
  customerFacingRole: z.boolean().default(false),
  targetCurrentEmployerCustomerBullets: z.number().int().min(0).max(4).default(0),
  customerFacingEvidenceIds: z.array(z.string().min(1)).max(10).default([]),
  // Older plans called maxBullets "targetBullets", which Agy read as a number to reach (2026-11-11).
  employerTargets: z.array(z.preprocess((value) => value && typeof value === "object" && "targetBullets" in value && !("maxBullets" in value) ? { ...(value as Record<string, unknown>), maxBullets: (value as { targetBullets: unknown }).targetBullets } : value, z.object({
    employer: z.string().min(1),
    /** Bullets in the base resume for this role. */
    baseBullets: z.number().int().nonnegative().optional(),
    /** The most bullets this role may have (base, or one more when more evidence is routed than it has bullets). */
    maxBullets: z.number().int().min(1).max(30),
    /** How many of its bullets may be rewritten for this job (the current role); the rest stay as written. */
    rewriteUpTo: z.number().int().nonnegative().optional(),
  }))).min(1),
});
export type ApplicationResumePlan = z.infer<typeof applicationResumePlanSchema>;

export const applicationCoverLetterBriefSchema = z.object({
  targetWordMin: z.number().int().min(1),
  targetWordMax: z.number().int().min(1),
  hardWordMax: z.number().int().min(1),
  /** Retired: JD lines fed to the model made letters lecture the employer. Kept optional for old contexts. */
  roleProblems: z.array(z.string().min(1)).max(6).optional(),
  company: z.string().nullable().optional(),
  role: z.string().nullable().optional(),
  /** What carries the letter (the candidate's setting); the checks read it. Older contexts have none. */
  focus: z.enum(COVER_LETTER_FOCUS).optional(),
  /** Paragraph-by-paragraph structure; the single owner of cover-letter structure. */
  structure: z.array(z.string().min(1)).optional(),
  introContract: z.array(z.string().min(1)).min(1).optional(),
  requiredElements: z.array(z.string().min(1)).min(1),
  prohibitedPatterns: z.array(z.string().min(1)).min(1),
});
export type ApplicationCoverLetterBrief = z.infer<typeof applicationCoverLetterBriefSchema>;

const applicationContextV1Schema = z.object({
  schemaVersion: z.literal(1),
  jobId: z.string().min(1),
  snapshotId: z.string().min(1),
  manifestHash: z.string().min(1),
  generatedAt: z.string(),
  baseResumePath: z.string().min(1),
  candidateProfile: candidateProfileSchema.nullable().optional(),
  canonicalResume: canonicalResumeBaselineSchema,
  footprint: resumeFootprintSchema,
  evidenceRows: z.array(evidenceSnapshotRowSchema),
  routes: z.array(applicationEvidenceRouteSchema),
  denylistRules: z.array(z.object({
    ruleId: z.string().min(1),
    blockedClaim: z.string().min(1),
    safeHandling: z.string().min(1),
  })),
  stylePolicy: z.object({
    path: z.string().min(1),
    text: z.string(),
  }),
  resumePlan: applicationResumePlanSchema.optional(),
  coverLetterBrief: applicationCoverLetterBriefSchema.optional(),
  secondaryResumePaths: z.array(z.string()),
  instructions: z.array(z.string().min(1)).min(1),
});

const compactEvidenceRowSchema = z.object({
  evidenceId: z.string().min(1),
  claim: z.string().min(1),
  scope: z.string(),
  employer: z.string().nullable(),
  project: z.string(),
  sourcePath: z.string().min(1).optional(),
  sourceFamily: z.string().nullable().optional(),
  timeline: z.enum(["current", "recent", "prior", "unknown"]),
  eligibility: evidenceEligibilitySchema,
  maximumClassification: z.enum(["direct", "strong_transferable", "adjacent_transferable", "unclear", "gap"]),
  sourceAuthority: z.enum(["primary", "corroboration", "history"]),
});

const applicationContextV2Schema = z.object({
  schemaVersion: z.literal(2),
  jobId: z.string().min(1),
  snapshotId: z.string().min(1),
  manifestHash: z.string().min(1),
  generatedAt: z.string(),
  baseResumePath: z.string().min(1),
  job: z.object({
    company: z.string().nullable(),
    title: z.string().nullable(),
    location: z.string().nullable(),
  }),
  candidate: z.object({
    fullName: z.string().min(1),
    artifactPrefix: z.string().min(1),
    transitionSummary: z.string(),
    preferredRoleFamilies: z.array(z.string()),
    storyGuidance: z.array(z.string()).optional(),
    voiceGuidance: z.array(z.string()).optional(),
  }),
  resumeTemplate: z.object({
    baselineId: z.string().min(1),
    /** Present only when the base resume has a summary; `editable` follows the Settings toggle. */
    summary: z.object({ original: z.string(), editable: z.boolean() }).optional(),
    originalSkillsLines: z.array(z.string()),
    employers: z.array(z.object({
      name: z.string().min(1),
      originalBulletCount: z.number().int().nonnegative(),
      originalBullets: z.array(z.string()).optional(),
      baselineBullets: z.array(z.object({
        text: z.string().min(1),
        evidenceIds: z.array(z.string().min(1)),
      })).optional(),
    })),
    editableSkillCategories: z.array(z.string()),
  }),
  footprint: resumeFootprintSchema,
  /** Older contexts: the posting's required items, rated in a Must-Have table. */
  mustHaves: z.array(z.object({ id: z.string().min(1), requirement: z.string().min(1) })).optional(),
  /** The posting's required items and main responsibilities; the evaluation rates each one (req:N). */
  requirements: z.array(z.object({ id: z.string().min(1), text: z.string().min(1), kind: z.enum(["required", "responsibility"]) })).optional(),
  /** The fit score below which the app reports the job as under the gate. */
  fitGate: z.number().optional(),
  evidenceRows: z.array(compactEvidenceRowSchema),
  denylistRules: z.array(z.object({
    ruleId: z.string().min(1),
    blockedClaim: z.string().min(1),
    safeHandling: z.string().min(1),
  })),
  styleRules: z.array(z.string().min(1)),
  resumePlan: applicationResumePlanSchema.optional(),
  coverLetterBrief: applicationCoverLetterBriefSchema.optional(),
  instructions: z.array(z.string().min(1)).min(1),
});

export const applicationContextSchema = z.discriminatedUnion("schemaVersion", [
  applicationContextV1Schema,
  applicationContextV2Schema,
]);
export type ApplicationContext = z.infer<typeof applicationContextSchema>;

const claimTimelineSchema = z.preprocess(
  (value) => value === "foundation" || value === "recent" ? "prior" : value,
  z.enum(["current", "prior", "transition", "employer-specific"]).nullable().default(null),
);

const careerArcTimelineSchema = z.preprocess(
  (value) => value === "foundation" || value === "recent" ? "prior" : value,
  z.enum(["current", "prior", "transition"]),
);

export const auditClaimMappingSchema = z.object({
  publicText: z.string().min(1),
  claimType: z.enum(["candidate", "framed", "employer", "non-factual", "baseline"]),
  evidenceIds: z.array(z.string().min(1)).default([]),
  sourcePaths: z.array(z.string().min(1)).default([]),
  timeline: claimTimelineSchema,
  ownership: z.string().nullable().default("").transform((value) => value ?? ""),
});

export const priorityScoresSchema = z.object({
  jdRelevance: z.number().min(0).max(5),
  evidenceStrength: z.number().min(0).max(5),
  recency: z.number().min(0).max(5),
  roleRepresentation: z.number().min(0).max(5),
  weightedTotal: z.number().min(0).max(5),
});
export type PriorityScores = z.infer<typeof priorityScoresSchema>;

export const metricOpportunitySchema = z.object({
  proposedOutcome: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)).min(1),
  requiredInputs: z.array(z.string().min(1)).min(1),
  calculationMethod: z.string().min(1),
  status: z.enum(["verified", "calculable", "needs_user_confirmation"]),
});
export type MetricOpportunity = z.infer<typeof metricOpportunitySchema>;

export const resumeAuditJsonSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  artifactType: z.literal("resume"),
  publicArtifact: z.string().min(1),
  validationStatus: z.enum(["passed", "failed"]),
  applicationRunId: z.string().min(1).optional(),
  evidenceSnapshotId: z.string().min(1),
  manifestHash: z.string().min(1),
  baseResumePath: z.string().min(1),
  claimMappings: z.array(auditClaimMappingSchema),
  sideBySideChanges: z.array(z.object({
    employer: z.string().min(1),
    originalText: z.string(),
    tailoredText: z.string().min(1),
    evidenceIds: z.array(z.string().min(1)).min(1),
    reason: z.string().min(1),
    priorityScores: priorityScoresSchema.optional(),
  })),
  suggestedAdditionalBullets: z.array(z.object({
    text: z.string().min(1),
    evidenceIds: z.array(z.string().min(1)).min(1),
  })).default([]),
  metricOpportunities: z.array(metricOpportunitySchema).default([]),
}).superRefine((audit, context) => {
  if (audit.schemaVersion !== 2) return;
  if (!audit.applicationRunId) context.addIssue({ code: "custom", message: "Audit v2 requires applicationRunId.", path: ["applicationRunId"] });
  audit.sideBySideChanges.forEach((change, index) => {
    if (!change.priorityScores) context.addIssue({ code: "custom", message: "Audit v2 changes require priority scores.", path: ["sideBySideChanges", index, "priorityScores"] });
  });
});
export type ResumeAuditJson = z.infer<typeof resumeAuditJsonSchema>;

export const coverLetterAuditJsonSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  artifactType: z.literal("cover-letter"),
  publicArtifact: z.literal("cover_letter.md"),
  validationStatus: z.enum(["passed", "failed"]),
  applicationRunId: z.string().min(1).optional(),
  evidenceSnapshotId: z.string().min(1),
  manifestHash: z.string().min(1),
  baseResumePath: z.string().min(1),
  claimMappings: z.array(auditClaimMappingSchema),
  careerArc: z.array(z.object({
    stage: z.string().min(1),
    timeline: careerArcTimelineSchema,
    evidenceIds: z.array(z.string().min(1)).min(1),
  })).min(2),
}).superRefine((audit, context) => {
  if (audit.schemaVersion === 2 && !audit.applicationRunId) context.addIssue({ code: "custom", message: "Audit v2 requires applicationRunId.", path: ["applicationRunId"] });
});
export type CoverLetterAuditJson = z.infer<typeof coverLetterAuditJsonSchema>;

export const applicationEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  applicationRunId: z.string().min(1),
  evidenceSnapshotId: z.string().min(1),
  manifestHash: z.string().min(1),
  baseResumePath: z.string().min(1),
  resume: z.object({
    publicArtifact: z.string().min(1),
    claimMappings: z.array(auditClaimMappingSchema),
  }),
  coverLetter: z.object({
    publicArtifact: z.literal("cover_letter.md"),
    claimMappings: z.array(auditClaimMappingSchema),
    careerArc: z.array(z.object({
      stage: z.string().min(1),
      timeline: careerArcTimelineSchema,
      evidenceIds: z.array(z.string().min(1)).min(1),
    })).min(2),
  }).nullable().default(null),
  excludedClaims: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
});
export type ApplicationEvidence = z.infer<typeof applicationEvidenceSchema>;

const evidenceLinkedTextSchema = z.object({
  text: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)).default([]),
}).strict();

/** Keep base-resume bullet N (1-based, from resumeTemplate.employers[i].baselineBullets) unchanged, without retyping it. */
const baselineBulletRefSchema = z.object({
  baseline: z.number().int().min(1),
}).strict();

export const applicationBundleSchema = z.object({
  schemaVersion: z.literal(1),
  applicationRunId: z.string().min(1),
  evidenceSnapshotId: z.string().min(1),
  canonicalBaselineId: z.string().min(1),
  evaluationMarkdown: z.string().min(1),
  resume: z.object({
    summary: evidenceLinkedTextSchema.optional(),
    skillsLines: z.array(evidenceLinkedTextSchema).min(1),
    /** Employers left out are kept exactly as in the base resume. */
    employers: z.array(z.object({
      name: z.string().min(1),
      bullets: z.array(z.union([evidenceLinkedTextSchema, baselineBulletRefSchema])).min(1),
    }).strict()).min(1),
  }).strict(),
  coverLetter: z.object({
    date: z.string().min(1),
    recipientLines: z.array(z.string().min(1)).min(1),
    salutation: z.string().min(1),
    bodyParagraphs: z.array(z.object({
      sentences: z.array(evidenceLinkedTextSchema).min(1),
    }).strict()).min(1),
    closing: z.string().min(1).default("Sincerely,"),
  }).strict().nullable().optional(),
  excludedClaims: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
}).strict();
export type ApplicationBundle = z.infer<typeof applicationBundleSchema>;
export type EvidenceLinkedText = z.infer<typeof evidenceLinkedTextSchema>;
/** A bundle after baseline references and omitted employers have been filled in. */
export type ExpandedApplicationBundle = Omit<ApplicationBundle, "resume"> & {
  resume: { summary?: EvidenceLinkedText; skillsLines: EvidenceLinkedText[]; employers: Array<{ name: string; bullets: EvidenceLinkedText[] }> };
};

export const applicationRunStateSchema = z.enum(["snapshot_ready", "matched", "drafted", "validated", "stale"]);
export const applicationRunSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1),
  jobId: z.string().min(1),
  snapshotId: z.string().min(1),
  manifestHash: z.string().min(1),
  baseResumePath: z.string().min(1),
  canonicalBaselineId: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
  state: applicationRunStateSchema,
  previousRunId: z.string().nullable().default(null),
  validatedAt: z.string().nullable().default(null),
  validationAttempts: z.number().int().nonnegative().default(0),
  maxValidationAttempts: z.literal(1).default(1),
  lastValidationStatus: z.enum(["passed", "failed", "not_ready"]).nullable().default(null),
});
export type ApplicationRun = z.infer<typeof applicationRunSchema>;

export const validationIssueSchema = z.object({
  code: z.string().min(1),
  artifact: z.string().min(1),
  field: z.string().nullable().default(null),
  message: z.string().min(1),
  expected: z.string().nullable().default(null),
  actual: z.string().nullable().default(null),
  repairHint: z.string().min(1),
  severity: z.enum(["error", "warning"]).default("error"),
  explanation: z.object({
    sentence: z.string().min(1).nullable().default(null),
    claimType: z.string().nullable().default(null),
    evidenceIds: z.array(z.string().min(1)).default([]),
    sources: z.array(z.object({
      evidenceId: z.string().min(1),
      sourcePath: z.string().min(1),
      claim: z.string().min(1),
    })).default([]),
  }).nullable().default(null),
});
export type ValidationIssue = z.infer<typeof validationIssueSchema>;
export type ValidationIssueExplanation = z.infer<typeof validationIssueSchema>["explanation"];


export const applicationValidationReportSchema = z.object({
  status: z.enum(["passed", "failed", "not_ready"]),
  jobId: z.string().min(1),
  runId: z.string().nullable(),
  snapshotId: z.string().nullable(),
  manifestHash: z.string().nullable(),
  fitScore: z.number().min(0).max(5).nullable().default(null),
  fitConfidence: z.enum(["high", "medium", "low"]).nullable().default(null),
  gateStatus: z.string().nullable().default(null),
  /** Why no cover letter was written for this run (null when one was); shown on the job page. */
  coverLetterSkipped: z.string().nullable().default(null),
  ats: z.object({
    status: z.enum(["passed", "warning", "not_exported", "unavailable"]),
    pdfPath: z.string().nullable(),
    extractedCharacters: z.number().int().nonnegative(),
    missingFields: z.array(z.string()),
  }).nullable().default(null),
  keywordClasses: z.array(z.object({
    term: z.string().min(1),
    classification: z.enum(["supported", "transferable", "unsupported"]),
    evidenceIds: z.array(z.string()),
  })).default([]),
  stretch: stretchScoreSchema.nullable().default(null),
  issues: z.array(validationIssueSchema),
});
export type ApplicationValidationReport = z.infer<typeof applicationValidationReportSchema>;

export const applicationStatusSchema = z.object({
  jobId: z.string().min(1),
  state: z.enum(["not_started", "snapshot_ready", "matched", "drafted", "validated", "stale", "invalid"]),
  run: applicationRunSchema.nullable(),
  footprint: resumeFootprintSchema.nullable(),
  canonicalBaselineId: z.string().nullable().default(null),
  templateIntegrity: z.enum(["passed", "failed", "unavailable", "not_checked"]).default("not_checked"),
  snapshotConsistent: z.boolean(),
  manifestCurrent: z.boolean(),
  publicResumePath: z.string().nullable(),
  resumeBulletCount: z.number().int().nonnegative().nullable(),
  currentEmployerBulletCount: z.number().int().nonnegative().nullable(),
  recentCurrentEmployerBulletCount: z.number().int().nonnegative().nullable(),
  validation: applicationValidationReportSchema.nullable(),
});
export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;

export const contextSelectionSchema = z.object({
  jobIds: z.array(z.string()).default([]),
  careerPaths: z.array(z.string()).default([]),
  structuredPaths: z.array(z.string()).default([]),
  broadPaths: z.array(z.string()).default([]),
  jobPaths: z.array(z.string()).default([]),
});
export type ContextSelection = z.infer<typeof contextSelectionSchema>;

export const bulletBankItemSchema = z.object({
  id: z.string(),
  themeId: z.string(),
  employerName: z.string(),
  text: z.string(),
  evidenceIds: z.array(z.string()).default([]),
  metrics: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  updatedAt: z.string(),
});
export type BulletBankItem = z.infer<typeof bulletBankItemSchema>;

export const bulletBankThemeSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  keywords: z.array(z.string()).default([]),
});
export type BulletBankTheme = z.infer<typeof bulletBankThemeSchema>;

export const bulletBankSchema = z.object({
  schemaVersion: z.literal(1),
  themes: z.array(bulletBankThemeSchema).default([]),
  bullets: z.array(bulletBankItemSchema).default([]),
  updatedAt: z.string(),
});
export type BulletBank = z.infer<typeof bulletBankSchema>;


/** Job links waiting to be sent to Agy one at a time: `.sensei/job_queue.json` in the workspace. */
export const jobQueueItemSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{6,40}$/),
  /** A link Agy fetches, or a JD pasted in the app and saved under the item's ID (`.sensei/staged-jds/<id>.md`). */
  kind: z.enum(["link", "paste"]).default("link"),
  url: z.string().url().max(400).refine((value) => /^https?:\/\//i.test(value), "Use an http(s) link.").nullable().default(null),
  /** What the queue shows before a job folder exists, e.g. "Northstar Labs, Support Analyst". */
  label: z.string().max(200).nullable().default(null),
  /** What the user typed with a paste ("focus on the API work"); passed to Agy in the prompt. */
  note: z.string().max(200).nullable().default(null),
  /** Sent from the chat: runs when Agy is free even while automatic running is paused. */
  manual: z.boolean().default(false),
  addedAt: z.string(),
  status: z.enum(["queued", "running", "done", "needs_attention"]),
  sentAt: z.string().nullable().default(null),
  finishedAt: z.string().nullable().default(null),
  jobId: z.string().nullable().default(null),
}).refine((item) => item.kind === "paste" || item.url !== null, "A link item needs its link.");
export type JobQueueItem = z.infer<typeof jobQueueItemSchema>;
export const jobQueueSchema = z.object({ autoRun: z.boolean().default(true), items: z.array(jobQueueItemSchema).max(50).default([]) });
export type JobQueue = z.infer<typeof jobQueueSchema>;

/** The latest pipeline run, shown above the terminal. Read from files the commands already write. */
export type RunStatus = {
  kind: "fetch" | "application" | "interview";
  jobId: string | null;
  roundId: string | null;
  label: string;
  at: string;
  durationSeconds: number | null;
  state: "running" | "passed" | "warnings" | "failed";
  fitScore: number | null;
  gate: string | null;
  issues: Array<{ severity: "error" | "warning"; code: string; message: string }>;
};

/** A written question from an application form or a paste (electron/application-questions.ts). */
export type ApplicationQuestion = {
  id: string;
  label: string;
  /** Word limit from the question ("[150 words max]", "1000 characters" ≈ 166 words, "2-3 sentences" ≈ 75); null when none is given. */
  wordLimit: number | null;
  /** Sentence limit from the question ("In 2-3 sentences" → 3); null when none is given. */
  sentenceLimit?: number | null;
  /** The question asks for the candidate's own words ("Please write this one yourself"): notes only, never a draft. */
  writeYourself: boolean;
  required: boolean;
  /** Plainly logistics ("How did you hear about us?"): skipped without asking Agy. */
  logistics?: boolean;
  /** The user pressed "Answer anyway": Agy must answer it, not skip it. */
  force?: boolean;
};
/** What Agy decided for a question: answer it, skip it (with a reason), or give notes only (write-yourself). */
export type QuestionDecision = "answer" | "skip" | "notes";
/** How a question is answered: a real example, why this company, how the candidate would go about it, or other. */
export type QuestionKind = "experience" | "motivation" | "approach" | "other";
export type QuestionAnswer = { id: string; text: string | null; notes: string[]; evidenceIds: string[]; storyIds: string[]; words: number; issues: string[]; decision?: QuestionDecision; kind?: QuestionKind; reason?: string | null };
/** A job's application questions and their background answers (`jobs/<id>/.sensei/application_questions.json`). */
export type QuestionsState = {
  source: "posting" | "pasted";
  sourceUrl: string | null;
  status: "reading" | "answering" | "done" | "failed" | "none";
  questions: ApplicationQuestion[];
  answers: QuestionAnswer[];
  message: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationSeconds: number | null;
  conversationId: string | null;
};

export type RecordingInfo = { path: string; size: number; state: "new" | "changed" | "imported" | "duplicate" | "skipped"; duplicateOf: string | null; jobId: string | null };
type ContentItemInfo = { file: string; section: string; key: string; text: string };
export type ContentReviewInfo = { added: ContentItemInfo[]; upgraded: Array<{ before: ContentItemInfo; after: ContentItemInfo }>; replaced: Array<{ before: ContentItemInfo; after: ContentItemInfo | null; replacement: string; why: string }>; lost: Array<{ before: ContentItemInfo; after: ContentItemInfo | null }>; files: string[]; changeListFound: boolean };

/** Files added to career context from the app: where each went (workspace-relative) and what was skipped and why. */
export type ContextImportResult = { added: string[]; skipped: Array<{ name: string; reason: string }> };

export interface SenseiApi {
  /** Recruiter Edition only: the candidate list and switching (electron/candidate-ipc.ts). */
  candidates: {
    state(): Promise<import("./candidates").CandidatesState>;
    /** Adds a candidate with their base resume, extra files, and notes, then opens them; reload the window afterwards. */
    add(name: string, intake?: { resumePath?: string | null; files?: string[]; notes?: string | null }): Promise<{ entry: import("./candidates").CandidateEntry; resume: { ok: true; lines: string[] } | { ok: false; message: string } | null; files: string[]; skipped: Array<{ name: string; reason: string }> }>;
    /** Absolute paths of a chosen resume or extra files; empty when cancelled. */
    chooseFiles(kind: "resume" | "files" | "image"): Promise<string[]>;
    /** Opens another candidate; reload the window afterwards. */
    switchTo(id: string): Promise<void>;
    /** Closes the open candidate; reload to show the Candidates page. */
    showAll(): Promise<void>;
    /** The recruiter's name, agency, and defaults for every candidate. */
    recruiterSettings(): Promise<import("./candidates").RecruiterSettings>;
    saveRecruiterSettings(input: { recruiterName?: string | null; agency?: string | null; defaults?: import("./candidates").RecruiterDefaults; agyInstructions?: string[] }): Promise<import("./candidates").RecruiterSettings>;
    rename(id: string, name: string): Promise<import("./candidates").CandidateEntry>;
    setStatus(id: string, status: import("./candidates").CandidateStatus): Promise<import("./candidates").CandidateEntry>;
    /** The open candidate's recruiter notes (recruiter plan R4). */
    notes(): Promise<string>;
    /** Saves them as a context file and returns its path, to be checked for Agy. */
    saveNotes(notes: string): Promise<string>;
    /** Another candidate with jobs waiting, so the queue can move on to them (recruiter plan R5). */
    nextQueued(): Promise<{ id: string; name: string; waiting: number } | null>;
    /** Saves a .zip of the candidate's folder where the recruiter chooses; null when cancelled (recruiter plan R6). */
    exportCandidate(candidateId: string): Promise<{ path: string; files: number } | null>;
    /** Deletes a candidate for good; the typed name must match. Returns what was removed. */
    deleteCandidate(candidateId: string, typedName: string): Promise<{ name: string; removed: string[] }>;
    /** A drafted job's resume lines, what changed from the base, and the evidence behind each change (recruiter plan R8). */
    review(jobId: string): Promise<import("./review").ApplicationReview>;
    /** Jobs waiting for a candidate's approval, and the weekly report (recruiter plan R8 P5). */
    proposals(candidateId: string): Promise<import("./recruiter-insight").Proposal[]>;
    approveProposal(candidateId: string, proposalId: string): Promise<void>;
    declineProposal(candidateId: string, proposalId: string): Promise<void>;
    report(candidateId: string, from: string, to: string): Promise<import("./recruiter-insight").ReportRow[]>;
    /** Proof of what was sent (recruiter plan R8 P4): read, record (Mark applied), undo, add a confirmation. */
    submission(jobId: string): Promise<import("./submission").Submission | null>;
    markApplied(jobId: string): Promise<import("./submission").Submission>;
    undoApplied(jobId: string): Promise<void>;
    /** `path` from a drop; without one the app asks for the file. */
    addConfirmation(jobId: string, path?: string): Promise<import("./submission").Submission | null>;
    /** Saves the open candidate's application facts sheet (recruiter plan R8 P3). */
    saveFacts(input: { email?: string; phone?: string; location?: string; links?: string[]; workAuthorization?: string; compensation?: string; noticePeriod?: string; workArrangement?: string; extra?: Array<{ label: string; value: string }> }): Promise<CandidateProfile>;
    /** Every job across candidates (recruiter plan R5). */
    pipeline(): Promise<import("./candidate-match").PipelineRow[]>;
    /** Sets one status on several jobs; returns each job's status before, for Undo. */
    setPipelineStatus(entries: Array<{ candidateId: string; jobId: string }>, status: TrackerStatus): Promise<Array<{ candidateId: string; jobId: string; previous: TrackerStatus }>>;
    /** Posting library: fetch or save a posting once, then send it to one or more candidates. */
    stageLink(url: string, postingId: string): Promise<import("./candidate-match").LibraryPosting>;
    stagePaste(text: string, postingId: string): Promise<import("./candidate-match").LibraryPosting>;
    setPostingCompany(postingId: string, company: string): Promise<import("./candidate-match").LibraryPosting>;
    suggest(postingId: string): Promise<import("./candidate-match").CandidateSuggestion[]>;
    /** Returns the open candidate's queue item (the window adds it) and who else got it. */
    send(postingId: string, candidateIds: string[]): Promise<{ active: { pasteId: string; label: string | null } | null; queued: string[]; proposed: string[] }>;
    /** Every posting in the library with who it went to (Postings page). */
    library(): Promise<import("./candidate-match").LibraryEntry[]>;
  };
  setup: {
    readiness(): Promise<Readiness>;
  };
  /** Interview content refresh: recordings the app has seen, and the update Agy runs on only the new ones. */
  content: {
    recordings(): Promise<{ recordings: RecordingInfo[]; pending: { startedAt: string; recordings: Array<{ path: string }> } | null }>;
    startUpdate(): Promise<string>;
    reviewUpdate(): Promise<ContentReviewInfo>;
    finishUpdate(keepOld: string[]): Promise<{ restored: number }>;
    undoUpdate(): Promise<void>;
    skip(paths: string[]): Promise<void>;
  };
  /** Today: what happened, what's due, insights, and questions (electron/today.ts). */
  /** Workspace folders: preview the tidy layout, apply it, undo it. */
  layout: {
    plan(): Promise<LayoutPlan>;
    apply(): Promise<LayoutPlan>;
    undo(): Promise<{ restored: number; skipped: string[] }>;
  };
  today: {
    get(): Promise<TodayData>;
    answer(id: string, answer: string): Promise<{ addedPath: string | null; queued: boolean }>;
    removeQuestion(id: string): Promise<void>;
    keepPosting(jobId: string): Promise<void>;
    closePosting(jobId: string): Promise<void>;
    onChanged(callback: () => void): () => void;
  };
  /** Job Search: settings, the inbox of found postings, and the search run (Agy finds links; the app checks them). */
  jobSearch: {
    get(): Promise<{ settings: JobSearchSettings; state: JobSearchState; status: SearchStatus }>;
    saveSettings(settings: JobSearchSettings): Promise<JobSearchSettings>;
    /** Starts a run in the background; progress arrives through onStatus, the result through onFinished. */
    run(mode?: "search" | "watched"): Promise<void>;
    suggestWatched(): Promise<WatchedSuggestion[]>;
    /** Agy's light rating for up to 10 matches, in the background; the result message arrives through onRated. */
    rate(ids: string[]): Promise<void>;
    scheduleInfo(): Promise<ScheduleInfo>;
    clearPending(ids: string[]): Promise<JobSearchState>;
    onRated(callback: (message: string) => void): () => void;
    onStatus(callback: (status: SearchStatus) => void): () => void;
    onFinished(callback: (run: SearchRun | null) => void): () => void;
    setStatus(ids: string[], status: "new" | "dismissed"): Promise<JobSearchState>;
    saveJob(id: string): Promise<string>;
    openPosting(id: string): Promise<void>;
    stage(id: string, pasteId: string, auto?: boolean): Promise<string>;
    onUpdated(callback: (state: JobSearchState) => void): () => void;
  };
  app: {
    copyText(text: string): Promise<void>;
    /** A newer GitHub release, or null (also null for builds without a recorded release source). */
    checkUpdate(): Promise<{ version: string; url: string } | null>;
    openRelease(url: string): Promise<void>;
  };
  workspace: {
    getSummary(): Promise<WorkspaceSummary>;
    rescan(): Promise<WorkspaceSummary>;
    /** Called with the workspace-relative paths that changed (empty when unknown). */
    onChanged(callback: (paths: string[]) => void): () => void;
  };
  profile: {
    get(): Promise<CandidateProfile | null>;
    create(input: CandidateProfileCreate): Promise<CandidateProfile>;
    updatePreferences(preferences: CandidateProfile["preferences"]): Promise<CandidateProfile>;
    /** Saves the writing-voice file (context/application_voice_profile.md); returns its path. */
    saveVoice(text: string): Promise<string>;
    updateDetails(details: { transitionSummary?: string; confidentialNames?: string[]; boundaries?: string[]; interviewLogistics?: Partial<InterviewLogistics> }): Promise<CandidateProfile>;
    /** What Agy will receive from the profile and voice profile on the next run. */
    preview(): Promise<{ styleRules: string[]; instructions: string[]; baseResumeHasSummary: boolean | null; interviewLogistics: string[]; storyBankPath: string | null }>;
  };
  bulletBank: {
    get(): Promise<BulletBank>;
    save(bank: BulletBank): Promise<BulletBank>;
  };
  settings: {
    get(): Promise<Settings>;
    save(input: SettingsUpdate): Promise<Settings>;
    chooseResume(role: "base" | "secondary" | "linkedin"): Promise<Settings>;
    removeSecondary(path: string): Promise<Settings>;
  };
  files: {
    listTree(): Promise<FileTreeNode[]>;
    preview(relativePath: string): Promise<FilePreview>;
    saveMarkdown(input: MarkdownSaveInput): Promise<FilePreview>;
    deletePath(relativePath: string): Promise<void>;
    reveal(relativePath: string): Promise<void>;
    /** The local path of a file dropped on the window (empty when it has none). */
    pathForFile(file: File): string;
    getBaseResume(): Promise<string | null>;
    exportMarkdownPdf(relativePath: string, textSize?: PdfTextSize): Promise<ExportedPdf>;
  };
  jobs: {
    list(): Promise<JobFolderSummary[]>;
    listTree(): Promise<FileTreeNode[]>;
    listArtifacts(jobId: string): Promise<ArtifactFile[]>;
    previewArtifact(jobId: string, relativePath: string): Promise<FilePreview>;
    getApplicationStatus(jobId: string): Promise<ApplicationStatus>;
    validateApplication(jobId: string): Promise<ApplicationValidationReport>;
    updateTracker(jobId: string, update: JobTrackerUpdate): Promise<JobTracker>;
    /** Saves a pasted JD where `jd:fetch` stages links; Agy then gets one short prompt. */
    /** Saves CSV text to a file the user picks; returns its path, or null when cancelled. */
    exportCsv(csv: string): Promise<string | null>;
    /** Saves a pasted JD under its queue item ID (`paste-…`). */
    stagePastedJd(text: string, id: string): Promise<{ company: string | null; title: string | null; suggestedJobId: string | null }>;
    /** Fetches a posting in the app and saves it under a paste ID; throws a plain message when the page can't be read. */
    stageLink(url: string, id: string): Promise<{ company: string | null; title: string | null; suggestedJobId: string | null }>;
    /** The company the user named for a saved paste that names none. */
    setStagedCompany(id: string, company: string): Promise<{ company: string | null; title: string | null; suggestedJobId: string | null }>;
  };
  interviews: {
    getOverview(jobId: string): Promise<InterviewOverview | null>;
    listRounds(jobId: string): Promise<InterviewRound[]>;
    setCurrentRound(jobId: string, roundId: string): Promise<InterviewOverview | null>;
    refreshDashboard(jobId: string): Promise<InterviewOverview | null>;
    /** `live` opens the compact always-on-top live window instead of the full interview window. */
    openWorkspaceWindow(jobId: string, roundId: string, live?: boolean): Promise<void>;
    setLiveCollapsed(collapsed: boolean): Promise<void>;
  };
  runs: {
    latest(): Promise<RunStatus | null>;
    /** Pushed by the main process when the latest run changes (one watcher for the whole app). */
    onChanged(callback: (run: RunStatus | null) => void): () => void;
  };
  /** Scenario questions answered by a background Agy (electron/question-agent.ts). */
  questions: {
    get(jobId: string): Promise<{ state: QuestionsState | null; running: boolean }>;
    auto(jobId: string): Promise<void>;
    ask(jobId: string, text: string): Promise<void>;
    retry(jobId: string): Promise<void>;
    /** Answers a question Agy (or the logistics filter) skipped. */
    answerAnyway(jobId: string, questionId: string): Promise<void>;
    onUpdated(callback: (jobId: string, state: QuestionsState) => void): () => void;
  };
  queue: {
    get(): Promise<JobQueue>;
    save(queue: JobQueue): Promise<JobQueue>;
  };
  search: {
    query(input: SearchQuery): Promise<SearchResponse>;
  };
  context: {
    getManifest(selection?: ContextSelection): Promise<ContextManifest>;
    addFiles(kind: "structured" | "broad"): Promise<ContextImportResult>;
    importPaths(paths: string[], kind: "structured" | "broad"): Promise<ContextImportResult>;
    getActiveManifest(): Promise<ContextManifest | null>;
    getSources(): Promise<string[]>;
    onUpdated(callback: (manifest: ContextManifest) => void): () => void;
  };
  terminal: {
    start(input: { cwd?: string }): Promise<{ cwd: string; agyStarted?: boolean }>;
    setContext(input: ContextSelection): Promise<ContextManifest>;
    write(data: string): Promise<void>;
    insertPrompt(text: string): Promise<void>;
    resize(input: { cols: number; rows: number }): Promise<void>;
    restart(): Promise<{ cwd: string; agyStarted?: boolean }>;
    status(): Promise<{ running: boolean; agy: boolean; startedAt: number | null; lastOutputAt: number | null; screen: "ready" | "blocked" | "unknown"; recentOutput: string }>;
    stop(): Promise<void>;
    onData(callback: (data: string) => void): () => void;
    onExit(callback: (code: number) => void): () => void;
  };
}

export type LayoutMove = { from: string; to: string; kind: "move" | "archive"; reason: string };
/** What tidying the workspace folders would do (version 2 = already tidy). */
export type LayoutPlan = { version: 1 | 2; moves: LayoutMove[]; conflicts: string[]; notes: string[]; canUndo: boolean };
