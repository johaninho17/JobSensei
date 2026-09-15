import { z } from "zod";

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
  }),
  preferences: z.object({
    resume: z.object({
      includeSummary: z.boolean().default(false),
      totalExperienceBullets: z.object({ min: z.number().int().min(1), max: z.number().int().min(1) }).default({ min: 10, max: 14 }),
      currentEmployerBullets: z.object({ min: z.number().int().min(1), max: z.number().int().min(1) }).default({ min: 6, max: 8 }),
      skillsCategories: z.array(z.string()).default([]),
    }),
    coverLetter: z.object({
      storyGuidance: z.array(z.string()).default([]),
      voiceGuidance: z.array(z.string()).default([]),
    }),
  }),
  truth: z.object({
    factualAuthority: z.string().default("Selected structured career evidence"),
    boundaries: z.array(z.string()).default([]),
  }),
  updatedAt: z.string(),
});
export type CandidateProfile = z.infer<typeof candidateProfileSchema>;

export const candidateProfileCreateSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  artifactPrefix: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
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

export const pdfExportRequestSchema = z.object({
  relativePath: z.string().min(1),
  textSize: pdfTextSizeSchema.default("auto"),
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
  location: z.string().nullable().default(null),
  interviewRoundLabel: z.string().nullable().default(null),
  hasApplicationMaterials: z.boolean().default(false),
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

export const interviewStageSchema = z.enum(["recruiter_screen", "hiring_manager", "technical", "technical_challenge", "take_home", "onsite", "executive", "unknown"]);
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
  skillsHeadingLine: z.string().min(1),
  professionalHeadingLine: z.string().min(1),
  employers: z.array(canonicalResumeEmployerSchema).min(1),
  educationHeadingLine: z.string().min(1),
  educationLines: z.array(z.string().min(1)).min(1),
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
  }).strict(),
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

export const applicationResumePlanSchema = z.object({
  targetTotalBullets: z.number().int().min(1).max(30),
  targetTailoredBulletMin: z.number().int().min(1).max(30).default(5),
  targetTailoredBulletMax: z.number().int().min(1).max(30).default(7),
  targetCareerAnchorBullets: z.number().int().min(1).max(30).default(6),
  targetExperienceWordMin: z.number().int().nonnegative().nullable(),
  targetExperienceWordMax: z.number().int().nonnegative().nullable(),
  customerFacingRole: z.boolean().default(false),
  targetCurrentEmployerCustomerBullets: z.number().int().min(0).max(4).default(0),
  customerFacingEvidenceIds: z.array(z.string().min(1)).max(10).default([]),
  employerTargets: z.array(z.object({
    employer: z.string().min(1),
    targetBullets: z.number().int().min(1).max(30),
    routedEvidenceCount: z.number().int().nonnegative(),
  })).min(1),
});
export type ApplicationResumePlan = z.infer<typeof applicationResumePlanSchema>;

export const applicationCoverLetterBriefSchema = z.object({
  targetWordMin: z.number().int().min(1),
  targetWordMax: z.number().int().min(1),
  hardWordMax: z.number().int().min(1),
  roleProblems: z.array(z.string().min(1)).max(6),
  company: z.string().nullable().optional(),
  role: z.string().nullable().optional(),
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
  sourcePath: z.string().min(1),
  sourceFamily: z.string().nullable(),
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
    storyGuidance: z.array(z.string()),
    voiceGuidance: z.array(z.string()),
  }),
  resumeTemplate: z.object({
    baselineId: z.string().min(1),
    originalSkillsLines: z.array(z.string()),
    employers: z.array(z.object({
      name: z.string().min(1),
      originalBulletCount: z.number().int().nonnegative(),
      originalBullets: z.array(z.string()),
    })),
    editableSkillCategories: z.array(z.string()),
  }),
  footprint: resumeFootprintSchema,
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
  claimType: z.enum(["candidate", "employer", "non-factual"]),
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
  }),
  excludedClaims: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
});
export type ApplicationEvidence = z.infer<typeof applicationEvidenceSchema>;

const evidenceLinkedTextSchema = z.object({
  text: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)).default([]),
}).strict();

export const applicationBundleSchema = z.object({
  schemaVersion: z.literal(1),
  applicationRunId: z.string().min(1),
  evidenceSnapshotId: z.string().min(1),
  canonicalBaselineId: z.string().min(1),
  evaluationMarkdown: z.string().min(1),
  resume: z.object({
    skillsLines: z.array(evidenceLinkedTextSchema).min(1),
    employers: z.array(z.object({
      name: z.string().min(1),
      bullets: z.array(evidenceLinkedTextSchema).min(1),
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
  }).strict(),
  excludedClaims: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
}).strict();
export type ApplicationBundle = z.infer<typeof applicationBundleSchema>;

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

export interface SenseiApi {
  app: {
    copyText(text: string): Promise<void>;
  };
  workspace: {
    getSummary(): Promise<WorkspaceSummary>;
    rescan(): Promise<WorkspaceSummary>;
    onChanged(callback: () => void): () => void;
  };
  profile: {
    get(): Promise<CandidateProfile | null>;
    create(input: CandidateProfileCreate): Promise<CandidateProfile>;
  };
  settings: {
    get(): Promise<Settings>;
    save(input: SettingsUpdate): Promise<Settings>;
    chooseResume(role: "base" | "secondary"): Promise<Settings>;
    removeSecondary(path: string): Promise<Settings>;
  };
  files: {
    listTree(): Promise<FileTreeNode[]>;
    preview(relativePath: string): Promise<FilePreview>;
    saveMarkdown(input: MarkdownSaveInput): Promise<FilePreview>;
    deletePath(relativePath: string): Promise<void>;
    reveal(relativePath: string): Promise<void>;
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
  };
  interviews: {
    getOverview(jobId: string): Promise<InterviewOverview | null>;
    listRounds(jobId: string): Promise<InterviewRound[]>;
    setCurrentRound(jobId: string, roundId: string): Promise<InterviewOverview | null>;
    refreshDashboard(jobId: string): Promise<InterviewOverview | null>;
    openWorkspaceWindow(jobId: string, roundId: string): Promise<void>;
  };
  search: {
    query(input: SearchQuery): Promise<SearchResponse>;
  };
  context: {
    getManifest(selection?: ContextSelection): Promise<ContextManifest>;
    getActiveManifest(): Promise<ContextManifest | null>;
    getSources(): Promise<string[]>;
    onUpdated(callback: (manifest: ContextManifest) => void): () => void;
  };
  terminal: {
    start(input: { cwd?: string }): Promise<{ cwd: string }>;
    setContext(input: ContextSelection): Promise<ContextManifest>;
    write(data: string): Promise<void>;
    insertPrompt(text: string): Promise<void>;
    resize(input: { cols: number; rows: number }): Promise<void>;
    restart(): Promise<{ cwd: string }>;
    stop(): Promise<void>;
    onData(callback: (data: string) => void): () => void;
    onExit(callback: (code: number) => void): () => void;
  };
}
