import { describe, expect, it } from "vitest";
import { jobRequirements, normalizeEvaluationScore, parseFitRequirements, parseMustHaves } from "../electron/fit-scoring";
import type { EvidenceSnapshot } from "../src/shared/schemas";

// Agy rates the posting's own items (req:N); the app writes the posting's wording, the weights,
// and the must-have table, and checks each rating against the cited evidence.

const JD = [
  "# Solution Analyst - Northstar Bank",
  "## Responsibilities",
  "- Translate business needs into clear requirements for engineering",
  "- Build dashboards that track delivery progress",
  "## Required Qualifications",
  "- 3+ years of experience in solutions analysis",
  "- Strong knowledge of Jira, including building dashboards",
  "- Proficiency in SQL and data modeling",
  "- Must be authorized to work in the United States",
  "## Preferred Qualifications",
  "- Experience with the Northstar platform",
].join("\n");

function row(evidenceId: string, claim: string) {
  return {
    evidenceId, year: "2025", startYear: 2025, endYear: 2026, isOngoing: true, recencyBand: "current", project: "Northstar Labs",
    employer: "Northstar Labs", claim, scope: "Hands-on scope.", sourcePath: "context/structured/work.md", sourceFamily: null,
    sourceLocator: "Work", confidence: "high", classification: "verified", eligibility: "eligible",
  };
}

const snapshot = {
  schemaVersion: 1, snapshotId: "s1", jobId: "northstar-analyst", generatedAt: "2026-10-26T00:00:00Z", manifestGeneratedAt: "2026-10-26T00:00:00Z",
  manifestHash: "m1", baseResumePath: "resumes/base.md", secondaryResumePaths: [], selectedStructuredPaths: ["context/structured/work.md"],
  selectedBroadPaths: [], selectedJobFiles: [], policyPaths: [], sourceFiles: [], denylistRules: [],
  evidenceRows: [
    row("context:work:requirements", "Three years of solutions analysis: gathered customer requirements and wrote solution-fit scoping documents for engineering."),
    row("context:work:sql", "Modeled PostgreSQL tables and SQL data models for analytics dashboards."),
    row("context:work:dashboards", "Built Looker dashboards that track delivery progress for stakeholders."),
    row("context:work:teamwork", "Collaborated with cross-functional teams to maintain project alignment."),
  ],
} as unknown as EvidenceSnapshot;

describe("requirements come from the posting", () => {
  it("lists required items first, then responsibilities, with stable IDs", () => {
    const requirements = jobRequirements(JD);
    expect(requirements.map((item) => `${item.id} ${item.kind}`)).toEqual([
      "req:1 required", "req:2 required", "req:3 required", "req:4 required", "req:5 responsibility", "req:6 responsibility",
    ]);
    expect(requirements[1]!.text).toBe("Strong knowledge of Jira, including building dashboards");
  });
});

describe("scoring the posting's own requirements", () => {
  const requirements = jobRequirements(JD);
  // Agy's rows: short, ID first. req:3 is missing; req:2 claims Jira from an unrelated row.
  const agy = [
    "# Evaluation",
    "",
    "### Requirement Scoring",
    "| Requirement | Category | Classification | Evidence | Blocker |",
    "| --- | --- | --- | --- | --- |",
    "| req:1 analysis years | scope | direct | context:work:requirements | |",
    "| req:2 jira | technical | direct | context:work:teamwork | |",
    "| req:4 work authorization | scope | gap | | yes |",
    "| req:5 requirements | core | direct | context:work:requirements | |",
    "| req:6 dashboards | core | strong_transferable | context:work:dashboards | |",
    "| Extra row Agy invented | domain | direct | context:work:sql | |",
    "",
  ].join("\n");
  const normalized = normalizeEvaluationScore(agy, snapshot, requirements.filter((item) => item.kind === "required").map((item) => item.text), requirements);
  const rows = parseFitRequirements(normalized)!;

  it("writes one row per requirement in the posting's words and drops invented rows", () => {
    expect(rows.map((item) => item.requirement.slice(0, 5))).toEqual(["req:1", "req:2", "req:3", "req:4", "req:5", "req:6"]);
    expect(rows[1]!.requirement).toContain("Strong knowledge of Jira");
    expect(normalized).not.toContain("Extra row Agy invented");
  });

  it("rates a skipped requirement as a gap and checks ratings against the posting's wording", () => {
    expect(rows[2]!.classification).toBe("gap");
    // A collaboration row does not show Jira, so it cannot make the Jira item direct.
    expect(rows[1]!.classification).not.toBe("direct");
  });

  it("derives the must-have table from the required rows", () => {
    const mustHaves = parseMustHaves(normalized);
    expect(mustHaves.map((item) => item.status)).toEqual(["met", "learnable", "learnable", "blocker"]);
    expect(mustHaves[1]!.requirement).toContain("Jira");
  });

  it("sets weights from categories, rescaled over the categories present", () => {
    const total = rows.reduce((sum, item) => sum + item.weight, 0);
    expect(Math.round(total)).toBe(100);
    expect(rows.filter((item) => item.category === "core").reduce((sum, item) => sum + item.weight, 0)).toBeCloseTo(50, 0);
  });
});
