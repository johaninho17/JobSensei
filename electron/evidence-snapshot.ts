import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { extname } from "node:path";
import mammoth from "mammoth";
import {
  applicationContextSchema,
  applicationEvidenceRouteSchema,
  applicationRunSchema,
  applicationRoutingSchema,
  contextManifestSchema,
  evidenceSnapshotSchema,
  type ApplicationContext,
  type ApplicationEvidenceRoute,
  type ApplicationRun,
  type CandidateProfile,
  type ContextManifest,
  type EvidenceSnapshot,
  type EvidenceSnapshotRow,
} from "../src/shared/schemas";
import { profileBaseResume } from "./resume-footprint";
import { loadCanonicalResumeBaseline } from "./canonical-resume";
import { contextManifestHash } from "./context-manifest-hash";
import { assertInsideWorkspace } from "./workspace";
import { parseJobDescriptionMetadata, resolveJobDescriptionPath } from "./job-description";
import { readCandidateProfile } from "./candidate-profile";
import { buildContextManifest, readActiveContextManifest } from "./context";

const MANIFEST_PATH = ".sensei/active-context.json";
const DENYLIST_PATH = "context/denylist.md";
const APPLICATION_VOICE_PROFILE_PATH = "context/application_voice_profile.md";

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseTable(lineBlock: string): string[][] {
  const lines = lineBlock.split("\n").filter((line) => /^\s*\|.*\|\s*$/.test(line));
  if (lines.length < 3) return [];
  const cells = (line: string) => line.trim().slice(1, -1).split("|").map((value) => value.trim().replaceAll("`", ""));
  const headers = cells(lines[0]).map((value) => value.toLowerCase());
  if (!headers.includes("evidence id")) return [];
  return lines.slice(2).map(cells).filter((row) => row.length === headers.length);
}

function tableBlocks(markdown: string): string[] {
  return markdown.match(/(?:^\s*\|.*\|\s*$\n?){3,}/gm) ?? [];
}

function metadataValue(markdown: string, key: string): string {
  return new RegExp(`^-\\s*${key}:\\s*(.+)$`, "im").exec(markdown)?.[1]?.trim().replaceAll("`", "") ?? "";
}

function classifyEvidence(confidence: string, publicUse: string, sourceRole: string): EvidenceSnapshotRow["classification"] {
  const combined = `${confidence} ${publicUse}`.toLowerCase();
  if (/contradict/.test(combined)) return "contradictory";
  if (/corroboration|required|medium-low|\blow\b/.test(combined)) return "corroboration-required";
  if (/inference/.test(combined)) return "supported-inference";
  if (/summary/.test(combined) || sourceRole.includes("summary")) return "summary-derived";
  return "verified";
}

function eligibilityFor(classification: EvidenceSnapshotRow["classification"], publicUse: string): EvidenceSnapshotRow["eligibility"] {
  if (classification === "contradictory") return "blocked";
  if (classification === "corroboration-required" || /corroborat|historical support|date reconciliation/i.test(publicUse)) return "corroboration-required";
  return /eligible|public|allowed/i.test(publicUse) ? "eligible" : "corroboration-required";
}

function recencyFor(value: string): Pick<EvidenceSnapshotRow, "startYear" | "endYear" | "isOngoing" | "recencyBand"> {
  const years = [...value.matchAll(/\b(?:19|20)\d{2}\b/g)].map((match) => Number(match[0]));
  const isOngoing = /\bpresent\b|\bongoing\b/i.test(value);
  const startYear = years[0] ?? null;
  const endYear = isOngoing ? new Date().getFullYear() : years.at(-1) ?? null;
  const currentYear = new Date().getFullYear();
  const recencyBand = isOngoing
    ? "current"
    : endYear !== null && endYear >= currentYear - 1
      ? "recent"
      : endYear !== null
        ? "foundation"
        : "unknown";
  return { startYear, endYear, isOngoing, recencyBand };
}

function normalizedName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "").replace(/inc$/, "");
}

function inferEmployer(
  row: Omit<EvidenceSnapshotRow, "employer">,
  canonicalEmployers: string[],
): string | null {
  const project = normalizedName(row.project);
  const evidenceId = normalizedName(row.evidenceId);
  const direct = canonicalEmployers.find((employer) => {
    const normalized = normalizedName(employer);
    return project.includes(normalized) || normalized.includes(project) || evidenceId.includes(normalized);
  });
  if (direct) return direct;
  if (row.sourcePath.startsWith("context/structured/") && !row.evidenceId.startsWith("linkedin:")) {
    return canonicalEmployers[0] ?? null;
  }
  return null;
}

function routingTokens(value: string): Set<string> {
  const stop = new Set([
    "about", "after", "also", "and", "are", "from", "have", "into", "more", "that", "the", "their",
    "this", "through", "using", "with", "work", "worked", "will", "your", "years", "experience",
  ]);
  return new Set(value.toLowerCase().split(/[^a-z0-9+#.]+/).filter((token) => token.length >= 3 && !stop.has(token)));
}

function routeMaximum(row: EvidenceSnapshotRow): ApplicationEvidenceRoute["maximumClassification"] {
  if (row.eligibility === "blocked") return "gap";
  if (row.eligibility === "corroboration-required") {
    return row.sourcePath.startsWith("context/structured/") ? "strong_transferable" : "unclear";
  }
  if (row.classification === "verified" || row.classification === "summary-derived") {
    if (row.sourceFamily === "linkedin-profile" && row.recencyBand === "current") return "strong_transferable";
    return "direct";
  }
  if (row.classification === "supported-inference") return "strong_transferable";
  return "adjacent_transferable";
}

function routeSourceAuthority(row: EvidenceSnapshotRow): ApplicationEvidenceRoute["sourceAuthority"] {
  if (row.sourceFamily !== "linkedin-profile") return "primary";
  return row.recencyBand === "current" ? "corroboration" : "history";
}

function routeTimeline(row: EvidenceSnapshotRow): ApplicationEvidenceRoute["timeline"] {
  if (row.recencyBand === "current") return "current";
  if (row.recencyBand === "recent") return "recent";
  if (row.recencyBand === "foundation") return "prior";
  return "unknown";
}

const CUSTOMER_ROLE_PATTERN = /\b(?:customer[- ]facing|customer success|client[- ]facing|forward deployed|solutions engineer|sales engineer|implementation|post[- ]sales|technical account|developer success|customer engineer|solutions architect|customer environments?)\b/i;
const CUSTOMER_EVIDENCE_PATTERN = /\b(?:customer|client|partner|onboard|discovery|demonstrat|enablement|technical guide|documentation|feedback|stakeholder|presentation|proof[- ]of[- ]value|proof[- ]of[- ]concept)\b/i;
const AI_ROLE_PATTERN = /\b(?:artificial intelligence|generative ai|genai|machine learning|ai\/ml|llms?|ai agents?|agentic|ai[- ]driven)\b/i;
const AI_EVIDENCE_PATTERN = /\b(?:artificial intelligence|machine learning|ai agents?|agent workflows?|named agents?|adk|llms?|rag|pytorch|tensorflow|vertex ai|model coordination)\b/i;
const SUPPORT_ROLE_PATTERN = /\b(?:technical support|support engineer|tier [23]|deliverability|it support|helpdesk|service desk|troubleshoot|diagnost|customer support engineer|application support|escalation|email deliverability)\b/i;
const SUPPORT_EVIDENCE_PATTERN = /\b(?:troubleshoot|postman|curl|api connectivity|authentication|diagnos|docker runtime|issue tracking|gitlab|ticket|deliverability|dns|smtp|logs?|opentelemetry|monitoring|synchronization errors?|verification routines?)\b/i;
const APP_DEV_ROLE_PATTERN = /\b(?:applications? dev|software developer|software engineer|fullstack|full-stack|frontend|front-end|backend|back-end|web developer|ui developer|application engineer)\b/i;
const APP_DEV_EVIDENCE_PATTERN = /\b(?:angular|typescript|javascript|frontend|ui|user interface|components?|node\.js|express|restful? api|microservices?|postgresql|cloudsql|schema|database|crud)\b/i;
const QA_ROLE_PATTERN = /\b(?:qa|quality assurance|test engineer|software engineer in test|sdet|verification|validation engineer|test automation|testing)\b/i;
const QA_EVIDENCE_PATTERN = /\b(?:test|testing|unit test|automated test|verification|validation|defect|bug|triage|ci\/cd|github actions|docker|postman|curl|reproduct|regression|build integrity)\b/i;

function customerFacingTarget(jobDescription: string): number {
  const matches = jobDescription.match(new RegExp(CUSTOMER_ROLE_PATTERN.source, "gi"))?.length ?? 0;
  return matches >= 3 ? 3 : matches > 0 ? 2 : 0;
}

function isCustomerFacingEvidence(row: EvidenceSnapshotRow): boolean {
  return CUSTOMER_EVIDENCE_PATTERN.test(`${row.project} ${row.claim} ${row.scope}`);
}

function isAiEvidence(row: EvidenceSnapshotRow): boolean {
  return AI_EVIDENCE_PATTERN.test(`${row.project} ${row.claim} ${row.scope}`);
}

function isSupportEvidence(row: EvidenceSnapshotRow): boolean {
  return SUPPORT_EVIDENCE_PATTERN.test(`${row.project} ${row.claim} ${row.scope}`);
}

function isAppDevEvidence(row: EvidenceSnapshotRow): boolean {
  return APP_DEV_EVIDENCE_PATTERN.test(`${row.project} ${row.claim} ${row.scope}`);
}

function isQaEvidence(row: EvidenceSnapshotRow): boolean {
  return QA_EVIDENCE_PATTERN.test(`${row.project} ${row.claim} ${row.scope}`);
}

export function buildApplicationRouting(rows: EvidenceSnapshotRow[], jobDescription: string, preferredEvidenceIds: string[] = []): EvidenceSnapshot["applicationRouting"] {
  const jdTokens = routingTokens(jobDescription);
  const customerTarget = customerFacingTarget(jobDescription);
  const aiTarget = AI_ROLE_PATTERN.test(jobDescription) ? 4 : 0;
  const supportTarget = SUPPORT_ROLE_PATTERN.test(jobDescription) ? 4 : 0;
  const qaTarget = QA_ROLE_PATTERN.test(jobDescription) ? 4 : 0;
  const appDevTarget = APP_DEV_ROLE_PATTERN.test(jobDescription) ? 4 : 0;
  const scored = rows
    .filter((row) => !row.evidenceId.startsWith("job:") && row.eligibility !== "blocked")
    .map((row) => {
      const rowTokens = routingTokens(`${row.project} ${row.claim} ${row.scope}`);
      const overlap = [...rowTokens].filter((token) => jdTokens.has(token)).length;
      const overlapRatio = overlap / Math.max(1, Math.min(rowTokens.size, 14));
      const evidenceStrength = row.eligibility === "eligible" ? 22 : 6;
      const recency = row.recencyBand === "current" ? 14 : row.recencyBand === "recent" ? 10 : row.recencyBand === "foundation" ? 5 : 0;
      const employerRepresentation = row.employer ? 6 : 1;
      const customerPriority = customerTarget > 0 && isCustomerFacingEvidence(row) && (row.recencyBand === "current" || row.recencyBand === "recent") ? 16 : 0;
      const aiPriority = aiTarget > 0 && isAiEvidence(row) ? 18 : 0;
      const supportPriority = supportTarget > 0 && isSupportEvidence(row) ? 16 : 0;
      const qaPriority = qaTarget > 0 && isQaEvidence(row) ? 16 : 0;
      const appDevPriority = appDevTarget > 0 && isAppDevEvidence(row) ? 16 : 0;
      const relevanceScore = Math.min(100, Math.round(
        overlapRatio * 58
        + evidenceStrength
        + recency
        + employerRepresentation
        + customerPriority
        + aiPriority
        + supportPriority
        + qaPriority
        + appDevPriority,
      ));
      const priorities = [
        customerPriority ? "customer-facing priority" : null,
        aiPriority ? "AI capability priority" : null,
        supportPriority ? "technical support priority" : null,
        qaPriority ? "QA/testing priority" : null,
        appDevPriority ? "application development priority" : null,
      ].filter(Boolean).join("; ");
      const prefix = priorities ? `${priorities}; ` : "";
      return {
        row,
        route: applicationEvidenceRouteSchema.parse({
          evidenceId: row.evidenceId,
          relevanceScore,
          employer: row.employer ?? null,
          timeline: routeTimeline(row),
          maximumClassification: routeMaximum(row),
          sourceAuthority: routeSourceAuthority(row),
          reason: overlap > 0
            ? `${overlap} JD terms overlap; ${prefix}${row.eligibility}; ${row.recencyBand ?? "unknown"} evidence.`
            : `${prefix}role-representation fallback; ${row.eligibility}; ${row.recencyBand ?? "unknown"} evidence.`,
        }),
      };
    });
  const targetSize = Math.min(scored.length, Math.max(36, Math.min(48, Math.ceil(scored.length * 0.35))));
  const selected = new Map<string, typeof scored[number]>();
  const add = (candidate: typeof scored[number]) => {
    if (selected.size >= targetSize || selected.has(candidate.row.evidenceId)) return;
    selected.set(candidate.row.evidenceId, candidate);
  };
  scored.sort((left, right) => right.route.relevanceScore - left.route.relevanceScore || left.row.evidenceId.localeCompare(right.row.evidenceId));

  // Preserve evidence used at screening, then balance strong project evidence
  // across sources before adding lower-authority corroboration.
  const preferred = new Set(preferredEvidenceIds);
  scored.filter((candidate) => preferred.has(candidate.row.evidenceId)).forEach(add);

  if (customerTarget > 0) {
    scored
      .filter((candidate) => candidate.route.sourceAuthority === "primary")
      .filter((candidate) => candidate.row.recencyBand === "current" || candidate.row.recencyBand === "recent")
      .filter((candidate) => isCustomerFacingEvidence(candidate.row))
      .slice(0, Math.max(6, customerTarget * 2))
      .forEach(add);
  }

  if (aiTarget > 0) {
    scored
      .filter((candidate) => candidate.route.sourceAuthority === "primary")
      .filter((candidate) => isAiEvidence(candidate.row))
      .slice(0, Math.max(6, aiTarget * 2))
      .forEach(add);
  }

  if (qaTarget > 0) {
    scored
      .filter((candidate) => candidate.route.sourceAuthority === "primary")
      .filter((candidate) => isQaEvidence(candidate.row))
      .slice(0, 6)
      .forEach(add);
  }

  if (supportTarget > 0) {
    scored
      .filter((candidate) => candidate.route.sourceAuthority === "primary")
      .filter((candidate) => isSupportEvidence(candidate.row))
      .slice(0, 6)
      .forEach(add);
  }

  if (appDevTarget > 0) {
    scored
      .filter((candidate) => candidate.route.sourceAuthority === "primary")
      .filter((candidate) => isAppDevEvidence(candidate.row))
      .slice(0, 6)
      .forEach(add);
  }

  const primary = scored.filter((candidate) => candidate.route.sourceAuthority === "primary");
  const representedSources = new Set<string>();
  for (const candidate of primary) {
    const source = candidate.row.sourceFamily ?? candidate.row.sourcePath;
    if (representedSources.has(source)) continue;
    representedSources.add(source);
    add(candidate);
  }
  const primaryLimit = Math.max(selected.size, targetSize - 8);
  for (const candidate of primary) {
    if (selected.size >= primaryLimit) break;
    add(candidate);
  }
  scored.filter((candidate) => candidate.route.sourceAuthority === "corroboration").slice(0, 4).forEach(add);
  scored.filter((candidate) => candidate.route.sourceAuthority === "history").slice(0, 4).forEach(add);
  scored.forEach(add);
  const routes = [...selected.values()].map((candidate) => candidate.route);
  return applicationRoutingSchema.parse({
    schemaVersion: 1,
    selectedEvidenceIds: routes.map((route) => route.evidenceId),
    routes,
    excludedEvidenceCount: Math.max(0, scored.length - routes.length),
  });
}

function buildResumePlan(
  rows: EvidenceSnapshotRow[],
  canonicalResume: NonNullable<EvidenceSnapshot["canonicalResume"]>,
  footprint: EvidenceSnapshot["baseResumeFootprint"],
  jobDescription: string,
  candidateProfile: CandidateProfile | null,
): NonNullable<ApplicationContext["resumePlan"]> {
  const totalRange = candidateProfile?.preferences.resume.totalExperienceBullets ?? { min: 10, max: 14 };
  const currentRange = candidateProfile?.preferences.resume.currentEmployerBullets ?? { min: 6, max: 8 };
  const baselineTotal = canonicalResume.employers.reduce((sum, employer) => sum + employer.originalBulletCount, 0);
  const densityTarget = footprint?.targetExperienceWordMin
    ? Math.ceil(footprint.targetExperienceWordMin / 17)
    : baselineTotal;
  const routedCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.employer) routedCounts.set(row.employer, (routedCounts.get(row.employer) ?? 0) + 1);
  }
  const currentEmployer = canonicalResume.employers[0]?.name ?? null;
  const targets = canonicalResume.employers.map((employer, index) => ({
    employer: employer.name,
    targetBullets: index === 0
      ? Math.max(currentRange.min, Math.min(currentRange.max, employer.originalBulletCount))
      : employer.originalBulletCount,
    routedEvidenceCount: routedCounts.get(employer.name) ?? 0,
  }));
  let plannedMinimum = targets.reduce((sum, target) => sum + target.targetBullets, 0);
  while (plannedMinimum > totalRange.max) {
    const reducible = [...targets].reverse().find((target) => target.employer !== currentEmployer && target.targetBullets > 1);
    if (!reducible) break;
    reducible.targetBullets -= 1;
    plannedMinimum -= 1;
  }
  const targetTotalBullets = Math.max(totalRange.min, Math.min(totalRange.max, Math.max(baselineTotal, densityTarget, plannedMinimum)));
  let remaining = targetTotalBullets - plannedMinimum;
  while (remaining > 0) {
    const candidate = targets.filter((target) => target.employer !== currentEmployer || target.targetBullets < currentRange.max).sort((left, right) =>
      (right.routedEvidenceCount - right.targetBullets) - (left.routedEvidenceCount - left.targetBullets)
      || right.routedEvidenceCount - left.routedEvidenceCount)[0];
    if (!candidate || candidate.routedEvidenceCount <= candidate.targetBullets) break;
    candidate.targetBullets += 1;
    remaining -= 1;
  }
  const customerTarget = customerFacingTarget(jobDescription);
  const customerFacingEvidenceIds = rows
    .filter((row) => row.employer === currentEmployer)
    .filter((row) => row.recencyBand === "current" || row.recencyBand === "recent")
    .filter(isCustomerFacingEvidence)
    .slice(0, 10)
    .map((row) => row.evidenceId);
  return {
    targetTotalBullets: targets.reduce((sum, target) => sum + target.targetBullets, 0),
    targetTailoredBulletMin: Math.max(4, Math.floor(targetTotalBullets * 0.3)),
    targetTailoredBulletMax: Math.min(6, Math.max(4, Math.floor(targetTotalBullets * 0.45))),
    targetCareerAnchorBullets: Math.max(6, Math.ceil(targetTotalBullets * 0.6)),
    targetExperienceWordMin: footprint?.targetExperienceWordMin ?? null,
    targetExperienceWordMax: footprint?.targetExperienceWordMax ?? null,
    customerFacingRole: customerTarget > 0,
    targetCurrentEmployerCustomerBullets: customerFacingEvidenceIds.length >= customerTarget ? customerTarget : Math.min(customerTarget, customerFacingEvidenceIds.length),
    customerFacingEvidenceIds,
    employerTargets: targets,
  };
}

export function buildCoverLetterBrief(
  jobDescription: string,
  canonicalJob?: { title?: string | null; company?: string | null } | null,
  profile?: CandidateProfile | null,
): ApplicationContext["coverLetterBrief"] {
  const metadata = parseJobDescriptionMetadata(jobDescription);
  const company = metadata.company ?? canonicalJob?.company ?? null;
  const role = metadata.title ?? canonicalJob?.title ?? null;
  const candidateName = profile?.identity.fullName ?? "the candidate";
  const currentEmployer = profile?.career.employers[0]?.name ?? "the current employer";
  const roleProblems = jobDescription.split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").replace(/^\s*[-*+]\s+/, "").replace(/\*\*/g, "").trim())
    .filter((line) => line.length >= 35 && line.length <= 240)
    .filter((line) => !/^(?:About|Who We Are|Our Mission|Benefits|Perks|Equal Opportunity|Salary|Compensation|Requirements|Qualifications|What You'll Do|What You Bring|Responsibilities|Role Summary)/i.test(line))
    .filter((line) => !/\b(?:raise blockers|sprint ceremonies|standup|equal opportunity|affirmative action|medical, dental|401\(k\)|unlimited pto|bonus|salary range)\b/i.test(line))
    .filter((line) => !(company && line.toLowerCase().includes(company.toLowerCase())))
    .filter((line) => !(role && line.toLowerCase().includes(role.toLowerCase())))
    .filter((line) => /\b(?:build|support|partner|lead|manage|design|deliver|solve|drive|improve|work with|responsib|customer|client)\b/i.test(line))
    .slice(0, 1);
  return {
    targetWordMin: 190,
    targetWordMax: 230,
    hardWordMax: 300,
    roleProblems,
    company,
    role,
    introContract: [
      `Candidate-first narrative: ${candidateName}'s story exists independently of the JD. Do not derive the candidate's interests, focus, identity, or reasons for applying from the job description.`,
      `Begin with ${candidateName}: who the candidate is and how the career developed, using candidateProfile and selected evidence.`,
      "Do not announce that he is applying and do not begin by describing the employer. Never use templated openings such as 'Throughout my work, I have focused/concentrated on [job requirements]' or declare the role a 'natural continuation' or 'natural next step'.",
      `Mention ${role ?? "the role"} at ${company ?? "the company"} briefly only after the candidate's trajectory is established, then connect it to the documented path.`,
      "Choose the opening angle from routed evidence rather than a reusable motivation sentence or invented passion under non-factual classification. Never invent attachment to the employer's mission, market, product, users, or slogan.",
    ],
    requiredElements: [
      `Candidate-first narrative: ${candidateName}'s career story exists independently of the JD. The JD selects which truthful career episode is relevant, but never creates interests, passions, focus, or identity.`,
      "Candidate-originated motivation must come from the candidate profile, application voice profile, or user goals—never inferred from JD terminology or invented under non-factual classification.",
      "Keep at least three quarters of the body on the candidate's documented career path, personal choices, and evidence rather than a skills inventory.",
      "Fit should be demonstrated through concrete evidence, not declared through lists of matching requirements or prose inventories of tools.",
      "Use education or earlier work only when it adds meaning to this particular career path; do not include the same education paragraph by default or list coursework.",
      `Use one or two concrete evidence-backed examples with accurate tense and ownership: use one ongoing ${currentEmployer} example when available, and when useful, one earlier career or education bridge.`,
      "Use chronological order when connecting earlier work to changing responsibility; mention only stages relevant to this role.",
      "Use at most one sentence to describe the employer or role. Do not write a standalone requirements paragraph; explain why the candidate wants this work as a credible next step in the documented career.",
      "If no personal company-specific motivation is supported, use straightforward interest in the role's scope or growth opportunity without declaring it a 'natural continuation' or manufacturing passion.",
      "Use common words the candidate could say aloud, then close briefly with the work the candidate wants to continue doing without repeating job requirements or pledging a list of capabilities.",
    ],
    prohibitedPatterns: [
      "Throughout my work, I have focused",
      "Throughout my work, I have concentrated",
      "Throughout my work as an engineer, I have focused",
      "Throughout my work as a Customer Engineer, I have focused",
      "I have focused on",
      "I have concentrated on",
      "making this position a natural continuation",
      "making this role a natural next step",
      "making this role a natural continuation",
      "a natural continuation",
      "a natural next step",
      "That background allows me to",
      "That development background allows me to",
      "That engineering background allows me to",
      "I look forward to bringing",
      "My background aligns",
      "My background connects",
      "This progression",
      "This combination",
      "I welcome the opportunity to discuss how my background",
      "This foundation enables me",
      "Opening with a generic description of the company",
      "Engineering teams need",
      "I am excited to bring this combination",
      "demands engineers who",
      "operational rigor",
      "high-ownership environment",
      "measurable results",
      "I am drawn to the mission",
      "I am passionate about your mission",
      "I am applying for",
      "I am excited to apply",
      "I am interested in applying",
      "democratizing access",
      ...(company ? [`As ${company}`, `${company}'s mission`, `${company}’s mission`] : []),
    ],
  };
}

function compactStyleRules(markdown: string, profile?: CandidateProfile | null): string[] {
  const documentRules = markdown.split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*+]\s+/, "").replace(/^#+\s+/, "").trim())
    .filter((line) => line.length >= 12 && line.length <= 240)
    .filter((line) => !/^source|^updated|^purpose|^application voice profile$/i.test(line))
    .slice(0, 14);
  return [...new Set([
    ...(profile?.preferences.coverLetter.voiceGuidance ?? []),
    ...(profile?.preferences.coverLetter.storyGuidance ?? []),
    ...documentRules,
  ])].slice(0, 20);
}

async function resumeReferenceText(path: string, content: Buffer): Promise<string | undefined> {
  const extension = extname(path).toLowerCase();
  try {
    if (extension === ".md" || extension === ".txt") return content.toString("utf8").slice(0, 30_000);
    if (extension === ".docx") return (await mammoth.extractRawText({ buffer: content })).value.slice(0, 30_000);
    if (extension === ".pdf") {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const pdf = await pdfjs.getDocument({ data: Uint8Array.from(content) }).promise;
      const pages: string[] = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const pageContent = await page.getTextContent();
        pages.push(pageContent.items.map((item) => ("str" in item ? item.str : "")).join(" "));
      }
      return pages.join("\n").slice(0, 30_000);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function evidenceRows(markdown: string, sourcePath: string, sourceFamily: string | null): EvidenceSnapshotRow[] {
  const sourceRole = metadataValue(markdown, "source_role");
  const defaultConfidence = metadataValue(markdown, "confidence");
  const rows = new Map<string, EvidenceSnapshotRow>();
  for (const block of tableBlocks(markdown)) {
    const lines = block.split("\n").filter((line) => /^\s*\|.*\|\s*$/.test(line));
    const headers = lines[0]?.trim().slice(1, -1).split("|").map((value) => value.trim().toLowerCase()) ?? [];
    for (const cells of parseTable(block)) {
      const value = (names: string[]) => {
        const index = headers.findIndex((header) => names.includes(header));
        return index >= 0 ? cells[index] ?? "" : "";
      };
      const evidenceId = value(["evidence id"]);
      if (!evidenceId) continue;
      const confidence = value(["confidence"]) || defaultConfidence || "unspecified";
      const publicUse = value(["public use"]) || "corroboration required";
      const classification = classifyEvidence(confidence, publicUse, sourceRole);
      const year = value(["year"]);
      rows.set(evidenceId, {
        evidenceId,
        year,
        ...recencyFor(year),
        project: value(["project", "project or employer"]),
        employer: null,
        claim: value(["explicit claim"]),
        scope: value(["scope note", "ownership and scope"]),
        sourcePath,
        sourceFamily,
        sourceLocator: value(["source locator"]) || metadataValue(markdown, "source_locator"),
        confidence,
        classification,
        eligibility: eligibilityFor(classification, publicUse),
      });
    }
  }
  return [...rows.values()].filter((row) => row.claim);
}

function denylistRules(markdown: string): EvidenceSnapshot["denylistRules"] {
  for (const block of tableBlocks(markdown)) {
    const lines = block.split("\n").filter((line) => /^\s*\|.*\|\s*$/.test(line));
    const headers = lines[0]?.toLowerCase() ?? "";
    if (!headers.includes("rule id")) continue;
    return parseGenericTable(block).map((row) => ({
      ruleId: row[0] ?? "",
      blockedClaim: row[1] ?? "",
      safeHandling: row[2] ?? "",
    })).filter((row) => row.ruleId && row.blockedClaim);
  }
  return [];
}

function parseGenericTable(block: string): string[][] {
  const lines = block.split("\n").filter((line) => /^\s*\|.*\|\s*$/.test(line));
  return lines.slice(2).map((line) => line.trim().slice(1, -1).split("|").map((value) => value.trim().replaceAll("`", "")));
}

function sourceRole(path: string, manifest: ContextManifest): "structured" | "employer-context" | "broad" | "linkedin" | "base-resume" | "secondary-resume" | "policy" | "job-description" {
  if (manifest.policyPaths.includes(path) || path === DENYLIST_PATH || path === APPLICATION_VOICE_PROFILE_PATH) return "policy";
  if (path.startsWith("jobs/")) return "job-description";
  if (path === manifest.linkedinProfilePath) return "linkedin";
  if (path === manifest.baseResumePath) return "base-resume";
  if (manifest.secondaryResumePaths.includes(path)) return "secondary-resume";
  if (path.startsWith("context/structured/company/") || path.startsWith("context/broad/company/")) return "employer-context";
  if (path.startsWith("context/structured/")) return "structured";
  return "broad";
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
}

export async function createEvidenceSnapshot(workspacePath: string, jobId: string): Promise<EvidenceSnapshot> {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(jobId)) throw new Error("The canonical job ID is invalid.");
  const workspace = resolve(workspacePath);
  let manifest = await readActiveContextManifest(workspace);
  if (!manifest || !manifest.baseResumePath) {
    const candidateProfile = await readCandidateProfile(workspace);
    manifest = await buildContextManifest(workspace, { jobIds: [jobId] }, {
      baseResumePath: candidateProfile?.sources.baseResumePath ?? null,
      secondaryResumePaths: candidateProfile?.sources.secondaryResumePaths ?? [],
      linkedinProfilePath: candidateProfile?.sources.linkedinProfilePath ?? null,
    });
  }
  const candidateProfile = await readCandidateProfile(workspace);
  if (resolve(manifest.workspacePath) !== workspace) throw new Error("The active context manifest belongs to another workspace.");
  if (!manifest.baseResumePath) throw new Error("The active context manifest has no configured base resume.");

  const jobPath = assertInsideWorkspace(workspace, join(workspace, "jobs", jobId));
  if (!(await stat(jobPath).catch(() => null))?.isDirectory()) throw new Error(`The canonical job workspace does not exist: jobs/${jobId}.`);
  const statePath = assertInsideWorkspace(workspace, join(jobPath, ".sensei"));
  await mkdir(statePath, { recursive: true });

  const evidencePaths = manifest.sourceFiles
    .map((source) => source.path)
    .filter((path) => path !== "context/structured/README.md")
    .filter((path) => !path.startsWith("jobs/"));
  const jobDescriptionPath = await resolveJobDescriptionPath(workspace, jobId);
  const allPaths = [...new Set([...evidencePaths, jobDescriptionPath, ...manifest.policyPaths, DENYLIST_PATH, APPLICATION_VOICE_PROFILE_PATH])];
  const sourceFiles: EvidenceSnapshot["sourceFiles"] = [];
  const rows: EvidenceSnapshotRow[] = [];
  let denylistMarkdown = "";
  let jobDescriptionText = "";
  const baseResumeFootprint = await profileBaseResume(workspace, manifest.baseResumePath);
  const canonicalResult = await loadCanonicalResumeBaseline(workspace, manifest.baseResumePath)
    .then((canonicalResume) => ({ canonicalResume, warnings: canonicalResume.warnings }))
    .catch((error: unknown) => ({
      canonicalResume: null,
      warnings: [error instanceof Error ? error.message : String(error)],
    }));

  for (const relativePath of allPaths) {
    const absolutePath = assertInsideWorkspace(workspace, join(workspace, relativePath));
    const content = await readFile(absolutePath).catch(() => {
      if (relativePath === DENYLIST_PATH || relativePath === APPLICATION_VOICE_PROFILE_PATH) {
        return Buffer.from("");
      }
      return null;
    });
    if (!content) continue;
    const role = sourceRole(relativePath, manifest);
    const text = /\.(?:md|txt|json)$/i.test(relativePath)
      ? content.toString("utf8")
      : role === "secondary-resume"
        ? await resumeReferenceText(relativePath, content)
        : undefined;
    const manifestSource = manifest.sourceFiles.find((source) => source.path === relativePath);
    sourceFiles.push({
      path: relativePath,
      sha256: sha256(content),
      sourceFamily: manifestSource?.sourceFamily ?? null,
      sourceRole: role,
      ...(text && (role === "structured" || role === "employer-context" || role === "broad" || role === "policy" || role === "secondary-resume") ? { contextText: text } : {}),
    });
    if (role === "structured" && text) rows.push(...evidenceRows(text, relativePath, manifestSource?.sourceFamily ?? null));
    if (role === "job-description" && text) {
      jobDescriptionText = text;
      rows.push({
        evidenceId: `job:${jobId}:original-jd`,
        year: "",
        ...recencyFor(""),
        project: jobId,
        employer: null,
        claim: text,
        scope: "Employer-provided job description; supports employer and role requirements only, never candidate experience.",
        sourcePath: relativePath,
        sourceFamily: null,
        sourceLocator: "Full supplied job description",
        confidence: "high",
        classification: "verified",
        eligibility: "eligible",
      });
    }
    if (relativePath === DENYLIST_PATH && text) denylistMarkdown = text;
  }

  const manifestHash = contextManifestHash(manifest);
  const canonicalEmployers = canonicalResult.canonicalResume?.employers.map((employer) => employer.name) ?? [];
  const normalizedRows = rows.map((row) => ({
    ...row,
    employer: row.evidenceId.startsWith("job:") ? null : inferEmployer(row, canonicalEmployers),
  })).sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));
  const applicationRouting = buildApplicationRouting(normalizedRows, jobDescriptionText);
  const snapshotCore = {
    schemaVersion: 1 as const,
    jobId,
    manifestHash,
    baseResumePath: manifest.baseResumePath,
    baseResumeFootprint,
    canonicalResume: canonicalResult.canonicalResume,
    canonicalResumeWarnings: canonicalResult.warnings,
    secondaryResumePaths: manifest.secondaryResumePaths,
    selectedStructuredPaths: manifest.selectedStructuredPaths.filter((path) => path !== "context/structured/README.md"),
    selectedBroadPaths: manifest.selectedBroadPaths,
    selectedJobFiles: manifest.selectedJobFiles,
    policyPaths: [...new Set([...manifest.policyPaths, DENYLIST_PATH, APPLICATION_VOICE_PROFILE_PATH])],
    sourceFiles: sourceFiles.sort((a, b) => a.path.localeCompare(b.path)),
    evidenceRows: normalizedRows,
    applicationRouting,
    denylistRules: denylistRules(denylistMarkdown),
  };
  const snapshotId = sha256(JSON.stringify(snapshotCore));
  const candidateSnapshot = evidenceSnapshotSchema.parse({
    ...snapshotCore,
    snapshotId,
    generatedAt: new Date().toISOString(),
    manifestGeneratedAt: manifest.generatedAt,
  });

  const currentPath = assertInsideWorkspace(workspace, join(statePath, "evidence_snapshot.json"));
  const existingVersion = await readFile(currentPath, "utf8")
    .then((value) => evidenceSnapshotSchema.parse(JSON.parse(value)))
    .catch(() => null);
  const snapshot = existingVersion?.snapshotId === snapshotId ? existingVersion : candidateSnapshot;
  await writeJsonAtomic(currentPath, snapshot);
  const hiddenJobPath = assertInsideWorkspace(jobPath, join(statePath, "job.json"));
  let canonicalJob: { title?: string | null; company?: string | null; location?: string | null } | null = await readFile(hiddenJobPath, "utf8")
    .catch(() => readFile(join(jobPath, "job.json"), "utf8"))
    .then((text) => JSON.parse(text) as { title?: string | null; company?: string | null })
    .catch(() => null);
  if (!(await stat(hiddenJobPath).catch(() => null))?.isFile()) {
    const metadata = parseJobDescriptionMetadata(jobDescriptionText);
    if (metadata.company || metadata.title) {
      const jobData = {
        id: jobId,
        company: metadata.company,
        title: metadata.title,
        location: metadata.location,
        externalJobId: metadata.jobId,
        sourceUrl: metadata.url,
        createdAt: snapshot.generatedAt,
      };
      await writeJsonAtomic(hiddenJobPath, jobData);
      if (!canonicalJob) {
        canonicalJob = jobData;
      }
    }
  }
  if (snapshot.canonicalResume && snapshot.applicationRouting) {
    const evidenceById = new Map(snapshot.evidenceRows.map((row) => [row.evidenceId, row]));
    const routedRows = snapshot.applicationRouting.selectedEvidenceIds
      .map((evidenceId) => evidenceById.get(evidenceId))
      .filter((row): row is EvidenceSnapshotRow => Boolean(row));
    const stylePolicy = snapshot.sourceFiles.find((source) => source.path === APPLICATION_VOICE_PROFILE_PATH)?.contextText ?? "";
    const resumePlan = buildResumePlan(routedRows, snapshot.canonicalResume, snapshot.baseResumeFootprint, jobDescriptionText, candidateProfile);
    const configuredSkillCategories = candidateProfile?.preferences.resume.skillsCategories ?? [];
    const baselineSkillCategories = snapshot.canonicalResume.originalSkillsLines
      .map((line) => line.replace(/[*_`]/g, "").split(":", 1)[0]?.trim() ?? "")
      .filter((category) => category && !/^languages?$/i.test(category));
    const editableSkillCategories = configuredSkillCategories.length ? configuredSkillCategories : baselineSkillCategories;
    const routeById = new Map(snapshot.applicationRouting.routes.map((route) => [route.evidenceId, route]));
    const applicationContext: ApplicationContext = applicationContextSchema.parse({
      schemaVersion: 2,
      jobId,
      snapshotId: snapshot.snapshotId,
      manifestHash: snapshot.manifestHash,
      generatedAt: snapshot.generatedAt,
      baseResumePath: snapshot.baseResumePath,
      job: {
        company: canonicalJob?.company ?? null,
        title: canonicalJob?.title ?? null,
        location: canonicalJob?.location ?? null,
      },
      candidate: {
        fullName: candidateProfile?.identity.fullName ?? "Candidate",
        artifactPrefix: candidateProfile?.identity.artifactPrefix ?? "Candidate",
        transitionSummary: candidateProfile?.career.transitionSummary ?? "",
        preferredRoleFamilies: candidateProfile?.career.preferredRoleFamilies ?? [],
        storyGuidance: candidateProfile?.preferences.coverLetter.storyGuidance ?? [],
        voiceGuidance: candidateProfile?.preferences.coverLetter.voiceGuidance ?? [],
      },
      resumeTemplate: {
        baselineId: snapshot.canonicalResume.baselineId,
        originalSkillsLines: snapshot.canonicalResume.originalSkillsLines,
        employers: snapshot.canonicalResume.employers.map((employer) => ({
          name: employer.name,
          originalBulletCount: employer.originalBulletCount,
          originalBullets: employer.originalBullets,
        })),
        editableSkillCategories,
      },
      footprint: snapshot.baseResumeFootprint,
      evidenceRows: routedRows.map((row) => {
        const route = routeById.get(row.evidenceId);
        return {
          evidenceId: row.evidenceId,
          claim: row.claim,
          scope: row.scope,
          employer: row.employer ?? null,
          project: row.project,
          sourcePath: row.sourcePath,
          sourceFamily: row.sourceFamily,
          timeline: route?.timeline ?? routeTimeline(row),
          eligibility: row.eligibility,
          maximumClassification: route?.maximumClassification ?? routeMaximum(row),
          sourceAuthority: route?.sourceAuthority ?? routeSourceAuthority(row),
        };
      }),
      denylistRules: snapshot.denylistRules,
      styleRules: compactStyleRules(stylePolicy, candidateProfile),
      resumePlan,
      coverLetterBrief: (() => {
        const brief = buildCoverLetterBrief(jobDescriptionText, canonicalJob, candidateProfile);
        if (!brief) return undefined;
        return {
          ...brief,
          introContract: brief.introContract?.slice(0, 3),
          requiredElements: brief.requiredElements.slice(0, 6),
          prohibitedPatterns: brief.prohibitedPatterns.slice(0, 24),
        };
      })(),
      instructions: [
        "Use only evidenceRows for candidate facts; preserve employer, timeline, scope, eligibility, and classification ceilings.",
        "Use the JD to prioritize supported work, never to rewrite candidate history. Follow resumePlan and resumeTemplate exactly.",
        "Substantively reframe 4-5 experience bullets for the target role using eligible evidence; do not copy baseline bullets verbatim (prevents RESUME_TAILORING_TOO_SIMILAR), and keep total experience words strictly within targetExperienceWordMin and targetExperienceWordMax.",
        "In the cover letter opening paragraph, introduce the candidate ('I' / 'my') and explicitly include both the target company and role names (prevents COVER_LETTER_INTRO_IMPERSONAL).",
        "Only cite eligible evidence rows for standalone claims; do not cite a single corroboration-required row alone.",
        "Use direct, natural wording; denylistRules always win. Apply styleRules to wording only, never as evidence.",
        resumePlan.customerFacingRole
          ? `Include ${resumePlan.targetCurrentEmployerCustomerBullets} supported current-employer customer-facing bullets and retain a technical foundation.`
          : "Retain one supported customer-facing career anchor when relevant without displacing stronger technical evidence.",
        "Write one application_bundle.json with evidence IDs beside each generated claim, then finalize once.",
      ],
    });
    await writeJsonAtomic(assertInsideWorkspace(jobPath, join(statePath, "application_context.json")), applicationContext);
  }
  await pinApplicationRun(jobPath, statePath, snapshot);
  return snapshot;
}

async function pinApplicationRun(jobPath: string, statePath: string, snapshot: EvidenceSnapshot): Promise<ApplicationRun> {
  const path = assertInsideWorkspace(jobPath, join(statePath, "application_run.json"));
  const existingHidden = await readFile(path, "utf8")
    .then((value) => applicationRunSchema.parse(JSON.parse(value)))
    .catch(() => null);
  const legacy = existingHidden ? null : await readFile(join(jobPath, "application_run.json"), "utf8")
    .then((value) => applicationRunSchema.parse(JSON.parse(value)))
    .catch(() => null);
  const existing = existingHidden ?? legacy;
  const runId = sha256(`${snapshot.jobId}:${snapshot.snapshotId}:${snapshot.manifestHash}:${snapshot.baseResumePath}`);
  if (existing?.runId === runId) {
    if (!existingHidden) await writeJsonAtomic(path, existing);
    return existing;
  }
  const now = new Date().toISOString();
  const run = applicationRunSchema.parse({
    schemaVersion: 1,
    runId,
    jobId: snapshot.jobId,
    snapshotId: snapshot.snapshotId,
    manifestHash: snapshot.manifestHash,
    baseResumePath: snapshot.baseResumePath,
    canonicalBaselineId: snapshot.canonicalResume?.baselineId ?? null,
    createdAt: now,
    updatedAt: now,
    state: "snapshot_ready",
    previousRunId: existing?.runId ?? null,
    validatedAt: null,
    validationAttempts: 0,
    maxValidationAttempts: 1,
    lastValidationStatus: null,
  });
  await writeJsonAtomic(path, run);
  return run;
}

function defaultWorkspace(): string {
  const configured = process.env.SENSEI_WORKSPACE;
  if (configured) return resolve(configured);
  return basename(process.cwd()) === "data" ? process.cwd() : resolve(process.cwd(), "data");
}

if (require.main === module) {
  const jobId = process.argv[2];
  if (!jobId) {
    process.stderr.write("Usage: npm run context:snapshot -- <canonical-job-id>\n");
    process.exitCode = 1;
  } else {
    createEvidenceSnapshot(defaultWorkspace(), jobId)
      .then(async (snapshot) => {
        const run = applicationRunSchema.parse(JSON.parse(await readFile(
          join(defaultWorkspace(), "jobs", jobId, ".sensei", "application_run.json"),
          "utf8",
        )));
        process.stdout.write(`${JSON.stringify({
          runId: run.runId,
          snapshotId: snapshot.snapshotId,
          manifestHash: snapshot.manifestHash,
          baseResumePath: snapshot.baseResumePath,
          canonicalBaselineId: snapshot.canonicalResume?.baselineId ?? null,
          applicationContextPath: `jobs/${jobId}/.sensei/application_context.json`,
          routedEvidenceCount: snapshot.applicationRouting?.selectedEvidenceIds.length ?? 0,
        }, null, 2)}\n`);
      })
      .catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      });
  }
}
