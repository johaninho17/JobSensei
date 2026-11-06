import { readFile, readdir, stat } from "node:fs/promises";
import { postingRecordFor } from "./posting-record";
import { basename, join, resolve } from "node:path";
import {
  type StretchScore,
  applicationContextSchema,
  applicationEvidenceSchema,
  applicationRunSchema,
  applicationStatusSchema,
  applicationValidationReportSchema,
  contextManifestSchema,
  evidenceSnapshotSchema,
  type ApplicationEvidence,
  type ApplicationContext,
  type ApplicationRun,
  type ApplicationStatus,
  type ApplicationValidationReport,
  type CanonicalResumeBaseline,
  type CandidateProfile,
  type EvidenceSnapshot,
  type ValidationIssue,
} from "../src/shared/schemas";
import {
  MIN_COVER_LETTER_PARAGRAPHS,
  MAX_COVER_LETTER_PARAGRAPHS,
  currentEmployerRecencyStats,
  coverLetterBodyParagraphs,
  MAX_COVER_LETTER_SENTENCES_PER_PARAGRAPH,
  resumeArtifactStats,
  validateApplicationArtifact,
  validateCoverLetterAuditJson,
  validateResumeAuditJson,
  type ClaimFailure,
  ClaimValidationError,
} from "./application-artifacts";
import { contextManifestHash } from "./context-manifest-hash";
import { writeJsonAtomic } from "./persistence";
import { assertInsideWorkspace } from "./workspace";
import { normalizeEvidenceClassifications, scoreEvaluation } from "./fit-scoring";
import { canonicalCoverLetterDrifts, canonicalResumeDrifts } from "./canonical-resume";
import { readCandidateProfile } from "./candidate-profile";
import { scoreStretch } from "./stretch-score";

interface LoadedApplication {
  jobPath: string;
  statePath: string;
  run: ApplicationRun | null;
  snapshot: EvidenceSnapshot | null;
  evidence: ApplicationEvidence | null;
  evidenceUnreadable: boolean;
  manifestHash: string | null;
  evaluationMarkdown: string | null;
  resumeName: string | null;
  resumeMarkdown: string | null;
  coverMarkdown: string | null;
  applicationContext: ApplicationContext | null;
  candidateProfile: CandidateProfile | null;
  jobDescriptionText: string | null;
}

type AtsCheck = {
  status: "passed" | "warning" | "not_exported" | "unavailable";
  pdfPath: string | null;
  extractedCharacters: number;
  missingFields: string[];
};

type ResumeTailoringSimilarity = {
  editableLineCount: number;
  nearIdenticalLineCount: number;
  substantiveMappedChangeCount: number;
  substantiveMappedBulletChangeCount: number;
  nearIdenticalRatio: number;
  nearIdenticalBulletRatio: number;
};

function normalizedResumeLine(value: string): string {
  return value
    .replace(/^[-*+]\s+/, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[*_`#]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function similarityTokens(value: string): Set<string> {
  return new Set(normalizedResumeLine(value).split(" ").filter((token) => token.length >= 3));
}

function lineSimilarity(left: string, right: string): number {
  const leftTokens = similarityTokens(left);
  const rightTokens = similarityTokens(right);
  const union = new Set([...leftTokens, ...rightTokens]);
  if (!union.size) return 1;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return intersection / union.size;
}

function editableResumeLines(markdown: string): string[] {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const skills = lines.findIndex((line) => /^\s*(?:\*\*|__)?(?:core competencies|technical skills|skills|qualifications|areas of expertise|competencies)(?:\s*&\s*languages)?/i.test(line));
  const experience = lines.findIndex((line) => /^\s*(?:\*\*|__)?(?:professional\s+|work\s+|relevant\s+|employment\s+)?experience/i.test(line));
  const education = lines.findIndex((line) => /^\s*(?:\*\*|__)?(?:education|academic|credentials)/i.test(line));
  if (skills < 0 || experience <= skills || education <= experience) return [];
  return [
    ...lines.slice(skills + 1, experience).filter((line) => normalizedResumeLine(line)),
    ...lines.slice(experience + 1, education).filter((line) => /^\s*[-*+]\s+/.test(line)),
  ];
}

export function resumeTailoringSimilarity(
  markdown: string,
  baseline: CanonicalResumeBaseline,
  evidence: ApplicationEvidence | null,
): ResumeTailoringSimilarity {
  const candidateLines = editableResumeLines(markdown);
  const baselineLines = [
    ...baseline.originalSkillsLines,
    ...baseline.employers.flatMap((employer) => employer.originalBullets),
  ];
  const baselineBullets = baseline.employers.flatMap((employer) => employer.originalBullets);
  const mappedClaims = new Set((evidence?.resume.claimMappings ?? [])
    .filter((mapping) => mapping.evidenceIds.length > 0)
    .map((mapping) => normalizedResumeLine(mapping.publicText)));
  let nearIdenticalLineCount = 0;
  let substantiveMappedChangeCount = 0;
  let nearIdenticalBulletCount = 0;
  let substantiveMappedBulletChangeCount = 0;
  let candidateBulletCount = 0;
  for (const line of candidateLines) {
    const isBullet = /^\s*[-*+]\s+/.test(line);
    const closest = Math.max(0, ...baselineLines.map((baselineLine) => lineSimilarity(line, baselineLine)));
    if (closest >= 0.9) nearIdenticalLineCount += 1;
    if (closest < 0.75 && mappedClaims.has(normalizedResumeLine(line))) substantiveMappedChangeCount += 1;
    if (isBullet) {
      candidateBulletCount += 1;
      const closestBullet = Math.max(0, ...baselineBullets.map((b) => lineSimilarity(line, b)));
      if (closestBullet >= 0.9) nearIdenticalBulletCount += 1;
      if (closestBullet < 0.75 && mappedClaims.has(normalizedResumeLine(line))) substantiveMappedBulletChangeCount += 1;
    }
  }
  return {
    editableLineCount: candidateLines.length,
    nearIdenticalLineCount,
    substantiveMappedChangeCount,
    substantiveMappedBulletChangeCount,
    nearIdenticalRatio: nearIdenticalLineCount / Math.max(1, candidateLines.length),
    nearIdenticalBulletRatio: nearIdenticalBulletCount / Math.max(1, candidateBulletCount),
  };
}

function keywordEvidenceIds(value: string): string[] {
  return [...new Set((value.match(/[a-z][a-z0-9-]*(?::[a-z0-9][a-z0-9-]*){2,}/gi) ?? [])
    .map((candidate) => candidate.replace(/^evidence:/i, "")))];
}

function keywordClasses(loaded: LoadedApplication): ApplicationValidationReport["keywordClasses"] {
  if (!loaded.evaluationMarkdown) return [];
  const bounded = loaded.snapshot
    ? normalizeEvidenceClassifications(loaded.evaluationMarkdown, loaded.snapshot)
    : { markdown: loaded.evaluationMarkdown, adjustments: [] };
  const scoring = scoreEvaluation(bounded.markdown);
  if (!scoring) return [];
  return [
    ...scoring.requirements.map((row) => ({
      term: row.requirement,
      classification: row.classification === "direct"
        ? "supported" as const
        : row.classification === "strong_transferable" || row.classification === "adjacent_transferable"
          ? "transferable" as const
          : "unsupported" as const,
      evidenceIds: keywordEvidenceIds(row.evidence),
    })),
    ...(scoring.mustHaves ?? []).map((row) => ({
      term: `${row.requirement} (must-have)`,
      classification: row.status === "met" ? "supported" as const : "unsupported" as const,
      evidenceIds: keywordEvidenceIds(row.evidence),
    })),
  ];
}

function normalizeAtsText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9@.+#]+/g, " ").replace(/\s+/g, " ").trim();
}

async function inspectExportedResumePdf(loaded: LoadedApplication, issues: ValidationIssue[]): Promise<AtsCheck> {
  const pdfDirectory = join(loaded.jobPath, "pdfs");
  let pdfName: string | null = null;
  try {
    const names = await readdir(pdfDirectory);
    const prefix = loaded.candidateProfile?.identity.artifactPrefix;
    pdfName = (prefix ? names.find((name) => name.toLowerCase() === `${prefix}_Resume.pdf`.toLowerCase()) : null)
      ?? names.find((name) => /resume/i.test(name) && name.toLowerCase().endsWith(".pdf"))
      ?? null;
  } catch {
    return { status: "not_exported", pdfPath: null, extractedCharacters: 0, missingFields: [] };
  }
  if (!pdfName) return { status: "not_exported", pdfPath: null, extractedCharacters: 0, missingFields: [] };
  const absolutePath = join(pdfDirectory, pdfName);
  const relativePath = `jobs/${basename(loaded.jobPath)}/pdfs/${pdfName}`;
  const [pdfStats, resumeStats] = await Promise.all([
    stat(absolutePath).catch(() => null),
    loaded.resumeName ? stat(join(loaded.jobPath, loaded.resumeName)).catch(() => null) : null,
  ]);
  const stale = Boolean(pdfStats && resumeStats && pdfStats.mtimeMs < resumeStats.mtimeMs);
  if (stale) {
    issues.push(issue(
      "ATS_PDF_STALE",
      relativePath,
      "modifiedAt",
      "The exported resume PDF predates the current Markdown draft.",
      "Review the regenerated Markdown, then export a new PDF manually.",
      "warning",
    ));
  }
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const bytes = await readFile(absolutePath);
    const loadingTask = pdfjs.getDocument({ data: Uint8Array.from(bytes) });
    const document = await loadingTask.promise;
    let extracted = "";
    try {
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const text = await page.getTextContent();
        extracted += `${text.items.map((item) => "str" in item ? item.str : "").join(" ")}\n`;
      }
    } finally {
      await loadingTask.destroy();
    }
    const normalized = normalizeAtsText(extracted);
    const baseline = loaded.snapshot?.canonicalResume;
    const profile = loaded.candidateProfile;
    const expected = [
      ...(profile?.identity.fullName ? [{ label: profile.identity.fullName, value: normalizeAtsText(profile.identity.fullName) }] : []),
      ...(profile?.identity.email ? [{ label: "email", value: normalizeAtsText(profile.identity.email) }] : []),
      { label: "Professional Experience", value: "professional experience" },
      { label: "Education", value: "education" },
      ...(baseline?.employers ?? []).map((employer) => ({ label: `employer: ${employer.name}`, value: normalizeAtsText(employer.name) })),
    ];
    const missingFields = expected.filter((field) => !normalized.includes(field.value)).map((field) => field.label);
    if (missingFields.length) {
      issues.push(issue(
        "ATS_PDF_FIELDS_MISSING",
        relativePath,
        "extractedText",
        `The exported resume PDF is readable but is missing expected ATS fields: ${missingFields.join(", ")}.`,
        "Review the PDF layout and export again only after confirming the Markdown remains correct. This is a diagnostic warning, not an automatic rewrite gate.",
        "warning",
      ));
    }
    return {
      status: stale || missingFields.length ? "warning" : "passed",
      pdfPath: relativePath,
      extractedCharacters: extracted.trim().length,
      missingFields,
    };
  } catch (error) {
    issues.push(issue(
      "ATS_PDF_UNAVAILABLE",
      relativePath,
      "extractedText",
      `The exported resume PDF could not be extracted for ATS inspection: ${error instanceof Error ? error.message : String(error)}.`,
      "Keep the Markdown draft reviewable and inspect the PDF manually; do not enter an automatic repair loop.",
      "warning",
    ));
    return { status: "unavailable", pdfPath: relativePath, extractedCharacters: 0, missingFields: [] };
  }
}

export async function validateJobApplication(workspacePath: string, jobId: string, persistRunState = false): Promise<ApplicationValidationReport> {
  const loaded = await loadApplication(workspacePath, jobId);
  if (persistRunState && loaded.run && loaded.run.validationAttempts >= loaded.run.maxValidationAttempts) {
    return applicationValidationReportSchema.parse({
      status: "failed",
      jobId,
      runId: loaded.run.runId,
      snapshotId: loaded.run.snapshotId,
      manifestHash: loaded.manifestHash,
      issues: [issue(
        "VALIDATION_BUDGET_EXHAUSTED",
        ".sensei/application_run.json",
        "validationAttempts",
        "This run already used its single automatic validation attempt.",
        "Stop and return the drafts for review. Use the app button or `/jobsensei-verify` for a later user-requested check.",
        "error",
      )],
    });
  }

  const issues: ValidationIssue[] = [];
  validateRunIntegrity(loaded, issues);
  validateVisibleArtifacts(loaded, issues);
  const stretch = validateEvidenceMap(loaded, issues);
  const ats = await inspectExportedResumePdf(loaded, issues);

  const hasErrors = issues.some((candidate) => candidate.severity === "error");
  const report = applicationValidationReportSchema.parse({
    status: hasErrors ? (loaded.snapshot ? "failed" : "not_ready") : "passed",
    jobId,
    runId: loaded.run?.runId ?? null,
    snapshotId: loaded.snapshot?.snapshotId ?? null,
    manifestHash: loaded.manifestHash,
    ats,
    stretch,
    keywordClasses: keywordClasses(loaded),
    issues,
  });

  if (persistRunState && loaded.run) {
    const stale = issues.some((candidate) => candidate.severity === "error" && /MISMATCH|STALE/.test(candidate.code));
    await writeJsonAtomic(join(loaded.statePath, "application_run.json"), {
      ...loaded.run,
      state: report.status === "passed" ? "validated" : stale ? "stale" : "drafted",
      updatedAt: new Date().toISOString(),
      validatedAt: report.status === "passed" ? new Date().toISOString() : null,
      validationAttempts: loaded.run.validationAttempts + 1,
      lastValidationStatus: report.status,
    });
    await writeJsonAtomic(join(loaded.statePath, "validation_report.json"), report);
  }
  return report;
}

export async function getJobApplicationStatus(workspacePath: string, jobId: string): Promise<ApplicationStatus> {
  const loaded = await loadApplication(workspacePath, jobId);
  const validation = await validateJobApplication(workspacePath, jobId, false);
  const stats = loaded.resumeMarkdown
    ? resumeArtifactStats(loaded.resumeMarkdown)
    : { wordCount: null, experienceWordCount: null, averageExperienceBulletWords: null, bulletCount: null, currentEmployerBulletCount: null };
  let recentCurrentEmployerBulletCount: number | null = null;
  if (loaded.resumeMarkdown && loaded.snapshot && loaded.evidence) {
    recentCurrentEmployerBulletCount = currentEmployerRecencyStats(
      loaded.resumeMarkdown,
      resumeAuditFromEvidence(loaded.evidence),
      loaded.snapshot,
    ).recent;
  }
  const manifestCurrent = Boolean(loaded.snapshot && loaded.manifestHash === loaded.snapshot.manifestHash);
  const snapshotConsistent = Boolean(loaded.run && loaded.snapshot
    && loaded.run.snapshotId === loaded.snapshot.snapshotId
    && loaded.run.manifestHash === loaded.snapshot.manifestHash);
  const hasErrors = validation.issues.some((candidate) => candidate.severity === "error");
  const state: ApplicationStatus["state"] = validation.status === "passed"
    ? "validated"
    : !loaded.snapshot && !loaded.run
      ? "not_started"
      : !manifestCurrent || !snapshotConsistent
        ? "stale"
        : loaded.resumeMarkdown || loaded.coverMarkdown
          ? hasErrors ? "invalid" : "drafted"
          : "snapshot_ready";
  const templateIssues = validation.issues.filter((candidate) => /^(?:HEADER|CONTACT|SECTION_STRUCTURE|EMPLOYMENT_|EDUCATION_|CANONICAL_)/.test(candidate.code));
  const templateIntegrity: ApplicationStatus["templateIntegrity"] = !loaded.snapshot?.canonicalResume
    ? "unavailable"
    : !loaded.resumeMarkdown
      ? "not_checked"
      : templateIssues.some((candidate) => candidate.severity === "error")
        ? "failed"
        : "passed";
  return applicationStatusSchema.parse({
    jobId,
    state,
    run: loaded.run,
    footprint: loaded.snapshot?.baseResumeFootprint ?? null,
    canonicalBaselineId: loaded.snapshot?.canonicalResume?.baselineId ?? null,
    templateIntegrity,
    snapshotConsistent,
    manifestCurrent,
    publicResumePath: loaded.resumeName ? `jobs/${jobId}/${loaded.resumeName}` : null,
    resumeBulletCount: stats.bulletCount,
    currentEmployerBulletCount: stats.currentEmployerBulletCount,
    recentCurrentEmployerBulletCount,
    validation,
  });
}

function validateRunIntegrity(loaded: LoadedApplication, issues: ValidationIssue[]): void {
  if (!loaded.run) issues.push(issue("RUN_MISSING", ".sensei/application_run.json", "runId", "The pinned run is missing.", "Run the snapshot command once before drafting.", "error"));
  if (!loaded.snapshot) issues.push(issue("SNAPSHOT_MISSING", ".sensei/evidence_snapshot.json", "snapshotId", "The evidence snapshot is missing.", "Run the snapshot command once before drafting.", "error"));
  if (loaded.run && loaded.snapshot) {
    if (loaded.run.snapshotId !== loaded.snapshot.snapshotId) {
      issues.push(issue("RUN_SNAPSHOT_MISMATCH", ".sensei/application_run.json", "snapshotId", "The run and snapshot do not match.", "Stop and begin a later fresh run; do not patch existing drafts.", "error"));
    }
    if (loaded.run.manifestHash !== loaded.snapshot.manifestHash || loaded.run.baseResumePath !== loaded.snapshot.baseResumePath) {
      issues.push(issue("RUN_INPUT_MISMATCH", ".sensei/application_run.json", "manifestHash", "The run inputs do not match the snapshot.", "Stop and begin a later fresh run.", "error"));
    }
    if (loaded.snapshot.canonicalResume === undefined) {
      issues.push(issue(
        "CANONICAL_BASELINE_LEGACY",
        ".sensei/evidence_snapshot.json",
        "canonicalResume",
        "This legacy application snapshot predates protected canonical resume baselines.",
        "Keep the existing artifacts readable. Start a fresh run before regenerating them.",
        "warning",
      ));
    } else if (loaded.snapshot.canonicalResume === null) {
      issues.push(issue(
        "CANONICAL_BASELINE_MISSING",
        ".sensei/evidence_snapshot.json",
        "canonicalResume",
        loaded.snapshot.canonicalResumeWarnings.join(" ") || "The snapshot has no protected canonical resume baseline.",
        "Select a readable Markdown or DOCX base resume, then begin a fresh application run.",
        "error",
      ));
    } else if (loaded.run.canonicalBaselineId !== loaded.snapshot.canonicalResume.baselineId) {
      issues.push({
        ...issue(
          "CANONICAL_BASELINE_STALE",
          ".sensei/application_run.json",
          "canonicalBaselineId",
          "The pinned run does not identify the current canonical resume baseline.",
          "Stop and begin a fresh run; never patch protected resume fields manually.",
          "error",
        ),
        expected: loaded.snapshot.canonicalResume.baselineId,
        actual: loaded.run.canonicalBaselineId,
      });
    }
  }
  if (loaded.snapshot && loaded.manifestHash && loaded.snapshot.manifestHash !== loaded.manifestHash) {
    issues.push(issue("MANIFEST_STALE", "data/.sensei/active-context.json", "manifestHash", "Selected context changed after the snapshot.", "Stop and leave the drafts pending review.", "error"));
  }
}

/**
 * Body paragraphs that open as a narrated scene ("When a partner was unsure…", "At Northstar, I ran…",
 * "In another implementation…"): the story-led letter keeps at most one of these.
 */
export function scenarioParagraphs(paragraphs: string[]): number[] {
  const scene = /^(?:When|While|After|During|Once|Recently|Last (?:year|month|quarter)|In (?:another|one|a recent|my last|a past)\b[^,]*,|At [A-Z][\w&.'’-]*(?:\s+[A-Z][\w&.'’-]*){0,3},\s*(?:I|we)\s+(?:ran|led|worked|helped|guided|built|was|had|joined|took|stepped|handled))/;
  return paragraphs.map((paragraph, index) => scene.test(paragraph.trim()) ? index : -1).filter((index) => index >= 0);
}

function sentenceCount(paragraph: string): number {
  return paragraph.split(/(?<=[.!?])\s+/).filter((sentence) => sentence.trim().split(/\s+/).length >= 3).length;
}

/**
 * Runs of 6+ consecutive words the letter shares with the job description, ignoring the
 * company and role names. These read as parroting the posting back to the employer.
 */
export function jobDescriptionEchoes(letter: string, jobDescription: string, ignore: Array<string | null | undefined> = []): string[] {
  const words = (text: string) => {
    let value = text.toLowerCase();
    for (const term of ignore) if (term) value = value.split(term.toLowerCase()).join(" ");
    return value.replace(/[^a-z0-9'\s]+/g, " ").split(/\s+/).filter(Boolean);
  };
  const jd = words(jobDescription);
  if (jd.length < 6) return [];
  const grams = new Set<string>();
  for (let i = 0; i + 6 <= jd.length; i += 1) grams.add(jd.slice(i, i + 6).join(" "));
  const body = words(letter.replace(/^[\s\S]*?\n(?:dear|to whom)[^\n]*\n/i, ""));
  const found: string[] = [];
  for (let i = 0; i + 6 <= body.length; i += 1) {
    const gram = body.slice(i, i + 6).join(" ");
    if (grams.has(gram) && !found.some((existing) => existing.includes(body.slice(i, i + 3).join(" ")))) found.push(gram);
  }
  return found;
}

const GENERIC_REQUIREMENT_WORDS = new Set(["experience", "demonstrated", "ability", "strong", "using", "within", "including", "support", "work", "working", "proven", "skills", "knowledge", "years", "excellent", "track", "record", "related", "field", "equivalent", "high", "quality", "with", "that", "this", "from", "their", "your", "will"]);

/**
 * Letter sentences that restate one of the posting's required items (written to tick a box rather
 * than tell the candidate's work): at least four distinctive words and 35% of the requirement's wording.
 */
export function restatedRequirements(letterBody: string, requiredItems: string[]): Array<{ sentence: string; requirement: string }> {
  const words = (text: string) => new Set(text.toLowerCase().replace(/[^a-z0-9\s-]+/g, " ").split(/[\s-]+/)
    .filter((word) => word.length >= 4 && !GENERIC_REQUIREMENT_WORDS.has(word)));
  const sentences = letterBody.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
  const found: Array<{ sentence: string; requirement: string }> = [];
  for (const requirement of requiredItems) {
    const wanted = words(requirement);
    if (wanted.size < 4) continue;
    for (const sentence of sentences) {
      const shared = [...words(sentence)].filter((word) => wanted.has(word)).length;
      if (shared >= 4 && shared / wanted.size >= 0.35 && !found.some((item) => item.sentence === sentence)) found.push({ sentence, requirement });
    }
  }
  return found;
}

/**
 * Opening sentences of 15+ words with no first-person reference. These are the
 * "lecture the employer about their own business" sentences the brief forbids.
 */
export function openingSentencesNotAboutCandidate(paragraph: string): string[] {
  return paragraph.split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.split(/\s+/).length >= 15)
    .filter((sentence) => !/\b(?:I|my|me|I'm|I've|I'd|myself)\b/i.test(sentence));
}

/** Public files must never name confidential clients or partners (profile truth.confidentialNames). */
export function confidentialNameIssues(
  artifacts: Array<{ name: string; markdown: string | null | undefined }>,
  confidentialNames: string[],
): ValidationIssue[] {
  const found: ValidationIssue[] = [];
  for (const artifact of artifacts) {
    if (!artifact.markdown) continue;
    const text = artifact.markdown.toLowerCase();
    const named = confidentialNames.filter((name) => {
      const escaped = name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(text);
    });
    if (named.length) {
      found.push(issue(
        "CONFIDENTIAL_NAME_PUBLIC",
        artifact.name,
        null,
        `The file names a confidential client or partner: ${named.join(", ")}.`,
        "Describe the client or partner by industry instead (e.g. 'a global professional-services firm') before sending.",
        "warning",
      ));
    }
  }
  return found;
}

function validateVisibleArtifacts(loaded: LoadedApplication, issues: ValidationIssue[]): void {
  issues.push(...confidentialNameIssues(
    [
      { name: loaded.resumeName ?? "resume", markdown: loaded.resumeMarkdown },
      { name: "cover_letter.md", markdown: loaded.coverMarkdown },
    ],
    loaded.candidateProfile?.truth.confidentialNames ?? [],
  ));
  if (!loaded.evaluationMarkdown) {
    issues.push(issue("EVALUATION_MISSING", "evaluation.md", null, "The application evaluation is missing.", "Create one concise evaluation containing score, matches, transferability, and gaps.", "error"));
  }
  if (loaded.evaluationMarkdown) {
    try {
      const bounded = loaded.snapshot
        ? normalizeEvidenceClassifications(loaded.evaluationMarkdown, loaded.snapshot)
        : { markdown: loaded.evaluationMarkdown, adjustments: [] };
      const scoring = scoreEvaluation(bounded.markdown);
      if (!scoring) {
        issues.push(issue("FIT_SCORING_UNVERIFIED", "evaluation.md", "Requirement Scoring", "The evaluation has no machine-checkable requirement scoring table.", "Future runs should include the required per-requirement classification table; keep this existing evaluation readable.", "warning"));
      } else {
        // The finalizer writes the score and confidence lines from this arithmetic and the app shows the
        // computed score, so a different number in an older file (e.g. after recalibration) is not flagged.
        for (const adjustment of bounded.adjustments.slice(0, 5)) {
          issues.push(issue(
            adjustment.evidenceChanged ? "FIT_EVIDENCE_REMAPPED" : "FIT_CLASSIFICATION_INFLATED",
            "evaluation.md",
            adjustment.requirement,
            adjustment.evidenceChanged
              ? adjustment.reason
              : `${adjustment.from.replaceAll("_", " ")} exceeds the evidence-backed maximum of ${adjustment.to.replaceAll("_", " ")}. ${adjustment.reason}`,
            adjustment.evidenceChanged
              ? "Use exact evidence IDs copied from the pinned application context in future runs. The deterministic routed replacement was used for this score."
              : "Use the calibrated classification shown in the evaluation and keep the Apply Recommendation separate from demonstrated fit.",
            "warning",
          ));
        }
      }
    } catch (error) {
      issues.push(issue("FIT_SCORING_INVALID", "evaluation.md", "Requirement Scoring", error instanceof Error ? error.message : String(error), "Correct the scoring table in the next explicit run; do not start an automatic repair loop.", "warning"));
    }
  }
  if (!loaded.resumeName || !loaded.resumeMarkdown) {
    issues.push(issue("RESUME_MISSING", "public resume", null, "The tailored resume is missing.", "Create the canonical company resume Markdown.", "error"));
  } else {
    collectError(issues, "RESUME_CONTENT_INVALID", loaded.resumeName, () => validateApplicationArtifact(loaded.resumeMarkdown!, "resume"));
    if (loaded.snapshot?.canonicalResume) {
      for (const drift of canonicalResumeDrifts(loaded.resumeMarkdown, loaded.snapshot.canonicalResume)) {
        issues.push({
          ...issue(
            drift.code,
            loaded.resumeName,
            drift.field,
            `Protected resume content changed in ${drift.field}.`,
            "Regenerate through canonical composition; only skills and experience bullets may change.",
            "error",
          ),
          expected: drift.expected,
          actual: drift.actual,
        });
      }
      const tailoring = resumeTailoringSimilarity(loaded.resumeMarkdown, loaded.snapshot.canonicalResume, loaded.evidence);
      const minBulletChanges = Math.min(2, Math.max(1, Math.ceil((tailoring.editableLineCount - 4) * 0.15)));
      if (
        tailoring.substantiveMappedChangeCount < 3
        || tailoring.substantiveMappedBulletChangeCount < minBulletChanges
        || tailoring.nearIdenticalRatio >= 0.88
        || tailoring.nearIdenticalBulletRatio >= 0.88
      ) {
        issues.push(issue(
          "RESUME_TAILORING_TOO_SIMILAR",
          loaded.resumeName,
          "skillsAndExperience",
          `The editable resume contains ${tailoring.substantiveMappedChangeCount} substantive evidence-mapped changes (${tailoring.substantiveMappedBulletChangeCount} experience bullets) and ${tailoring.nearIdenticalLineCount} of ${tailoring.editableLineCount} lines remain near-identical to the canonical baseline (${Math.round(tailoring.nearIdenticalRatio * 100)}% of lines, ${Math.round(tailoring.nearIdenticalBulletRatio * 100)}% of bullets).`,
          "In the next explicit run, rework the 3-4 current-employer bullets most relevant to this job and curate the skills lines from selected evidence; keep earlier roles unchanged.",
          "warning",
        ));
      }
    }
    const stats = resumeArtifactStats(loaded.resumeMarkdown);
    const footprint = loaded.snapshot?.baseResumeFootprint;
    const resumePlan = loaded.applicationContext?.resumePlan;
    if (resumePlan && stats.bulletCount !== resumePlan.targetTotalBullets) {
      issues.push(issue(
        "RESUME_BULLET_PLAN_MISMATCH",
        loaded.resumeName,
        "bulletCount",
        `The resume has ${stats.bulletCount} experience bullets; this run planned ${resumePlan.targetTotalBullets}.`,
        "In the next explicit run, follow the routed employer allocation and add distinct supported bullets before lengthening existing ones.",
        "warning",
      ));
    }
    const currentEmployerTarget = resumePlan?.employerTargets[0];
    if (currentEmployerTarget && stats.currentEmployerBulletCount !== currentEmployerTarget.targetBullets) {
      issues.push(issue(
        "RESUME_EMPLOYER_PLAN_MISMATCH",
        loaded.resumeName,
        "currentEmployerBulletCount",
        `The resume has ${stats.currentEmployerBulletCount} current-employer bullets; this run planned ${currentEmployerTarget.targetBullets}.`,
        "In the next explicit run, use the profile's planned distinct evidence-backed current-employer bullets without duplicating claims or inventing detail.",
        "warning",
      ));
    }
    const minExpWordTolerance = Math.floor((footprint?.targetExperienceWordMin ?? 0) * 0.85);
    const maxExpWordTolerance = Math.ceil((footprint?.targetExperienceWordMax ?? Infinity) * 1.15);
    const minWordTolerance = Math.floor((footprint?.targetWordMin ?? 0) * 0.85);
    const maxWordTolerance = Math.ceil((footprint?.targetWordMax ?? Infinity) * 1.15);

    if (footprint?.targetExperienceWordMin && stats.experienceWordCount < minExpWordTolerance) {
      issues.push(issue("RESUME_EXPERIENCE_DENSITY_LOW", loaded.resumeName, "experienceWordCount", `The experience bullets contain ${stats.experienceWordCount} words; the preferred minimum is ${footprint.targetExperienceWordMin}.`, "Deepen supported bullets with method, scope, purpose, or documented impact in the next explicit run; never add filler or unsupported outcomes.", "warning"));
    } else if (footprint?.targetWordMin && stats.wordCount < minWordTolerance) {
      issues.push(issue("RESUME_DENSITY_LOW", loaded.resumeName, "wordCount", `The resume has ${stats.wordCount} words; the preferred minimum is ${footprint.targetWordMin}.`, "Review density if the exported page looks sparse; do not add unsupported content.", "warning"));
    }
    if (footprint?.targetExperienceWordMax && stats.experienceWordCount > maxExpWordTolerance) {
      issues.push(issue("RESUME_EXPERIENCE_DENSITY_HIGH", loaded.resumeName, "experienceWordCount", `The experience bullets contain ${stats.experienceWordCount} words; the preferred maximum is ${footprint.targetExperienceWordMax}.`, "Review readability and one-page export without automatically deleting relevant truthful content.", "warning"));
    } else if (footprint?.targetWordMax && stats.wordCount > maxWordTolerance) {
      issues.push(issue("RESUME_DENSITY_HIGH", loaded.resumeName, "wordCount", `The resume has ${stats.wordCount} words; the preferred maximum is ${footprint.targetWordMax}.`, "Review density and one-page export without deleting relevant truthful content automatically.", "warning"));
    }
  }
  if (!loaded.coverMarkdown) {
    issues.push(issue("COVER_LETTER_MISSING", "cover_letter.md", null, "The cover letter is missing.", "Create one concise employer-focused cover letter.", "error"));
  } else {
    let result: ReturnType<typeof validateApplicationArtifact> | null = null;
    try {
      result = validateApplicationArtifact(loaded.coverMarkdown, "cover-letter", { letterHardWordMax: loaded.applicationContext?.coverLetterBrief?.hardWordMax ?? null });
      if (loaded.snapshot?.canonicalResume) {
        for (const drift of canonicalCoverLetterDrifts(loaded.coverMarkdown, loaded.snapshot.canonicalResume)) {
          issues.push({
            ...issue(
              drift.code,
              "cover_letter.md",
              drift.field,
              "The cover-letter candidate contact block differs from the canonical base resume.",
              "Regenerate the cover letter through canonical composition.",
              "error",
            ),
            expected: drift.expected,
            actual: drift.actual,
          });
        }
      }
    } catch (error) {
      issues.push(issue("COVER_LETTER_INVALID", "cover_letter.md", null, error instanceof Error ? error.message : String(error), "Leave the draft pending review; do not enter an automatic repair loop.", "error"));
    }
    if (!result) return;
    if (result.wordCount < 180) {
      issues.push(issue("COVER_LETTER_CONCISE", "cover_letter.md", "wordCount", `The cover letter has ${result.wordCount} words.`, "This is allowed; review whether the employer connection and career arc are sufficiently clear.", "warning"));
    }
    if ((result.paragraphCount ?? 0) < MIN_COVER_LETTER_PARAGRAPHS || (result.paragraphCount ?? 0) > MAX_COVER_LETTER_PARAGRAPHS) {
      issues.push(issue("COVER_LETTER_STRUCTURE", "cover_letter.md", "paragraphCount", `The cover letter has ${result.paragraphCount ?? 0} body paragraphs; 3-5 is preferred.`, "Review structure manually; do not pad the letter automatically.", "warning"));
    }
    const boilerplatePatterns = loaded.applicationContext?.coverLetterBrief?.prohibitedPatterns ?? [];
    const usedPattern = boilerplatePatterns.find((pattern) => loaded.coverMarkdown!.toLowerCase().includes(pattern.toLowerCase()));
    if (usedPattern) {
      issues.push(issue(
        "COVER_LETTER_BOILERPLATE",
        "cover_letter.md",
        "bodyParagraphs",
        `The cover letter reused a prohibited generic pattern: “${usedPattern}”.`,
        "Follow coverLetterBrief in the next explicit run: a plain first-person opening, concrete examples from the candidate's own work, and a short warm close.",
        "warning",
      ));
    }
    const firstParagraph = coverLetterBodyParagraphs(loaded.coverMarkdown)[0] ?? "";
    const brief = loaded.applicationContext?.coverLetterBrief;
    const namesCandidate = /\b(?:I|my)\b/i.test(firstParagraph);
    const namesCompany = !brief?.company || firstParagraph.toLowerCase().includes(brief.company.toLowerCase());
    const namesRole = !brief?.role || firstParagraph.toLowerCase().includes(brief.role.toLowerCase());
    const bodyParagraphs = coverLetterBodyParagraphs(loaded.coverMarkdown);
    // The career story paragraph may run to 4 sentences; an examples-led letter keeps 3.
    const storyLed = brief?.focus !== "examples";
    const sentenceLimit = storyLed ? MAX_COVER_LETTER_SENTENCES_PER_PARAGRAPH + 1 : MAX_COVER_LETTER_SENTENCES_PER_PARAGRAPH;
    const denseIndex = bodyParagraphs.findIndex((paragraph) => sentenceCount(paragraph) > sentenceLimit);
    if (denseIndex >= 0) {
      issues.push(issue(
        "COVER_LETTER_DENSE_PARAGRAPH",
        "cover_letter.md",
        `bodyParagraphs.${denseIndex}`,
        `Paragraph ${denseIndex + 1} has ${sentenceCount(bodyParagraphs[denseIndex]!)} sentences; at most ${sentenceLimit} reads well.`,
        storyLed ? "Keep each paragraph to one idea: the career story, then how you work now." : "Tell one or two examples properly instead of listing several.",
        "warning",
      ));
    }
    const scenes = storyLed ? scenarioParagraphs(bodyParagraphs) : [];
    if (scenes.length >= 2) {
      issues.push(issue(
        "COVER_LETTER_SCENARIO_HEAVY",
        "cover_letter.md",
        `bodyParagraphs.${scenes[0]}`,
        `${scenes.length} paragraphs tell a scene ("${bodyParagraphs[scenes[0]!]!.split(/\s+/).slice(0, 8).join(" ")}…") instead of the career story.`,
        "Tell where you started, why you moved, and how you work now; keep at most one concrete detail, woven in rather than told as a scene.",
        "warning",
      ));
    }
    const echoes = jobDescriptionEchoes(loaded.coverMarkdown, loaded.jobDescriptionText ?? "", [brief?.company, brief?.role]);
    if (echoes.length) {
      issues.push(issue(
        "COVER_LETTER_ECHOES_JD",
        "cover_letter.md",
        "bodyParagraphs",
        `The letter repeats job-description wording: “${echoes[0]}”.`,
        "Describe the candidate's own work in their own words; don't mirror the posting.",
        "warning",
      ));
    }
    const restated = restatedRequirements(loaded.coverMarkdown.replace(/^[\s\S]*?\n(?:dear|to whom)[^\n]*\n/i, ""), postingRecordFor(loaded.jobDescriptionText ?? "").requiredItems);
    if (restated.length) {
      issues.push(issue(
        "COVER_LETTER_RESTATES_REQUIREMENT",
        "cover_letter.md",
        "bodyParagraphs",
        `A letter sentence restates a requirement instead of telling your work: “${restated[0]!.sentence}”.`,
        "Replace it with a real example from your evidence, or cut it; the resume and interview cover the checklist.",
        "warning",
      ));
    }
    const employerSentences = openingSentencesNotAboutCandidate(firstParagraph);
    if (employerSentences.length) {
      issues.push(issue(
        "COVER_LETTER_OPENING_ABOUT_EMPLOYER",
        "cover_letter.md",
        "bodyParagraphs.0",
        `The opening explains the employer or the job instead of the candidate: “${employerSentences[0]}”`,
        "Keep the opening about the candidate: why they are applying and who they are. Do not explain the employer's business back to them.",
        "warning",
      ));
    }
    if (!namesCandidate || !namesCompany || !namesRole) {
      issues.push(issue(
        "COVER_LETTER_INTRO_IMPERSONAL",
        "cover_letter.md",
        "bodyParagraphs.0",
        "The opening does not clearly introduce the candidate, company, and role.",
        "Start with a plain first-person sentence grounded in the candidate profile, then connect the documented career progression to the work.",
        "warning",
      ));
    }
  }
}

/** Validates the claim map; returns the stretch score for the drafts it covers (null when it can't be read). */
function validateEvidenceMap(loaded: LoadedApplication, issues: ValidationIssue[]): StretchScore | null {
  if (loaded.evidenceUnreadable || !loaded.evidence) {
    issues.push(issue("EVIDENCE_MAP_INCOMPLETE", ".sensei/application_evidence.json", null, "The compact evidence map is missing or malformed.", "The drafts remain reviewable, but their claim grounding is not fully machine-verified.", "warning"));
    return null;
  }
  if (!loaded.run || !loaded.snapshot || !loaded.resumeName || !loaded.resumeMarkdown || !loaded.coverMarkdown) return null;
  for (const [field, expected, actual] of [
    ["applicationRunId", loaded.run.runId, loaded.evidence.applicationRunId],
    ["evidenceSnapshotId", loaded.snapshot.snapshotId, loaded.evidence.evidenceSnapshotId],
    ["manifestHash", loaded.snapshot.manifestHash, loaded.evidence.manifestHash],
    ["baseResumePath", loaded.snapshot.baseResumePath, loaded.evidence.baseResumePath],
  ] as const) {
    if (actual !== expected) issues.push(issue("EVIDENCE_MAP_MISMATCH", ".sensei/application_evidence.json", field, `The evidence map has the wrong ${field}.`, "Stop and leave the drafts pending review; do not patch identifiers.", "error"));
  }
  if (loaded.evidence.resume.publicArtifact !== loaded.resumeName) {
    issues.push(issue("EVIDENCE_MAP_MISMATCH", ".sensei/application_evidence.json", "resume.publicArtifact", "The evidence map identifies another resume.", "Stop and leave the drafts pending review.", "error"));
  }
  const resumeFailures = collectClaimIssues(issues, "RESUME_GROUNDING_INVALID", (claimFailures) => validateResumeAuditJson(
    resumeAuditFromEvidence(loaded.evidence!),
    {
      publicMarkdown: loaded.resumeMarkdown!,
      publicArtifactName: loaded.resumeName!,
      snapshot: loaded.snapshot!,
      applicationRunId: loaded.run!.runId,
      leanEvidenceMap: true,
      claimFailures,
    },
  ));
  const coverFailures = collectClaimIssues(issues, "COVER_GROUNDING_INVALID", (claimFailures) => validateCoverLetterAuditJson(
    coverAuditFromEvidence(loaded.evidence!),
    {
      publicMarkdown: loaded.coverMarkdown!,
      publicArtifactName: "cover_letter.md",
      snapshot: loaded.snapshot!,
      applicationRunId: loaded.run!.runId,
      claimFailures,
    },
  ));
  const snapshot = loaded.snapshot;
  return scoreStretch({
    lines: [
      ...loaded.evidence.resume.claimMappings.map((mapping) => ({ text: mapping.publicText, claimType: mapping.claimType, evidenceIds: mapping.evidenceIds, artifact: "resume" as const })),
      ...loaded.evidence.coverLetter.claimMappings.map((mapping) => ({ text: mapping.publicText, claimType: mapping.claimType, evidenceIds: mapping.evidenceIds, artifact: "cover-letter" as const })),
    ],
    baselineLines: [
      ...(snapshot.canonicalResume?.employers.flatMap((employer) => employer.originalBullets) ?? []),
      ...(snapshot.canonicalResume?.originalSkillsLines ?? []),
    ],
    rowText: new Map(snapshot.evidenceRows.map((row) => [row.evidenceId, `${row.claim} ${row.scope}`])),
    // Only failures that mean the line says more than its evidence; evidence-rule failures (corroboration,
    // routing, currency) are reported as warnings but are not inflation.
    unsupported: [...resumeFailures, ...coverFailures]
      .filter((failure) => INFLATION_FAILURE.test(failure.message))
      .map((failure) => ({ text: failure.explanation.sentence ?? "", reason: failure.message }))
      .filter((line) => line.text),
  });
}

function resumeAuditFromEvidence(evidence: ApplicationEvidence) {
  return {
    schemaVersion: 1 as const,
    artifactType: "resume" as const,
    publicArtifact: evidence.resume.publicArtifact,
    validationStatus: "passed" as const,
    applicationRunId: evidence.applicationRunId,
    evidenceSnapshotId: evidence.evidenceSnapshotId,
    manifestHash: evidence.manifestHash,
    baseResumePath: evidence.baseResumePath,
    claimMappings: evidence.resume.claimMappings,
    sideBySideChanges: [],
    suggestedAdditionalBullets: [],
    metricOpportunities: [],
  };
}

function coverAuditFromEvidence(evidence: ApplicationEvidence) {
  return {
    schemaVersion: 1 as const,
    artifactType: "cover-letter" as const,
    publicArtifact: "cover_letter.md" as const,
    validationStatus: "passed" as const,
    applicationRunId: evidence.applicationRunId,
    evidenceSnapshotId: evidence.evidenceSnapshotId,
    manifestHash: evidence.manifestHash,
    baseResumePath: evidence.baseResumePath,
    claimMappings: evidence.coverLetter.claimMappings,
    careerArc: evidence.coverLetter.careerArc,
  };
}

async function loadApplication(workspacePath: string, jobId: string): Promise<LoadedApplication> {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(jobId)) throw new Error("The canonical job ID is invalid.");
  const workspace = resolve(workspacePath);
  const jobPath = assertInsideWorkspace(workspace, join(workspace, "jobs", jobId));
  if (!(await stat(jobPath).catch(() => null))?.isDirectory()) throw new Error(`The canonical job workspace does not exist: jobs/${jobId}.`);
  const statePath = assertInsideWorkspace(workspace, join(jobPath, ".sensei"));
  const files = await readdir(jobPath);
  const candidateProfile = await readCandidateProfile(workspace);
  const escapedPrefix = candidateProfile?.identity.artifactPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const resumePattern = escapedPrefix
    ? new RegExp(`^${escapedPrefix}_[A-Za-z0-9][A-Za-z0-9_-]*_Resume\\.md$`)
    : /^[A-Za-z0-9][A-Za-z0-9_-]*_[A-Za-z0-9][A-Za-z0-9_-]*_Resume\.md$/;
  const resumeName = files.find((name) => resumePattern.test(name)) ?? null;
  const manifest = await readOptionalJson(join(workspace, ".sensei", "active-context.json"), contextManifestSchema);
  const evidenceResult = await readJsonState(join(statePath, "application_evidence.json"), applicationEvidenceSchema);
  const applicationContext = await readOptionalJson(join(statePath, "application_context.json"), applicationContextSchema);
  return {
    jobPath,
    statePath,
    run: await readStateWithLegacy(statePath, jobPath, "application_run.json", applicationRunSchema),
    snapshot: await readStateWithLegacy(statePath, jobPath, "evidence_snapshot.json", evidenceSnapshotSchema),
    evidence: evidenceResult.value,
    evidenceUnreadable: evidenceResult.exists && !evidenceResult.value,
    manifestHash: manifest ? contextManifestHash(manifest) : null,
    evaluationMarkdown: await readOptionalText(join(jobPath, "evaluation.md")),
    resumeName,
    resumeMarkdown: resumeName ? await readOptionalText(join(jobPath, resumeName)) : null,
    coverMarkdown: await readOptionalText(join(jobPath, "cover_letter.md")),
    applicationContext,
    candidateProfile,
    jobDescriptionText: await readOptionalText(join(jobPath, "original_jd.md")) ?? await readOptionalText(join(jobPath, "original_jd.txt")),
  };
}

async function readStateWithLegacy<T>(statePath: string, jobPath: string, name: string, schema: { parse(value: unknown): T }): Promise<T | null> {
  return await readOptionalJson(join(statePath, name), schema) ?? readOptionalJson(join(jobPath, name), schema);
}

async function readJsonState<T>(path: string, schema: { parse(value: unknown): T }): Promise<{ exists: boolean; value: T | null }> {
  const raw = await readFile(path, "utf8").catch(() => null);
  if (raw === null) return { exists: false, value: null };
  try {
    return { exists: true, value: schema.parse(JSON.parse(raw)) };
  } catch {
    return { exists: true, value: null };
  }
}

const MAX_CLAIM_ISSUES = 10;
/** Grounding failures that mean a line claims more than its evidence (used by the stretch score). */
const INFLATION_FAILURE = /names terms|skills not found|upgrades ownership|public metric|share no wording|denylist|deny:/i;

/**
 * Grounding warnings name every failing line with the rows it cited. A stale manifest is
 * MANIFEST_STALE's job, so it is not repeated here.
 */
function collectClaimIssues(issues: ValidationIssue[], code: string, run: (claimFailures: ClaimFailure[]) => unknown): ClaimFailure[] {
  const claimFailures: ClaimFailure[] = [];
  collectError(issues, code, ".sensei/application_evidence.json", () => run(claimFailures), "warning");
  const hint = "Cite the evidence row whose text contains the claim's terms, or reword the line to what the row says.";
  for (const failure of claimFailures.slice(0, MAX_CLAIM_ISSUES)) {
    issues.push(issue(code, ".sensei/application_evidence.json", null, failure.message, hint, "warning", failure.explanation));
  }
  if (claimFailures.length > MAX_CLAIM_ISSUES) {
    issues.push(issue(code, ".sensei/application_evidence.json", null, `${claimFailures.length - MAX_CLAIM_ISSUES} more lines have the same kind of grounding problem.`, hint, "warning"));
  }
  return claimFailures;
}

function collectError(
  issues: ValidationIssue[],
  code: string,
  artifact: string,
  operation: () => unknown,
  severity: "error" | "warning" = "error",
): void {
  try {
    operation();
  } catch (error) {
    issues.push(issue(
      code,
      artifact,
      null,
      error instanceof Error ? error.message : String(error),
      "Keep the generated documents available for human review; do not enter an automatic repair loop.",
      severity,
      error instanceof ClaimValidationError ? error.explanation : null,
    ));
  }
}

function issue(
  code: string,
  artifact: string,
  field: string | null,
  message: string,
  repairHint: string,
  severity: "error" | "warning",
  explanation: ValidationIssue["explanation"] = null,
): ValidationIssue {
  return { code, artifact, field, message, expected: null, actual: null, repairHint, severity, explanation };
}

async function readOptionalText(path: string): Promise<string | null> {
  return readFile(path, "utf8").catch(() => null);
}

async function readOptionalJson<T>(path: string, schema: { parse(value: unknown): T }): Promise<T | null> {
  return readFile(path, "utf8").then((value) => schema.parse(JSON.parse(value))).catch(() => null);
}
