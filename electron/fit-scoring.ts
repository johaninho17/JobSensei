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

export type FitScoreResult = {
  score: number;
  rawScore: number;
  confidence: "high" | "medium" | "low";
  directWeightPercent: number;
  directCorePercent: number;
  materialTransferableCoreCount: number;
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

const CREDIT: Record<FitClassification, number> = {
  direct: 1,
  strong_transferable: 0.8,
  adjacent_transferable: 0.65,
  unclear: 0.25,
  gap: 0,
};

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

export function scoreEvaluation(markdown: string): FitScoreResult | null {
  const requirements = parseFitRequirements(markdown);
  return requirements ? calculateFitScore(requirements) : null;
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

export function normalizeEvaluationScore(markdown: string, snapshot?: EvidenceSnapshot): string {
  const bounded = snapshot ? normalizeEvidenceClassifications(markdown, snapshot) : { markdown, adjustments: [] };
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
  const gateLine = `- **Gate Status:** ${result.score >= 3.5 ? "accepted" : "accepted at screening; evidence-calibrated score below threshold"}`;
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
  for (const [heading, title, rows] of canonicalSections) {
    const body = rows.length
      ? rows.map((row) => `- **${row.requirement}:** ${row.classification.replaceAll("_", " ")} (${row.evidence || "no eligible evidence"}).`).join("\n")
      : "- None identified in the calibrated requirement table.";
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
