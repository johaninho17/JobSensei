import type { ApplicationEvidence, ApplicationValidationReport } from "../src/shared/schemas";
import { resumeArtifactStats, validateApplicationArtifact } from "./application-artifacts";

const AUDIT_START = "<!-- jobsensei-application-audit:start -->";
const AUDIT_END = "<!-- jobsensei-application-audit:end -->";

type EvaluationAuditInput = {
  resumeName: string;
  resumeMarkdown: string;
  coverMarkdown: string;
  evidence: ApplicationEvidence;
  report: ApplicationValidationReport;
};

function issueLines(issues: ApplicationValidationReport["issues"]): string[] {
  if (!issues.length) return ["- No review findings."];
  return issues.flatMap((candidate) => {
    const lines = [`- **${candidate.severity === "error" ? "Needs review" : "Warning"}:** ${candidate.message}`];
    if (!candidate.explanation) return lines;
    lines.push(`  - **Sentence:** ${candidate.explanation.sentence ?? "Unavailable"}`);
    lines.push(`  - **Source:** ${candidate.explanation.sources.length
      ? candidate.explanation.sources.map((source) => `\`${source.evidenceId}\` · \`${source.sourcePath}\``).join("; ")
      : "Unavailable"}`);
    return lines;
  });
}

function reviewLabel(report: ApplicationValidationReport): string {
  if (report.issues.some((candidate) => candidate.severity === "error")) return "Needs human review";
  if (report.issues.length) return "Generated with review warnings";
  return "Passed";
}

export function mergeEvaluationAudit(evaluationMarkdown: string, input: EvaluationAuditInput): string {
  const withoutExisting = evaluationMarkdown
    .replace(new RegExp(`${AUDIT_START}[\\s\\S]*?${AUDIT_END}`, "g"), "")
    .trimEnd();
  const resumeStats = resumeArtifactStats(input.resumeMarkdown);
  let coverWords: number | null = null;
  let coverParagraphs: number | null = null;
  try {
    const coverStats = validateApplicationArtifact(input.coverMarkdown, "cover-letter");
    coverWords = coverStats.wordCount;
    coverParagraphs = coverStats.paragraphCount;
  } catch {
    // The validation report below retains the detailed content finding.
  }
  const resumeIssues = input.report.issues.filter((candidate) =>
    candidate.artifact === input.resumeName || candidate.code.startsWith("RESUME_"));
  const coverIssues = input.report.issues.filter((candidate) =>
    candidate.artifact === "cover_letter.md" || candidate.code.startsWith("COVER_"));
  const generalIssues = input.report.issues.filter((candidate) =>
    !resumeIssues.includes(candidate) && !coverIssues.includes(candidate));
  const resumeEvidenceIds = new Set(input.evidence.resume.claimMappings.flatMap((mapping) => mapping.evidenceIds));
  const coverEvidenceIds = new Set(input.evidence.coverLetter.claimMappings.flatMap((mapping) => mapping.evidenceIds));
  const excluded = input.evidence.excludedClaims.length
    ? input.evidence.excludedClaims.map((claim) => `- ${claim}`)
    : ["- None recorded."];

  const audit = [
    AUDIT_START,
    "## Resume Audit",
    `- **Artifact:** \`${input.resumeName}\``,
    `- **Review status:** ${resumeIssues.length ? "Review findings recorded" : "Passed"}`,
    `- **Experience bullets:** ${resumeStats.bulletCount}`,
    `- **Current-employer bullets:** ${resumeStats.currentEmployerBulletCount}`,
    `- **Experience words:** ${resumeStats.experienceWordCount}`,
    `- **Average bullet length:** ${resumeStats.averageExperienceBulletWords?.toFixed(1) ?? "Unavailable"} words`,
    `- **Mapped public claims:** ${input.evidence.resume.claimMappings.length}`,
    `- **Evidence references:** ${resumeEvidenceIds.size}`,
    "",
    "### Resume Findings",
    ...issueLines(resumeIssues),
    "",
    "## Cover Letter Audit",
    "- **Artifact:** `cover_letter.md`",
    `- **Review status:** ${coverIssues.length ? "Review findings recorded" : "Passed"}`,
    `- **Word count:** ${coverWords ?? "Unavailable"}`,
    `- **Body paragraphs:** ${coverParagraphs ?? "Unavailable"}`,
    `- **Mapped public claims:** ${input.evidence.coverLetter.claimMappings.length}`,
    `- **Evidence references:** ${coverEvidenceIds.size}`,
    `- **Career-arc stages:** ${input.evidence.coverLetter.careerArc.length}`,
    "",
    "### Career Arc",
    ...input.evidence.coverLetter.careerArc.map((stage) => `- **${stage.timeline}:** ${stage.stage}`),
    "",
    "### Cover Letter Findings",
    ...issueLines(coverIssues),
    "",
    "## Overall Application Review",
    `- **Status:** ${reviewLabel(input.report)}`,
    `- **Run:** \`${input.report.runId ?? "Unavailable"}\``,
    `- **Snapshot:** \`${input.report.snapshotId ?? "Unavailable"}\``,
    "",
    "### General Findings",
    ...issueLines(generalIssues),
    "",
    "### Excluded Claims",
    ...excluded,
    AUDIT_END,
  ].join("\n");

  return `${withoutExisting}\n\n${audit}\n`;
}
