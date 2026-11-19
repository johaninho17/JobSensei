import { readFile } from "node:fs/promises";
import { recruiterDefaultsFor } from "./recruiter-defaults";
import { postingRecordFor } from "./posting-record";
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
  type ValidationIssue, type ExpandedApplicationBundle, type ApplicationContext } from "../src/shared/schemas";
import {
  canonicalCoverLetterDrifts,
  canonicalResumeDrifts,
  composeCanonicalCoverLetter,
  composeCanonicalResume,
  summaryIsEditable,
  nthRole,
  roleOccurrence,
} from "./canonical-resume";
import { pruneUnsupportedSkills } from "./application-artifacts";
import { currentManifestHash } from "./context-manifest-hash";
import { mergeEvaluationAudit } from "./evaluation-audit";
import { fitSettingsOf, gateStatusFor, normalizeEvaluationScore, scoreEvaluation } from "./fit-scoring";
import { validateJobApplication } from "./application-validation";
import { writeJsonAtomic, writeTextAtomic, readTextFile } from "./persistence";
import { assertInsideWorkspace } from "./workspace";
import { companyArgument, recordJobCompany } from "./job-company";
import { readCandidateProfile } from "./candidate-profile";

/**
 * How a failed finalize tells Agy what to do next (#109). A "Fix" error is something Agy can correct in its own draft
 * (the bundle, or the company name), so the pipeline skill allows one more finalize; anything else stops the run.
 * Step 6 of the application pipeline skill owns the retry rule; these two prefixes are the only signal it reads.
 */
export const FIX_DRAFT = "Fix the draft and run finalize once more:";
export const STOP_RUN = "Stop: begin a fresh run.";
const BUNDLE = ".sensei/application_bundle.json";

/** The message a finalize failure prints: labeled Fix or Stop. */
export function finalizeFailureMessage(message: string): string {
  return message.startsWith(FIX_DRAFT) || message.startsWith(STOP_RUN) ? message : `${STOP_RUN} ${message}`;
}

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
    return schema.parse(JSON.parse(await readTextFile(path)));
  } catch (error: unknown) {
    throw new ApplicationInputError(artifact, error);
  }
}

async function readOptionalBundle(path: string): Promise<ApplicationBundle | null> {
  try {
    return applicationBundleSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw new ApplicationInputError(BUNDLE, error);
  }
}

function publicResumeName(prefix: string, company: string | null | undefined): string {
  const token = (company ?? "Company").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "Company";
  return `${prefix}_${token}_Resume.md`;
}

/**
 * Fills in baseline references ({ baseline: N }) and employers the model left out, so the
 * model never has to retype unchanged base-resume bullets. Output order follows the base resume.
 */
export function expandBundleBaselines(
  bundle: ApplicationBundle,
  canonical: NonNullable<EvidenceSnapshot["canonicalResume"]>,
  context: ApplicationContext | null,
): ExpandedApplicationBundle {
  const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "").replace(/inc$/, "");
  const templates = context?.schemaVersion === 2 ? context.resumeTemplate.employers : [];
  // Several roles at one employer are told apart by occurrence (roleOccurrence in canonical-resume.ts).
  const baselinesFor = (name: string, occurrence = 0) => {
    const template = nthRole(templates, name, occurrence, key);
    if (template?.baselineBullets?.length) return template.baselineBullets;
    const original = nthRole(canonical.employers, name, occurrence, key);
    return (original?.originalBullets ?? []).map((text) => ({ text, evidenceIds: [] as string[] }));
  };
  const expand = (name: string, bullets: ApplicationBundle["resume"]["employers"][number]["bullets"], occurrence = 0) => bullets.map((bullet) => {
    if (!("baseline" in bullet)) return bullet;
    const reference = baselinesFor(name, occurrence)[bullet.baseline - 1];
    if (!reference) {
      throw new ApplicationInputError(BUNDLE, new Error(`${name} has no base-resume bullet ${bullet.baseline}.`));
    }
    return { text: reference.text, evidenceIds: [...reference.evidenceIds] };
  });
  const drafted = bundle.resume.employers;
  const warnings: string[] = [];
  const baselineOf = (name: string, occurrence = 0) => baselinesFor(name, occurrence).map((bullet) => ({ text: bullet.text, evidenceIds: [...bullet.evidenceIds] }));
  const rowEmployer = new Map((context?.schemaVersion === 2 ? context.evidenceRows ?? [] : []).map((row) => [row.evidenceId, row.employer ?? ""]));
  const employers = canonical.employers.map((employer, index) => {
    const occurrence = roleOccurrence(canonical.employers, index, key);
    const match = nthRole(drafted, employer.name, occurrence, key);
    if (!match) return { name: employer.name, bullets: baselineOf(employer.name, occurrence) };
    const bullets = expand(employer.name, match.bullets, occurrence);
    // Earlier roles stay exactly as in the base resume unless every changed bullet cites that employer's evidence.
    if (index > 0) {
      const original = new Set(baselineOf(employer.name, occurrence).map((bullet) => key(bullet.text)));
      const unbacked = bullets.filter((bullet) => !original.has(key(bullet.text))
        && !bullet.evidenceIds.some((id) => key(rowEmployer.get(id) ?? "") === key(employer.name)));
      if (unbacked.length) {
        warnings.push(`Kept ${employer.name} as in the base resume: ${unbacked.length} changed bullet(s) cited no ${employer.name} evidence.`);
        return { name: employer.name, bullets: baselineOf(employer.name, occurrence) };
      }
    }
    return { name: match.name, bullets };
  });
  // Employers that don't match the base resume pass through so validation can report them.
  for (const extra of drafted.filter((candidate) => !canonical.employers.some((employer) => key(employer.name) === key(candidate.name)))) {
    employers.push({ name: extra.name, bullets: expand(extra.name, extra.bullets) });
  }
  return { ...bundle, warnings: [...bundle.warnings, ...warnings], resume: { ...(bundle.resume.summary ? { summary: bundle.resume.summary } : {}), skillsLines: bundle.resume.skillsLines, employers } };
}

/** Removes skills no evidence supports (see `pruneUnsupportedSkills`) and records what went. */
export function pruneBundleSkills(bundle: ExpandedApplicationBundle, snapshot: EvidenceSnapshot): ExpandedApplicationBundle {
  const removed: string[] = [];
  const skillsLines = bundle.resume.skillsLines.flatMap((line) => {
    const pruned = pruneUnsupportedSkills(line.text, line.evidenceIds, snapshot);
    removed.push(...pruned.removed);
    return pruned.text ? [{ ...line, text: pruned.text }] : [];
  });
  if (!removed.length) return bundle;
  return { ...bundle, warnings: [...bundle.warnings, `Removed skills no evidence supports: ${removed.join(", ")}.`], resume: { ...bundle.resume, skillsLines } };
}

function materializeBundle(
  bundle: ExpandedApplicationBundle,
  snapshot: EvidenceSnapshot,
  artifactPrefix: string,
  company: string | null | undefined,
  summaryEditable = false,
): { draft: ApplicationDraft; evidence: ApplicationEvidence; evaluationMarkdown: string } {
  // A tailored summary is used only when the base resume has one and the user turned summary tailoring on.
  const summary = summaryEditable ? bundle.resume.summary : undefined;
  const summaryWarnings = bundle.resume.summary && !summaryEditable
    ? ["The bundle included a resume summary, but summary tailoring is off or the base resume has no summary; it was left out."]
    : [];
  const rows = new Map(snapshot.evidenceRows.map((row) => [row.evidenceId, row]));
  const sourcePaths = (ids: string[]) => [...new Set(ids.map((id) => rows.get(id)?.sourcePath).filter((path): path is string => Boolean(path)))];
  const timeline = (ids: string[], employerSpecific = false): "current" | "prior" | "transition" | "employer-specific" | null => {
    if (employerSpecific) return "employer-specific";
    const bands = new Set(ids.map((id) => rows.get(id)?.recencyBand));
    if (bands.has("current") && (bands.has("recent") || bands.has("foundation"))) return "transition";
    if (bands.has("current")) return "current";
    return ids.length ? "prior" : null;
  };
  const normalizeText = (val: string) => val.replace(/[*_`#|\\-]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  const claim = (item: { text: string; evidenceIds: string[] }, employerSpecific = false, employerName?: string) => {
    const ids = item.evidenceIds;
    if (ids.length === 0 && employerName && snapshot.canonicalResume) {
      // Unchanged base-resume bullets are the candidate's own approved wording.
      // Record them as baseline text; never borrow an unrelated evidence ID.
      // Every role at that employer counts (someone promoted there holds several roles under one name).
      const baselineRoles = snapshot.canonicalResume.employers.filter((e) => normalizeText(e.name) === normalizeText(employerName));
      if (baselineRoles.some((role) => role.originalBullets.some((b) => normalizeText(b) === normalizeText(item.text)))) {
        return {
          publicText: item.text,
          claimType: "baseline" as const,
          evidenceIds: [] as string[],
          sourcePaths: [snapshot.baseResumePath],
          timeline: null as ReturnType<typeof timeline>,
          ownership: "baseline",
        };
      }
    }
    return {
      publicText: item.text,
      claimType: ids.length ? "candidate" as const : "non-factual" as const,
      evidenceIds: ids,
      sourcePaths: sourcePaths(ids),
      timeline: timeline(ids, employerSpecific),
      ownership: ids.length ? "supported" : "",
    };
  };
  // A run whose snapshot says no letter (src/shared/cover-letter-policy.ts) ignores any letter in the bundle.
  const letter = snapshot.coverLetterPlan?.write === false ? null : bundle.coverLetter ?? null;
  if (snapshot.coverLetterPlan?.write !== false && !letter) {
    throw new ApplicationInputError(BUNDLE, new Error("coverLetter is missing; this run writes a cover letter (follow coverLetterBrief)."));
  }
  const coverItems = letter ? letter.bodyParagraphs.flatMap((paragraph) => paragraph.sentences) : [];
  // Letter sentences retell real work in the candidate voice: framed, never a new fact (ledger T4).
  const coverClaims = coverItems.map((item) => {
    const mapping = claim(item);
    return mapping.claimType === "candidate" ? { ...mapping, claimType: "framed" as const } : mapping;
  });
  const arcClaims = coverClaims.filter((mapping) => mapping.claimType === "framed" && mapping.evidenceIds.length);
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
        ...(summary ? { summary: summary.text } : {}),
        skillsLines: bundle.resume.skillsLines.map((item) => item.text),
        employers: bundle.resume.employers.map((employer) => ({
          name: employer.name,
          bullets: employer.bullets.map((item) => item.text),
        })),
      },
      coverLetter: letter ? {
        date: letter.date,
        recipientLines: letter.recipientLines,
        salutation: letter.salutation,
        bodyParagraphs: letter.bodyParagraphs.map((paragraph) => paragraph.sentences.map((item) => item.text).join(" ")),
        closing: letter.closing,
      } : null,
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
          ...(summary ? [claim(summary)] : []),
          ...bundle.resume.skillsLines.map((item) => claim(item)),
          ...bundle.resume.employers.flatMap((employer) => employer.bullets.map((item) => claim(item, true, employer.name))),
        ],
      },
      coverLetter: letter ? {
        publicArtifact: "cover_letter.md",
        claimMappings: coverClaims,
        careerArc,
      } : null,
      excludedClaims: bundle.excludedClaims,
      warnings: [...bundle.warnings, ...summaryWarnings],
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
      repairHint: error.artifact === BUNDLE
        ? `${FIX_DRAFT} make ${issue.path?.length ? issue.path.join(".") : "the bundle"} match the Hidden Draft Contract (${issue.message || "wrong shape"}).`
        : `${STOP_RUN} ${error.artifact} is not the app's own output; do not edit it.`,
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
    repairHint: error.artifact === BUNDLE
      ? `${FIX_DRAFT} ${missing ? "write" : "rewrite"} ${BUNDLE} as one complete JSON file${!missing && cause?.message ? ` (${cause.message})` : ""}.`
      : `${STOP_RUN} ${missing ? `${error.artifact} is missing` : `${error.artifact} can't be read`}.`,
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

async function finalizeApplicationUnchecked(workspacePath: string, jobId: string, persistRunState = true, options: { company?: string | null } = {}): Promise<ApplicationValidationReport> {
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
  const jobCompany = options.company
    ? await recordJobCompany(workspace, jobId, options.company)
    : applicationContext?.schemaVersion === 2 ? applicationContext.job.company : null;
  if (bundle && !jobCompany) {
    throw new Error(`${FIX_DRAFT} the job has no company name, so the resume can't be named. Run: sensei application:finalize ${jobId} --company "<employer name from the JD>"`);
  }
  const expandedBundle = bundle ? pruneBundleSkills(expandBundleBaselines(bundle, snapshot.canonicalResume, applicationContext), snapshot) : null;
  const summaryEditable = summaryIsEditable(snapshot.canonicalResume, candidateProfile, (await recruiterDefaultsFor(workspace))?.tailorSummary ?? false);
  const generated = expandedBundle
    ? materializeBundle(expandedBundle, snapshot, candidateProfile?.identity.artifactPrefix ?? "Candidate", jobCompany, summaryEditable)
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
  if (snapshot.manifestHash !== currentManifestHash(manifest, snapshot.manifestHash)) {
    throw new Error("The active context changed after the application snapshot. Begin a fresh run.");
  }
  if (evidence.applicationRunId !== run.runId
    || evidence.evidenceSnapshotId !== snapshot.snapshotId
    || evidence.manifestHash !== snapshot.manifestHash
    || evidence.baseResumePath !== snapshot.baseResumePath) {
    throw new Error("The application evidence map does not match the pinned run.");
  }

  const resumeMarkdown = composeCanonicalResume(snapshot.canonicalResume, draft.resume, { includeSummary: summaryEditable });
  const coverMarkdown = draft.coverLetter ? composeCanonicalCoverLetter(snapshot.canonicalResume, draft.coverLetter, { fullName: candidateProfile?.identity.fullName }) : null;
  const resumeName = evidence.resume.publicArtifact;
  const escapedPrefix = (candidateProfile?.identity.artifactPrefix ?? "Candidate").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`^${escapedPrefix}_[A-Za-z0-9][A-Za-z0-9_-]*_Resume\\.md$`).test(resumeName)) {
    throw new Error("The evidence map does not identify a canonical public resume filename.");
  }
  const resumePath = assertInsideWorkspace(jobPath, join(jobPath, resumeName));
  const coverPath = assertInsideWorkspace(jobPath, join(jobPath, "cover_letter.md"));
  const resumeDrifts = canonicalResumeDrifts(resumeMarkdown, snapshot.canonicalResume);
  const coverDrifts = coverMarkdown ? canonicalCoverLetterDrifts(coverMarkdown, snapshot.canonicalResume) : [];
  if (resumeDrifts.length || coverDrifts.length) {
    throw new Error(`${FIX_DRAFT} canonical composition failed (${[...resumeDrifts, ...coverDrifts].map((drift) => drift.code).join(", ")}). Keep the base resume's headings, roles, dates, and order; change only bullet and skills wording in the bundle.`);
  }
  const evaluationPath = assertInsideWorkspace(jobPath, join(jobPath, "evaluation.md"));
  const evaluationMarkdown = generated?.evaluationMarkdown
    ?? await readFile(evaluationPath, "utf8").catch(() => "# Application Evaluation");
  const jobDescription = await readFile(join(jobPath, "original_jd.md"), "utf8")
    .catch(() => readFile(join(jobPath, "original_jd.txt"), "utf8"))
    .catch(() => "");
  const normalizedEvaluation = normalizeEvaluationScore(evaluationMarkdown, snapshot, postingRecordFor(jobDescription).requiredItems, postingRecordFor(jobDescription).requirements);
  // The rating gate decides whether application documents exist. Grounding and
  // content checks annotate the persisted drafts for review; they do not suppress them.
  await Promise.all([
    writeTextAtomic(resumePath, resumeMarkdown),
    ...(coverMarkdown ? [writeTextAtomic(coverPath, coverMarkdown)] : []),
    writeTextAtomic(evaluationPath, normalizedEvaluation),
    ...(bundle ? [
      writeJsonAtomic(join(statePath, "application_draft.json"), draft),
      writeJsonAtomic(join(statePath, "application_evidence.json"), evidence),
    ] : []),
  ]);
  const report = await validateJobApplication(workspace, jobId, persistRunState);
  const fit = scoreEvaluation(normalizedEvaluation, fitSettingsOf(snapshot));
  const finalReport = applicationValidationReportSchema.parse({
    ...report,
    fitScore: fit?.score ?? null,
    fitConfidence: fit?.confidence ?? null,
    gateStatus: fit ? gateStatusFor(fit, fitSettingsOf(snapshot).gate) : null,
    coverLetterSkipped: draft.coverLetter ? null : snapshot.coverLetterPlan?.reason ?? null,
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

export async function finalizeApplication(workspacePath: string, jobId: string, persistRunState = true, options: { company?: string | null } = {}): Promise<ApplicationValidationReport> {
  try {
    return await finalizeApplicationUnchecked(workspacePath, jobId, persistRunState, options);
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
      stretch: null,
      framingLines: [],
      fitScore: null,
      fitConfidence: null,
      gateStatus: null,
      coverLetterSkipped: null,
      settingsScore: null,
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

/** Completes `.sensei/run_timing.json` and returns the run's duration in seconds, if known. */
export async function recordRunDuration(workspacePath: string, jobId: string, now = new Date()): Promise<number | null> {
  const path = join(resolve(workspacePath), "jobs", jobId, ".sensei", "run_timing.json");
  const timing = await readFile(path, "utf8").then((value) => JSON.parse(value) as { startedAt?: string }).catch(() => null);
  if (!timing?.startedAt) return null;
  const durationSeconds = Math.max(0, Math.round((now.getTime() - new Date(timing.startedAt).getTime()) / 1000));
  await writeJsonAtomic(path, { ...timing, finalizedAt: now.toISOString(), durationSeconds });
  return durationSeconds;
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
    process.stderr.write("Usage: npm run application:finalize -- <canonical-job-id> [--company \"<name>\"]\n");
    process.exitCode = 1;
  } else {
    finalizeApplication(defaultWorkspace(), jobId, !reviewOnly, { company: companyArgument(process.argv) })
      .then(async (report) => {
        const durationSeconds = await recordRunDuration(defaultWorkspace(), jobId).catch(() => null);
        process.stdout.write(`${JSON.stringify({ ...report, durationSeconds }, null, 2)}\n`);
        if (report.status !== "passed") process.exitCode = 1;
      })
      .catch((error: unknown) => {
        process.stderr.write(`${finalizeFailureMessage(error instanceof Error ? error.message : String(error))}\n`);
        process.exitCode = 1;
      });
  }
}
