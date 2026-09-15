import { basename } from "node:path";
import {
  coverLetterAuditJsonSchema,
  resumeAuditJsonSchema,
  type CoverLetterAuditJson,
  type EvidenceSnapshot,
  type ResumeFootprint,
  type ResumeAuditJson,
  type ValidationIssueExplanation,
} from "../src/shared/schemas";

export type ApplicationArtifactType = "resume" | "cover-letter" | "submission-checklist";

export interface ArtifactValidation {
  artifactType: ApplicationArtifactType;
  wordCount: number;
  paragraphCount: number | null;
  bulletCount: number | null;
  currentEmployerBulletCount: number | null;
  experienceBulletChanges: number | null;
  skillChanges: number | null;
}

export interface ArtifactValidationOptions {
  baselineMarkdown?: string | null;
  jobMatchMarkdown?: string | null;
  requireResumeRelevance?: boolean;
  baseResumePath?: string | null;
  selectedStructuredPaths?: string[];
  selectedBroadPaths?: string[];
  changePlanMarkdown?: string | null;
  resumeFootprint?: ResumeFootprint | null;
}

export interface AuditValidationOptions {
  requireResumeTailoring?: boolean;
  minimumResumeChanges?: number;
  baseResumePath?: string | null;
  selectedStructuredPaths?: string[];
  selectedBroadPaths?: string[];
  baselineMarkdown?: string | null;
  publicMarkdown?: string | null;
  jobMatchMarkdown?: string | null;
  changePlanMarkdown?: string | null;
}

export class ClaimValidationError extends Error {
  constructor(
    message: string,
    public readonly explanation: NonNullable<ValidationIssueExplanation>,
  ) {
    super(message);
    this.name = "ClaimValidationError";
  }
}

export interface MachineAuditValidationOptions {
  publicMarkdown: string;
  publicArtifactName: string;
  snapshot: EvidenceSnapshot;
  currentManifestHash?: string;
  requireAuditSchemaVersion?: 2;
  applicationRunId?: string;
  leanEvidenceMap?: boolean;
}

const INTERNAL_SECTION = /(?:^|\n)\s*(?:#{1,6}\s*)?(?:provenance|tailoring audit|timeline audit|excluded(?:[_\s-]+or[_\s-]+uncertain)? claims?|source hashes?|evidence ids?|generated\s*-\s*awaiting review)\b/i;
const SUMMARY_SECTION = /(?:^|\n)\s*#{1,6}\s+(?:professional\s+)?summary\b/i;
const RESUME_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*_[A-Za-z0-9][A-Za-z0-9_-]*_Resume\.md$/;
const COVER_NAME = "cover_letter.md";
const CHECKLIST_NAME = "submission_checklist.md";

export const BASE_RESUME_WORDS = 342;
export const MIN_RESUME_WORDS = Math.floor(BASE_RESUME_WORDS * 0.9);
export const MAX_RESUME_WORDS = Math.floor(BASE_RESUME_WORDS * 1.1);
export const MIN_RESUME_BULLETS = 10;
export const TARGET_RESUME_BULLETS = 12;
export const MAX_RESUME_BULLETS = 14;
export const MIN_CURRENT_EMPLOYER_BULLETS = 5;
export const MIN_COVER_LETTER_WORDS = 180;
export const TARGET_MAX_COVER_LETTER_WORDS = 280;
export const MAX_COVER_LETTER_WORDS = 300;
export const MIN_COVER_LETTER_PARAGRAPHS = 3;
export const MAX_COVER_LETTER_PARAGRAPHS = 5;
export const MAX_COVER_LETTER_SENTENCES_PER_PARAGRAPH = 3;

export function requiredExperienceBulletChanges(jobMatchMarkdown: string | null | undefined): number {
  return supportedRequirementCount(jobMatchMarkdown) >= 3 ? 3 : 2;
}

export function classifyApplicationArtifact(path: string): ApplicationArtifactType {
  const name = basename(path);
  if (RESUME_NAME.test(name)) return "resume";
  if (name === COVER_NAME) return "cover-letter";
  if (name === CHECKLIST_NAME) return "submission-checklist";
  throw new Error("Only the public resume, cover letter, and submission checklist can be exported.");
}

export function auditNameFor(type: ApplicationArtifactType): string | null {
  if (type === "resume") return "resume_audit.md";
  if (type === "cover-letter") return "cover_letter_audit.md";
  return null;
}

export function validateApplicationArtifact(markdown: string, artifactType: ApplicationArtifactType, options: ArtifactValidationOptions = {}): ArtifactValidation {
  if (INTERNAL_SECTION.test(markdown)) throw new Error("Submission files cannot contain provenance, audits, evidence metadata, warnings, or generation status.");
  const wordCount = countWords(markdown);

  if (artifactType === "resume") {
    if (SUMMARY_SECTION.test(markdown)) throw new Error("The resume cannot add a summary section because the canonical resume has none.");
    validateResumeStructure(markdown);
    const bulletCount = experienceBulletCount(markdown);
    const currentEmployer = options.baselineMarkdown ? firstEmployerName(options.baselineMarkdown) : firstEmployerName(markdown);
    const currentEmployerBulletCount = currentEmployer ? employerBullets(markdown, currentEmployer).length : 0;
    if (bulletCount < MIN_RESUME_BULLETS || bulletCount > MAX_RESUME_BULLETS) {
      throw new Error(`The resume has ${bulletCount} bullets; the required range is ${MIN_RESUME_BULLETS}-${MAX_RESUME_BULLETS}.`);
    }
    if (currentEmployerBulletCount < MIN_CURRENT_EMPLOYER_BULLETS) {
      throw new Error(`The current-employer section has ${currentEmployerBulletCount} bullets; at least ${MIN_CURRENT_EMPLOYER_BULLETS} are required.`);
    }
    const experienceBulletChanges = options.baselineMarkdown ? countExperienceBulletChanges(options.baselineMarkdown, markdown) : null;
    const skillChanges = options.baselineMarkdown ? countSkillChanges(options.baselineMarkdown, markdown) : null;
    if (options.requireResumeRelevance && options.baselineMarkdown && hasSupportedJobEvidence(options.jobMatchMarkdown)) {
      if (!options.changePlanMarkdown) throw new Error("The private resume_change_plan.md must exist before resume validation.");
      const requiredChanges = requiredExperienceBulletChanges(options.jobMatchMarkdown);
      if ((experienceBulletChanges ?? 0) < requiredChanges) throw new Error(`The tailored resume did not make at least ${requiredChanges} substantive experience-bullet changes for this supported job match.`);
      if ((skillChanges ?? 0) < 1) throw new Error("The tailored resume did not update the skills section to surface supported job keywords.");
    }
    return { artifactType, wordCount, paragraphCount: null, bulletCount, currentEmployerBulletCount, experienceBulletChanges, skillChanges };
  }

  if (artifactType === "cover-letter") {
    if (wordCount > MAX_COVER_LETTER_WORDS) throw new Error(`The cover letter has ${wordCount} words; the hard limit is ${MAX_COVER_LETTER_WORDS}.`);
    const paragraphs = coverLetterBodyParagraphs(markdown);
    return { artifactType, wordCount, paragraphCount: paragraphs.length, bulletCount: null, currentEmployerBulletCount: null, experienceBulletChanges: null, skillChanges: null };
  }

  return { artifactType, wordCount, paragraphCount: null, bulletCount: null, currentEmployerBulletCount: null, experienceBulletChanges: null, skillChanges: null };
}

export function validateAudit(markdown: string, publicArtifactName: string, options: AuditValidationOptions = {}): void {
  if (!auditStatusPassed(markdown)) throw new Error("The private audit must declare `validation_status: passed` before export.");
  const escapedName = publicArtifactName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const identifiesArtifact = new RegExp(`\\bpublic_artifact\\s*:\\s*["']?${escapedName}["']?`, "i").test(markdown)
    || new RegExp(`\\bpublic\\s+artifact(?:\\s+target)?\\s*[:*]*\\s*[` + "\\`*_" + `]*${escapedName}[` + "\\`*_" + `]*`, "i").test(markdown)
    || new RegExp(`\\bpublic\\s+target\\s+artifact\\s*[:*]*\\s*[` + "\\`*_" + `]*${escapedName}[` + "\\`*_" + `]*`, "i").test(markdown)
    || new RegExp(`\\bpublic\\s+resume\\s*[:*]*\\s*[` + "\\`*_" + `]*${escapedName}[` + "\\`*_" + `]*`, "i").test(markdown);
  if (!identifiesArtifact) {
    throw new Error(`The private audit must identify \`public_artifact: ${publicArtifactName}\`.`);
  }
  if (!/\b(?:evidence|claim)[_\s-]*(?:map|mapping|provenance)\b|claim\s+grounding\s*&\s*provenance|provenance\s*&\s*evidence|claim\s*[-\s]+by\s*[-\s]+claim\s+evidence|claim\s+traceability\s+matrix/i.test(markdown)) {
    throw new Error("The private audit must contain a claim evidence map or provenance section.");
  }
  if (publicArtifactName === COVER_NAME) validateCoverLetterAudit(markdown);
  if (options.requireResumeTailoring) {
    validateResumeAuditContract(markdown, options as AuditValidationOptions);
    const changeCount = /\btailoring_change_count\s*:\s*(\d+)/i.exec(markdown)?.[1]
      ?? /(\d+)\s+substantive\s+(?:experience-)?bullet\s+changes?/i.exec(markdown)?.[1]
      ?? /(?:substantive changes|bullet changes)[^\n]*?(\d+)\s*(?:bullet|experience)/i.exec(markdown)?.[1]
      ?? numberedAuditItems(markdown, /bullet changes/i);
    const requiredChanges = options.minimumResumeChanges ?? 2;
    if (!changeCount || Number(changeCount) < requiredChanges) throw new Error(`The resume audit must record at least ${requiredChanges} substantive tailoring changes.`);
    const contextChangeCount = /\bcontext_evidence_change_count\s*:\s*(\d+)/i.exec(markdown)?.[1];
    if (!contextChangeCount || Number(contextChangeCount) < 2) throw new Error("The resume audit must record at least two substantive context-evidence changes.");
    const skillCount = /\bskill_change_count\s*:\s*(\d+)/i.exec(markdown)?.[1]
      ?? /(?:substantive changes|skill keywords added)[^\n]*?(\d+)\s*skill/i.exec(markdown)?.[1]
      ?? /(\d+)\s+skills?-section\s+keyword\s+changes?/i.exec(markdown)?.[1]
      ?? addedKeywordCount(markdown);
    if (!skillCount || Number(skillCount) < 1) throw new Error("The resume audit must record at least one substantive skills-section change.");
    if (!/\bformatting_preservation_status\s*:\s*passed\b/i.test(markdown)) throw new Error("The resume audit must declare `formatting_preservation_status: passed`.");
    if (!/\bside_by_side_status\s*:\s*passed\b/i.test(markdown)) throw new Error("The resume audit must declare `side_by_side_status: passed`.");
    if (!/##\s+Side-by-side changes\b/i.test(markdown)) throw new Error("The resume audit must include the exact `## Side-by-side changes` section.");
    if (!/##\s+(?:Requirement|Keyword) (?:coverage|mapping)|##\s+\d+\.\s+Before\s*\/\s*After\s+(?:Requirement\s+Coverage|Bullet\s+Diffs)/i.test(markdown)) throw new Error("The resume audit must include a requirement coverage or keyword mapping section.");
  }
}

export function validateResumeAuditJson(input: unknown, options: MachineAuditValidationOptions): ResumeAuditJson {
  const audit = resumeAuditJsonSchema.parse(input);
  if (options.requireAuditSchemaVersion && audit.schemaVersion !== options.requireAuditSchemaVersion) {
    throw new Error(`The resume audit must use schemaVersion ${options.requireAuditSchemaVersion} for a pinned application run.`);
  }
  validateMachineAudit(audit, options);
  const publicBullets = experienceBullets(options.publicMarkdown).map(normalizeResumeText);
  const publicSkills = skillSectionLines(options.publicMarkdown).map(normalizeResumeText);
  if (audit.claimMappings.some((mapping) => mapping.claimType !== "candidate")) {
    throw new Error("Every resume claim mapping must be classified as candidate evidence.");
  }
  const mappedClaims = new Set(audit.claimMappings.map((mapping) => normalizeResumeText(mapping.publicText)));
  for (const claim of [...publicBullets, ...publicSkills]) {
    if (!mappedClaims.has(claim)) throw new Error(`Every public experience bullet and skills line must have an exact JSON evidence mapping: ${claim}`);
  }
  validateResumeEmployerAttribution(audit, options);
  if (!options.leanEvidenceMap) {
    const substantiveChanges = audit.sideBySideChanges.filter((change) => lexicalSimilarity(change.originalText, change.tailoredText) <= 0.9);
    if (substantiveChanges.filter((change) => !/^skills?$/i.test(change.employer)).length < 2) {
      throw new Error("The JSON audit must contain at least two substantive side-by-side experience changes.");
    }
    if (!substantiveChanges.some((change) => /^skills?$/i.test(change.employer))) {
      throw new Error("The JSON audit must contain a substantive skills-section change.");
    }
    for (const change of audit.sideBySideChanges) {
      if (!normalizeResumeText(options.publicMarkdown).includes(normalizeResumeText(change.tailoredText))) {
        throw new Error("Every side-by-side tailored bullet must appear in the public resume.");
      }
      if (change.originalText && lexicalSimilarity(change.originalText, change.tailoredText) > 0.9) {
        throw new Error("A side-by-side change is only a synonym, punctuation, or keyword-level rewrite.");
      }
    }
  }
  for (const suggestion of audit.suggestedAdditionalBullets) {
    if (normalizeResumeText(options.publicMarkdown).includes(normalizeResumeText(suggestion.text))) {
      throw new Error("Suggested additional bullets must remain outside the public resume.");
    }
  }
  for (const opportunity of audit.metricOpportunities) {
    validateMappedEvidence(opportunity.evidenceIds, [], options.snapshot, "candidate", opportunity.proposedOutcome);
    if (normalizeResumeText(options.publicMarkdown).includes(normalizeResumeText(opportunity.proposedOutcome))) {
      throw new Error("Private metric opportunities must remain outside the public resume.");
    }
  }
  if (audit.schemaVersion === 2) {
    for (const change of audit.sideBySideChanges) {
      const scores = change.priorityScores!;
      const expected = scores.jdRelevance * 0.4
        + scores.evidenceStrength * 0.25
        + scores.recency * 0.2
        + scores.roleRepresentation * 0.15;
      if (Math.abs(scores.weightedTotal - expected) > 0.02) {
        throw new Error("Resume priority scores must use the 40/25/20/15 weighting contract.");
      }
    }
  }
  validateCurrentEmployerRecency(audit, options);
  return audit;
}

export function validateCoverLetterAuditJson(input: unknown, options: MachineAuditValidationOptions): CoverLetterAuditJson {
  const audit = coverLetterAuditJsonSchema.parse(input);
  if (options.requireAuditSchemaVersion && audit.schemaVersion !== options.requireAuditSchemaVersion) {
    throw new Error(`The cover-letter audit must use schemaVersion ${options.requireAuditSchemaVersion} for a pinned application run.`);
  }
  validateMachineAudit(audit, options);
  const mappedClaims = new Set(audit.claimMappings.map((mapping) => normalizeResumeText(mapping.publicText)));
  for (const sentence of coverLetterBodyParagraphs(options.publicMarkdown).flatMap(splitSentences).map(normalizeResumeText)) {
    if (!mappedClaims.has(sentence)) throw new Error(`Every cover-letter body sentence must be classified in the JSON audit: ${sentence}`);
  }
  const timelines = new Set(audit.careerArc.map((stage) => stage.timeline));
  if (!timelines.has("prior") || (!timelines.has("transition") && !timelines.has("current"))) {
    throw new Error("The cover-letter JSON audit must connect prior work to a documented transition or current stage.");
  }
  const arcEvidence = new Set(audit.careerArc.flatMap((stage) => stage.evidenceIds));
  if (arcEvidence.size < 2) throw new Error("The cover-letter career arc must use at least two distinct evidence rows.");
  const usedArcEvidence = new Set<string>();
  const usedArcClaims = new Set<string>();
  for (const stage of audit.careerArc) {
    if (stage.evidenceIds.some((id) => usedArcEvidence.has(id))) throw new Error("Each cover-letter career stage must use distinct evidence.");
    stage.evidenceIds.forEach((id) => usedArcEvidence.add(id));
    validateMappedEvidence(stage.evidenceIds, [], options.snapshot, "candidate");
    const matchingClaim = audit.claimMappings.find((mapping) => mapping.claimType === "candidate" && mapping.timeline === stage.timeline && stage.evidenceIds.some((id) => mapping.evidenceIds.includes(id)));
    if (!matchingClaim) throw new Error("Every career-arc stage must map to a public candidate sentence with the same timeline.");
    const normalizedClaim = normalizeResumeText(matchingClaim.publicText);
    if (usedArcClaims.has(normalizedClaim)) throw new Error("Each cover-letter career stage must map to a distinct public sentence.");
    usedArcClaims.add(normalizedClaim);
    validateArcStageSupport(stage.stage, matchingClaim.publicText, stage.evidenceIds, options.snapshot);
    validateTimelineSupport(stage.timeline, stage.evidenceIds, options.snapshot, matchingClaim.publicText);
  }
  return audit;
}

function validateTimelineSupport(timeline: "current" | "prior" | "transition", evidenceIds: string[], snapshot: EvidenceSnapshot, publicText: string): void {
  if (timeline === "current") validateCurrentEvidence(evidenceIds, snapshot, publicText);
}

function usesContinuingTense(value: string): boolean {
  return /\bcurrently\b|\brecently,?\s+I\s+have\b|\bI\s+(?:specialize|focus|partner|lead|manage|investigate|design|build|maintain|support|translate|work)\b/i.test(stripMarkdown(value));
}

function validateCurrentEvidence(evidenceIds: string[], snapshot: EvidenceSnapshot, publicText: string): void {
  const rows = evidenceIds.map((id) => snapshot.evidenceRows.find((row) => row.evidenceId === id)).filter((row): row is EvidenceSnapshot["evidenceRows"][number] => Boolean(row));
  if (!rows.some((row) => row.isOngoing && row.recencyBand === "current")) {
    throw new ClaimValidationError("A current responsibility requires explicitly ongoing evidence; a completed current-year activity is only recent.", claimExplanation(publicText, "candidate", evidenceIds, snapshot));
  }
}

function validateMachineAudit(
  audit: ResumeAuditJson | CoverLetterAuditJson,
  options: MachineAuditValidationOptions,
): void {
  if (audit.validationStatus !== "passed") throw new Error("The JSON audit must pass before an artifact is marked ready.");
  if (options.applicationRunId && audit.applicationRunId !== options.applicationRunId) throw new Error("The JSON audit references a different application run.");
  if (audit.publicArtifact !== options.publicArtifactName) throw new Error("The JSON audit identifies a different public artifact.");
  if (audit.evidenceSnapshotId !== options.snapshot.snapshotId) throw new Error("The JSON audit references a stale evidence snapshot.");
  if (audit.manifestHash !== options.snapshot.manifestHash) throw new Error("The JSON audit manifest hash does not match its evidence snapshot.");
  if (options.currentManifestHash && audit.manifestHash !== options.currentManifestHash) throw new Error("The active context manifest changed after evidence collection.");
  if (audit.baseResumePath !== options.snapshot.baseResumePath) throw new Error("The JSON audit does not identify the configured canonical base resume.");
  enforceDenylist(options.publicMarkdown, options.snapshot);
  for (const mapping of audit.claimMappings) {
    if (!normalizeResumeText(options.publicMarkdown).includes(normalizeResumeText(mapping.publicText))) {
      throw new Error("A JSON claim mapping does not match text in the public artifact.");
    }
    if (mapping.claimType === "non-factual") {
      if (mapping.evidenceIds.length || mapping.sourcePaths.length) throw new Error("Non-factual text cannot cite career evidence.");
      if (!/^(?:I am applying|I am interested|I would welcome|I welcome|I look forward|I would value|I am eager|I enjoy|I care|I want|I have always|What (?:draws|interests|appeals to) me|Thank you)\b/i.test(stripMarkdown(mapping.publicText))) {
        throw new Error("Only a clearly personal application, motivation, or closing sentence may be classified as non-factual.");
      }
      continue;
    }
    if (mapping.evidenceIds.length === 0 || mapping.sourcePaths.length === 0) throw new Error("Every factual claim needs evidence IDs and source paths.");
    validateMappedEvidence(mapping.evidenceIds, mapping.sourcePaths, options.snapshot, mapping.claimType, mapping.publicText);
    if (audit.artifactType === "cover-letter") {
      if (mapping.claimType === "employer" && candidateSignal(mapping.publicText, options.snapshot)) {
        throw new ClaimValidationError("A sentence about the candidate cannot be classified as an employer claim.", claimExplanation(mapping.publicText, mapping.claimType, mapping.evidenceIds, options.snapshot));
      }
      if (mapping.claimType === "candidate" && !candidateSignal(mapping.publicText, options.snapshot)) {
        throw new Error("A candidate claim must identify the candidate or a documented career stage.");
      }
    }
    validateSemanticSupport(mapping.publicText, mapping.evidenceIds, options.snapshot);
    if (mapping.claimType === "candidate") {
      validateMappedMetrics(mapping.publicText, mapping.evidenceIds, options.snapshot);
      validateOwnership(mapping.publicText, mapping.evidenceIds, options.snapshot);
      if (mapping.timeline === "current") validateCurrentEvidence(mapping.evidenceIds, options.snapshot, mapping.publicText);
      if (audit.artifactType === "cover-letter" && usesContinuingTense(mapping.publicText)) validateCurrentEvidence(mapping.evidenceIds, options.snapshot, mapping.publicText);
    }
  }
}

function validateMappedEvidence(evidenceIds: string[], sourcePaths: string[], snapshot: EvidenceSnapshot, claimType: "candidate" | "employer", publicText = ""): void {
  const rows = evidenceIds.map((id) => {
    const row = snapshot.evidenceRows.find((candidate) => candidate.evidenceId === id);
    if (!row) throw new Error(`The audit references evidence outside the active snapshot: ${id}.`);
    return row;
  });
  const jobDescriptionPath = snapshot.sourceFiles.find((source) => source.path === `jobs/${snapshot.jobId}/original_jd.md` || source.path === `jobs/${snapshot.jobId}/original_jd.txt`)?.path ?? `jobs/${snapshot.jobId}/original_jd.md`;
  const selected = new Set([
    ...snapshot.selectedStructuredPaths,
    ...snapshot.selectedBroadPaths,
    ...snapshot.selectedJobFiles,
    jobDescriptionPath,
  ]);
  for (const row of rows) {
    if (!selected.has(row.sourcePath)) throw new Error(`The audit references an unselected evidence path: ${row.sourcePath}.`);
    if (row.eligibility === "blocked") throw new Error(`The audit references blocked evidence: ${row.evidenceId}.`);
    const isJobDescription = row.evidenceId === `job:${snapshot.jobId}:original-jd`;
    if (claimType === "candidate" && isJobDescription) throw new Error("A job description cannot support candidate experience.");
    if (claimType === "employer" && !isJobDescription) throw new Error("Employer-specific claims must cite the supplied job description.");
    if (claimType === "candidate" && snapshot.applicationRouting && !snapshot.applicationRouting.selectedEvidenceIds.includes(row.evidenceId)) {
      throw new Error(`The claim references evidence outside the job-scoped application context: ${row.evidenceId}.`);
    }
  }
  for (const path of sourcePaths) {
    if (!rows.some((row) => row.sourcePath === path)) throw new Error(`The claim source path is not backed by its evidence IDs: ${path}.`);
  }
  const needsCorroboration = rows.some((row) => row.eligibility === "corroboration-required");
  if (needsCorroboration) {
    const eligibleFamilies = new Set(rows.filter((row) => row.eligibility === "eligible").map((row) => row.sourceFamily ?? row.sourcePath));
    const corroborationFamilies = new Set(rows.map((row) => row.sourceFamily ?? row.sourcePath));
    if (eligibleFamilies.size === 0 || corroborationFamilies.size < 2) {
      const claim = publicText ? ` for \`${stripMarkdown(publicText)}\`` : "";
      throw new Error(`Corroboration-required evidence${claim} needs one eligible row and at least two distinct source families; received IDs: ${evidenceIds.join(", ") || "none"}.`);
    }
  }
  if (claimType === "candidate") {
    const currentEmployer = snapshot.canonicalResume?.employers[0]?.name;
    const linkedinOnlyCurrentEmployer = Boolean(currentEmployer) && rows.length > 0 && rows.every((row) =>
      row.sourceFamily === "linkedin-profile" && normalizedEmployer(row.employer ?? "") === normalizedEmployer(currentEmployer!));
    if (linkedinOnlyCurrentEmployer) {
      throw new ClaimValidationError(
        "A current-employer claim cannot rely only on LinkedIn when selected structured project evidence is available.",
        claimExplanation(publicText, claimType, evidenceIds, snapshot),
      );
    }
  }
}

function validateResumeEmployerAttribution(audit: ResumeAuditJson, options: MachineAuditValidationOptions): void {
  if (!options.snapshot.applicationRouting) return;
  const employers = options.snapshot.canonicalResume?.employers.map((employer) => employer.name) ?? [];
  for (const employer of employers) {
    const bullets = new Set(employerBullets(options.publicMarkdown, employer).map(normalizeResumeText));
    for (const mapping of audit.claimMappings.filter((candidate) => bullets.has(normalizeResumeText(candidate.publicText)))) {
      const evidenceEmployers = new Set(mapping.evidenceIds.flatMap((id) => {
        const evidenceEmployer = options.snapshot.evidenceRows.find((row) => row.evidenceId === id)?.employer;
        return evidenceEmployer ? [evidenceEmployer] : [];
      }));
      const conflicting = [...evidenceEmployers].filter((evidenceEmployer) => normalizedEmployer(evidenceEmployer) !== normalizedEmployer(employer));
      if (conflicting.length) {
        throw new ClaimValidationError(
          `A ${employer} bullet cites evidence assigned to ${conflicting.join(", ")}.`,
          claimExplanation(mapping.publicText, "candidate", mapping.evidenceIds, options.snapshot),
        );
      }
      if (evidenceEmployers.size === 0) {
        throw new ClaimValidationError(
          `A ${employer} bullet needs evidence assigned to that employer rather than career-wide or unscoped evidence.`,
          claimExplanation(mapping.publicText, "candidate", mapping.evidenceIds, options.snapshot),
        );
      }
    }
  }
}

function normalizedEmployer(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "").replace(/inc$/, "");
}

function validateCurrentEmployerRecency(audit: ResumeAuditJson, options: MachineAuditValidationOptions): void {
  const { total: currentBulletCount, recent: recentCount } = currentEmployerRecencyStats(options.publicMarkdown, audit, options.snapshot);
  const currentEmployer = options.snapshot.canonicalResume?.employers[0]?.name;
  const currentBullets = currentEmployer ? employerBullets(options.publicMarkdown, currentEmployer) : [];
  if (currentBullets.length === 0) return;
  const requiredRecent = Math.max(3, Math.ceil(currentBulletCount * 2 / 3));
  if (recentCount < requiredRecent) {
    throw new Error(`The current-employer section has ${recentCount} current/recent evidence-backed bullets; ${requiredRecent} are required for ${currentBullets.length} bullets.`);
  }
}

function validateSemanticSupport(publicText: string, evidenceIds: string[], snapshot: EvidenceSnapshot): void {
  const evidenceText = evidenceIds.map((id) => {
    const row = snapshot.evidenceRows.find((candidate) => candidate.evidenceId === id);
    return `${row?.claim ?? ""} ${row?.scope ?? ""}`;
  }).join(" ");
  const publicTokens = meaningfulTokens(publicText);
  const evidenceTokens = meaningfulTokens(evidenceText);
  const overlap = [...publicTokens].filter((token) => evidenceTokens.has(token));
  const requiredOverlap = publicTokens.size < 4 ? Math.max(1, Math.ceil(publicTokens.size * 0.5)) : Math.max(2, Math.ceil(publicTokens.size * 0.35));
  if (overlap.length < requiredOverlap) {
    throw new ClaimValidationError("The cited evidence does not substantively overlap the public claim.", claimExplanation(publicText, "candidate", evidenceIds, snapshot));
  }
}

function claimExplanation(publicText: string, claimType: string, evidenceIds: string[], snapshot: EvidenceSnapshot): NonNullable<ValidationIssueExplanation> {
  return {
    sentence: publicText,
    claimType,
    evidenceIds,
    sources: evidenceIds.flatMap((evidenceId) => {
      const row = snapshot.evidenceRows.find((candidate) => candidate.evidenceId === evidenceId);
      return row ? [{ evidenceId, sourcePath: row.sourcePath, claim: row.claim }] : [];
    }),
  };
}

function validateArcStageSupport(stage: string, publicText: string, evidenceIds: string[], snapshot: EvidenceSnapshot): void {
  const evidenceText = evidenceIds.map((id) => snapshot.evidenceRows.find((row) => row.evidenceId === id)?.claim ?? "").join(" ");
  const normalizedStage = normalizeResumeText(stage);
  const normalizedSupport = normalizeResumeText(evidenceText);
  if (normalizedStage && normalizedSupport.includes(normalizedStage)) return;
  const stageTokens = meaningfulTokens(stage);
  const supportTokens = meaningfulTokens(evidenceText);
  const overlap = [...stageTokens].filter((token) => supportTokens.has(token));
  if (stageTokens.size > 0 && overlap.length < Math.max(1, Math.ceil(stageTokens.size * 0.5))) {
    throw new Error(`The cover-letter career-stage label \`${stage}\` is not supported by its public sentence or evidence.`);
  }
}

function candidateSignal(publicText: string, snapshot: EvidenceSnapshot): boolean {
  if (/\b(?:I|my|me)\b/i.test(stripMarkdown(publicText))) return true;
  const lower = publicText.toLowerCase();
  return snapshot.evidenceRows
    .filter((row) => row.evidenceId !== `job:${snapshot.jobId}:original-jd`)
    .some((row) => row.project.length >= 3 && lower.includes(row.project.toLowerCase()));
}

function meaningfulTokens(value: string): Set<string> {
  const stop = new Set(["about", "after", "again", "also", "been", "being", "could", "from", "have", "into", "more", "that", "their", "these", "this", "through", "using", "with", "would", "work", "worked"]);
  return new Set(normalizeResumeText(value).split(/[^a-z0-9+#.]+/).filter((token) => token.length >= 4 && !stop.has(token)));
}

function validateMappedMetrics(publicText: string, evidenceIds: string[], snapshot: EvidenceSnapshot): void {
  const metrics = publicText.match(/\b\d+(?:\.\d+)?(?:%|x|k|m|b|\+)?\b/gi) ?? [];
  if (metrics.length === 0) return;
  const evidenceText = evidenceIds
    .map((id) => snapshot.evidenceRows.find((row) => row.evidenceId === id)?.claim ?? "")
    .join(" ");
  for (const metric of metrics) {
    if (!evidenceText.toLowerCase().includes(metric.toLowerCase())) {
      throw new Error(`The public metric \`${metric}\` does not appear in its eligible evidence.`);
    }
  }
}

function validateOwnership(publicText: string, evidenceIds: string[], snapshot: EvidenceSnapshot): void {
  if (!/\b(?:led|owned|architected|spearheaded|directed|managed|built|designed|engineered|created|developed)\b/i.test(publicText)) return;
  const support = evidenceIds
    .map((id) => snapshot.evidenceRows.find((row) => row.evidenceId === id))
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .map((row) => `${row.claim} ${row.scope}`)
    .join(" ");
  if (!/\b(?:led|owned|architected|spearheaded|directed|managed|built|designed|engineered|created|developed)\b/i.test(support)
    || /\b(?:do not (?:infer|imply).*(?:sole|ownership|lead)|confirm (?:authorship|ownership)|(?:contribution|participation|support) scope)\b/i.test(support)) {
    throw new Error("The public claim upgrades ownership beyond its selected evidence.");
  }
}

function extractEmployerSection(markdown: string, employer: string): string | null {
  const regex = new RegExp(`\\*\\*${employer}[^*]*\\*\\*[\\s\\S]*?(?=\\n\\*\\*[A-Z]|\\n##|$)`, "i");
  const match = regex.exec(markdown);
  return match ? match[0] : null;
}

function enforceDenylist(publicMarkdown: string, snapshot: EvidenceSnapshot): void {
  const normalized = normalizeResumeText(publicMarkdown);
  for (const rule of snapshot.denylistRules) {
    const blocked = normalizeResumeText(rule.blockedClaim);
    if (blocked.length >= 12 && normalized.includes(blocked)) throw new Error(`The public artifact violates ${rule.ruleId}: ${rule.safeHandling}`);
  }
}

function lexicalSimilarity(left: string, right: string): number {
  const tokens = (value: string) => new Set(normalizeResumeText(value).split(/\s+/).filter((token) => token.length > 2));
  const a = tokens(left);
  const b = tokens(right);
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 1;
  return [...a].filter((token) => b.has(token)).length / union.size;
}

function validateResumeAuditContract(markdown: string, options: AuditValidationOptions): void {
  for (const field of ["base_resume_path", "selected_structured_paths", "selected_broad_paths", "relevant_employer_targets", "current_employer_change_count", "current_employer_change_target"]) {
    if (!new RegExp(`^${field}\\s*:\\s*.+$`, "im").test(markdown)) throw new Error(`The resume audit must declare \`${field}: <value>\`.`);
  }
  if (!/##\s+Suggested additional bullets for user review\b/i.test(markdown)) throw new Error("The resume audit must include the suggested-bullets section.");
  if (!/##\s+Employer targeting\b/i.test(markdown)) throw new Error("The resume audit must include the `## Employer targeting` section.");
  const employerTargets = declaredPathList(markdown, "relevant_employer_targets");
  const employerSection = /##\s+Employer targeting\b([\s\S]*?)(?=\n##\s+|$)/i.exec(markdown)?.[1] ?? "";
  for (const employer of employerTargets) {
    const employerPattern = new RegExp(`\\b${employer.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`, "i");
    if (!employerPattern.test(employerSection) || !/(?:changed|excluded|not included|no change)/i.test(employerSection)) {
      throw new Error(`The resume audit must document a change or explicit exclusion for targeted employer: ${employer}.`);
    }
  }
  if (!options.changePlanMarkdown) throw new Error("The private resume_change_plan.md must exist before resume validation.");
  if (!/(?:current employer|current-employer)/i.test(options.changePlanMarkdown) || !/direct|transferable|gap/i.test(options.changePlanMarkdown)) {
    throw new Error("The resume change plan must identify current-employer requirements and evidence classes.");
  }
  const selected = new Set([...(options.selectedStructuredPaths ?? []), ...(options.selectedBroadPaths ?? [])]);
  const declaredStructured = declaredPathList(markdown, "selected_structured_paths");
  const declaredBroad = declaredPathList(markdown, "selected_broad_paths");
  for (const path of [...declaredStructured, ...declaredBroad]) {
    if (selected.size > 0 && !selected.has(path)) throw new Error(`The resume audit names context outside the active selection: ${path}.`);
  }
  if (options.baselineMarkdown && options.publicMarkdown) {
    const employer = firstEmployerName(options.baselineMarkdown);
    const actualChanges = employer ? changedEmployerBullets(options.baselineMarkdown, options.publicMarkdown, employer) : 0;
    const declaredChanges = requiredAuditInteger(markdown, "current_employer_change_count");
    if (declaredChanges !== actualChanges) throw new Error(`The resume audit declares ${declaredChanges} current-employer changes, but the public resume contains ${actualChanges}.`);
    const target = requiredAuditInteger(markdown, "current_employer_change_target");
    if (actualChanges < target) throw new Error(`The public resume contains ${actualChanges} current-employer changes; the required target is ${target}.`);
    if (options.jobMatchMarkdown) {
      const directTarget = requiredCurrentEmployerTarget(options.jobMatchMarkdown);
      if (target !== directTarget) throw new Error("The resume audit current-employer target does not match job_match.md.");
    }
  }
  const suggestions = suggestedBullets(markdown);
  if (options.publicMarkdown && suggestions.some((suggestion) => normalizeResumeText(suggestion) && normalizeResumeText(options.publicMarkdown!).includes(normalizeResumeText(suggestion)))) {
    throw new Error("Suggested additional bullets must remain outside the public resume.");
  }
}

function declaredPathList(markdown: string, field: string): string[] {
  const value = new RegExp(`^${field}\\s*:\\s*(.+)$`, "im").exec(markdown)?.[1]?.trim() ?? "";
  return value === "none" || value === "" ? [] : value.split(/,\s*/).filter(Boolean);
}

function suggestedBullets(markdown: string): string[] {
  const section = /##\s+Suggested additional bullets for user review\b([\s\S]*?)(?=\n##\s+|$)/i.exec(markdown)?.[1] ?? "";
  return section.split("\n").map((line) => line.replace(/^\s*[-*+]\s+/, "").trim()).filter((line) => line.length > 20 && !/^evidence|^source|^requirement|^reason|^uncertainty/i.test(line));
}

function changedEmployerBullets(baseline: string, tailored: string, employer: string): number {
  const before = employerBullets(baseline, employer).map(normalizeResumeText);
  return employerBullets(tailored, employer)
    .map(normalizeResumeText)
    .filter((bullet) => bullet.length > 0 && !before.includes(bullet)).length;
}

function employerBullets(markdown: string, employer: string): string[] {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const employerIndex = lines.findIndex((line) => {
    const plain = stripMarkdown(line).replace(/[|]/g, " ").trim();
    return new RegExp(`\\b${employer.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`, "i").test(plain)
      && /^\s*(?:#{1,6}\s*)?\*{0,2}[^\n]+\*{0,2}/.test(line);
  });
  if (employerIndex < 0) return [];
  const bullets: string[] = [];
  for (const line of lines.slice(employerIndex + 1)) {
    if (/^\s*[-*+]\s+/.test(line)) {
      bullets.push(line.replace(/^\s*[-*+]\s+/, "").trim());
    } else if (bullets.length > 0 && line.trim()) {
      break;
    }
  }
  return bullets;
}

function firstEmployerName(markdown: string): string | null {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const start = lines.findIndex((line) => stripMarkdown(line).toLowerCase() === "professional experience");
  for (const line of lines.slice(Math.max(0, start + 1))) {
    if (stripMarkdown(line).toLowerCase() === "education") break;
    const match = /^\s*(?:#{1,6}\s*)?\*\*([^*|]+)\*\*/.exec(line);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return null;
}

function requiredCurrentEmployerTarget(jobMatchMarkdown: string): number {
  const explicit = /\bcurrent_employer_change_target\s*:\s*(\d+)\b/i.exec(jobMatchMarkdown)?.[1];
  if (explicit) return Number(explicit);
  const currentSection = /current[ -]employer[\s\S]{0,1800}/i.exec(jobMatchMarkdown)?.[0] ?? jobMatchMarkdown;
  const direct = (currentSection.match(/\bdirect\b/gi)?.length ?? 0);
  return Math.min(3, Math.max(2, direct));
}

function validateCoverLetterAudit(markdown: string): void {
  const normalized = markdown.replace(/[\u0060*]/g, "");
  const wordCount = requiredAuditInteger(normalized, "word_count");
  if (wordCount < MIN_COVER_LETTER_WORDS || wordCount > MAX_COVER_LETTER_WORDS) {
    throw new Error(`The cover-letter audit must record a word count between ${MIN_COVER_LETTER_WORDS} and ${MAX_COVER_LETTER_WORDS}.`);
  }
  const paragraphCount = requiredAuditInteger(normalized, "body_paragraph_count");
  if (paragraphCount < MIN_COVER_LETTER_PARAGRAPHS || paragraphCount > MAX_COVER_LETTER_PARAGRAPHS) {
    throw new Error(`The cover-letter audit must record ${MIN_COVER_LETTER_PARAGRAPHS}-${MAX_COVER_LETTER_PARAGRAPHS} substantive body paragraphs.`);
  }
  const maxSentenceCount = requiredAuditInteger(normalized, "max_body_paragraph_sentence_count");
  if (maxSentenceCount > MAX_COVER_LETTER_SENTENCES_PER_PARAGRAPH) {
    throw new Error(`The cover-letter audit cannot pass with more than ${MAX_COVER_LETTER_SENTENCES_PER_PARAGRAPH} sentences in a body paragraph.`);
  }
  for (const field of [
    "header_status",
    "body_structure_status",
    "opening_closing_status",
    "argument_sequence_status",
    "career_arc_status",
    "timeline_tense_status",
    "employer_need_connection_status",
    "claim_evidence_status",
    "banned_content_status",
  ]) {
    if (!new RegExp(`\\b${field}\\s*:\\s*passed\\b`, "i").test(normalized)) {
      throw new Error(`The cover-letter audit must declare \`${field}: passed\`.`);
    }
  }
  if (!/\btemplate_reference_status\s*:\s*layout_only\b/i.test(normalized)) {
    throw new Error("The cover-letter audit must declare `template_reference_status: layout_only`.");
  }
  if (!/##\s+Career arc and timeline\b/i.test(markdown)) {
    throw new Error("The cover-letter audit must include `## Career arc and timeline`.");
  }
  if (!/##\s+Claim evidence map\b/i.test(markdown)) {
    throw new Error("The cover-letter audit must include the exact `## Claim evidence map` section.");
  }
}

function requiredAuditInteger(markdown: string, field: string): number {
  const value = new RegExp(`\\b${field}\\s*:\\s*(\\d+)\\b`, "i").exec(markdown)?.[1];
  if (!value) throw new Error(`The cover-letter audit must declare \`${field}: <integer>\`.`);
  return Number(value);
}

function numberedAuditItems(markdown: string, heading: RegExp): string | undefined {
  const headingMatch = heading.exec(markdown);
  if (!headingMatch || headingMatch.index === undefined) return undefined;
  const section = (markdown.slice(headingMatch.index).split(/\n##\s+/i)[0] ?? "");
  const count = section.match(/^\s*\d+\.\s+/gm)?.length ?? 0;
  return count > 0 ? String(count) : undefined;
}

function addedKeywordCount(markdown: string): string | undefined {
  const value = /(?:added keywords|skill keywords added)\s*:\s*([^\n]+)/i.exec(markdown)?.[1];
  if (!value) return undefined;
  const count = value.split(/,|;|\band\b/i).map((item) => item.trim()).filter(Boolean).length;
  return count > 0 ? String(count) : undefined;
}

function auditStatusPassed(markdown: string): boolean {
  // Audits are Markdown documents, so emphasis and code formatting may wrap
  // either side of the machine-readable status field.
  const normalized = markdown.replace(/[\u0060*]/g, "");
  return /\bvalidation_status\s*:\s*passed\b/i.test(normalized)
    || /\bvalidation\s+status\s*:\s*passed\b/i.test(normalized);
}

export function countWords(markdown: string): number {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#>*_`|~-]/g, " ");
  return plain.match(/\b[\p{L}\p{N}][\p{L}\p{N}'’+./&-]*\b/gu)?.length ?? 0;
}

export function coverLetterBodyParagraphs(markdown: string): string[] {
  const blocks = markdown.replaceAll("\r\n", "\n").split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  const greetingIndex = blocks.findIndex((block) => /^(?:dear|hello)\b/i.test(stripMarkdown(block)));
  const closingIndex = blocks.findIndex((block, index) => index > greetingIndex && /^(?:sincerely|best|regards|thank you)[,\s]*$/i.test(stripMarkdown(block).split("\n")[0] ?? ""));
  const start = greetingIndex >= 0 ? greetingIndex + 1 : 0;
  const end = closingIndex >= 0 ? closingIndex : blocks.length;
  return blocks.slice(start, end).filter((block) => {
    const plain = stripMarkdown(block);
    return plain.length > 0 && !/^#{1,6}\s/.test(block) && !/^(?:candidate|target role|company|date)\s*:/i.test(plain);
  });
}

function validateCoverLetterHeader(markdown: string): void {
  const blocks = markdown.replaceAll("\r\n", "\n").split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  const greetingIndex = blocks.findIndex((block) => /^(?:dear|hello)\b/i.test(stripMarkdown(block)));
  if (greetingIndex < 0) throw new Error("The cover letter must include a salutation.");
  const header = stripMarkdown(blocks.slice(0, greetingIndex).join("\n"));
  if (!header.trim()) throw new Error("The cover letter must include the candidate name in its compact header.");
  if (!/(?:[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}|linkedin\.com)/i.test(header)) {
    throw new Error("The cover letter must include a compact contact line before the salutation.");
  }
  if (!/(?:\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},\s+\d{4}\b|\b\d{4}-\d{2}-\d{2}\b)/i.test(header)) {
    throw new Error("The cover letter must include a date in its compact header.");
  }
}

function validateCoverLetterLanguage(markdown: string): void {
  if (/!\[[^\]]*]\([^)]*\)|<img\b/i.test(markdown)) {
    throw new Error("The cover letter cannot include an image or handwritten-signature imitation.");
  }
  const body = coverLetterBodyParagraphs(markdown).map(stripMarkdown).join("\n");
  if (/\bI am writing to (?:express|convey|submit)\b/i.test(body)) {
    throw new Error("The cover letter cannot use a generic `I am writing to express...` opening.");
  }
  if (/\b(?:I thrive in|dynamic environments?|fast[- ]paced environments?|culture fit|perfect fit for (?:your|the) culture|team player|hard[- ]working individual)\b/i.test(body)) {
    throw new Error("The cover letter cannot use generic personality or vague culture-fit claims.");
  }
}

function validateResumeStructure(markdown: string): void {
  const normalized = stripMarkdown(markdown).toLowerCase();
  const requiredInOrder = ["skills", "professional experience", "education"];
  let cursor = -1;
  for (const section of requiredInOrder) {
    const next = normalized.indexOf(section, cursor + 1);
    if (next < 0) throw new Error(`The resume must preserve the canonical \`${section}\` section or employer.`);
    cursor = next;
  }
}

function validateResumeEmphasis(markdown: string): void {
  for (const required of [
    "**SKILLS & Languages**",
    "**PROFESSIONAL EXPERIENCE**",
    "**EDUCATION**",
  ]) {
    if (!markdown.includes(required)) throw new Error(`The resume must preserve canonical bold emphasis for \`${required.replaceAll("*", "")}\`.`);
  }
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const skillsStart = lines.findIndex((line) => stripMarkdown(line).toLowerCase() === "skills & languages");
  const experienceStart = lines.findIndex((line) => stripMarkdown(line).toLowerCase() === "professional experience");
  const skillLines = lines.slice(skillsStart + 1, experienceStart).filter((line) => line.trim());
  if (skillLines.length < 4 || skillLines.some((line) => !/^\s*\*\*[^*\n]+:\*\*/.test(line))) {
    throw new Error("Every resume skills line must preserve a bold category label.");
  }
}

function experienceBulletCount(markdown: string): number {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const start = lines.findIndex((line) => stripMarkdown(line).toLowerCase() === "professional experience");
  const end = lines.findIndex((line, index) => index > start && stripMarkdown(line).toLowerCase() === "education");
  if (start < 0 || end < 0) throw new Error("The resume must preserve Professional Experience and Education sections.");
  return lines.slice(start + 1, end).filter((line) => /^\s*[-*+]\s+/.test(line)).length;
}

function countExperienceBulletChanges(baseline: string, tailored: string): number {
  const before = experienceBullets(baseline);
  const after = experienceBullets(tailored);
  const length = Math.max(before.length, after.length);
  let changes = 0;
  for (let index = 0; index < length; index += 1) {
    if (normalizeResumeText(before[index] ?? "") !== normalizeResumeText(after[index] ?? "")) changes += 1;
  }
  return changes;
}

function countSkillChanges(baseline: string, tailored: string): number {
  const before = skillSectionLines(baseline);
  const after = skillSectionLines(tailored);
  const length = Math.max(before.length, after.length);
  let changes = 0;
  for (let index = 0; index < length; index += 1) {
    if (normalizeResumeText(before[index] ?? "") !== normalizeResumeText(after[index] ?? "")) changes += 1;
  }
  return changes;
}

function skillSectionLines(markdown: string): string[] {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const start = lines.findIndex((line) => stripMarkdown(line).toLowerCase().includes("skills"));
  const end = lines.findIndex((line, index) => index > start && stripMarkdown(line).toLowerCase() === "professional experience");
  if (start < 0 || end < 0) return [];
  return lines.slice(start + 1, end)
    .filter((line) => line.trim())
    .filter((line) => !/^\s*\*\*[^*]+:\*\*\s*$/.test(line))
    .filter((line) => !/^languages\s*:/i.test(stripMarkdown(line)))
    .map((line) => line.trim());
}

function experienceBullets(markdown: string): string[] {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const start = lines.findIndex((line) => stripMarkdown(line).toLowerCase() === "professional experience");
  const end = lines.findIndex((line, index) => index > start && stripMarkdown(line).toLowerCase() === "education");
  if (start < 0 || end < 0) return [];
  return lines.slice(start + 1, end).filter((line) => /^\s*[-*+]\s+/.test(line)).map((line) => line.replace(/^\s*[-*+]\s+/, ""));
}

function normalizeResumeText(value: string): string {
  return value.replaceAll("\\-", "-").replace(/[*_`#|]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function hasSupportedJobEvidence(jobMatchMarkdown: string | null | undefined): boolean {
  return supportedRequirementCount(jobMatchMarkdown) >= 2;
}

function supportedRequirementCount(jobMatchMarkdown: string | null | undefined): number {
  if (!jobMatchMarkdown) return 0;
  return (jobMatchMarkdown.match(/\bsupported\b/gi)?.length ?? 0);
}

function sentenceCount(value: string): number {
  return stripMarkdown(value).split(/(?<=[.!?])(?:["')\]]*)\s+/).filter((sentence) => /[\p{L}\p{N}]/u.test(sentence)).length;
}

function splitSentences(value: string): string[] {
  return stripMarkdown(value).split(/(?<=[.!?])(?:["')\]]*)\s+/).filter((sentence) => /[\p{L}\p{N}]/u.test(sentence));
}

function stripMarkdown(value: string): string {
  return value
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/[#>*_`|~]/g, "")
    .trim();
}

export function resumeArtifactStats(markdown: string): { wordCount: number; experienceWordCount: number; averageExperienceBulletWords: number | null; bulletCount: number; currentEmployerBulletCount: number } {
  const bullets = experienceBullets(markdown);
  const experienceWordCount = countWords(bullets.join(" "));
  return {
    wordCount: countWords(markdown),
    experienceWordCount,
    averageExperienceBulletWords: bullets.length ? experienceWordCount / bullets.length : null,
    bulletCount: bullets.length,
    currentEmployerBulletCount: firstEmployerName(markdown) ? employerBullets(markdown, firstEmployerName(markdown)!).length : 0,
  };
}

export function currentEmployerRecencyStats(markdown: string, audit: ResumeAuditJson, snapshot: EvidenceSnapshot): { total: number; recent: number } {
  const employer = snapshot.canonicalResume?.employers[0]?.name ?? firstEmployerName(markdown);
  const currentBullets = employer ? employerBullets(markdown, employer) : [];
  const mappingByText = new Map(audit.claimMappings.map((mapping) => [normalizeResumeText(mapping.publicText), mapping]));
  const recent = currentBullets.filter((bullet) => {
    const mapping = mappingByText.get(normalizeResumeText(bullet));
    return mapping?.evidenceIds.some((id) => {
      const band = snapshot.evidenceRows.find((row) => row.evidenceId === id)?.recencyBand;
      return band === "current" || band === "recent";
    });
  }).length;
  return { total: currentBullets.length, recent };
}
