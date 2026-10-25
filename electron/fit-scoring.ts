import { FIT_CLASSIFICATION_CREDIT } from "../src/shared/fit-credit";
export const FIT_CATEGORIES = ["core", "technical", "scope", "outcomes", "domain", "learning"] as const;
export type FitCategory = typeof FIT_CATEGORIES[number];

export const FIT_CLASSIFICATIONS = ["direct", "strong_transferable", "adjacent_transferable", "unclear", "gap"] as const;
export type FitClassification = typeof FIT_CLASSIFICATIONS[number];

export type FitRequirement = {
  requirement: string;
  category: FitCategory;
  weight: number;
  material: boolean;
  classification: FitClassification;
  evidence: string;
};

export const MUST_HAVE_STATUSES = ["met", "learnable", "blocker"] as const;
export type MustHaveStatus = typeof MUST_HAVE_STATUSES[number];
export type MustHaveRequirement = { requirement: string; status: MustHaveStatus; evidence: string; note: string };

/** Each learnable must-have lowers the visible score by this much, up to the cap. */
export const LEARNABLE_MUST_HAVE_PENALTY = 0.15;
export const LEARNABLE_MUST_HAVE_PENALTY_CAP = 0.45;
export const FIT_GATE = 3.5;

export type FitScoreResult = {
  score: number;
  rawScore: number;
  confidence: "high" | "medium" | "low";
  directWeightPercent: number;
  directCorePercent: number;
  materialTransferableCoreCount: number;
  /** Score before learnable must-have penalties. The apply gate uses this, so a learnable gap never turns YES into NO. */
  scoreBeforeMustHaves?: number;
  gateScore?: number;
  mustHaves?: MustHaveRequirement[];
  learnablePenalty?: number;
  blockers?: MustHaveRequirement[];
  categoryCredits: Record<FitCategory, number>;
  requirements: FitRequirement[];
};

export type FitClassificationAdjustment = {
  requirement: string;
  from: FitClassification;
  to: FitClassification;
  evidenceIds: string[];
  reason: string;
  evidenceChanged: boolean;
  originalEvidence: string;
  resolvedEvidence: string;
};

const CREDIT: Record<FitClassification, number> = FIT_CLASSIFICATION_CREDIT;

const EXPECTED_CATEGORY_WEIGHTS: Record<FitCategory, number> = {
  core: 40,
  technical: 25,
  scope: 15,
  outcomes: 10,
  domain: 5,
  learning: 5,
};

export function calculateFitScore(requirements: FitRequirement[]): FitScoreResult {
  if (!requirements.length) throw new Error("Requirement scoring needs at least one material JD requirement.");
  const categoryWeights = Object.fromEntries(FIT_CATEGORIES.map((category) => [category, 0])) as Record<FitCategory, number>;
  for (const row of requirements) {
    if (!FIT_CATEGORIES.includes(row.category)) throw new Error(`Unknown fit category: ${row.category}.`);
    if (!FIT_CLASSIFICATIONS.includes(row.classification)) throw new Error(`Unknown fit classification: ${row.classification}.`);
    if (!Number.isFinite(row.weight) || row.weight <= 0) throw new Error(`Requirement weights must be positive: ${row.requirement}.`);
    categoryWeights[row.category] += row.weight;
  }
  for (const category of FIT_CATEGORIES) {
    if (Math.abs(categoryWeights[category] - EXPECTED_CATEGORY_WEIGHTS[category]) > 0.01) {
      throw new Error(`${category} requirements must total ${EXPECTED_CATEGORY_WEIGHTS[category]}%, received ${categoryWeights[category]}%.`);
    }
  }

  const weightedCredit = requirements.reduce((sum, row) => sum + row.weight * CREDIT[row.classification], 0);
  const categoryCredits = Object.fromEntries(FIT_CATEGORIES.map((category) => [
    category,
    requirements.filter((row) => row.category === category).reduce((sum, row) => sum + row.weight * CREDIT[row.classification], 0),
  ])) as Record<FitCategory, number>;
  const rawScore = weightedCredit / 20;
  const directWeight = requirements.filter((row) => row.classification === "direct").reduce((sum, row) => sum + row.weight, 0);
  const coreRows = requirements.filter((row) => row.category === "core");
  const directCoreWeight = coreRows.filter((row) => row.classification === "direct").reduce((sum, row) => sum + row.weight, 0);
  const directCorePercent = directCoreWeight / EXPECTED_CATEGORY_WEIGHTS.core * 100;
  const materialTransferableCoreCount = coreRows.filter((row) => row.material && row.classification !== "direct").length;
  const materialCore = coreRows.filter((row) => row.material);
  const roleDefiningCore = materialCore.filter((row) => row.weight >= 15);
  let score = rawScore;
  if (directCorePercent < 80) score = Math.min(score, 4.4);
  if (roleDefiningCore.some((row) => row.classification === "gap")) score = Math.min(score, 3.4);
  else if (roleDefiningCore.some((row) => row.classification === "unclear")) score = Math.min(score, 3.8);
  else if (materialCore.some((row) => row.classification === "adjacent_transferable")) score = Math.min(score, 4.2);
  else if (materialCore.filter((row) => row.classification === "strong_transferable").length > 1) score = Math.min(score, 4.3);
  const uncertainWeight = requirements
    .filter((row) => row.classification === "unclear" || row.classification === "gap")
    .reduce((sum, row) => sum + row.weight, 0);
  const strongTransferableWeight = requirements
    .filter((row) => row.classification === "strong_transferable")
    .reduce((sum, row) => sum + row.weight, 0);
  const materialRows = requirements.filter((row) => row.material);
  const materialWeight = materialRows.reduce((sum, row) => sum + row.weight, 0);
  const materialDirectOrStrongWeight = materialRows
    .filter((row) => row.classification === "direct" || row.classification === "strong_transferable")
    .reduce((sum, row) => sum + row.weight, 0);
  const materialDirectOrStrongPercent = materialDirectOrStrongWeight / Math.max(1, materialWeight) * 100;
  const materialUnclearCount = materialRows.filter((row) => row.classification === "unclear").length;
  const materialCoreGap = materialCore.some((row) => row.classification === "gap");
  const confidence = directWeight >= 75 && materialTransferableCoreCount === 0
    ? "high"
    : directWeight >= 45
      || (uncertainWeight === 0 && strongTransferableWeight >= 45)
      || (materialDirectOrStrongPercent >= 70 && !materialCoreGap && materialUnclearCount <= 1)
      ? "medium"
      : "low";
  return {
    score: Math.round(score * 100) / 100,
    rawScore: Math.round(rawScore * 100) / 100,
    confidence,
    directWeightPercent: Math.round(directWeight * 100) / 100,
    directCorePercent: Math.round(directCorePercent * 100) / 100,
    materialTransferableCoreCount,
    categoryCredits,
    requirements,
  };
}

function normalizedHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z]+/g, " ").trim();
}

export function parseFitRequirements(markdown: string): FitRequirement[] | null {
  const section = /###\s+Requirement Scoring\s*\n([\s\S]*?)(?=\n#{1,3}\s+|$)/i.exec(markdown)?.[1];
  if (!section) return null;
  const lines = section.split("\n").filter((line) => /^\s*\|.*\|\s*$/.test(line));
  if (lines.length < 3) return null;
  const cells = (line: string) => line.trim().slice(1, -1).split("|").map((value) => value.trim().replaceAll("`", ""));
  const headers = cells(lines[0]).map(normalizedHeader);
  const index = (name: string) => headers.indexOf(name);
  const required = ["requirement", "category", "weight", "material", "classification", "evidence"];
  if (required.some((name) => index(name) < 0)) return null;
  return lines.slice(2).map(cells).map((row) => ({
    requirement: row[index("requirement")] ?? "",
    category: (row[index("category")] ?? "").toLowerCase().replaceAll(" ", "_") as FitCategory,
    weight: Number((row[index("weight")] ?? "").replace("%", "")),
    material: /^(?:yes|true)$/i.test(row[index("material")] ?? ""),
    classification: (row[index("classification")] ?? "").toLowerCase().replaceAll(" ", "_") as FitClassification,
    evidence: row[index("evidence")] ?? "",
  })).filter((row) => row.requirement);
}

/** Parses the optional `### Must-Have Requirements` table (Requirement | Status | Evidence | Note). */
export function parseMustHaves(markdown: string): MustHaveRequirement[] {
  const section = /###\s+Must-Have Requirements\s*\n([\s\S]*?)(?=\n#{1,3}\s+|$)/i.exec(markdown)?.[1];
  if (!section) return [];
  const lines = section.split("\n").filter((line) => /^\s*\|.*\|\s*$/.test(line));
  if (lines.length < 3) return [];
  const cells = (line: string) => line.trim().slice(1, -1).split("|").map((value) => value.trim().replaceAll("`", ""));
  const headers = cells(lines[0]!).map(normalizedHeader);
  const index = (name: string) => headers.indexOf(name);
  if (index("requirement") < 0 || index("status") < 0) return [];
  return lines.slice(2).map(cells).map((row) => {
    const raw = (row[index("status")] ?? "").toLowerCase();
    const status: MustHaveStatus = raw.includes("block") ? "blocker" : raw.includes("learn") ? "learnable" : raw.includes("met") ? "met" : "learnable";
    return {
      requirement: row[index("requirement")] ?? "",
      status,
      evidence: index("evidence") >= 0 ? row[index("evidence")] ?? "" : "",
      note: index("note") >= 0 ? row[index("note")] ?? "" : "",
    };
  }).filter((row) => row.requirement);
}

/**
 * Learnable must-haves (e.g. a language the candidate can pick up) lower the visible score by
 * 0.15 each, capped at 0.45, but the gate uses the score before that penalty. Only blockers
 * (legal, credential, clearance, location) can stop an application.
 */
export function applyMustHaves(result: FitScoreResult, mustHaves: MustHaveRequirement[]): FitScoreResult {
  const learnable = mustHaves.filter((row) => row.status === "learnable");
  const blockers = mustHaves.filter((row) => row.status === "blocker");
  const learnablePenalty = Math.round(Math.min(LEARNABLE_MUST_HAVE_PENALTY_CAP, learnable.length * LEARNABLE_MUST_HAVE_PENALTY) * 100) / 100;
  const score = Math.max(0, Math.round((result.score - learnablePenalty) * 100) / 100);
  const confidence = (learnable.length || blockers.length) && result.confidence === "high" ? "medium" : result.confidence;
  return { ...result, score, confidence, scoreBeforeMustHaves: result.score, gateScore: result.score, mustHaves, learnablePenalty, blockers };
}

export function gateStatusFor(result: FitScoreResult): string {
  if (result.blockers?.length) return "manual review: hard blocker";
  return (result.gateScore ?? result.score) >= FIT_GATE ? "accepted" : "accepted at screening; evidence-calibrated score below threshold";
}

export function scoreEvaluation(markdown: string): FitScoreResult | null {
  const requirements = parseFitRequirements(markdown);
  return requirements ? applyMustHaves(calculateFitScore(requirements), parseMustHaves(markdown)) : null;
}

const CLASSIFICATION_ORDER: FitClassification[] = ["gap", "unclear", "adjacent_transferable", "strong_transferable", "direct"];

function lowerClassification(left: FitClassification, right: FitClassification): FitClassification {
  return CLASSIFICATION_ORDER[Math.min(CLASSIFICATION_ORDER.indexOf(left), CLASSIFICATION_ORDER.indexOf(right))] ?? "gap";
}

function evidenceIds(value: string): string[] {
  return [...value.matchAll(/[a-z][a-z0-9-]*(?::[a-z0-9][a-z0-9-]*){2,}/gi)]
    .map((match) => match[0].replace(/^evidence:(?=context:|linkedin:|job:)/i, ""));
}

const TOKEN_EQUIVALENCE: Record<string, string> = {
  clients: "customer",
  client: "customer",
  customers: "customer",
  debugging: "debug",
  debugged: "debug",
  diagnose: "debug",
  diagnosed: "debug",
  diagnosing: "debug",
  troubleshoot: "debug",
  troubleshot: "debug",
  troubleshooting: "debug",
  integrations: "integrate",
  integration: "integrate",
  integrated: "integrate",
  connecting: "integrate",
  connected: "integrate",
  connectors: "integrate",
  onboarding: "adopt",
  onboarded: "adopt",
  enablement: "adopt",
  enabling: "adopt",
  adoption: "adopt",
  developing: "build",
  developed: "build",
  implemented: "build",
  implementing: "build",
  building: "build",
};

function normalizedFitToken(token: string): string {
  const equivalent = TOKEN_EQUIVALENCE[token];
  if (equivalent) return equivalent;
  if (token.length > 5 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

function fitTokens(value: string): Set<string> {
  const stop = new Set(["ability", "about", "across", "also", "and", "are", "experience", "from", "have", "into", "knowledge", "more", "that", "the", "their", "this", "through", "using", "with", "work"]);
  return new Set(value.toLowerCase().split(/[^a-z0-9+#.]+/)
    .filter((token) => token.length >= 3 && !stop.has(token))
    .map(normalizedFitToken));
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_value, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length] ?? Math.max(left.length, right.length);
}

function idSimilarity(left: string, right: string): number {
  const maximum = Math.max(left.length, right.length, 1);
  return 1 - editDistance(left, right) / maximum;
}

function stableEvidencePrefix(id: string): string {
  return id.split(":").slice(0, 2).join(":");
}

function tokenCoverage(requirement: string, evidence: string): number {
  const requirementTokens = fitTokens(requirement);
  const evidenceTokens = fitTokens(evidence);
  return [...requirementTokens].filter((token) => evidenceTokens.has(token)).length / Math.max(1, requirementTokens.size);
}

function resolveEvidenceId(id: string, requirement: string, snapshot: EvidenceSnapshot): string | null {
  if (snapshot.evidenceRows.some((candidate) => candidate.evidenceId === id)) return id;
  const selected = new Set(snapshot.applicationRouting?.selectedEvidenceIds ?? snapshot.evidenceRows.map((candidate) => candidate.evidenceId));
  const prefix = stableEvidencePrefix(id);
  const ranked = snapshot.evidenceRows
    .filter((candidate) => selected.has(candidate.evidenceId) && stableEvidencePrefix(candidate.evidenceId) === prefix)
    .map((candidate) => {
      const structuralSimilarity = idSimilarity(id, candidate.evidenceId);
      return {
        id: candidate.evidenceId,
        structuralSimilarity,
        score: structuralSimilarity * 0.7
          + tokenCoverage(requirement, `${candidate.claim} ${candidate.scope} ${candidate.project}`) * 0.3,
      };
    })
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];
  const runnerUp = ranked[1];
  if (!best
    || (best.structuralSimilarity < 0.78 && best.score < 0.68)
    || (runnerUp && best.score - runnerUp.score < 0.08)) return null;
  return best.id;
}

type ClassificationCeiling = {
  classification: FitClassification;
  evidenceIds: string[];
  originalEvidenceIds: string[];
  reason: string;
  evidenceChanged: boolean;
};

function classificationCeiling(row: FitRequirement, snapshot: EvidenceSnapshot): ClassificationCeiling {
  const originalIds = evidenceIds(row.evidence);
  const resolved = originalIds.map((id) => resolveEvidenceId(id, row.requirement, snapshot));
  const ids = resolved.filter((id): id is string => Boolean(id));
  const evidenceChanged = ids.some((id, index) => id !== originalIds[index]);
  const rows = ids.map((id) => snapshot.evidenceRows.find((candidate) => candidate.evidenceId === id)).filter((candidate): candidate is EvidenceSnapshot["evidenceRows"][number] => Boolean(candidate));
  if (!ids.length || rows.length !== ids.length || rows.some((candidate) => candidate.evidenceId.startsWith("job:"))) {
    return { classification: "gap", evidenceIds: ids, originalEvidenceIds: originalIds, evidenceChanged, reason: "No unique in-scope candidate-evidence mapping exists in the pinned snapshot." };
  }
  if (snapshot.applicationRouting && ids.some((id) => !snapshot.applicationRouting!.selectedEvidenceIds.includes(id))) {
    return { classification: "gap", evidenceIds: ids, originalEvidenceIds: originalIds, evidenceChanged, reason: "The cited evidence is outside the job-scoped application context." };
  }
  const eligible = rows.filter((candidate) => candidate.eligibility === "eligible");
  const needsCorroboration = rows.some((candidate) => candidate.eligibility === "corroboration-required");
  const selectedStructuredRows = rows.filter((candidate) => candidate.sourcePath.startsWith("context/structured/"));
  const families = new Set(rows.map((candidate) => candidate.sourceFamily ?? candidate.sourcePath));
  const requirementTokens = fitTokens(row.requirement);
  const evidenceTokens = fitTokens(rows.map((candidate) => `${candidate.claim} ${candidate.scope} ${candidate.project}`).join(" "));
  const overlap = [...requirementTokens].filter((token) => evidenceTokens.has(token)).length;
  const coverage = overlap / Math.max(1, requirementTokens.size);
  if (!eligible.length) {
    if (needsCorroboration && selectedStructuredRows.length) {
      const routeCeiling = snapshot.applicationRouting?.routes.find((route) => route.evidenceId === ids[0])?.maximumClassification;
      const evidenceClass: FitClassification = coverage >= 0.14
        ? "strong_transferable"
        : coverage >= 0.06
          ? "adjacent_transferable"
          : "unclear";
      return {
        classification: routeCeiling ? lowerClassification(evidenceClass, routeCeiling) : evidenceClass,
        evidenceIds: ids,
        originalEvidenceIds: originalIds,
        evidenceChanged,
        reason: `Selected structured context provides ${evidenceClass.replaceAll("_", " ")} overlap; corroboration-required rows cannot independently make the requirement direct.`,
      };
    }
    return {
      classification: needsCorroboration ? "unclear" : "gap",
      evidenceIds: ids,
      originalEvidenceIds: originalIds,
      evidenceChanged,
      reason: needsCorroboration ? "Corroboration-required evidence cannot independently earn direct or transferable credit." : "No eligible candidate evidence supports this requirement.",
    };
  }
  let ceiling: FitClassification = eligible.some((candidate) => candidate.classification === "verified" || candidate.classification === "summary-derived")
    ? "direct"
    : eligible.some((candidate) => candidate.classification === "supported-inference")
      ? "strong_transferable"
      : "adjacent_transferable";
  if (snapshot.applicationRouting) {
    for (const id of ids) {
      const route = snapshot.applicationRouting.routes.find((candidate) => candidate.evidenceId === id);
      if (route) ceiling = lowerClassification(ceiling, route.maximumClassification);
    }
  }
  const currentEmployer = snapshot.canonicalResume?.employers[0]?.name
    ?? snapshot.evidenceRows.find((row) => row.recencyBand === "current" && row.employer)?.employer;
  const linkedinOnlyCurrentEmployer = Boolean(currentEmployer) && rows.length > 0 && rows.every((candidate) =>
    candidate.sourceFamily === "linkedin-profile" && candidate.employer && normalizedEmployerName(candidate.employer) === normalizedEmployerName(currentEmployer!));
  if (linkedinOnlyCurrentEmployer) ceiling = lowerClassification(ceiling, "strong_transferable");
  if (needsCorroboration && families.size < 2) ceiling = lowerClassification(ceiling, "unclear");

  // Literal overlap is a safety signal for direct claims, not a semantic-fit
  // scorer. Valid transferable judgments survive vocabulary differences.
  const directDowngrade = ceiling === "direct" && coverage < 0.1;
  if (directDowngrade) ceiling = "strong_transferable";

  const responsibilitySignals = /\b(?:lead|own|executive|architect|manage|strategy|enterprise|production|deploy|administer)\w*\b/gi;
  const requiredSignals = row.requirement.match(responsibilitySignals) ?? [];
  const evidenceText = rows.map((candidate) => `${candidate.claim} ${candidate.scope}`).join(" ");
  if (requiredSignals.length && !requiredSignals.some((signal) => evidenceText.toLowerCase().includes(signal.toLowerCase()))) {
    ceiling = lowerClassification(ceiling, "strong_transferable");
  }
  if (row.category === "outcomes" && !/\b(?:improv|reduc|increas|accelerat|enhanc|enabled|result|outcome|\d+(?:\.\d+)?%?)\w*\b/i.test(evidenceText)) {
    ceiling = lowerClassification(ceiling, "adjacent_transferable");
  }
  return {
    classification: ceiling,
    evidenceIds: ids,
    originalEvidenceIds: originalIds,
    evidenceChanged,
    reason: ceiling === "direct"
      ? evidenceChanged
        ? "A unique in-scope evidence ID was resolved and its eligible evidence has sufficient requirement and scope coverage."
        : "Eligible evidence has sufficient requirement and scope coverage."
      : `Evidence coverage or scope supports at most ${ceiling.replaceAll("_", " ")}.`,
  };
}

function normalizedEmployerName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "").replace(/inc$/, "");
}

export function normalizeEvidenceClassifications(markdown: string, snapshot: EvidenceSnapshot): { markdown: string; adjustments: FitClassificationAdjustment[] } {
  const section = /###\s+Requirement Scoring\s*\n([\s\S]*?)(?=\n#{1,3}\s+|$)/i.exec(markdown);
  if (!section) return { markdown, adjustments: [] };
  const table = section[1];
  const lines = table.split("\n");
  const tableLines = lines.filter((line) => /^\s*\|.*\|\s*$/.test(line));
  if (tableLines.length < 3) return { markdown, adjustments: [] };
  const cells = (line: string) => line.trim().slice(1, -1).split("|").map((value) => value.trim().replaceAll("`", ""));
  const headers = cells(tableLines[0]).map(normalizedHeader);
  const indexes = {
    requirement: headers.indexOf("requirement"),
    category: headers.indexOf("category"),
    weight: headers.indexOf("weight"),
    material: headers.indexOf("material"),
    classification: headers.indexOf("classification"),
    evidence: headers.indexOf("evidence"),
  };
  if (Object.values(indexes).some((index) => index < 0)) return { markdown, adjustments: [] };
  const adjustments: FitClassificationAdjustment[] = [];
  const rewritten = lines.map((line) => {
    if (!/^\s*\|.*\|\s*$/.test(line) || /^\s*\|\s*:?-+/.test(line)) return line;
    const values = cells(line);
    const classification = (values[indexes.classification] ?? "").toLowerCase().replaceAll(" ", "_") as FitClassification;
    if (!FIT_CLASSIFICATIONS.includes(classification)) return line;
    const requirement: FitRequirement = {
      requirement: values[indexes.requirement] ?? "",
      category: (values[indexes.category] ?? "").toLowerCase().replaceAll(" ", "_") as FitCategory,
      weight: Number((values[indexes.weight] ?? "").replace("%", "")),
      material: /^(?:yes|true)$/i.test(values[indexes.material] ?? ""),
      classification,
      evidence: values[indexes.evidence] ?? "",
    };
    const ceiling = classificationCeiling(requirement, snapshot);
    const normalized = lowerClassification(classification, ceiling.classification);
    if (normalized === classification) return line;
    adjustments.push({
      requirement: requirement.requirement,
      from: classification,
      to: normalized,
      evidenceIds: ceiling.evidenceIds,
      reason: ceiling.reason,
      evidenceChanged: ceiling.evidenceChanged,
      originalEvidence: requirement.evidence,
      resolvedEvidence: ceiling.evidenceChanged ? ceiling.evidenceIds.join(", ") : requirement.evidence,
    });
    const rawCells = line.trim().slice(1, -1).split("|").map((value) => value.trim());
    rawCells[indexes.classification] = normalized;
    if (ceiling.evidenceChanged) rawCells[indexes.evidence] = ceiling.evidenceIds.join(", ");
    return `| ${rawCells.join(" | ")} |`;
  }).join("\n");
  return { markdown: markdown.replace(table, rewritten), adjustments };
}

/** Headings are matched by meaning, not exact text, across ATS formats (Workday, Greenhouse, Lever, Ashby, bank postings). */
const REQUIRED_HEADING = /\b(?:required|requirements?|minimum|basic qualifications|qualifications|what you(?:'|’)?ll need|what you need|what you(?:'|’)?ll bring|what you bring|what we(?:'|’)?re looking for|must[- ]haves?|you have|you(?:'|’)?ll have|who you are|about you|ideal candidate|(?:great|good) fit|a fit if|skills and experience)\b/i;
const NOT_REQUIRED_HEADING = /\b(?:preferred|nice|bonus|plus(?:es)?|desired|desirable|optional|extra credit|benefits|perks|compensation|salary|about us|about the company)\b/i;
/** A line that reads like a section heading: markdown heading, bold line, "Label:", or a short line without a full stop. */
function isHeadingLike(line: string): boolean {
  const trimmed = line.trim();
  if (/^\s*(?:[-*•▪◦]|\d+[.)])\s+/.test(line) || trimmed.length > 80) return false;
  return /^#/.test(trimmed) || /^\*\*[^*]+\*\*:?$/.test(trimmed) || /:$/.test(trimmed) || (trimmed.length <= 60 && !/[.!?]$/.test(trimmed));
}
function isRequiredHeading(text: string): boolean {
  return REQUIRED_HEADING.test(text) && !NOT_REQUIRED_HEADING.test(text);
}
const MAX_REQUIRED_ITEMS = 12;
/** Personality items are folded into observable work rows, never rated as must-haves. */
const SOFT_REQUIREMENT = /\b(?:communicat\w*|mindset|self-starter|ambiguity|team player|attitude|curious|curiosity|passion\w*|instincts?|detail-oriented|collaborat\w*|proactive|interpersonal|fast-paced|enthusias\w*|empath\w*|humble|hungry|grit)\b/i;
/** Logistics can't be shown by career evidence; their status is taken as written. */
const LOGISTICS_REQUIREMENT = /\b(?:authori[sz]ed|authori[sz]ation|visa|sponsorship|citizen\w*|clearance|relocat\w*|located|location|on-?site|in-office|travel|driver'?s licen[cs]e|background check|shifts?|weekends?)\b/i;

/**
 * The posting's required items: the bullets under its requirements heading, stopping at the
 * next heading (so "Nice to have" / "Preferred" never count). Empty when no such section exists.
 */
export function extractRequiredItems(jobDescription: string): string[] {
  const heading = (line: string) => line.replace(/^#+\s*/, "").replace(/[*_]/g, "").replace(/:\s*$/, "").trim();
  const bullet = /^\s*(?:[-*•▪◦]|\d+[.)])\s+(.*)$/;
  const lines = jobDescription.replaceAll("\r\n", "\n").split("\n");
  const items: string[] = [];
  let inside = false;
  for (const line of lines) {
    if (!line.trim()) continue;
    const item = bullet.exec(line)?.[1]?.replace(/[*_]/g, "").trim();
    if (inside && item) {
      if (!SOFT_REQUIREMENT.test(item)) items.push(item);
      continue;
    }
    if (inside && isHeadingLike(line)) {
      // A sub-heading like "Basic Qualifications" under "Qualifications" continues the section.
      if (!items.length && isRequiredHeading(heading(line))) continue;
      break;
    }
    if (inside && items.length) break;
    if (!inside && isHeadingLike(line) && isRequiredHeading(heading(line))) inside = true;
  }
  return items.slice(0, MAX_REQUIRED_ITEMS);
}

const RESPONSIBILITY_HEADING = /\b(?:responsibilit(?:y|ies)|what you(?:'|’)?ll do|what you will do|what you(?:'|’)?ll be doing|the role|in this role|your role|your impact|day[- ]to[- ]day|duties|what you(?:'|’)?ll work on)\b/i;

/**
 * The posting's responsibilities: bullets under its "What you'll do" heading. Plain sub-headings
 * inside that section are skipped; the next markdown or requirements heading ends it.
 */
export function extractResponsibilityItems(jobDescription: string): string[] {
  const heading = (line: string) => line.replace(/^#+\s*/, "").replace(/[*_]/g, "").replace(/:\s*$/, "").trim();
  const bullet = /^\s*(?:[-*•▪◦]|\d+[.)])\s+(.*)$/;
  const items: string[] = [];
  let inside = false;
  for (const line of jobDescription.replaceAll("\r\n", "\n").split("\n")) {
    if (!line.trim()) continue;
    const item = bullet.exec(line)?.[1]?.replace(/[*_]/g, "").trim();
    if (inside && item) {
      items.push(item);
      continue;
    }
    if (inside && (/^#/.test(line.trim()) || (isHeadingLike(line) && (isRequiredHeading(heading(line)) || NOT_REQUIRED_HEADING.test(heading(line)))))) {
      if (/^#/.test(line.trim()) && RESPONSIBILITY_HEADING.test(heading(line)) && !items.length) continue;
      break;
    }
    if (!inside && isHeadingLike(line) && RESPONSIBILITY_HEADING.test(heading(line))) inside = true;
  }
  return items.slice(0, MAX_REQUIRED_ITEMS);
}

const GENERIC_MUST_HAVE_TOKENS = new Set(["strong", "clear", "hands-on", "concept", "understanding", "including", "common", "similar", "role", "year", "years", "2+", "3+", "5+", "able", "comfort", "proficiency", "fluency", "familiarity", "solid", "good", "excellent", "plus", "etc", "other", "related", "both", "keep", "even", "when", "thing", "get", "hard", "natural"]);

function meaningfulTokens(value: string): Set<string> {
  return new Set([...fitTokens(value)].map((token) => token.replace(/\.+$/, "")).filter((token) => token.length >= 2 && !GENERIC_MUST_HAVE_TOKENS.has(token)));
}

/** The evidence row sharing the most concrete terms with a must-have, so the run can cite it. */
export function bestEvidenceForRequirement(requirement: string, rows: Array<{ evidenceId: string; claim: string; scope?: string | null }>): string | null {
  const wanted = meaningfulTokens(requirement);
  const rowTokens = rows.map((row) => meaningfulTokens(`${row.claim} ${row.scope ?? ""}`));
  // Rare shared terms (e.g. a specific language) outweigh terms many rows share (e.g. "data").
  const frequency = new Map<string, number>();
  for (const tokens of rowTokens) for (const token of tokens) if (wanted.has(token)) frequency.set(token, (frequency.get(token) ?? 0) + 1);
  let best: string | null = null;
  let bestScore = 0;
  rows.forEach((row, index) => {
    const score = [...rowTokens[index]!].filter((token) => wanted.has(token)).reduce((sum, token) => sum + 1 / (frequency.get(token) ?? 1), 0);
    if (score > bestScore) { best = row.evidenceId; bestScore = score; }
  });
  return best;
}

/**
 * Makes the Must-Have table answerable to the posting and the evidence:
 * - one row per required item in the posting (missing items count as learnable, "not assessed");
 * - rows the posting doesn't require are dropped, except blockers;
 * - "met" needs a real evidence ID whose claim shares a concrete term with the requirement,
 *   otherwise it becomes learnable.
 */
export function verifyMustHaves(markdown: string, requiredItems: string[], snapshot?: EvidenceSnapshot): { markdown: string; adjustments: string[] } {
  const rows = parseMustHaves(markdown);
  if (!requiredItems.length && !rows.length) return { markdown, adjustments: [] };
  const adjustments: string[] = [];
  const evidenceById = new Map((snapshot?.evidenceRows ?? []).map((row) => [row.evidenceId, `${row.claim} ${row.scope}`]));
  const idPattern = /must:(\d+)/i;
  const used = new Set<number>();
  const matchRow = (item: string, index: number): MustHaveRequirement | undefined => {
    const byId = rows.findIndex((row, rowIndex) => !used.has(rowIndex) && Number(idPattern.exec(row.requirement)?.[1]) === index + 1);
    if (byId >= 0) { used.add(byId); return rows[byId]; }
    let best = -1;
    let bestCoverage = 0.3;
    rows.forEach((row, rowIndex) => {
      if (used.has(rowIndex) || idPattern.test(row.requirement)) return;
      const coverage = tokenCoverage(row.requirement, item);
      if (coverage >= bestCoverage) { best = rowIndex; bestCoverage = coverage; }
    });
    if (best >= 0) { used.add(best); return rows[best]; }
    return undefined;
  };
  const verifyMet = (requirement: string, row: MustHaveRequirement): MustHaveRequirement => {
    if (row.status !== "met" || !snapshot || LOGISTICS_REQUIREMENT.test(requirement)) return row;
    const ids = evidenceIds(row.evidence).filter((id) => evidenceById.has(id));
    const wanted = meaningfulTokens(requirement);
    const shown = ids.some((id) => [...meaningfulTokens(evidenceById.get(id)!)].some((token) => wanted.has(token)));
    if (shown) return row;
    adjustments.push(`${requirement}: met -> learnable (cited evidence doesn't show it)`);
    return { ...row, status: "learnable", note: `${row.note ? `${row.note}; ` : ""}cited evidence doesn't show this` };
  };
  const shorten = (value: string) => {
    const sentence = value.split(/(?<=[.;])\s+/)[0]!.replace(/[.;]$/, "");
    return sentence.length > 100 ? `${sentence.slice(0, 97).trimEnd()}...` : sentence;
  };
  const verified: MustHaveRequirement[] = requiredItems.length
    ? requiredItems.map((item, index) => {
      const row = matchRow(item, index);
      if (!row) {
        adjustments.push(`${shorten(item)}: not assessed -> learnable`);
        return { requirement: shorten(item), status: "learnable" as const, evidence: "", note: "not assessed in the run" };
      }
      return verifyMet(item, { ...row, requirement: shorten(item) });
    })
    : rows.map((row) => verifyMet(row.requirement, row));
  if (requiredItems.length) {
    rows.forEach((row, rowIndex) => {
      if (used.has(rowIndex)) return;
      if (row.status === "blocker") verified.push(row);
      else adjustments.push(`${row.requirement}: dropped (not a required item in the posting)`);
    });
  }
  const table = [
    "### Must-Have Requirements",
    "| Requirement | Status | Evidence | Note |",
    "| --- | --- | --- | --- |",
    ...verified.map((row) => `| ${[row.requirement, row.status, row.evidence, row.note].map((cell) => cell.replaceAll("|", "/")).join(" | ")} |`),
  ].join("\n");
  const section = /###\s+Must-Have Requirements\s*\n[\s\S]*?(?=\n#{1,3}\s+|\n- \*\*|$)/i;
  const updated = section.test(markdown)
    ? markdown.replace(section, `${table}\n`)
    : markdown.replace(/(###\s+Requirement Scoring\s*\n(?:\s*\|.*\|\s*\n?)+)/i, `$1\n${table}\n`);
  return { markdown: updated, adjustments };
}

export function normalizeEvaluationScore(markdown: string, snapshot?: EvidenceSnapshot, requiredItems: string[] = []): string {
  const checked = verifyMustHaves(markdown, requiredItems, snapshot).markdown;
  const bounded = snapshot ? normalizeEvidenceClassifications(checked, snapshot) : { markdown: checked, adjustments: [] };
  const result = scoreEvaluation(bounded.markdown);
  if (!result) return bounded.markdown;
  const scoreLine = `- **Weighted Fit Score:** ${result.score.toFixed(2)} / 5`;
  const scorePattern = /^.*Weighted Fit Score\*{0,2}\s*:\*{0,2}\s*\d(?:\.\d+)?\s*\/\s*5(?:\.0)?.*$/im;
  let normalized = bounded.markdown
    .replace(/##\s+Executive Summary\s*\n[\s\S]*?(?=\n#{1,3}\s+|$)/gi, "")
    .replace(/###\s+(?:Category Summary Arithmetic|Category Arithmetic|Category Breakdown|Scoring Breakdown)\s*\n[\s\S]*?(?=\n#{1,3}\s+|$)/gi, "")
    .replace(/\s*\(\d(?:\.\d+)?\s*\/\s*5(?:\.0)?\)/g, "")
    .replace(/\n{3,}/g, "\n\n");
  normalized = scorePattern.test(normalized)
    ? normalized.replace(scorePattern, scoreLine)
    : normalized.replace(/^(#{1,2}\s+[^\n]+\n)/, `$1\n${scoreLine}\n`);
  const confidenceLine = `- **Fit Confidence:** ${result.confidence}`;
  const confidencePattern = /^.*Fit Confidence\*{0,2}\s*:\*{0,2}\s*[^\n]+$/im;
  normalized = confidencePattern.test(normalized)
    ? normalized.replace(confidencePattern, confidenceLine)
    : normalized.replace(scoreLine, `${scoreLine}\n${confidenceLine}`);
  const gateLine = `- **Gate Status:** ${gateStatusFor(result)}`;
  const gatePattern = /^.*Gate Status\*{0,2}\s*:\*{0,2}\s*[^\n]+$/im;
  normalized = gatePattern.test(normalized)
    ? normalized.replace(gatePattern, gateLine)
    : normalized.replace(confidenceLine, `${confidenceLine}\n${gateLine}`);

  const categoryLabels: Record<FitCategory, string> = {
    core: "Core responsibilities",
    technical: "Technical requirements",
    scope: "Scope and seniority",
    outcomes: "Outcomes",
    domain: "Domain",
    learning: "Learning and adaptability",
  };
  const categorySummary = [
    "### Category Summary",
    ...FIT_CATEGORIES.map((category) => `- **${categoryLabels[category]}:** ${result.categoryCredits[category].toFixed(1)} / ${EXPECTED_CATEGORY_WEIGHTS[category]}`),
    `- **Weighted total:** ${(result.rawScore * 20).toFixed(1)} / 100`,
    `- **Canonical fit score:** ${result.score.toFixed(2)} / 5`,
    ...(result.learnablePenalty ? [`- **Fit before must-have gaps:** ${(result.scoreBeforeMustHaves ?? result.score).toFixed(2)} / 5 (learnable must-haves: −${result.learnablePenalty.toFixed(2)})`] : []),
  ].join("\n");
  const categoryPattern = /###\s+Category Summary\s*\n[\s\S]*?(?=\n#{1,3}\s+|$)/i;
  normalized = categoryPattern.test(normalized)
    ? normalized.replace(categoryPattern, categorySummary)
    : normalized.replace(/(###\s+Requirement Scoring\s*\n)/i, `${categorySummary}\n\n$1`);

  const canonicalSections: Array<[RegExp, string, FitRequirement[]]> = [
    [/Direct Matches/i, "## Direct Matches", result.requirements.filter((row) => row.classification === "direct")],
    [/Transferable Evidence/i, "## Transferable Evidence", result.requirements.filter((row) => row.classification === "strong_transferable" || row.classification === "adjacent_transferable")],
    [/(?:Important Gaps|Gaps and Risks|Hard Blockers)/i, "## Important Gaps or Hard Blockers", result.requirements.filter((row) => row.classification === "gap" || row.classification === "unclear")],
  ];
  const mustHaveGaps = (result.mustHaves ?? []).filter((row) => row.status !== "met");
  for (const [heading, title, rows] of canonicalSections) {
    const isGaps = title.startsWith("## Important Gaps");
    const lines = [
      ...rows.map((row) => `- **${row.requirement}:** ${row.classification.replaceAll("_", " ")} (${row.evidence || "no eligible evidence"}).`),
      ...(isGaps ? mustHaveGaps.map((row) => `- **${row.requirement}** (must-have, ${row.status === "blocker" ? "hard blocker" : "learnable"})${row.note ? `: ${row.note}` : "."}`) : []),
    ];
    const body = lines.length ? lines.join("\n") : "- None identified in the calibrated requirement table.";
    const section = `${title}\n${body}`;
    const pattern = new RegExp(`##\\s+[^\\n]*${heading.source}[^\\n]*\\n[\\s\\S]*?(?=\\n##\\s+|$)`, "i");
    normalized = pattern.test(normalized) ? normalized.replace(pattern, section) : `${normalized.trimEnd()}\n\n${section}\n`;
  }
  const calibrationPattern = /\n?<!-- jobsensei-score-calibration:start -->[\s\S]*?<!-- jobsensei-score-calibration:end -->\n?/g;
  normalized = normalized.replace(calibrationPattern, "\n").trimEnd();
  if (bounded.adjustments.length) {
    const findings = bounded.adjustments.slice(0, 5).map((adjustment) => {
      const classification = adjustment.from === adjustment.to ? adjustment.to.replaceAll("_", " ") : `${adjustment.from.replaceAll("_", " ")} -> ${adjustment.to.replaceAll("_", " ")}`;
      return `- **${adjustment.requirement}:** ${classification}. ${adjustment.reason}`;
    }).join("\n");
    normalized += `\n\n<!-- jobsensei-score-calibration:start -->\n## Score Calibration\n${findings}\n<!-- jobsensei-score-calibration:end -->\n`;
  }
  return normalized;
}
import type { EvidenceSnapshot } from "../src/shared/schemas";
