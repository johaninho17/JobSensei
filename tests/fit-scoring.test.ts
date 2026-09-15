import { describe, expect, it } from "vitest";
import { calculateFitScore, normalizeEvidenceClassifications, normalizeEvaluationScore, scoreEvaluation, type FitRequirement } from "../electron/fit-scoring";
import type { EvidenceSnapshot } from "../src/shared/schemas";

const sampleRequirements: FitRequirement[] = [
  { requirement: "Own escalated issues end to end", category: "core", weight: 15, material: true, classification: "strong_transferable", evidence: "troubleshooting support" },
  { requirement: "Diagnose logs and root causes", category: "core", weight: 10, material: true, classification: "direct", evidence: "log diagnosis" },
  { requirement: "Build self-service internal tools", category: "core", weight: 8, material: true, classification: "adjacent_transferable", evidence: "SDK testing and SQL administration" },
  { requirement: "Maintain technical documentation", category: "core", weight: 4, material: false, classification: "direct", evidence: "technical guides" },
  { requirement: "Guide enterprise calls and engineering bugs", category: "core", weight: 3, material: true, classification: "strong_transferable", evidence: "customer discovery and coordination" },
  { requirement: "SQL, logs, and coding", category: "technical", weight: 20, material: true, classification: "direct", evidence: "SQL and troubleshooting" },
  { requirement: "Low-code internal tooling", category: "technical", weight: 5, material: false, classification: "strong_transferable", evidence: "automation foundation" },
  { requirement: "Customer-facing B2B work", category: "scope", weight: 8, material: true, classification: "direct", evidence: "customer solutions" },
  { requirement: "Formal CS, AM, and Engineering workflow", category: "scope", weight: 4, material: true, classification: "strong_transferable", evidence: "technical stakeholder coordination" },
  { requirement: "One to three years relevant experience", category: "scope", weight: 3, material: false, classification: "direct", evidence: "career chronology" },
  { requirement: "Faster investigations and resolution", category: "outcomes", weight: 10, material: true, classification: "adjacent_transferable", evidence: "activity without measured outcome" },
  { requirement: "B2B AI platform familiarity", category: "domain", weight: 3, material: false, classification: "direct", evidence: "AI platform work" },
  { requirement: "Recruiting and ATS integrations", category: "domain", weight: 2, material: false, classification: "gap", evidence: "none" },
  { requirement: "Startup learning and adaptability", category: "learning", weight: 5, material: false, classification: "direct", evidence: "small startup progression" },
];

describe("fit scoring", () => {
  it("rates a transferable sample match as credible rather than near-direct", () => {
    const result = calculateFitScore(sampleRequirements);
    expect(result.score).toBe(4.2);
    expect(result.score).toBeLessThanOrEqual(4.2);
    expect(result.confidence).toBe("medium");
    expect(result.materialTransferableCoreCount).toBeGreaterThan(1);
  });

  it("uses medium confidence when the evidence is consistently transferable without uncertainty", () => {
    const result = calculateFitScore(sampleRequirements.map((row) => ({
      ...row,
      classification: row.classification === "gap" ? "adjacent_transferable" : "strong_transferable",
    })));
    expect(result.confidence).toBe("medium");
  });

  it("parses the required evaluation table and applies deterministic arithmetic", () => {
    const rows = sampleRequirements.map((row) => `| ${row.requirement} | ${row.category} | ${row.weight}% | ${row.material ? "yes" : "no"} | ${row.classification} | ${row.evidence} |`).join("\n");
    const markdown = `# Evaluation\n\n### Requirement Scoring\n| Requirement | Category | Weight | Material | Classification | Evidence |\n| --- | --- | ---: | --- | --- | --- |\n${rows}\n\n## Direct Matches\n`;
    expect(scoreEvaluation(markdown)?.score).toBe(4.2);
  });

  it("rejects category-level arithmetic that does not preserve fixed weights", () => {
    expect(() => calculateFitScore(sampleRequirements.filter((row) => row.requirement !== "Startup learning and adaptability"))).toThrow(/learning requirements must total 5%/i);
  });

  it("makes deterministic arithmetic authoritative over a model-written score", () => {
    const rows = sampleRequirements.map((row) => `| ${row.requirement} | ${row.category} | ${row.weight}% | ${row.material ? "yes" : "no"} | ${row.classification} | ${row.evidence} |`).join("\n");
    const markdown = `# Evaluation\n\n- **Weighted Fit Score:** 4.90 / 5\n- **Fit Confidence:** high\n\n### Requirement Scoring\n| Requirement | Category | Weight | Material | Classification | Evidence |\n| --- | --- | ---: | --- | --- | --- |\n${rows}\n\n## Direct Matches\n`;
    const normalized = normalizeEvaluationScore(markdown);
    expect(normalized).toContain("**Weighted Fit Score:** 4.20 / 5");
    expect(normalized).toContain("**Fit Confidence:** medium");
    expect(normalized).not.toContain("4.90 / 5");
    expect(normalized).toContain("**Gate Status:** accepted");
    expect(normalized).toContain("### Category Summary");
    expect(normalized).toContain("**Canonical fit score:** 4.20 / 5");
  });

  it("replaces stale category summaries and explains a post-screening score below the gate", () => {
    const requirements = sampleRequirements.map((row) => ({ ...row, classification: row.category === "learning" ? row.classification : "gap" as const }));
    const rows = requirements.map((row) => `| ${row.requirement} | ${row.category} | ${row.weight}% | ${row.material ? "yes" : "no"} | ${row.classification} | ${row.evidence} |`).join("\n");
    const markdown = `# Evaluation\n\n- **Weighted Fit Score:** 4.70 / 5\n- **Fit Confidence:** high\n- **Gate Status:** accepted\n\n### Category Summary\n- Core responsibilities: 35 / 35\n- Canonical fit score: 4.70 / 5\n\n### Requirement Scoring\n| Requirement | Category | Weight | Material | Classification | Evidence |\n| --- | --- | ---: | --- | --- | --- |\n${rows}\n\n### Category Summary Arithmetic\n- Total Weighted Credit: 94 / 100 -> 4.70 / 5\n\n## Direct Matches\n- Example.\n`;
    const normalized = normalizeEvaluationScore(markdown);
    expect(normalized).toContain("accepted at screening; evidence-calibrated score below threshold");
    expect(normalized).not.toContain("35 / 35");
    expect(normalized.match(/### Category Summary/g)).toHaveLength(1);
    expect(normalized).not.toContain("Category Summary Arithmetic");
    expect(normalized).not.toContain("94 / 100");
  });

  it("caps LinkedIn-only current-employer evidence below direct", () => {
    const snapshot = {
      schemaVersion: 1,
      snapshotId: "snapshot-linkedin",
      jobId: "sample-role",
      generatedAt: "2026-08-05T00:00:00.000Z",
      manifestGeneratedAt: "2026-08-05T00:00:00.000Z",
      manifestHash: "manifest-linkedin",
      baseResumePath: "resumes/base.md",
      secondaryResumePaths: [],
      selectedStructuredPaths: ["context/structured/linkedin-profile.md"],
      selectedBroadPaths: [],
      selectedJobFiles: [],
      policyPaths: ["context/denylist.md"],
      sourceFiles: [],
      evidenceRows: [{
        evidenceId: "linkedin:northstar:solutions",
        year: "2023-present",
        recencyBand: "current",
        project: "Northstar Labs",
        employer: "Northstar Labs",
        claim: "Translated customer challenges into technical architectures.",
        scope: "Customer-facing architecture contribution.",
        sourcePath: "context/structured/linkedin-profile.md",
        sourceFamily: "linkedin-profile",
        sourceLocator: "Profile",
        confidence: "medium-high",
        classification: "verified",
        eligibility: "eligible",
      }],
      applicationRouting: {
        schemaVersion: 1,
        selectedEvidenceIds: ["linkedin:northstar:solutions"],
        routes: [{ evidenceId: "linkedin:northstar:solutions", relevanceScore: 80, employer: "Northstar Labs", timeline: "current", maximumClassification: "direct", sourceAuthority: "corroboration", reason: "Profile overlap." }],
        excludedEvidenceCount: 0,
      },
      denylistRules: [],
    } satisfies EvidenceSnapshot;
    const markdown = `# Evaluation\n\n### Requirement Scoring\n| Requirement | Category | Weight | Material | Classification | Evidence |\n| --- | --- | ---: | --- | --- | --- |\n| Translate customer requirements into technical solutions | core | 35% | yes | direct | linkedin:northstar:solutions |\n`;
    const result = normalizeEvidenceClassifications(markdown, snapshot);
    expect(result.markdown).toContain("| strong_transferable | linkedin:northstar:solutions |");
  });

  it("normalizes legacy evaluation labels without adding duplicate score lines", () => {
    const rows = sampleRequirements.map((row) => `| ${row.requirement} | ${row.category} | ${row.weight}% | ${row.material ? "yes" : "no"} | ${row.classification} | ${row.evidence} |`).join("\n");
    const markdown = `# Evaluation\n\n- **Weighted Fit Score**: 4.7 / 5.0\n- **Fit Confidence**: high\n\n### Requirement Scoring\n| Requirement | Category | Weight | Material | Classification | Evidence |\n| --- | --- | ---: | --- | --- | --- |\n${rows}\n`;
    const normalized = normalizeEvaluationScore(markdown);
    expect(normalized.match(/Weighted Fit Score/g)).toHaveLength(1);
    expect(normalized).toContain("**Weighted Fit Score:** 4.20 / 5");
    expect(normalized).toContain("**Fit Confidence:** medium");
  });

  it("accepts the evidence-prefixed IDs emitted by newer evaluations", () => {
    const rows = sampleRequirements.map((row) => `| ${row.requirement} | ${row.category} | ${row.weight}% | ${row.material ? "yes" : "no"} | ${row.classification} | evidence:context:${row.evidence.replaceAll(/[^a-z0-9]+/gi, ":")} |`).join("\n");
    const prefixed = `# Evaluation\n\n### Requirement Scoring\n| Requirement | Category | Weight | Material | Classification | Evidence |\n| --- | --- | ---: | --- | --- | --- |\n${rows}\n`;
    expect(scoreEvaluation(prefixed)?.score).toBe(4.2);
  });

  it("caps model-written direct matches at the routed evidence ceiling", () => {
    const snapshot = {
      schemaVersion: 1,
      snapshotId: "snapshot-1",
      jobId: "sample-role",
      generatedAt: "2026-08-05T00:00:00.000Z",
      manifestGeneratedAt: "2026-08-05T00:00:00.000Z",
      manifestHash: "manifest-1",
      baseResumePath: "resumes/base.md",
      secondaryResumePaths: [],
      selectedStructuredPaths: ["context/structured/work.md"],
      selectedBroadPaths: [],
      selectedJobFiles: [],
      policyPaths: ["context/denylist.md"],
      sourceFiles: [],
      evidenceRows: [{
        evidenceId: "context:work:api",
        year: "2025",
        project: "Northstar Labs",
        employer: "Northstar Labs",
        claim: "Supported customer API configuration and testing.",
        scope: "Support and testing scope.",
        sourcePath: "context/structured/work.md",
        sourceFamily: null,
        sourceLocator: "API section",
        confidence: "medium",
        classification: "corroboration-required",
        eligibility: "corroboration-required",
      }],
      applicationRouting: {
        schemaVersion: 1,
        selectedEvidenceIds: ["context:work:api"],
        routes: [{ evidenceId: "context:work:api", relevanceScore: 70, employer: "Northstar Labs", timeline: "recent", maximumClassification: "unclear", reason: "Needs corroboration." }],
        excludedEvidenceCount: 0,
      },
      denylistRules: [],
    } satisfies EvidenceSnapshot;
    const markdown = `# Evaluation\n\n### Requirement Scoring\n| Requirement | Category | Weight | Material | Classification | Evidence |\n| --- | --- | ---: | --- | --- | --- |\n| Own enterprise API architecture | core | 35% | yes | direct | context:work:api |\n`;
    const result = normalizeEvidenceClassifications(markdown, snapshot);
    expect(result.markdown).toContain("| unclear | context:work:api |");
    expect(result.adjustments).toEqual([expect.objectContaining({ from: "direct", to: "unclear", evidenceIds: ["context:work:api"] })]);
  });

  it("recognizes a semantic capability match without promoting it to direct experience", () => {
    const snapshot = {
      schemaVersion: 1,
      snapshotId: "snapshot-semantic",
      jobId: "data-role",
      generatedAt: "2026-08-05T00:00:00.000Z",
      manifestGeneratedAt: "2026-08-05T00:00:00.000Z",
      manifestHash: "manifest-semantic",
      baseResumePath: "resumes/base.md",
      secondaryResumePaths: [],
      selectedStructuredPaths: ["context/structured/data.md"],
      selectedBroadPaths: [],
      selectedJobFiles: [],
      policyPaths: ["context/denylist.md"],
      sourceFiles: [],
      evidenceRows: [{
        evidenceId: "context:data:looker",
        year: "2024",
        project: "PGBC",
        employer: "Northstar Labs",
        claim: "Built SQL queries and Looker views for operational log categorization.",
        scope: "Collaborative analytics implementation.",
        sourcePath: "context/structured/data.md",
        sourceFamily: null,
        sourceLocator: "Looker section",
        confidence: "medium",
        classification: "verified",
        eligibility: "eligible",
      }],
      applicationRouting: {
        schemaVersion: 1,
        selectedEvidenceIds: ["context:data:looker"],
        routes: [{ evidenceId: "context:data:looker", relevanceScore: 75, employer: "Northstar Labs", timeline: "prior", maximumClassification: "direct", sourceAuthority: "primary", reason: "Data capability match." }],
        excludedEvidenceCount: 0,
      },
      denylistRules: [],
    } satisfies EvidenceSnapshot;
    const markdown = `# Evaluation\n\n### Requirement Scoring\n| Requirement | Category | Weight | Material | Classification | Evidence |\n| --- | --- | ---: | --- | --- | --- |\n| Execute accurate data operations and audit dataset integrity | core | 35% | yes | direct | context:data:looker |\n`;
    const result = normalizeEvidenceClassifications(markdown, snapshot);
    expect(result.markdown).toContain("| strong_transferable | context:data:looker |");
    expect(result.markdown).not.toContain("| adjacent_transferable | context:data:looker |");

    const nearby = normalizeEvidenceClassifications(markdown.replace("context:data:looker", "context:data:looker-view"), snapshot);
    expect(nearby.markdown).toContain("| strong_transferable | context:data:looker |");
    expect(nearby.adjustments).toEqual([expect.objectContaining({
      evidenceChanged: true,
      originalEvidence: "context:data:looker-view",
      resolvedEvidence: "context:data:looker",
    })]);

    const stale = normalizeEvidenceClassifications(markdown.replace("context:data:looker", "context:data:legacy-query"), snapshot);
    expect(stale.markdown).toContain("| gap | context:data:legacy-query |");
    expect(stale.adjustments).toEqual([expect.objectContaining({
      evidenceChanged: false,
      originalEvidence: "context:data:legacy-query",
      resolvedEvidence: "context:data:legacy-query",
    })]);

    const baseRow = snapshot.evidenceRows[0]!;
    const ambiguousSnapshot = {
      ...snapshot,
      evidenceRows: [
        { ...baseRow, evidenceId: "context:data:looker-one" },
        { ...baseRow, evidenceId: "context:data:looker-two" },
      ],
      applicationRouting: {
        schemaVersion: 1 as const,
        selectedEvidenceIds: ["context:data:looker-one", "context:data:looker-two"],
        routes: [
          { ...snapshot.applicationRouting.routes[0]!, evidenceId: "context:data:looker-one" },
          { ...snapshot.applicationRouting.routes[0]!, evidenceId: "context:data:looker-two" },
        ],
        excludedEvidenceCount: 0,
      },
    } satisfies EvidenceSnapshot;
    const ambiguous = normalizeEvidenceClassifications(markdown.replace("context:data:looker", "context:data:looker-xxx"), ambiguousSnapshot);
    expect(ambiguous.markdown).toContain("| gap | context:data:looker-xxx |");
    expect(ambiguous.adjustments).toEqual([expect.objectContaining({ evidenceChanged: false })]);
  });

  it("normalizes bounded engineering synonyms without upgrading scope", () => {
    const snapshot = {
      schemaVersion: 1,
      snapshotId: "snapshot-synonyms",
      jobId: "support-role",
      generatedAt: "2026-09-01T00:00:00.000Z",
      manifestGeneratedAt: "2026-09-01T00:00:00.000Z",
      manifestHash: "manifest-synonyms",
      baseResumePath: "resumes/base.md",
      secondaryResumePaths: [],
      selectedStructuredPaths: ["context/structured/support.md"],
      selectedBroadPaths: [],
      selectedJobFiles: [],
      policyPaths: ["context/denylist.md"],
      sourceFiles: [],
      evidenceRows: [{
        evidenceId: "context:support:debugging",
        year: "2026",
        project: "Integration support",
        employer: "Northstar Labs",
        claim: "Troubleshot customer integration failures.",
        scope: "Debugging and support scope.",
        sourcePath: "context/structured/support.md",
        sourceFamily: "support",
        sourceLocator: "Debugging",
        confidence: "high",
        classification: "verified",
        eligibility: "eligible",
      }],
      applicationRouting: {
        schemaVersion: 1,
        selectedEvidenceIds: ["context:support:debugging"],
        routes: [{
          evidenceId: "context:support:debugging",
          relevanceScore: 90,
          employer: "Northstar Labs",
          timeline: "current",
          maximumClassification: "direct",
          sourceAuthority: "primary",
          reason: "Same debugging capability.",
        }],
        excludedEvidenceCount: 0,
      },
      denylistRules: [],
    } satisfies EvidenceSnapshot;
    const markdown = `# Evaluation\n\n### Requirement Scoring\n| Requirement | Category | Weight | Material | Classification | Evidence |\n| --- | --- | ---: | --- | --- | --- |\n| Diagnose client connector failures | core | 40% | yes | direct | context:support:debugging |\n`;
    const result = normalizeEvidenceClassifications(markdown, snapshot);
    expect(result.markdown).toContain("| direct | context:support:debugging |");
  });

  it("uses evidence-sensitive caps for material core uncertainty", () => {
    const mostlyDirect = sampleRequirements.map((row) => ({ ...row, classification: "direct" as const }));
    const strongCore = mostlyDirect.map((row, index) => ({
      ...row,
      classification: row.category === "core" && index < 2 ? "strong_transferable" as const : row.classification,
    }));
    expect(calculateFitScore(strongCore).score).toBe(4.3);
    const unclearCore = strongCore.map((row, index) => ({ ...row, classification: index === 0 ? "unclear" as const : row.classification }));
    expect(calculateFitScore(unclearCore).score).toBe(3.8);
    const gapCore = strongCore.map((row, index) => ({ ...row, classification: index === 0 ? "gap" as const : row.classification }));
    expect(calculateFitScore(gapCore).score).toBe(3.4);
  });

  it("does not treat a small non-role-defining core gap as a hard fit cap", () => {
    const mostlyDirect = sampleRequirements.map((row) => ({ ...row, classification: "direct" as const }));
    const minorGap = mostlyDirect.map((row) => row.category === "core" && row.weight === 4
      ? { ...row, material: true, classification: "gap" as const }
      : row);

    expect(calculateFitScore(minorGap).score).toBeGreaterThan(3.4);
  });

  it("removes stale narrative arithmetic and rebuilds match sections from the calibrated table", () => {
    const rows = sampleRequirements.map((row) => `| ${row.requirement} | ${row.category} | ${row.weight}% | ${row.material ? "yes" : "no"} | ${row.classification} | ${row.evidence} |`).join("\n");
    const markdown = `# Evaluation\n\n- **Weighted Fit Score:** 4.90 / 5\n\n## Executive Summary\nStrong fit (4.9 / 5.0).\n\n### Category Breakdown\n- Model-written total: 98%.\n\n### Requirement Scoring\n| Requirement | Category | Weight | Material | Classification | Evidence |\n| --- | --- | ---: | --- | --- | --- |\n${rows}\n\n## Direct Matches\n- Everything is direct.\n\n## Transferable Evidence\n- None.\n\n## Important Gaps or Hard Blockers\n- None.\n`;
    const normalized = normalizeEvaluationScore(markdown);
    expect(normalized).not.toContain("4.9 / 5.0");
    expect(normalized).not.toContain("Executive Summary");
    expect(normalized).not.toContain("Category Breakdown");
    expect(normalized).not.toContain("Everything is direct");
    expect(normalized).toContain("Recruiting and ATS integrations");
    expect(normalized).toContain("gap (none)");
  });
});
