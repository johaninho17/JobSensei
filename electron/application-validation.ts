import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
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
  resumeArtifactStats,
  validateApplicationArtifact,
  validateCoverLetterAuditJson,
  validateResumeAuditJson,
  ClaimValidationError,
} from "./application-artifacts";
import { contextManifestHash } from "./context-manifest-hash";
import { writeJsonAtomic } from "./persistence";
import { assertInsideWorkspace } from "./workspace";
import { normalizeEvidenceClassifications, scoreEvaluation } from "./fit-scoring";
import { canonicalCoverLetterDrifts, canonicalResumeDrifts } from "./canonical-resume";
import { readCandidateProfile } from "./candidate-profile";

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
  const skills = lines.findIndex((line) => /^\s*(?:\*\*|__)?skills(?:\s*&\s*languages)?/i.test(line));
  const experience = lines.findIndex((line) => /^\s*(?:\*\*|__)?professional experience/i.test(line));
  const education = lines.findIndex((line) => /^\s*(?:\*\*|__)?education/i.test(line));
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
  return scoring.requirements.map((row) => ({
    term: row.requirement,
    classification: row.classification === "direct"
      ? "supported"
      : row.classification === "strong_transferable" || row.classification === "adjacent_transferable"
        ? "transferable"
        : "unsupported",
    evidenceIds: keywordEvidenceIds(row.evidence),
  }));
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
  validateEvidenceMap(loaded, issues);
  const ats = await inspectExportedResumePdf(loaded, issues);

  const hasErrors = issues.some((candidate) => candidate.severity === "error");
  const report = applicationValidationReportSchema.parse({
    status: hasErrors ? (loaded.snapshot ? "failed" : "not_ready") : "passed",
    jobId,
    runId: loaded.run?.runId ?? null,
    snapshotId: loaded.snapshot?.snapshotId ?? null,
    manifestHash: loaded.manifestHash,
    ats,
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

function validateVisibleArtifacts(loaded: LoadedApplication, issues: ValidationIssue[]): void {
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
        const declared = /Weighted Fit Score\*{0,2}\s*:\*{0,2}\s*(\d(?:\.\d+)?)\s*\/\s*5(?:\.0)?/i.exec(loaded.evaluationMarkdown)?.[1];
        if (!declared || Math.abs(Number(declared) - scoring.score) > 0.05) {
          issues.push(issue("FIT_SCORE_MISMATCH", "evaluation.md", "Weighted Fit Score", `The declared score does not match the requirement-level arithmetic (${scoring.score.toFixed(2)} / 5).`, "Use the deterministic requirement score and its applicable core-work cap.", "warning"));
        }
        const confidence = /Fit Confidence\*{0,2}\s*:\*{0,2}\s*([^\n]+)/i.exec(loaded.evaluationMarkdown)?.[1]?.replace(/[\u0060*]/g, "").trim().toLowerCase();
        if (confidence && confidence !== scoring.confidence) {
          issues.push(issue("FIT_CONFIDENCE_MISMATCH", "evaluation.md", "Fit Confidence", `The declared confidence is ${confidence}; requirement coverage supports ${scoring.confidence}.`, "Derive confidence from direct weighted coverage instead of application enthusiasm.", "warning"));
        }
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
      const minBulletChanges = Math.min(3, Math.max(1, Math.ceil((tailoring.editableLineCount - 4) * 0.25)));
      if (
        tailoring.substantiveMappedChangeCount < 4
        || tailoring.substantiveMappedBulletChangeCount < minBulletChanges
        || tailoring.nearIdenticalRatio >= 0.65
        || tailoring.nearIdenticalBulletRatio >= 0.7
      ) {
        issues.push(issue(
          "RESUME_TAILORING_TOO_SIMILAR",
          loaded.resumeName,
          "skillsAndExperience",
          `The editable resume contains ${tailoring.substantiveMappedChangeCount} substantive evidence-mapped changes (${tailoring.substantiveMappedBulletChangeCount} experience bullets) and ${tailoring.nearIdenticalLineCount} of ${tailoring.editableLineCount} lines remain near-identical to the canonical baseline (${Math.round(tailoring.nearIdenticalRatio * 100)}% of lines, ${Math.round(tailoring.nearIdenticalBulletRatio * 100)}% of bullets).`,
          "In the next explicit run, rebuild the editable draft from the current job's highest-value requirements and selected evidence. Curate skills and bullets across relevant employers for the target role family; do not reuse the canonical resume as the tailored output.",
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
    if (footprint?.targetExperienceWordMin && stats.experienceWordCount < footprint.targetExperienceWordMin) {
      issues.push(issue("RESUME_EXPERIENCE_DENSITY_LOW", loaded.resumeName, "experienceWordCount", `The experience bullets contain ${stats.experienceWordCount} words; the preferred minimum is ${footprint.targetExperienceWordMin}.`, "Deepen supported bullets with method, scope, purpose, or documented impact in the next explicit run; never add filler or unsupported outcomes.", "warning"));
    } else if (footprint?.targetWordMin && stats.wordCount < footprint.targetWordMin) {
      issues.push(issue("RESUME_DENSITY_LOW", loaded.resumeName, "wordCount", `The resume has ${stats.wordCount} words; the preferred minimum is ${footprint.targetWordMin}.`, "Review density if the exported page looks sparse; do not add unsupported content.", "warning"));
    }
    if (footprint?.targetExperienceWordMax && stats.experienceWordCount > footprint.targetExperienceWordMax) {
      issues.push(issue("RESUME_EXPERIENCE_DENSITY_HIGH", loaded.resumeName, "experienceWordCount", `The experience bullets contain ${stats.experienceWordCount} words; the preferred maximum is ${footprint.targetExperienceWordMax}.`, "Review readability and one-page export without automatically deleting relevant truthful content.", "warning"));
    } else if (footprint?.targetWordMax && stats.wordCount > footprint.targetWordMax) {
      issues.push(issue("RESUME_DENSITY_HIGH", loaded.resumeName, "wordCount", `The resume has ${stats.wordCount} words; the preferred maximum is ${footprint.targetWordMax}.`, "Review density and one-page export without deleting relevant truthful content automatically.", "warning"));
    }
  }
  if (!loaded.coverMarkdown) {
    issues.push(issue("COVER_LETTER_MISSING", "cover_letter.md", null, "The cover letter is missing.", "Create one concise employer-focused cover letter.", "error"));
  } else {
    let result: ReturnType<typeof validateApplicationArtifact> | null = null;
    try {
      result = validateApplicationArtifact(loaded.coverMarkdown, "cover-letter");
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
    if (result.wordCount < 190) {
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
        "Use the job-specific role problem, one grounded example, a concise chronological bridge, and a specific close in the next explicit run.",
        "warning",
      ));
    }
    const firstParagraph = coverLetterBodyParagraphs(loaded.coverMarkdown)[0] ?? "";
    const brief = loaded.applicationContext?.coverLetterBrief;
    const namesCandidate = /\b(?:I|my)\b/i.test(firstParagraph);
    const namesCompany = !brief?.company || firstParagraph.toLowerCase().includes(brief.company.toLowerCase());
    const namesRole = !brief?.role || firstParagraph.toLowerCase().includes(brief.role.toLowerCase());
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

function validateEvidenceMap(loaded: LoadedApplication, issues: ValidationIssue[]): void {
  if (loaded.evidenceUnreadable || !loaded.evidence) {
    issues.push(issue("EVIDENCE_MAP_INCOMPLETE", ".sensei/application_evidence.json", null, "The compact evidence map is missing or malformed.", "The drafts remain reviewable, but their claim grounding is not fully machine-verified.", "warning"));
    return;
  }
  if (!loaded.run || !loaded.snapshot || !loaded.resumeName || !loaded.resumeMarkdown || !loaded.coverMarkdown) return;
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
  collectError(issues, "RESUME_GROUNDING_INVALID", ".sensei/application_evidence.json", () => validateResumeAuditJson(
    resumeAuditFromEvidence(loaded.evidence!),
    {
      publicMarkdown: loaded.resumeMarkdown!,
      publicArtifactName: loaded.resumeName!,
      snapshot: loaded.snapshot!,
      currentManifestHash: loaded.manifestHash ?? undefined,
      applicationRunId: loaded.run!.runId,
      leanEvidenceMap: true,
    },
  ), "warning");
  collectError(issues, "COVER_GROUNDING_INVALID", ".sensei/application_evidence.json", () => validateCoverLetterAuditJson(
    coverAuditFromEvidence(loaded.evidence!),
    {
      publicMarkdown: loaded.coverMarkdown!,
      publicArtifactName: "cover_letter.md",
      snapshot: loaded.snapshot!,
      currentManifestHash: loaded.manifestHash ?? undefined,
      applicationRunId: loaded.run!.runId,
    },
  ), "warning");
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
