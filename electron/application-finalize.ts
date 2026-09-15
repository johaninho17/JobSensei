import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
  applicationContextSchema,
  applicationBundleSchema,
  applicationDraftSchema,
  applicationEvidenceSchema,
  applicationRunSchema,
  applicationValidationReportSchema,
  contextManifestSchema,
  evidenceSnapshotSchema,
  type ApplicationValidationReport,
  type ApplicationBundle,
  type ApplicationDraft,
  type ApplicationEvidence,
  type EvidenceSnapshot,
  type ApplicationRun,
  type ValidationIssue,
} from "../src/shared/schemas";
import {
  canonicalCoverLetterDrifts,
  canonicalResumeDrifts,
  composeCanonicalCoverLetter,
  composeCanonicalResume,
} from "./canonical-resume";
import { contextManifestHash } from "./context-manifest-hash";
import { mergeEvaluationAudit } from "./evaluation-audit";
import { normalizeEvaluationScore, scoreEvaluation } from "./fit-scoring";
import { validateJobApplication } from "./application-validation";
import { writeJsonAtomic, writeTextAtomic } from "./persistence";
import { assertInsideWorkspace } from "./workspace";
import { readCandidateProfile } from "./candidate-profile";

class ApplicationInputError extends Error {
  constructor(
    readonly artifact: string,
    readonly cause: unknown,
  ) {
    super(`Invalid application input: ${artifact}`);
  }
}

async function readJson<T>(path: string, artifact: string, schema: { parse(value: unknown): T }): Promise<T> {
  try {
    return schema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error: unknown) {
    throw new ApplicationInputError(artifact, error);
  }
}

async function readOptionalBundle(path: string): Promise<ApplicationBundle | null> {
  try {
    return applicationBundleSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw new ApplicationInputError(".sensei/application_bundle.json", error);
  }
}

function publicResumeName(prefix: string, company: string | null | undefined): string {
  const token = (company ?? "Company").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "Company";
  return `${prefix}_${token}_Resume.md`;
}

function materializeBundle(
  bundle: ApplicationBundle,
  snapshot: EvidenceSnapshot,
  artifactPrefix: string,
  company: string | null | undefined,
): { draft: ApplicationDraft; evidence: ApplicationEvidence; evaluationMarkdown: string } {
  const rows = new Map(snapshot.evidenceRows.map((row) => [row.evidenceId, row]));
  const sourcePaths = (ids: string[]) => [...new Set(ids.map((id) => rows.get(id)?.sourcePath).filter((path): path is string => Boolean(path)))];
  const timeline = (ids: string[], employerSpecific = false): "current" | "prior" | "transition" | "employer-specific" | null => {
    if (employerSpecific) return "employer-specific";
    const bands = new Set(ids.map((id) => rows.get(id)?.recencyBand));
    if (bands.has("current") && (bands.has("recent") || bands.has("foundation"))) return "transition";
    if (bands.has("current")) return "current";
    return ids.length ? "prior" : null;
  };
  const claim = (item: { text: string; evidenceIds: string[] }, employerSpecific = false) => ({
    publicText: item.text,
    claimType: item.evidenceIds.length ? "candidate" as const : "non-factual" as const,
    evidenceIds: item.evidenceIds,
    sourcePaths: sourcePaths(item.evidenceIds),
    timeline: timeline(item.evidenceIds, employerSpecific),
    ownership: item.evidenceIds.length ? "supported" : "",
  });
  const coverItems = bundle.coverLetter.bodyParagraphs.flatMap((paragraph) => paragraph.sentences);
  const coverClaims = coverItems.map((item) => claim(item));
  const arcClaims = coverClaims.filter((mapping) => mapping.claimType === "candidate" && mapping.evidenceIds.length);
  const careerArc = arcClaims.filter((mapping, index, all) =>
    index === 0 || mapping.evidenceIds.some((id) => !all.slice(0, index).some((prior) => prior.evidenceIds.includes(id))))
    .slice(0, 3)
    .map((mapping) => ({
      stage: rows.get(mapping.evidenceIds[0])?.claim ?? mapping.publicText,
      timeline: mapping.timeline === "current" || mapping.timeline === "transition" ? mapping.timeline : "prior" as const,
      evidenceIds: mapping.evidenceIds,
    }));
  const resumeName = publicResumeName(artifactPrefix, company);
  return {
    evaluationMarkdown: bundle.evaluationMarkdown,
    draft: applicationDraftSchema.parse({
      schemaVersion: 1,
      applicationRunId: bundle.applicationRunId,
      evidenceSnapshotId: bundle.evidenceSnapshotId,
      canonicalBaselineId: bundle.canonicalBaselineId,
      resume: {
        skillsLines: bundle.resume.skillsLines.map((item) => item.text),
        employers: bundle.resume.employers.map((employer) => ({
          name: employer.name,
          bullets: employer.bullets.map((item) => item.text),
        })),
      },
      coverLetter: {
        date: bundle.coverLetter.date,
        recipientLines: bundle.coverLetter.recipientLines,
        salutation: bundle.coverLetter.salutation,
        bodyParagraphs: bundle.coverLetter.bodyParagraphs.map((paragraph) => paragraph.sentences.map((item) => item.text).join(" ")),
        closing: bundle.coverLetter.closing,
      },
    }),
    evidence: applicationEvidenceSchema.parse({
      schemaVersion: 1,
      applicationRunId: bundle.applicationRunId,
      evidenceSnapshotId: bundle.evidenceSnapshotId,
      manifestHash: snapshot.manifestHash,
      baseResumePath: snapshot.baseResumePath,
      resume: {
        publicArtifact: resumeName,
        claimMappings: [
          ...bundle.resume.skillsLines.map((item) => claim(item)),
          ...bundle.resume.employers.flatMap((employer) => employer.bullets.map((item) => claim(item, true))),
        ],
      },
      coverLetter: {
        publicArtifact: "cover_letter.md",
        claimMappings: coverClaims,
        careerArc,
      },
      excludedClaims: bundle.excludedClaims,
      warnings: bundle.warnings,
    }),
  };
}

function inputValidationIssues(error: ApplicationInputError): ValidationIssue[] {
  const cause = error.cause as { issues?: Array<{ path?: Array<string | number>; message?: string }>; code?: string; message?: string };
  if (Array.isArray(cause?.issues) && cause.issues.length) {
    return cause.issues.slice(0, 5).map((issue) => ({
      code: "INPUT_SCHEMA_INVALID",
      artifact: error.artifact,
      field: issue.path?.length ? issue.path.join(".") : null,
      message: issue.message || "The generated JSON does not match the application contract.",
      expected: "The exact Hidden Evidence or Hidden Draft Contract from jobsensei-application-pipeline.",
      actual: null,
      repairHint: "Keep this run pending review. Use the exact documented JSON shape in the next explicit generation run; do not start an automatic repair loop.",
      severity: "error",
      explanation: null,
    }));
  }
  const missing = cause?.code === "ENOENT";
  return [{
    code: missing ? "INPUT_MISSING" : "INPUT_JSON_INVALID",
    artifact: error.artifact,
    field: null,
    message: missing ? "A required hidden application input is missing." : (cause?.message || "The generated application input is not valid JSON."),
    expected: "A present, parseable file matching the exact JobSensei contract.",
    actual: null,
    repairHint: "Keep this run pending review. Regenerate the complete hidden input in the next explicit run; do not patch this run automatically.",
    severity: "error",
    explanation: null,
  }];
}

async function readableRun(path: string): Promise<ApplicationRun | null> {
  try {
    return applicationRunSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return null;
  }
}

async function finalizeApplicationUnchecked(workspacePath: string, jobId: string, persistRunState = true): Promise<ApplicationValidationReport> {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(jobId)) throw new Error("The canonical job ID is invalid.");
  const workspace = resolve(workspacePath);
  const jobPath = assertInsideWorkspace(workspace, join(workspace, "jobs", jobId));
  const statePath = assertInsideWorkspace(jobPath, join(jobPath, ".sensei"));
  const [run, snapshot, manifest, applicationContext, bundle] = await Promise.all([
    readJson(join(statePath, "application_run.json"), ".sensei/application_run.json", applicationRunSchema),
    readJson(join(statePath, "evidence_snapshot.json"), ".sensei/evidence_snapshot.json", evidenceSnapshotSchema),
    readJson(join(workspace, ".sensei", "active-context.json"), "data/.sensei/active-context.json", contextManifestSchema),
    readFile(join(statePath, "application_context.json"), "utf8")
      .then((value) => applicationContextSchema.parse(JSON.parse(value)))
      .catch(() => null),
    readOptionalBundle(join(statePath, "application_bundle.json")),
  ]);
  const candidateProfile = await readCandidateProfile(workspace);
  if (!snapshot.canonicalResume) {
    throw new Error(snapshot.canonicalResumeWarnings.join(" ") || "The current snapshot has no canonical resume baseline.");
  }
  if (snapshot.applicationRouting) {
    if (!applicationContext) throw new Error("The job-scoped application context is missing. Begin a fresh snapshot run.");
    if (applicationContext.snapshotId !== snapshot.snapshotId
      || applicationContext.manifestHash !== snapshot.manifestHash
      || applicationContext.baseResumePath !== snapshot.baseResumePath) {
      throw new Error("The job-scoped application context does not match the pinned snapshot.");
    }
  }
  const jobCompany = applicationContext?.schemaVersion === 2 ? applicationContext.job.company : null;
  const generated = bundle
    ? materializeBundle(bundle, snapshot, candidateProfile?.identity.artifactPrefix ?? "Candidate", jobCompany)
    : null;
  const [draft, evidence] = generated
    ? [generated.draft, generated.evidence]
    : await Promise.all([
      readJson(join(statePath, "application_draft.json"), ".sensei/application_draft.json", applicationDraftSchema),
      readJson(join(statePath, "application_evidence.json"), ".sensei/application_evidence.json", applicationEvidenceSchema),
    ]);
  if (run.runId !== draft.applicationRunId || run.snapshotId !== draft.evidenceSnapshotId) {
    throw new Error("The application draft does not belong to the pinned application run.");
  }
  if (draft.canonicalBaselineId !== snapshot.canonicalResume.baselineId
    || run.canonicalBaselineId !== snapshot.canonicalResume.baselineId) {
    throw new Error("The application draft does not identify the pinned canonical resume baseline.");
  }
  if (snapshot.manifestHash !== contextManifestHash(manifest)) {
    throw new Error("The active context changed after the application snapshot. Begin a fresh run.");
  }
  if (evidence.applicationRunId !== run.runId
    || evidence.evidenceSnapshotId !== snapshot.snapshotId
    || evidence.manifestHash !== snapshot.manifestHash
    || evidence.baseResumePath !== snapshot.baseResumePath) {
    throw new Error("The application evidence map does not match the pinned run.");
  }

  const resumeMarkdown = composeCanonicalResume(snapshot.canonicalResume, draft.resume);
  const coverMarkdown = composeCanonicalCoverLetter(snapshot.canonicalResume, draft.coverLetter);
  const resumeName = evidence.resume.publicArtifact;
  const escapedPrefix = (candidateProfile?.identity.artifactPrefix ?? "Candidate").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`^${escapedPrefix}_[A-Za-z0-9][A-Za-z0-9_-]*_Resume\\.md$`).test(resumeName)) {
    throw new Error("The evidence map does not identify a canonical public resume filename.");
  }
  const resumePath = assertInsideWorkspace(jobPath, join(jobPath, resumeName));
  const coverPath = assertInsideWorkspace(jobPath, join(jobPath, "cover_letter.md"));
  const resumeDrifts = canonicalResumeDrifts(resumeMarkdown, snapshot.canonicalResume);
  const coverDrifts = canonicalCoverLetterDrifts(coverMarkdown, snapshot.canonicalResume);
  if (resumeDrifts.length || coverDrifts.length) {
    throw new Error(`Canonical composition failed: ${[...resumeDrifts, ...coverDrifts].map((drift) => drift.code).join(", ")}.`);
  }
  const evaluationPath = assertInsideWorkspace(jobPath, join(jobPath, "evaluation.md"));
  const evaluationMarkdown = generated?.evaluationMarkdown
    ?? await readFile(evaluationPath, "utf8").catch(() => "# Application Evaluation");
  const normalizedEvaluation = normalizeEvaluationScore(evaluationMarkdown, snapshot);
  // The rating gate decides whether application documents exist. Grounding and
  // content checks annotate the persisted drafts for review; they do not suppress them.
  await Promise.all([
    writeTextAtomic(resumePath, resumeMarkdown),
    writeTextAtomic(coverPath, coverMarkdown),
    writeTextAtomic(evaluationPath, normalizedEvaluation),
    ...(bundle ? [
      writeJsonAtomic(join(statePath, "application_draft.json"), draft),
      writeJsonAtomic(join(statePath, "application_evidence.json"), evidence),
    ] : []),
  ]);
  const report = await validateJobApplication(workspace, jobId, persistRunState);
  const fit = scoreEvaluation(normalizedEvaluation);
  const finalReport = applicationValidationReportSchema.parse({
    ...report,
    fitScore: fit?.score ?? null,
    fitConfidence: fit?.confidence ?? null,
    gateStatus: fit ? (fit.score >= 3.5 ? "accepted" : "accepted at screening; evidence-calibrated score below threshold") : null,
  });
  if (persistRunState) await writeJsonAtomic(join(statePath, "validation_report.json"), finalReport);
  await writeTextAtomic(evaluationPath, mergeEvaluationAudit(normalizedEvaluation, {
    resumeName,
    resumeMarkdown,
    coverMarkdown,
    evidence,
    report: finalReport,
  }));
  return finalReport;
}

export async function finalizeApplication(workspacePath: string, jobId: string, persistRunState = true): Promise<ApplicationValidationReport> {
  try {
    return await finalizeApplicationUnchecked(workspacePath, jobId, persistRunState);
  } catch (error: unknown) {
    if (!(error instanceof ApplicationInputError)) throw error;
    const workspace = resolve(workspacePath);
    const statePath = assertInsideWorkspace(workspace, join(workspace, "jobs", jobId, ".sensei"));
    const runPath = join(statePath, "application_run.json");
    const run = await readableRun(runPath);
    const report: ApplicationValidationReport = {
      status: "not_ready",
      jobId,
      runId: run?.runId ?? null,
      snapshotId: run?.snapshotId ?? null,
      manifestHash: run?.manifestHash ?? null,
      fitScore: null,
      fitConfidence: null,
      gateStatus: null,
      ats: null,
      keywordClasses: [],
      issues: inputValidationIssues(error),
    };
    if (persistRunState) {
      if (run) {
        await writeJsonAtomic(runPath, {
          ...run,
          updatedAt: new Date().toISOString(),
          validationAttempts: Math.min(run.maxValidationAttempts, run.validationAttempts + 1),
          lastValidationStatus: "not_ready",
        });
      }
      await writeJsonAtomic(join(statePath, "validation_report.json"), report);
    }
    return report;
  }
}

function defaultWorkspace(): string {
  const configured = process.env.SENSEI_WORKSPACE;
  if (configured) return resolve(configured);
  return basename(process.cwd()) === "data" ? process.cwd() : resolve(process.cwd(), "data");
}

if (require.main === module) {
  const jobId = process.argv[2];
  const reviewOnly = process.argv.includes("--review");
  if (!jobId) {
    process.stderr.write("Usage: npm run application:finalize -- <canonical-job-id>\n");
    process.exitCode = 1;
  } else {
    finalizeApplication(defaultWorkspace(), jobId, !reviewOnly)
      .then((report) => {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        if (report.status !== "passed") process.exitCode = 1;
      })
      .catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      });
  }
}
